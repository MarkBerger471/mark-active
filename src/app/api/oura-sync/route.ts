import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createSign } from 'crypto';
import http2 from 'http2';
import { checkWidgetKey } from '@/lib/widgetAuth';

// Morning Oura sync. A Netlify scheduled function hits this across the early
// morning; the moment last night's sleep is available in the Oura cloud it
// caches it to Firestore and fires ONE user-visible push ("Oura synced …") so
// the data reaches you without opening the Oura app OR this one.
//
// It cannot make the ring sync to the cloud — only the Oura app can do that
// (proprietary BLE). It automates the cloud→you hop; the ring→cloud hop still
// depends on Oura's own background sync.
//
// Reuses the same APNs env as /api/live-activity/push (APNS_P8, APNS_KEY_ID,
// APNS_TEAM_ID, APP_BUNDLE_ID, APNS_ENV, WIDGET_KEY). The APNs helpers are
// duplicated here rather than shared, deliberately — so a change here can never
// break the (health-critical) glucose Live Activity push.
export const dynamic = 'force-dynamic';

function base64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url');
}

function normalizePem(raw: string): string {
  const k = (raw || '').trim().replace(/\\n/g, '\n');
  const m = k.match(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/);
  const body = (m ? m[1] : k).replace(/[^A-Za-z0-9+/=]/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function apnsJwt(): string {
  const kid = process.env.APNS_KEY_ID!;
  const iss = process.env.APNS_TEAM_ID!;
  const key = normalizePem(process.env.APNS_P8 || '');
  const header = base64url(JSON.stringify({ alg: 'ES256', kid }));
  const payload = base64url(JSON.stringify({ iss, iat: Math.floor(Date.now() / 1000) }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const sig = base64url(signer.sign({ key, dsaEncoding: 'ieee-p1363' }));
  return `${header}.${payload}.${sig}`;
}

// Standard user-visible alert push (apns-push-type: alert).
function sendAlert(token: string, alert: { title: string; body: string }): Promise<{ status: number; body: string }> {
  const host = process.env.APNS_ENV === 'production'
    ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  const bundle = process.env.APP_BUNDLE_ID!;
  const jwt = apnsJwt();
  return new Promise((resolve, reject) => {
    const client = http2.connect(host);
    client.on('error', reject);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundle,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
    let status = 0;
    let data = '';
    req.on('response', h => { status = Number(h[':status']); });
    req.setEncoding('utf8');
    req.on('data', c => { data += c; });
    req.on('end', () => { client.close(); resolve({ status, body: data }); });
    req.on('error', e => { client.close(); reject(e); });
    req.end(JSON.stringify({ aps: { alert, sound: 'default' }, kind: 'oura-sync' }));
  });
}

// Oura total_sleep_duration is seconds → "7h 32m".
function fmtDur(sec?: number): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

interface OuraDay {
  day: string;
  score?: number;
  readinessScore?: number | null;
  totalSleep?: number;
}

export async function GET(req: Request) {
  if (!checkWidgetKey(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const origin = new URL(req.url).origin;
  // Server runs in UTC; the cron window (early morning) is well past local
  // midnight everywhere in Europe, so the UTC date == today's local wake-day,
  // which is how Oura dates a night's sleep.
  const today = new Date().toISOString().split('T')[0];

  const oura = await fetch(`${origin}/api/oura?days=3`, { cache: 'no-store' })
    .then(r => r.json())
    .catch(() => null);
  const days: OuraDay[] = Array.isArray(oura?.data) ? oura.data : [];
  const entry = days.find(d => d.day === today && d.score != null) || null;

  // Always refresh the cache record (cheap, and lets the app fall back to it).
  await setDoc(doc(db, 'settings', 'oura_cache'),
    { at: new Date().toISOString(), today, entry, data: days },
    { merge: true }).catch(() => {});

  if (!entry) {
    return NextResponse.json({ ok: true, synced: false, reason: 'no sleep for today yet' });
  }

  // Notify at most once per day, only after the data is actually present.
  const syncSnap = await getDoc(doc(db, 'settings', 'oura_sync'));
  const lastNotifiedDay = syncSnap.exists() ? (syncSnap.data().lastNotifiedDay as string | undefined) : undefined;
  if (lastNotifiedDay === today) {
    return NextResponse.json({ ok: true, synced: true, notified: false, reason: 'already notified today' });
  }

  const apnsReady = process.env.APNS_P8 && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APP_BUNDLE_ID;
  if (!apnsReady) {
    return NextResponse.json({ ok: true, synced: true, notified: false, reason: 'APNs not configured' });
  }

  const devSnap = await getDoc(doc(db, 'settings', 'device_token'));
  const token = devSnap.exists() ? (devSnap.data().token as string | undefined) : undefined;
  if (!token) {
    return NextResponse.json({ ok: true, synced: true, notified: false, reason: 'no device token registered' });
  }

  const parts = [`Sleep ${entry.score}`];
  if (entry.readinessScore != null) parts.push(`Readiness ${entry.readinessScore}`);
  const dur = fmtDur(entry.totalSleep);
  if (dur) parts.push(dur);
  const summary = parts.join(' · ');

  const res = await sendAlert(token, { title: 'Oura synced', body: summary }).catch(e => ({ status: 0, body: String(e) }));
  // Only mark notified on a real APNs accept (200), so a transient failure
  // retries on the next cron run instead of silently skipping the day.
  if (res.status === 200) {
    await setDoc(doc(db, 'settings', 'oura_sync'),
      { lastNotifiedDay: today, at: new Date().toISOString() },
      { merge: true }).catch(() => {});
  }
  return NextResponse.json({ ok: true, synced: true, notified: res.status === 200, apnsStatus: res.status, summary });
}
