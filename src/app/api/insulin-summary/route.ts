import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  calcIOB, DEFAULT_INSULIN_SETTINGS,
  type InsulinDose, type InsulinEvent, type InsulinSettings,
} from '@/utils/insulin';
import { checkWidgetKey } from '@/lib/widgetAuth';

// Server-side insulin summary for the lock/home-screen widgets + push sender.
// Reads the same Firestore blobs the app writes (settings/insulin_log,
// settings/insulin_settings) and returns the glanceable, INFORMATIONAL numbers:
// current IOB (active insulin) and the last dose. No dosing suggestion here —
// that stays in the app.
export const dynamic = 'force-dynamic';

async function readJsonSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const snap = await getDoc(doc(db, 'settings', key));
    if (!snap.exists()) return fallback;
    const raw = snap.data().value;
    if (typeof raw !== 'string') return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET(req: Request) {
  if (!checkWidgetKey(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const log = await readJsonSetting<InsulinEvent[]>('insulin_log', []);
  const stored = await readJsonSetting<Partial<InsulinSettings>>('insulin_settings', {});
  const settings: InsulinSettings = { ...DEFAULT_INSULIN_SETTINGS, ...stored };

  const doses = (Array.isArray(log) ? log : []).filter(
    (e): e is InsulinDose => !!e && e.kind === 'dose',
  );

  const now = new Date();
  const iob = calcIOB(doses, now, settings.diaHours);

  let last: InsulinDose | null = null;
  for (const d of doses) {
    if (!last || new Date(d.timestamp).getTime() > new Date(last.timestamp).getTime()) last = d;
  }

  return NextResponse.json(
    {
      iob,
      lastDose: last
        ? { units: last.actualUnits, meal: last.mealName, carbs: last.mealCarbs, timestamp: last.timestamp, glucoseBefore: last.glucoseBefore }
        : null,
      diaHours: settings.diaHours,
      updatedAt: now.toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
