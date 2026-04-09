import { Measurement, TrainingDay, NutritionPlan, NutritionPlanVersion, DayPlan, Workout, TrainingSession } from '@/types';
import { db, storage } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import {
  getAllMeasurements as idbGetMeasurements,
  putMeasurement as idbPutMeasurement,
  deleteMeasurementLocal as idbDeleteMeasurement,
  bulkPutMeasurements,
  getAllTrainingSessions as idbGetSessions,
  putTrainingSession as idbPutSession,
  deleteTrainingSessionLocal as idbDeleteSession,
  bulkPutTrainingSessions,
  getNutritionPlanLocal as idbGetNutrition,
  putNutritionPlanLocal as idbPutNutrition,
  getSettingLocal as idbGetSetting,
  putSettingLocal as idbPutSetting,
  deleteSettingLocal as idbDeleteSetting,
  addPendingSync,
  getAllPendingSync,
  deletePendingSync,
  addPendingPhoto,
  getAllPendingPhotos,
  deletePendingPhoto,
  hasPendingSyncFor,
} from './offlineDb';

// Strip undefined values recursively — Firestore rejects undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripUndefined(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (typeof obj === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clean: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) clean[k] = stripUndefined(v);
    }
    return clean;
  }
  return obj;
}

// Background refresh: pull from Firestore into IndexedDB when online
function backgroundRefreshMeasurements() {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  // Defer to avoid blocking initial render
  setTimeout(() => (async () => {
    try {
      const q = query(collection(db, 'measurements'), orderBy('date', 'asc'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => d.data() as Measurement);
      // Only overwrite docs without pending sync
      for (const m of items) {
        const pending = await hasPendingSyncFor('measurements', m.date);
        if (!pending) await idbPutMeasurement(m);
      }
    } catch (e) {
      console.warn('Background refresh measurements failed:', e);
    }
  })(), 2000);
}

function backgroundRefreshSessions() {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  setTimeout(() => (async () => {
    try {
      const snap = await getDocs(collection(db, 'trainingSessions'));
      const items = snap.docs.map(d => d.data() as TrainingSession);
      for (const s of items) {
        const pending = await hasPendingSyncFor('trainingSessions', s.id);
        if (!pending) await idbPutSession(s);
      }
    } catch (e) {
      console.warn('Background refresh sessions failed:', e);
    }
  })(), 3000);
}

function backgroundRefreshNutrition() {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  setTimeout(() => (async () => {
    try {
      const snap = await getDoc(doc(db, 'nutrition', 'plan'));
      if (snap.exists()) {
        const data = snap.data();
        // Only accept new format (has 'current' key); skip legacy data
        if (!data.current) return;
        const pending = await hasPendingSyncFor('nutrition', 'plan');
        if (!pending) await idbPutNutrition(data as NutritionPlan);
      }
    } catch (e) {
      console.warn('Background refresh nutrition failed:', e);
    }
  })(), 4000);
}

function backgroundRefreshSetting(key: string) {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  setTimeout(() => (async () => {
    try {
      const snap = await getDoc(doc(db, 'settings', key));
      const pending = await hasPendingSyncFor('settings', key);
      if (!pending) {
        if (snap.exists()) {
          await idbPutSetting(key, snap.data().value);
        }
      }
    } catch (e) {
      console.warn('Background refresh setting failed:', e);
    }
  })(), 2000);
}

// Auth (localStorage for offline persistence)
export function isSessionValid(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('bb_session') === 'true';
}

export function setSession(valid: boolean) {
  if (valid) {
    localStorage.setItem('bb_session', 'true');
  } else {
    localStorage.removeItem('bb_session');
  }
}

// Settings — offline-first
export async function getSetting(key: string): Promise<string | null> {
  try {
    const local = await idbGetSetting(key);
    backgroundRefreshSetting(key);
    return local;
  } catch (e) {
    console.error('getSetting error:', e);
    return null;
  }
}

export async function saveSetting(key: string, value: string | null) {
  if (value === null) {
    await idbDeleteSetting(key);
    await addPendingSync({
      collection: 'settings',
      docId: key,
      operation: 'delete',
      timestamp: Date.now(),
    });
  } else {
    await idbPutSetting(key, value);
    await addPendingSync({
      collection: 'settings',
      docId: key,
      operation: 'set',
      data: { value },
      timestamp: Date.now(),
    });
  }
  flushSyncQueue();
}

// Measurements — offline-first
export async function getMeasurements(): Promise<Measurement[]> {
  try {
    const local = await idbGetMeasurements();
    backgroundRefreshMeasurements();
    return local;
  } catch (e) {
    console.error('getMeasurements error:', e);
    return [];
  }
}

export async function saveMeasurement(measurement: Measurement) {
  const toSave = { ...measurement, savedAt: measurement.savedAt || new Date().toISOString() };

  // Queue base64 photos for background upload, but keep them in local data
  const localPhotos: Record<string, string> = {};
  const firestorePhotos: Record<string, string> = {};
  if (toSave.photos) {
    for (const [angle, val] of Object.entries(toSave.photos)) {
      if (!val) continue;
      if (val.startsWith('data:')) {
        // Queue photo for upload when online
        await addPendingPhoto({
          measurementDate: toSave.date,
          angle,
          base64: val,
          timestamp: Date.now(),
        });
        localPhotos[angle] = val; // Keep base64 in local DB for display
      } else {
        localPhotos[angle] = val;
        firestorePhotos[angle] = val;
      }
    }
  }
  // Local copy keeps base64 for display; Firestore copy only has URLs
  const localMeasurement = { ...toSave, photos: localPhotos };
  toSave.photos = firestorePhotos;

  // Save to IndexedDB with base64 photos for local display
  await idbPutMeasurement(localMeasurement);

  // Queue for Firestore sync
  await addPendingSync({
    collection: 'measurements',
    docId: toSave.date,
    operation: 'set',
    data: stripUndefined(toSave),
    timestamp: Date.now(),
  });

  flushSyncQueue();
}

export async function deleteMeasurement(date: string) {
  await idbDeleteMeasurement(date);
  await addPendingSync({
    collection: 'measurements',
    docId: date,
    operation: 'delete',
    timestamp: Date.now(),
  });
  flushSyncQueue();
}

// Training Sessions — offline-first
export async function getTrainingSessions(): Promise<TrainingSession[]> {
  try {
    const local = await idbGetSessions();
    backgroundRefreshSessions();
    return local;
  } catch (e) {
    console.error('getTrainingSessions error:', e);
    return [];
  }
}

export async function saveTrainingSession(session: TrainingSession) {
  const allLocal = await idbGetSessions();
  const existing = allLocal.find(s => s.id === session.id);
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  if (existing) {
    // Preserve startedAt (first save time)
    session.startedAt = existing.startedAt || existing.savedAt || now;

    if (session.manualDuration) {
      // User manually set duration — preserve it, only update savedAt for past days
      session.savedAt = session.date < today ? (existing.savedAt || now) : now;
    } else if (existing.manualDuration) {
      // Previously manually set — preserve duration and flag
      session.savedAt = existing.savedAt;
      session.durationMinutes = existing.durationMinutes;
      session.manualDuration = true;
    } else if (session.date < today && existing.durationMinutes != null) {
      // Past day + already frozen — preserve both
      session.savedAt = existing.savedAt;
      session.durationMinutes = existing.durationMinutes;
    } else if (session.date < today) {
      // Past day + not yet frozen — freeze now
      session.savedAt = existing.savedAt || now;
      const dur = Math.round((new Date(session.savedAt).getTime() - new Date(session.startedAt).getTime()) / 60000);
      session.durationMinutes = Math.max(dur, 0);
    } else {
      // Same day, still in progress — update savedAt and live duration
      session.savedAt = now;
      const dur = Math.round((new Date(now).getTime() - new Date(session.startedAt).getTime()) / 60000);
      session.durationMinutes = Math.max(dur, 0);
    }
  } else {
    session.startedAt = session.startedAt || now;
    session.savedAt = now;
    session.durationMinutes = 0;
  }

  await idbPutSession(session);

  await addPendingSync({
    collection: 'trainingSessions',
    docId: session.id,
    operation: 'set',
    data: stripUndefined(session),
    timestamp: Date.now(),
  });

  flushSyncQueue();
}

export async function updateSessionDuration(id: string, minutes: number) {
  const allLocal = await idbGetSessions();
  const session = allLocal.find(s => s.id === id);
  if (!session) return;
  session.durationMinutes = minutes;
  session.manualDuration = true;
  await idbPutSession(session);
  await addPendingSync({
    collection: 'trainingSessions',
    docId: session.id,
    operation: 'set',
    data: stripUndefined(session),
    timestamp: Date.now(),
  });
  flushSyncQueue();
}

export async function deleteTrainingSession(id: string) {
  await idbDeleteSession(id);
  await addPendingSync({
    collection: 'trainingSessions',
    docId: id,
    operation: 'delete',
    timestamp: Date.now(),
  });
  flushSyncQueue();
}

export async function getLastSessionForWorkout(workoutName: string): Promise<TrainingSession | null> {
  try {
    const all = await idbGetSessions();
    const matching = all
      .filter(s => s.workoutName === workoutName)
      .sort((a, b) => (b.savedAt || b.date || '').localeCompare(a.savedAt || a.date || ''));
    return matching[0] || null;
  } catch (e) {
    console.error('getLastSessionForWorkout error:', e);
    return null;
  }
}

// Preset workouts (static, no persistence needed)
export function getPresetWorkouts(): Workout[] {
  return [
    {
      name: 'Shoulders + Abs',
      exercises: [
        { name: 'Lateral raises dumbbells (seated)', targetReps: '6-8', sets: [
          { weight: 10, isWarmup: true },
          { weight: 14, isWarmup: false }, { weight: 16, isWarmup: false }, { weight: 16, isWarmup: false }, { weight: 16, isWarmup: false },
        ]},
        { name: 'Shoulders press dumbbells', targetReps: '6-8', sets: [
          { weight: 16, isWarmup: true },
          { weight: 26, isWarmup: false }, { weight: 27.5, isWarmup: false }, { weight: 27.5, isWarmup: false },
        ]},
        { name: 'Front raises dumbbells', targetReps: '8-10', sets: [
          { weight: 8, isWarmup: true },
          { weight: 12, isWarmup: false }, { weight: 12, isWarmup: false }, { weight: 12, isWarmup: false },
        ]},
        { name: 'Shoulders press machine', targetReps: '6-8', sets: [
          { weight: 80, isWarmup: true },
          { weight: 100, isWarmup: false }, { weight: 100, isWarmup: false }, { weight: 100, isWarmup: false },
        ]},
        { name: 'Upright row', targetReps: '8-10', sets: [
          { weight: 40, isWarmup: true },
          { weight: 50, isWarmup: false }, { weight: 50, isWarmup: false }, { weight: 50, isWarmup: false },
        ]},
        { name: 'Reverse fly machine', targetReps: '8-10', sets: [
          { weight: 6, isWarmup: true },
          { weight: 10, isWarmup: false }, { weight: 10, isWarmup: false }, { weight: 12, isWarmup: false }, { weight: 12, isWarmup: false },
        ]},
        { name: 'Face pull', targetReps: '8-10', sets: [
          { weight: 30, isWarmup: true },
          { weight: 40, isWarmup: false }, { weight: 50, isWarmup: false }, { weight: 50, isWarmup: false }, { weight: 50, isWarmup: false },
        ]},
        { name: 'Abs (sit ups, flutter kicks)', targetReps: '15-20', notes: '3 sets each', sets: [
          { weight: 0, isWarmup: false }, { weight: 0, isWarmup: false }, { weight: 0, isWarmup: false },
        ]},
      ],
    },
    {
      name: 'Legs',
      exercises: [
        { name: 'Leg extension', targetReps: '6-8', sets: [
          { weight: 30, isWarmup: true }, { weight: 50, isWarmup: true }, { weight: 70, isWarmup: true },
          { weight: 100, isWarmup: false }, { weight: 120, isWarmup: false }, { weight: 120, isWarmup: false }, { weight: 140, isWarmup: false },
        ]},
        { name: 'Leg curl seated', targetReps: '6-8', sets: [
          { weight: 50, isWarmup: true },
          { weight: 75, isWarmup: false }, { weight: 80, isWarmup: false }, { weight: 80, isWarmup: false },
        ]},
        { name: 'Walking lunges', targetReps: '15 each leg', notes: 'Watch knee', sets: [
          { weight: 8, isWarmup: true },
          { weight: 32, isWarmup: false }, { weight: 32, isWarmup: false }, { weight: 32, isWarmup: false },
        ]},
        { name: 'Dead lift Romanian', targetReps: '8-10', sets: [
          { weight: 60, isWarmup: true },
          { weight: 80, isWarmup: false }, { weight: 100, isWarmup: false }, { weight: 100, isWarmup: false }, { weight: 100, isWarmup: false },
        ]},
        { name: 'Hyperextension', targetReps: '12-15', sets: [
          { weight: 20, isWarmup: false }, { weight: 20, isWarmup: false }, { weight: 20, isWarmup: false },
        ]},
        { name: 'Hip abduction', targetReps: '8-10', sets: [
          { weight: 80, isWarmup: true },
          { weight: 102.5, isWarmup: false }, { weight: 102.5, isWarmup: false }, { weight: 102.5, isWarmup: false },
        ]},
        { name: 'Hip adduction', targetReps: '8-10', sets: [
          { weight: 80, isWarmup: true },
          { weight: 102.5, isWarmup: false }, { weight: 102.5, isWarmup: false }, { weight: 102.5, isWarmup: false },
        ]},
        { name: 'Leg press machine (wide stand)', targetReps: '8-10', sets: [
          { weight: 100, isWarmup: true },
          { weight: 200, isWarmup: false }, { weight: 200, isWarmup: false }, { weight: 200, isWarmup: false },
        ]},
        { name: 'Calve raises', targetReps: '15-20', sets: [
          { weight: 100, isWarmup: true },
          { weight: 200, isWarmup: false }, { weight: 240, isWarmup: false }, { weight: 240, isWarmup: false }, { weight: 280, isWarmup: false },
        ]},
      ],
    },
    {
      name: 'Chest + Triceps',
      exercises: [
        { name: 'Pec fly machine', targetReps: '6-8', sets: [
          { weight: 40, isWarmup: true }, { weight: 50, isWarmup: true },
          { weight: 60, isWarmup: false }, { weight: 70, isWarmup: false }, { weight: 80, isWarmup: false },
        ]},
        { name: 'Chest press machine (horizontal handles)', targetReps: '6-8', sets: [
          { weight: 60, isWarmup: true },
          { weight: 80, isWarmup: false }, { weight: 100, isWarmup: false }, { weight: 100, isWarmup: false },
        ]},
        { name: 'Incline bench press barbell', targetReps: '6-8', sets: [
          { weight: 60, isWarmup: true },
          { weight: 80, isWarmup: false }, { weight: 80, isWarmup: false }, { weight: 80, isWarmup: false },
        ]},
        { name: 'Cable fly', targetReps: '8-10', sets: [
          { weight: 10, isWarmup: true },
          { weight: 15, isWarmup: false }, { weight: 15, isWarmup: false }, { weight: 15, isWarmup: false },
        ]},
        { name: 'Chest press machine (neutral grip)', targetReps: '6-8', sets: [
          { weight: 30, isWarmup: true },
          { weight: 50, isWarmup: false }, { weight: 60, isWarmup: false }, { weight: 60, isWarmup: false }, { weight: 60, isWarmup: false },
        ]},
        { name: 'Triceps single arm curl', targetReps: '8-10', sets: [
          { weight: 10, isWarmup: true },
          { weight: 14, isWarmup: false }, { weight: 16, isWarmup: false }, { weight: 16, isWarmup: false },
        ]},
        { name: 'Triceps curl cable (rope)', targetReps: '8-10', sets: [
          { weight: 20, isWarmup: true },
          { weight: 30, isWarmup: false }, { weight: 30, isWarmup: false }, { weight: 30, isWarmup: false },
        ]},
        { name: 'Triceps curl cable single arm', targetReps: '12-15', sets: [
          { weight: 5, isWarmup: true },
          { weight: 7.5, isWarmup: false }, { weight: 7.5, isWarmup: false }, { weight: 7.5, isWarmup: false },
        ]},
      ],
    },
    {
      name: 'Back + Biceps',
      exercises: [
        { name: 'Pull downs', targetReps: '15-17', sets: [
          { weight: 50, isWarmup: true }, { weight: 70, isWarmup: true },
          { weight: 80, isWarmup: false }, { weight: 85, isWarmup: false }, { weight: 85, isWarmup: false },
        ]},
        { name: 'Lat pull down', targetReps: '6-8', sets: [
          { weight: 55, isWarmup: true },
          { weight: 80, isWarmup: false }, { weight: 80, isWarmup: false }, { weight: 85, isWarmup: false },
        ]},
        { name: 'V-grip cable row', targetReps: '6-8', sets: [
          { weight: 40, isWarmup: true },
          { weight: 60, isWarmup: false }, { weight: 60, isWarmup: false }, { weight: 65, isWarmup: false },
        ]},
        { name: 'Low row machine', targetReps: '6-8', sets: [
          { weight: 90, isWarmup: true },
          { weight: 100, isWarmup: false }, { weight: 120, isWarmup: false }, { weight: 120, isWarmup: false },
        ]},
        { name: 'Pullover cable machine', targetReps: '8-10', sets: [
          { weight: 20, isWarmup: true },
          { weight: 32.5, isWarmup: false }, { weight: 32.5, isWarmup: false }, { weight: 30, isWarmup: false },
        ]},
        { name: 'Biceps curl dumbbells', targetReps: '8-10', sets: [
          { weight: 12, isWarmup: true },
          { weight: 20, isWarmup: false }, { weight: 20, isWarmup: false }, { weight: 20, isWarmup: false },
        ]},
        { name: 'Biceps curl cable (straight bar)', targetReps: '8-10', sets: [
          { weight: 15, isWarmup: true },
          { weight: 25, isWarmup: false }, { weight: 25, isWarmup: false }, { weight: 25, isWarmup: false },
        ]},
      ],
    },
    {
      name: 'Cardio',
      exercises: [
        { name: 'Cardio', targetReps: '30 min', notes: 'Target HR: 120-130 bpm', sets: [
          { weight: 0, isWarmup: false },
        ]},
      ],
    },
  ];
}

// Default nutrition plans
export function getDefaultNutritionPlan(): NutritionPlanVersion {
  const f = (name: string, amount?: string) => ({ name, amount });

  const trainingDay: DayPlan = {
    meals: [
      {
        name: 'Meal 1', subtitle: 'pre workout meal',
        items: [f('Greek yogurt', '250 gr'), f('Whey', '25 gr'), f('Oatmeal', '100 gr'), f('Berries'), f('Cheese', '40 gr')],
        supplements: ['Krill oil 500mg', 'Omega 3 1000 mg', 'D3+K2 1000 iu', 'CoQ10 100 mg', 'Daflon 500mg', 'Vitamin C 1000mg'],
      },
      {
        name: 'Intra workout drink',
        items: [f('Creatine', '5 gr'), f('EAA or BCAA', '5 gr')],
      },
      {
        name: 'Meal 2', subtitle: 'post workout meal',
        items: [f('Cream of rice (or flakes without sugar)', '70 gr'), f('Whey', '45 gr')],
      },
      {
        name: 'Meal 3',
        items: [f('Chicken / white fish / tuna / turkey', '150 gr'), f('Whole rye bread', '150 gr'), f('Feta', '90 gr')],
      },
      {
        name: 'Meal 4',
        items: [f('Red fish / lean beef', '150 gr'), f('Rice', '250 gr'), f('Olive oil', '7 gr'), f('Veggies')],
      },
      {
        name: 'Meal 5',
        items: [f('Egg white', '150 gr'), f('Egg', '2'), f('Whole rye bread', '200 gr'), f('Whey', '25 gr')],
        supplements: ['Krill oil 500mg', 'Omega 3 2000 mg', 'D3+K2 1000 iu', 'Glutamine 5 gr', 'Magnesium 400 mg'],
      },
    ],
    macros: { kcal: 3429, protein: 265, carbs: 416, fat: 79 },
  };

  const restDay: DayPlan = {
    meals: [
      {
        name: 'Meal 1',
        items: [f('Greek yogurt', '200 gr'), f('Whey', '25 gr'), f('Nuts', '25 gr'), f('Oatmeal', '90 gr'), f('Berries'), f('Cottage cheese 5%', '200 gr')],
        supplements: ['Krill oil 500mg', 'Omega 3 1000 mg', 'D3+K2 1000 iu', 'CoQ10 100 mg', 'Daflon 500mg', 'Vitamin C 1000mg'],
      },
      {
        name: 'Meal 2',
        items: [f('Chicken / white fish / tuna / turkey', '150 gr'), f('Rice', '200 gr'), f('Olive oil', '7 gr'), f('Veggies'), f('Whole rye bread', '150 gr')],
      },
      {
        name: 'Meal 3',
        items: [f('Greek yogurt', '200 gr'), f('Nuts', '15 gr'), f('Whey', '25 gr'), f('Oatmeal', '60 gr')],
      },
      {
        name: 'Meal 4',
        items: [f('Red fish / lean beef', '150 gr'), f('Rice', '200 gr')],
      },
      {
        name: 'Meal 5',
        items: [f('Egg white', '150 gr'), f('Egg', '2'), f('Nuts', '20 gr'), f('Whey 25 gr OR egg white', '170 ml')],
        supplements: ['Krill oil 500mg', 'Omega 3 2000 mg', 'D3+K2 1000 iu', 'Glutamine 5 gr', 'Magnesium 400 mg'],
      },
    ],
    macros: { kcal: 3429, protein: 257, carbs: 346, fat: 89 },
  };

  return {
    id: Date.now().toString(),
    startDate: new Date().toISOString().split('T')[0],
    trainingDay,
    restDay,
    emptyStomach: ['Glutamine 5 gr', 'Greens superfood 1 scoop', 'Lemon juice 20 ml', 'Apple vinegar 10 ml', 'NAC 600 mg', 'BCAA 1 scoop'],
  };
}

// Nutrition — offline-first
export async function getNutritionPlan(): Promise<NutritionPlan | null> {
  try {
    const local = await idbGetNutrition();
    backgroundRefreshNutrition();
    return local;
  } catch (e) {
    console.error('getNutritionPlan error:', e);
    return null;
  }
}

export async function saveNutritionPlan(plan: NutritionPlan) {
  await idbPutNutrition(plan);
  await addPendingSync({
    collection: 'nutrition',
    docId: 'plan',
    operation: 'set',
    data: stripUndefined(plan),
    timestamp: Date.now(),
  });
  flushSyncQueue();
}

// Blood tests — stored as JSON in settings
export async function getBloodTests(): Promise<import('@/types').BloodTest[]> {
  try {
    const json = await getSetting('bloodTests');
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveBloodTests(tests: import('@/types').BloodTest[]) {
  await saveSetting('bloodTests', JSON.stringify(tests));
}

// File to base64 (client-side utility)
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}

// Sync queue flush — push pending changes to Firestore
let flushing = false;

export async function flushSyncQueue() {
  if (typeof window === 'undefined' || !navigator.onLine || flushing) return;
  flushing = true;

  try {
    // Flush pending data writes
    const entries = await getAllPendingSync();
    const sorted = entries.sort((a, b) => a.timestamp - b.timestamp);

    for (const entry of sorted) {
      try {
        if (entry.operation === 'set') {
          await setDoc(doc(db, entry.collection, entry.docId), entry.data);
        } else if (entry.operation === 'delete') {
          await deleteDoc(doc(db, entry.collection, entry.docId));
        }
        if (entry.id != null) await deletePendingSync(entry.id);
      } catch (e) {
        console.error('Sync failed for entry:', entry, e);
        break; // Stop on failure, retry later
      }
    }

    // Flush pending photos
    const photos = await getAllPendingPhotos();
    for (const photo of photos.sort((a, b) => a.timestamp - b.timestamp)) {
      try {
        const storageRef = ref(storage, `photos/${photo.measurementDate}/${photo.angle}.jpg`);
        await uploadString(storageRef, photo.base64, 'data_url');
        const url = await getDownloadURL(storageRef);

        // Update measurement doc with photo URL
        const measurementSnap = await getDoc(doc(db, 'measurements', photo.measurementDate));
        if (measurementSnap.exists()) {
          const data = measurementSnap.data() as Measurement;
          const photos = { ...data.photos, [photo.angle]: url };
          await setDoc(doc(db, 'measurements', photo.measurementDate), { ...data, photos });
          // Also update IDB
          await idbPutMeasurement({ ...data, photos });
        }

        if (photo.id != null) await deletePendingPhoto(photo.id);
      } catch (e) {
        console.error('Photo sync failed:', photo, e);
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

// Seed initial data — check IDB first
export async function seedInitialData() {
  const existing = await idbGetMeasurements();
  if (existing.length > 0) return;

  // Also check Firestore if online
  if (navigator.onLine) {
    try {
      const q = query(collection(db, 'measurements'), orderBy('date', 'asc'));
      const snap = await getDocs(q);
      if (!snap.empty) {
        // Firestore has data, pull into IDB
        const items = snap.docs.map(d => d.data() as Measurement);
        await bulkPutMeasurements(items);
        return;
      }
    } catch (e) {
      console.warn('Firestore check during seed failed:', e);
    }
  }

  const historicalData: Measurement[] = [
    { date: '2025-10-12', weight: 101, arms: 40, chest: 106, waist: 98, legs: 61, energy: 'Good', hunger: 'Normal, a bit hungry sometimes', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7, cardio: 3, trainings: 5, foodChanges: 100, photos: {} },
    { date: '2025-10-19', weight: 101, arms: 38, chest: 106, waist: 98, legs: 62, energy: 'Good', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7, cardio: 2, trainings: 4, foodChanges: 80, photos: {} },
    { date: '2025-10-26', weight: 102, arms: 38, chest: 107.5, waist: 101, legs: 61, energy: 'Good', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7, cardio: 1, trainings: 5, foodChanges: 60, photos: {} },
    { date: '2025-11-01', weight: 101, arms: 38, chest: 110, waist: 100, legs: 62, energy: 'Good', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7, cardio: 4, trainings: 5, foodChanges: 100, photos: {} },
    { date: '2025-11-09', weight: 102.4, arms: 39, chest: 110, waist: 101, legs: 62, energy: 'Good', hunger: 'Normal to full', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7, cardio: 5, trainings: 5, foodChanges: 95, photos: {} },
    { date: '2025-11-16', weight: 104, arms: 39, chest: 110, waist: 100, legs: 63, energy: 'Tired', hunger: 'Normal', tiredness: 'Tired, lower back pain', digestion: 'No problem', sleepHours: 7, cardio: 5, trainings: 3, foodChanges: 90, photos: {} },
    { date: '2025-11-29', weight: 104, arms: 39, chest: 110, waist: 100, legs: 63, energy: 'Good', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 6, cardio: 0, trainings: 3, foodChanges: 0, photos: {} },
    { date: '2025-12-09', weight: 104, arms: 38.5, chest: 109, waist: 103, legs: 64, energy: 'Good', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 6, cardio: 0, trainings: 3, foodChanges: 0, photos: {} },
    { date: '2025-12-14', weight: 105, arms: 39.5, chest: 110.5, waist: 104, legs: 65, energy: 'Good', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7, cardio: 2, trainings: 5, foodChanges: 100, photos: {} },
    { date: '2025-12-21', weight: 105, arms: 39.5, chest: 111, waist: 104, legs: 65, energy: 'Tired a bit', hunger: 'Normal to hungry', tiredness: 'Tired during training', digestion: 'No problem', sleepHours: 6.5, cardio: 3, trainings: 5, foodChanges: 100, photos: {} },
    { date: '2025-12-28', weight: 105, arms: 39, chest: 111, waist: 104, legs: 65, energy: 'Good', hunger: 'Hungry', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7.5, cardio: 3, trainings: 6, foodChanges: 90, photos: {} },
    { date: '2026-01-04', weight: 105.7, arms: 39.5, chest: 111, waist: 104, legs: 66, energy: 'Good, but sore', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7.5, cardio: 6, trainings: 5, foodChanges: 90, photos: {} },
    { date: '2026-01-11', weight: 108, arms: 39.5, chest: 114, waist: 105, legs: 67, energy: 'Good', hunger: 'Normal', tiredness: 'Normal', digestion: 'No problem', sleepHours: 7.5, cardio: 6, trainings: 5, foodChanges: 80, photos: {} },
    { date: '2026-01-18', weight: 109.4, arms: 40, chest: 115, waist: 106, legs: 67, energy: 'Tired', hunger: 'Full', tiredness: 'Tired', digestion: 'No problem', sleepHours: 7.5, cardio: 3, trainings: 3, foodChanges: 70, photos: {} },
    { date: '2026-01-25', weight: 109.7, arms: 40, chest: 112, waist: 106, legs: 67, energy: 'Good', hunger: 'Full', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 2, trainings: 2, foodChanges: 50, photos: {} },
    { date: '2026-02-01', weight: 110.4, arms: 40, chest: 112, waist: 107, legs: 67, energy: 'Good', hunger: 'Good', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 2, trainings: 3, foodChanges: 80, photos: {} },
    { date: '2026-02-08', weight: 110.4, arms: 40, chest: 112, waist: 107, legs: 67, energy: 'Good', hunger: 'Good', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 2, trainings: 4, foodChanges: 80, photos: {} },
    { date: '2026-02-15', weight: 109.2, arms: 40, chest: 113, waist: 106, legs: 68, energy: 'Good', hunger: 'Good', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 3, trainings: 4, foodChanges: 95, photos: {} },
    { date: '2026-02-22', weight: 109.8, arms: 40, chest: 114, waist: 106, legs: 66, energy: 'Good', hunger: 'Good', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 5, trainings: 5, foodChanges: 95, photos: {} },
    { date: '2026-03-03', weight: 110, arms: 41, chest: 112, waist: 106, legs: 68, energy: 'Good', hunger: 'Good', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 3, trainings: 3, foodChanges: 50, photos: {} },
    {
      date: '2026-03-08',
      weight: 110.3, arms: 40, chest: 111, waist: 106, legs: 68,
      energy: 'Sick all week', hunger: 'Good', tiredness: 'Good', digestion: 'No problem',
      sleepHours: 7, cardio: 1, trainings: 0, foodChanges: 100,
      photos: {
        front: '/progress-photos/2026-03-08/front.jpeg',
        sideLeft: '/progress-photos/2026-03-08/side-left.jpeg',
        sideRight: '/progress-photos/2026-03-08/side-right.jpeg',
        back: '/progress-photos/2026-03-08/back.jpeg',
      },
    },
    { date: '2026-03-15', weight: 111.2, arms: 40, chest: 117, waist: 106, legs: 68, energy: 'Good', hunger: 'Good', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 4, trainings: 1, foodChanges: 100, photos: {} },
  ];

  // Seed to IDB
  await bulkPutMeasurements(historicalData);

  // Queue for Firestore sync
  for (const m of historicalData) {
    await addPendingSync({
      collection: 'measurements',
      docId: m.date,
      operation: 'set',
      data: stripUndefined(m),
      timestamp: Date.now(),
    });
  }
  flushSyncQueue();
}

// Legacy (unused but kept for type compatibility)
export function getTrainingPlan(): TrainingDay[] { return []; }
export function saveTrainingPlan(_plan: TrainingDay[]) {}
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
