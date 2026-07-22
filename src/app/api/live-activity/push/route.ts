import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { createSign } from 'crypto';
import http2 from 'http2';
import { checkWidgetKey } from '@/lib/widgetAuth';

// APNs push sender for the glucose Live Activity. Call this on a ~5-min cron
// (e.g. a Netlify scheduled function or cron-job.org hitting the URL). It reads
// the latest glucose + insulin summary and pushes an update to the running
// Live Activity.
//
// Required env (set in Netlify):
//   APNS_KEY_ID    – the 10-char Key ID of your APNs Auth Key (.p8)
//   APNS_TEAM_ID   – your 10-char Apple Team ID
//   APNS_P8        – the FULL contents of the .p8 file (newlines as real \n)
//   APP_BUNDLE_ID  – e.g. com.markberger.markactive
//   APNS_ENV       – 'production' or 'sandbox' (Xcode debug builds = sandbox)
//   WIDGET_KEY     – (optional) shared secret; then call with ?key=...
export const dynamic = 'force-dynamic';

function base64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url');
}

// Reconstruct a clean PKCS#8 PEM from however the .p8 got pasted into the env
// (single line, literal \n, spaces instead of newlines, \r\n, …). We strip to
// the base64 body and re-chunk to 64-char lines — robust against UI mangling.
function normalizePem(raw: string): string {
  let k = (raw || '').trim().replace(/\\n/g, '\n');
  const m = k.match(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/);
  const body = (m ? m[1] : k).replace(/[^A-Za-z0-9+/=]/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

// ES256 JWT for APNs provider auth (valid ~1h; we mint per-call).
function apnsJwt(): string {
  const kid = process.env.APNS_KEY_ID!;
  const iss = process.env.APNS_TEAM_ID!;
  const key = normalizePem(process.env.APNS_P8 || '');
  const header = base64url(JSON.stringify({ alg: 'ES256', kid }));
  const payload = base64url(JSON.stringify({ iss, iat: Math.floor(Date.now() / 1000) }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  // ieee-p1363 = raw r||s (JOSE) signature, which APNs/JWT expects.
  const sig = base64url(signer.sign({ key, dsaEncoding: 'ieee-p1363' }));
  return `${header}.${payload}.${sig}`;
}

interface HistPoint { value: number; timestamp: string; epoch?: number }
function downsample(history: HistPoint[], target: number): { v: number; t: number }[] {
  const map = (h: HistPoint) => ({ v: h.value, t: (h.epoch ?? Date.parse(h.timestamp)) || 0 });
  if (history.length <= target) return history.map(map);
  const step = history.length / target;
  const out: { v: number; t: number }[] = [];
  for (let i = 0; i < target; i++) out.push(map(history[Math.floor(i * step)]));
  return out;
}

function sendApns(token: string, aps: object): Promise<{ status: number; body: string }> {
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
      'apns-topic': `${bundle}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
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
    // APNs requires the Live Activity fields nested under an "aps" object.
    req.end(JSON.stringify({ aps }));
  });
}

export async function GET(req: Request) {
  if (!checkWidgetKey(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.APNS_P8 || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APP_BUNDLE_ID) {
    return NextResponse.json({ error: 'APNs not configured' }, { status: 501 });
  }
  const origin = new URL(req.url).origin;
  const keyQ = process.env.WIDGET_KEY ? `?key=${process.env.WIDGET_KEY}` : '';

  const [g, ins, tokSnap] = await Promise.all([
    fetch(`${origin}/api/glucose`).then(r => r.json()).catch(() => null),
    fetch(`${origin}/api/insulin-summary${keyQ}`).then(r => r.json()).catch(() => null),
    getDoc(doc(db, 'settings', 'live_activity_tokens')),
  ]);

  const token = tokSnap.exists() ? (tokSnap.data().updateToken as string | undefined) : undefined;
  if (!token) return NextResponse.json({ error: 'no live-activity token registered' }, { status: 404 });
  const cur = g?.current;
  if (!cur?.value) return NextResponse.json({ error: 'no glucose' }, { status: 502 });

  // last 6h only, for the mini graph
  const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
  const recent: HistPoint[] = (g.history || []).filter((h: { epoch?: number }) => (h.epoch ?? 0) >= sixHoursAgo);

  const nowSec = Math.floor(Date.now() / 1000);
  const contentState = {
    value: cur.value,
    mmol: cur.valueMmol,
    trend: cur.trend,
    epoch: cur.epoch,              // reading time (ms) → the widget shows its age
    iob: ins?.iob ?? 0,
    diaHours: ins?.diaHours ?? 4,  // for IOB time-left
    lastDose: ins?.lastDose ?? null, // {units, meal, carbs, glucoseBefore, timestamp}
    history: downsample(recent, 24), // compact 6h graph, ~24 pts
  };

  const aps = {
    timestamp: nowSec,
    event: 'update',
    'content-state': contentState,
    'stale-date': nowSec + 15 * 60,   // iOS greys it out if no update in 15 min
  };

  try {
    const res = await sendApns(token, aps);
    return NextResponse.json({ sent: res.status === 200, apnsStatus: res.status, apnsBody: res.body });
  } catch (e) {
    return NextResponse.json({ error: 'apns send failed', detail: String(e) }, { status: 502 });
  }
}
