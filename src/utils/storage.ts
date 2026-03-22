import { Measurement, TrainingDay, NutritionPlan, Workout, TrainingSession } from '@/types';
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  limit,
  writeBatch,
} from 'firebase/firestore';

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

// Auth (stays in sessionStorage — per-browser-session)
export function isSessionValid(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem('bb_session') === 'true';
}

export function setSession(valid: boolean) {
  if (valid) {
    sessionStorage.setItem('bb_session', 'true');
  } else {
    sessionStorage.removeItem('bb_session');
  }
}

// Settings (Firestore)
export async function getSetting(key: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'settings', key));
    return snap.exists() ? snap.data().value : null;
  } catch (e) {
    console.error('getSetting error:', e);
    return null;
  }
}

export async function saveSetting(key: string, value: string | null) {
  if (value === null) {
    await deleteDoc(doc(db, 'settings', key));
  } else {
    await setDoc(doc(db, 'settings', key), { value });
  }
}

// Measurements (Firestore)
export async function getMeasurements(): Promise<Measurement[]> {
  try {
    const q = query(collection(db, 'measurements'), orderBy('date', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Measurement);
  } catch (e) {
    console.error('getMeasurements error:', e);
    return [];
  }
}

export async function saveMeasurement(measurement: Measurement) {
  // Strip base64 photos to avoid exceeding Firestore 1MB limit
  const toSave = { ...measurement };
  if (toSave.photos) {
    const cleanPhotos: Record<string, string> = {};
    for (const [key, val] of Object.entries(toSave.photos)) {
      if (val && !val.startsWith('data:')) {
        cleanPhotos[key] = val; // keep file path references
      }
      // base64 photos are dropped — Firestore can't handle them
    }
    toSave.photos = cleanPhotos;
  }
  try {
    await setDoc(doc(db, 'measurements', toSave.date), stripUndefined(toSave));
  } catch (e) {
    console.error('saveMeasurement error:', e);
    alert('Failed to save measurement. Check console for details.');
  }
}

export async function deleteMeasurement(date: string) {
  await deleteDoc(doc(db, 'measurements', date));
}

// Training Sessions (Firestore)
export async function getTrainingSessions(): Promise<TrainingSession[]> {
  try {
    const snap = await getDocs(collection(db, 'trainingSessions'));
    return snap.docs.map(d => d.data() as TrainingSession);
  } catch (e) {
    console.error('getTrainingSessions error:', e);
    return [];
  }
}

export async function saveTrainingSession(session: TrainingSession) {
  // Check if existing to preserve savedAt
  const existing = await getDoc(doc(db, 'trainingSessions', session.id));
  if (existing.exists()) {
    session.savedAt = existing.data().savedAt || session.savedAt || new Date().toISOString();
  } else {
    session.savedAt = session.savedAt || new Date().toISOString();
  }
  await setDoc(doc(db, 'trainingSessions', session.id), stripUndefined(session));
}

export async function deleteTrainingSession(id: string) {
  await deleteDoc(doc(db, 'trainingSessions', id));
}

export async function getLastSessionForWorkout(workoutName: string): Promise<TrainingSession | null> {
  try {
    const q = query(
      collection(db, 'trainingSessions'),
      where('workoutName', '==', workoutName),
      orderBy('date', 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    return snap.empty ? null : (snap.docs[0].data() as TrainingSession);
  } catch (e) {
    console.error('getLastSessionForWorkout error:', e);
    return null;
  }
}

// Preset workouts (static, no persistence needed)
export function getPresetWorkouts(): Workout[] {
  return [
    {
      name: 'Shoulders',
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
        { name: 'Cardio', targetReps: '30 min', notes: 'Treadmill / bike / incline walk', sets: [
          { weight: 0, isWarmup: false },
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
        { name: 'Cardio', targetReps: '30 min', notes: 'Treadmill / bike / incline walk', sets: [
          { weight: 0, isWarmup: false },
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
        { name: 'Cardio', targetReps: '30 min', notes: 'Treadmill / bike / incline walk', sets: [
          { weight: 0, isWarmup: false },
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
        { name: 'Cardio', targetReps: '30 min', notes: 'Treadmill / bike / incline walk', sets: [
          { weight: 0, isWarmup: false },
        ]},
      ],
    },
  ];
}

// Nutrition (Firestore)
export async function getNutritionPlan(): Promise<NutritionPlan | null> {
  try {
    const snap = await getDoc(doc(db, 'nutrition', 'plan'));
    return snap.exists() ? (snap.data() as NutritionPlan) : null;
  } catch (e) {
    console.error('getNutritionPlan error:', e);
    return null;
  }
}

export async function saveNutritionPlan(plan: NutritionPlan) {
  await setDoc(doc(db, 'nutrition', 'plan'), stripUndefined(plan));
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

// Seed initial data
export async function seedInitialData() {
  const existing = await getMeasurements();
  if (existing.length === 0) {
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
    const batch = writeBatch(db);
    historicalData.forEach(m => {
      batch.set(doc(db, 'measurements', m.date), stripUndefined(m));
    });
    await batch.commit();
  }
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
