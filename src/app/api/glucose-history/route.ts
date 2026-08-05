import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

// Reads the archived CGM day buckets (cgm/{date}) back as one merged series.
// Params: ?start=YYYY-MM-DD&end=YYYY-MM-DD, or ?days=N (default 14, max 60).
// A single range query on the `day` field (auto-indexed) — no composite index.
export const dynamic = 'force-dynamic';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Reading { t: number; v: number }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let start = searchParams.get('start');
  let end = searchParams.get('end');
  if (!(start && DATE.test(start) && end && DATE.test(end))) {
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '14') || 14, 1), 60);
    const now = new Date();
    end = now.toISOString().slice(0, 10);
    start = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  }

  try {
    const q = query(collection(db, 'cgm'), where('day', '>=', start), where('day', '<=', end));
    const snap = await getDocs(q);
    const readings: Reading[] = [];
    snap.forEach(d => {
      const arr = d.data().readings;
      if (Array.isArray(arr)) for (const r of arr) if (r && r.t > 0 && r.v > 0) readings.push({ t: r.t, v: r.v });
    });
    readings.sort((a, b) => a.t - b.t);
    return NextResponse.json({ start, end, count: readings.length, readings }, {
      // Archived history changes slowly; cache a few minutes at the edge.
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (e) {
    console.error('glucose-history error:', e);
    return NextResponse.json({ error: 'history fetch failed' }, { status: 500 });
  }
}
