export interface Measurement {
  date: string; // ISO date string
  arms: number;
  chest: number;
  waist: number;
  legs: number;
  weight: number;
  bodyFat?: number;
  energy?: string;
  hunger?: string;
  tiredness?: string;
  digestion?: string;
  sleepHours?: number;   // 5-10 hours
  cardio?: number;       // 0-7 sessions
  trainings?: number;    // 0-7 sessions
  foodChanges?: number;  // 0-100 percent
  photos: {
    front?: string;
    sideLeft?: string;
    sideRight?: string;
    back?: string;
  };
}

export interface TrainingDay {
  day: string;
  name: string;
  exercises: Exercise[];
}

export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  weight?: string;
  notes?: string;
}

// New training types
export interface TrainingSet {
  weight: number | string;
  reps?: number;
  isWarmup: boolean;
  done?: boolean;
}

export interface TrainingExercise {
  name: string;
  targetReps: string;
  sets: TrainingSet[];
  notes?: string;
  skipped?: boolean;
}

export interface Workout {
  name: string;
  exercises: TrainingExercise[];
}

export interface TrainingSession {
  id: string;
  date: string;
  savedAt?: string; // ISO timestamp
  workoutName: string;
  exercises: TrainingExercise[];
}

export interface NutritionPlan {
  dailyCalories: number;
  protein: number;
  carbs: number;
  fat: number;
  meals: Meal[];
}

export interface Meal {
  name: string;
  time: string;
  foods: string[];
  calories?: number;
  protein?: number;
}

export interface UserCredentials {
  username: string;
  passwordHash: string;
}
