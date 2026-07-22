import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { checkWidgetKey } from '@/lib/widgetAuth';

// The app posts its APNs device token here (Phase 2). The push cron sends a
// silent background push to it so the app wakes, refreshes the shared cache,
// and reloads the widgets. Single user → one device token.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!checkWidgetKey(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body.token) return NextResponse.json({ error: 'no token' }, { status: 400 });
  await setDoc(doc(db, 'settings', 'device_token'), { token: body.token, updatedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
