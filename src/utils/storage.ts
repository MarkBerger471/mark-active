import { Measurement, TrainingDay, NutritionPlan, Workout, TrainingSession } from '@/types';

const KEYS = {
  MEASUREMENTS: 'bb_measurements',
  TRAINING: 'bb_training',
  NUTRITION: 'bb_nutrition',
  AUTH: 'bb_auth',
  SESSION: 'bb_session',
  TRAINING_SESSIONS: 'bb_training_sessions',
};

// Simple hash function for password (not cryptographic, but sufficient for localStorage auth)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Auth
export function getStoredCredentials(): { username: string; passwordHash: string } | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(KEYS.AUTH);
  return data ? JSON.parse(data) : null;
}

export function setStoredCredentials(username: string, passwordHash: string) {
  localStorage.setItem(KEYS.AUTH, JSON.stringify({ username, passwordHash }));
}

export function isSessionValid(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(KEYS.SESSION) === 'true';
}

export function setSession(valid: boolean) {
  if (valid) {
    sessionStorage.setItem(KEYS.SESSION, 'true');
  } else {
    sessionStorage.removeItem(KEYS.SESSION);
  }
}

// Measurements
export function getMeasurements(): Measurement[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(KEYS.MEASUREMENTS);
  return data ? JSON.parse(data) : [];
}

export function saveMeasurement(measurement: Measurement) {
  const measurements = getMeasurements();
  const existingIndex = measurements.findIndex(m => m.date === measurement.date);
  if (existingIndex >= 0) {
    measurements[existingIndex] = measurement;
  } else {
    measurements.push(measurement);
  }
  measurements.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  localStorage.setItem(KEYS.MEASUREMENTS, JSON.stringify(measurements));
}

export function deleteMeasurement(date: string) {
  const measurements = getMeasurements().filter(m => m.date !== date);
  localStorage.setItem(KEYS.MEASUREMENTS, JSON.stringify(measurements));
}

// Training (legacy)
export function getTrainingPlan(): TrainingDay[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(KEYS.TRAINING);
  return data ? JSON.parse(data) : [];
}

export function saveTrainingPlan(plan: TrainingDay[]) {
  localStorage.setItem(KEYS.TRAINING, JSON.stringify(plan));
}

// Training Sessions (new)
export function getTrainingSessions(): TrainingSession[] {
  if (typeof window === 'undefined') return [];
  const data = localStorage.getItem(KEYS.TRAINING_SESSIONS);
  return data ? JSON.parse(data) : [];
}

export function saveTrainingSession(session: TrainingSession) {
  const sessions = getTrainingSessions();
  const existingIndex = sessions.findIndex(s => s.id === session.id);
  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.push(session);
  }
  localStorage.setItem(KEYS.TRAINING_SESSIONS, JSON.stringify(sessions));
}

export function deleteTrainingSession(id: string) {
  const sessions = getTrainingSessions().filter(s => s.id !== id);
  localStorage.setItem(KEYS.TRAINING_SESSIONS, JSON.stringify(sessions));
}

export function getLastSessionForWorkout(workoutName: string): TrainingSession | null {
  const sessions = getTrainingSessions()
    .filter(s => s.workoutName === workoutName)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return sessions[0] || null;
}

// Preset workouts
export function getPresetWorkouts(): Workout[] {
  return [
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
  ];
}

// Nutrition
export function getNutritionPlan(): NutritionPlan | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem(KEYS.NUTRITION);
  return data ? JSON.parse(data) : null;
}

export function saveNutritionPlan(plan: NutritionPlan) {
  localStorage.setItem(KEYS.NUTRITION, JSON.stringify(plan));
}

// File to base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}

// Seed initial data from spreadsheet history
export function seedInitialData() {
  const measurements = getMeasurements();
  if (measurements.length === 0) {
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
        weight: 110.3,
        arms: 40,
        chest: 111,
        waist: 106,
        legs: 68,
        energy: 'Sick all week',
        hunger: 'Good',
        tiredness: 'Good',
        digestion: 'No problem',
        sleepHours: 7,
        cardio: 1,
        trainings: 0,
        foodChanges: 100,
        photos: {
          front: '/progress-photos/2026-03-08/front.jpeg',
          sideLeft: '/progress-photos/2026-03-08/side-left.jpeg',
          sideRight: '/progress-photos/2026-03-08/side-right.jpeg',
          back: '/progress-photos/2026-03-08/back.jpeg',
        },
      },
      { date: '2026-03-15', weight: 111.2, arms: 40, chest: 117, waist: 106, legs: 68, energy: 'Good', hunger: 'Good', tiredness: 'Good', digestion: 'No problem', sleepHours: 7, cardio: 4, trainings: 1, foodChanges: 100, photos: {} },
    ];
    historicalData.forEach(m => saveMeasurement(m));
  }
}
