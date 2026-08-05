import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { checkWidgetKey } from '@/lib/widgetAuth';

// CGM archiver. LibreLinkUp only serves a rolling ~12h window, so on a ~15-min
// cron this route pulls that window and MERGES it into day buckets
// (cgm/{YYYY-MM-DD}) in Firestore — mirroring the health-activity/{date} pattern.
//
// It is strictly append/dedup by timestamp: it never recomputes or overwrites a
// reading, so re-running over the overlapping window is idempotent and safe.
// Buckets are keyed by UTC date (a storage partition, not a "night"); the read
// API stitches a range back together, so the boundary is irrelevant.
export const dynamic = 'force-dynamic';

interface Reading { t: number; v: number }
interface RawPoint { epoch?: number; timestamp?: string; value?: number }

export async function GET(req: Request) {
  if (!checkWidgetKey(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const origin = new URL(req.url).origin;
  const g = await fetch(`${origin}/api/glucose`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
  const hist: RawPoint[] = Array.isArray(g?.history) ? g.history : [];
  const fresh: Reading[] = hist
    .map(p => ({ t: Number(p.epoch) || Date.parse(p.timestamp || '') || 0, v: Number(p.value) || 0 }))
    .filter(p => p.t > 0 && p.v > 0);
  if (!fresh.length) return NextResponse.json({ ok: true, added: 0, reason: 'no readings from /api/glucose' });

  // group incoming readings by their UTC date
  const byDay = new Map<string, Reading[]>();
  for (const r of fresh) {
    const day = new Date(r.t).toISOString().slice(0, 10);
    let arr = byDay.get(day);
    if (!arr) { arr = []; byDay.set(day, arr); }
    arr.push(r);
  }

  let added = 0;
  for (const [day, incoming] of byDay) {
    const ref = doc(db, 'cgm', day);
    const snap = await getDoc(ref);
    const existing: Reading[] = snap.exists() && Array.isArray(snap.data().readings) ? snap.data().readings : [];
    const map = new Map<number, number>();
    for (const r of existing) map.set(r.t, r.v);
    const before = map.size;
    for (const r of incoming) map.set(r.t, r.v);   // dedup by exact epoch
    added += map.size - before;
    const merged = [...map.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
    await setDoc(ref, { day, readings: merged, count: merged.length, updatedAt: new Date().toISOString() }, { merge: true });
  }

  return NextResponse.json({ ok: true, days: [...byDay.keys()], seen: fresh.length, added });
}
