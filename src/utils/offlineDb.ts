import { openDB, IDBPDatabase } from 'idb';
import { Measurement, TrainingSession, NutritionPlan } from '@/types';

const DB_NAME = 'bb-tracker';
const DB_VERSION = 1;

export interface PendingSyncEntry {
  id?: number;
  collection: string;
  docId: string;
  operation: 'set' | 'delete';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  timestamp: number;
}

export interface PendingPhotoEntry {
  id?: number;
  measurementDate: string;
  angle: string;
  base64: string;
  timestamp: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbPromise: Promise<IDBPDatabase<any>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('measurements')) {
          db.createObjectStore('measurements', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('trainingSessions')) {
          db.createObjectStore('trainingSessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('nutrition')) {
          db.createObjectStore('nutrition');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('pendingSync')) {
          db.createObjectStore('pendingSync', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('pendingPhotos')) {
          db.createObjectStore('pendingPhotos', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

// Measurements
export async function getAllMeasurements(): Promise<Measurement[]> {
  const db = await getDB();
  const all = await db.getAll('measurements');
  return all.sort((a: Measurement, b: Measurement) => a.date.localeCompare(b.date));
}

export async function putMeasurement(m: Measurement) {
  const db = await getDB();
  await db.put('measurements', m);
}

export async function deleteMeasurementLocal(date: string) {
  const db = await getDB();
  await db.delete('measurements', date);
}

export async function bulkPutMeasurements(items: Measurement[]) {
  const db = await getDB();
  const tx = db.transaction('measurements', 'readwrite');
  await Promise.all([
    ...items.map((m) => tx.store.put(m)),
    tx.done,
  ]);
}

// Training Sessions
export async function getAllTrainingSessions(): Promise<TrainingSession[]> {
  const db = await getDB();
  return db.getAll('trainingSessions');
}

export async function putTrainingSession(s: TrainingSession) {
  const db = await getDB();
  await db.put('trainingSessions', s);
}

export async function deleteTrainingSessionLocal(id: string) {
  const db = await getDB();
  await db.delete('trainingSessions', id);
}

export async function bulkPutTrainingSessions(items: TrainingSession[]) {
  const db = await getDB();
  const tx = db.transaction('trainingSessions', 'readwrite');
  await Promise.all([
    ...items.map((s) => tx.store.put(s)),
    tx.done,
  ]);
}

// Nutrition
export async function getNutritionPlanLocal(): Promise<NutritionPlan | null> {
  const db = await getDB();
  return (await db.get('nutrition', 'plan')) || null;
}

export async function putNutritionPlanLocal(plan: NutritionPlan) {
  const db = await getDB();
  await db.put('nutrition', plan, 'plan');
}

// Settings
export async function getSettingLocal(key: string): Promise<string | null> {
  const db = await getDB();
  const val = await db.get('settings', key);
  return val ?? null;
}

export async function putSettingLocal(key: string, value: string) {
  const db = await getDB();
  await db.put('settings', value, key);
}

export async function deleteSettingLocal(key: string) {
  const db = await getDB();
  await db.delete('settings', key);
}

// Pending Sync Queue
export async function addPendingSync(entry: Omit<PendingSyncEntry, 'id'>) {
  const db = await getDB();
  await db.add('pendingSync', entry);
}

export async function getAllPendingSync(): Promise<PendingSyncEntry[]> {
  const db = await getDB();
  return db.getAll('pendingSync');
}

export async function deletePendingSync(id: number) {
  const db = await getDB();
  await db.delete('pendingSync', id);
}

// Pending Photos Queue
export async function addPendingPhoto(entry: Omit<PendingPhotoEntry, 'id'>) {
  const db = await getDB();
  await db.add('pendingPhotos', entry);
}

export async function getAllPendingPhotos(): Promise<PendingPhotoEntry[]> {
  const db = await getDB();
  return db.getAll('pendingPhotos');
}

export async function deletePendingPhoto(id: number) {
  const db = await getDB();
  await db.delete('pendingPhotos', id);
}

// Check if a doc has pending sync entries (to avoid overwriting local changes during refresh)
export async function hasPendingSyncFor(collection: string, docId: string): Promise<boolean> {
  const all = await getAllPendingSync();
  return all.some((e) => e.collection === collection && e.docId === docId);
}
