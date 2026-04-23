// Delete malformed health-activity docs (anything where doc ID isn't YYYY-MM-DD).
// Run: node scripts/clean-health-activity.mjs

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = loadEnv();
const app = initializeApp({
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const db = getFirestore(app);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const snap = await getDocs(collection(db, 'health-activity'));
const bad = snap.docs.filter(d => !ISO.test(d.id));
console.log(`Found ${snap.docs.length} docs total, ${bad.length} malformed.`);

if (bad.length === 0) { console.log('Nothing to delete.'); process.exit(0); }

for (const d of bad) {
  console.log(`Deleting: ${d.id}`);
  await deleteDoc(doc(db, 'health-activity', d.id));
}
console.log(`Deleted ${bad.length} docs.`);
process.exit(0);
