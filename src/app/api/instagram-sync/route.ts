import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

// POST: IFTTT sends new Instagram post URL
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { secret, url, caption, imageUrl, timestamp } = body;

    const syncSecret = process.env.HEALTH_SYNC_SECRET;
    if (!syncSecret || secret !== syncSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!url) {
      return NextResponse.json({ error: 'Missing URL' }, { status: 400 });
    }

    // Extract post ID from URL
    const idMatch = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    const postId = idMatch ? idMatch[2] : Date.now().toString();

    const docRef = doc(db, 'instagram-feed', postId);
    await setDoc(docRef, {
      url,
      postId,
      caption: caption || '',
      imageUrl: imageUrl || '',
      timestamp: timestamp || new Date().toISOString(),
      account: 'gmbadass',
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, postId });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}

// GET: Fetch latest Instagram posts
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const count = parseInt(searchParams.get('count') || '5');

    const q = query(collection(db, 'instagram-feed'), orderBy('createdAt', 'desc'), limit(count));
    const snap = await getDocs(q);
    const posts = snap.docs.map(d => d.data());

    return NextResponse.json({ posts });
  } catch (e) {
    return NextResponse.json({ posts: [] });
  }
}
