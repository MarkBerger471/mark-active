// One-shot Firestore dump to a local JSON file.
// Run: node scripts/dump-data.mjs
// Output: data-snapshot.json (gitignored)

import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, getDoc, doc, query, orderBy } from 'firebase/firestore';

// Parse .env.local without adding dotenv as a dependency
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
const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

for (const [k, v] of Object.entries(firebaseConfig)) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function dumpCollection(name, orderField) {
  const q = orderField ? query(collection(db, name), orderBy(orderField, 'asc')) : collection(db, name);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function dumpDoc(colName, docId) {
  const snap = await getDoc(doc(db, colName, docId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

const started = Date.now();
console.log('Fetching Firestore…');

const [measurements, trainingSessions, settings, healthActivity, nutritionPlan] = await Promise.all([
  dumpCollection('measurements', 'date'),
  dumpCollection('trainingSessions'),
  dumpCollection('settings'),
  dumpCollection('health-activity'),
  dumpDoc('nutrition', 'plan'),
]);

// Settings is a flat k/v store — turn it into an object for convenience
const settingsObj = {};
for (const s of settings) {
  settingsObj[s.id] = s.value ?? s;
}

const snapshot = {
  dumpedAt: new Date().toISOString(),
  counts: {
    measurements: measurements.length,
    trainingSessions: trainingSessions.length,
    settings: settings.length,
    healthActivity: healthActivity.length,
    nutritionPlan: nutritionPlan ? 1 : 0,
  },
  measurements,
  trainingSessions,
  settings: settingsObj,
  healthActivity,
  nutritionPlan,
};

const outPath = new URL('../data-snapshot.json', import.meta.url);
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

console.log(`Done in ${Date.now() - started}ms`);
console.log(`Wrote ${outPath.pathname}`);
console.log('Counts:', snapshot.counts);
process.exit(0);
