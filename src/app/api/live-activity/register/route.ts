import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { checkWidgetKey } from '@/lib/widgetAuth';

// The app posts its Live Activity push token here when it starts an activity, so
// the push sender (../push) can address it. Single user → one active activity;
// we keep the latest tokens. `updateToken` addresses a running activity;
// `startToken` is the (iOS 17.2+) push-to-start channel token.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!checkWidgetKey(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { updateToken?: string; startToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (body.updateToken) patch.updateToken = body.updateToken;
  if (body.startToken) patch.startToken = body.startToken;
  if (!body.updateToken && !body.startToken) {
    return NextResponse.json({ error: 'no token' }, { status: 400 });
  }
  await setDoc(doc(db, 'settings', 'live_activity_tokens'), patch, { merge: true });
  return NextResponse.json({ ok: true });
}
