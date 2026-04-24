import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, collection, addDoc } from 'firebase/firestore';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Log a bad payload so we can see what the Shortcut is actually sending
async function logError(reason: string, payload: unknown) {
  try {
    await addDoc(collection(db, 'health-sync-errors'), {
      reason,
      payload,
      at: new Date().toISOString(),
    });
  } catch {}
}

// POST: iOS Shortcut sends Apple Health data
export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    await logError('invalid-json', { raw: 'unparseable' });
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const { secret, date, activeCalories, steps } = body as {
    secret?: string; date?: string; activeCalories?: unknown; steps?: unknown;
  };

  const syncSecret = process.env.HEALTH_SYNC_SECRET;
  if (!syncSecret || secret !== syncSecret) {
    await logError('unauthorized', { date, activeCalories, steps, hasSecret: Boolean(secret) });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Date must be YYYY-MM-DD — reject the localized "15. April 2026 at 09:57" format
  if (typeof date !== 'string' || !ISO_DATE.test(date)) {
    await logError('bad-date-format', { date, expected: 'YYYY-MM-DD' });
    return NextResponse.json({
      error: 'date must be YYYY-MM-DD format',
      got: date,
      hint: 'In iOS Shortcut: Format Date → Custom Format → "yyyy-MM-dd"',
    }, { status: 400 });
  }

  // activeCalories must be a positive number — reject nulls / zero / strings that don't parse
  const cal = Number(activeCalories);
  if (!isFinite(cal) || cal <= 0) {
    await logError('bad-active-calories', { date, activeCalories });
    return NextResponse.json({
      error: 'activeCalories must be a positive number',
      got: activeCalories,
      hint: 'In iOS Shortcut: use "Find Health Samples → Active Energy → Today" then "Calculate Statistics → Sum"',
    }, { status: 400 });
  }

  const stepCount = Math.round(Number(steps || 0));

  try {
    await setDoc(doc(db, 'health-activity', date), {
      date,
      activeCalories: Math.round(cal),
      steps: isFinite(stepCount) ? stepCount : 0,
      source: 'apple-watch',
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[health-sync] setDoc failed:', msg, e);
    await logError('firestore-write-failed', { date, message: msg });
    return NextResponse.json({ error: 'Storage failed', detail: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, date, activeCalories: Math.round(cal), steps: stepCount });
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
    // Apple Watch syncs every few min via iOS Shortcut. 2 min fresh + 3 min stale.
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=180' },
  });
}
