// Repair cardio session durations.
// Sets durationMinutes = 30 + manualDuration: true on any cardio session
// where the current duration is suspect (< 5, > 120, missing, or 0).
// Sessions with reasonable durations (5–120 min) are left untouched.
//
// Run: node scripts/clean-cardio-durations.mjs

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

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

const DEFAULT_CARDIO_MIN = 30;
const SANE_MIN = 5;
const SANE_MAX = 120;

const snap = await getDocs(collection(db, 'trainingSessions'));
const cardio = snap.docs.filter(d => d.data().workoutName === 'Cardio');
console.log(`Found ${cardio.length} cardio sessions total.`);

let fixed = 0, kept = 0;
for (const d of cardio) {
  const data = d.data();
  const dur = data.durationMinutes;
  const isBad = dur == null || dur < SANE_MIN || dur > SANE_MAX;
  if (!isBad) {
    console.log(`  KEEP  ${data.date} dur=${dur}min`);
    kept++;
    continue;
  }
  console.log(`  FIX   ${data.date} dur=${dur} → ${DEFAULT_CARDIO_MIN}min`);
  await updateDoc(doc(db, 'trainingSessions', d.id), {
    durationMinutes: DEFAULT_CARDIO_MIN,
    manualDuration: true,
    lastModified: Date.now(),
  });
  fixed++;
}

console.log();
console.log(`Done: ${fixed} fixed, ${kept} kept as-is.`);
process.exit(0);
