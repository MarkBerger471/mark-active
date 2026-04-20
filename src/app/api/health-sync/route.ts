import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST: iOS Shortcut sends Apple Health data
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { secret, date, activeCalories, steps } = body;

    // Validate secret (read at request time for serverless compatibility)
    const syncSecret = process.env.HEALTH_SYNC_SECRET;
    if (!syncSecret || secret !== syncSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate required fields
    if (!date || activeCalories === undefined) {
      return NextResponse.json({ error: 'Missing date or activeCalories' }, { status: 400 });
    }

    // Store in Firestore
    const docRef = doc(db, 'health-activity', date);
    await setDoc(docRef, {
      date,
      activeCalories: Math.round(Number(activeCalories)),
      steps: Math.round(Number(steps || 0)),
      source: 'apple-watch',
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return NextResponse.json({ ok: true, date, activeCalories: Math.round(Number(activeCalories)) });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}

// GET: Dashboard fetches Apple Health activity data
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7') || 7, 1), 90);

  const result: Record<string, { activeCalories: number; steps: number; source: string }> = {};
  const now = new Date();

  // Fetch each day individually (small dataset, no need for collection query)
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split('T')[0];
    try {
      const docRef = doc(db, 'health-activity', dayStr);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        result[dayStr] = {
          activeCalories: data.activeCalories || 0,
          steps: data.steps || 0,
          source: data.source || 'apple-watch',
        };
      }
    } catch {}
  }

  return NextResponse.json({ activity: result }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
