export interface Measurement {
  date: string; // ISO date string
  savedAt?: string; // ISO timestamp
  arms: number;
  chest: number;
  waist: number;
  legs: number;
  weight: number;
  bodyFat?: number;
  muscleMass?: number;
  bmr?: number;           // Basal Metabolic Rate (kcal)
  recommendedCalories?: number; // Recommended Calorie Intake (kcal)
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
  calories?: number; // manually entered calories (e.g. from cardio machine display)
}

export interface Workout {
  name: string;
  exercises: TrainingExercise[];
}

export interface TrainingSession {
  id: string;
  date: string;
  savedAt?: string; // ISO timestamp
  startedAt?: string; // ISO timestamp — first save time
  durationMinutes?: number; // frozen after the session day
  workoutName: string;
  exercises: TrainingExercise[];
}

// Legacy types kept for migration
export interface NutritionPlanLegacy {
  dailyCalories: number;
  protein: number;
  carbs: number;
  fat: number;
  meals: MealLegacy[];
}

export interface MealLegacy {
  name: string;
  time: string;
  foods: string[];
  calories?: number;
  protein?: number;
}

// New nutrition plan types
export interface FoodItem {
  name: string;        // "Greek yogurt", "Whey"
  amount?: string;     // "250 gr", "25 gr", "2", "30 min"
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface NutritionMeal {
  name: string;        // "Meal 1", "Intra workout drink", "Before bed"
  subtitle?: string;   // "pre workout meal", "post workout meal"
  items: FoodItem[];
  supplements?: string[]; // "Krill oil 500mg", "Omega 3 1000 mg"
}

export interface NutritionMacros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DayPlan {
  meals: NutritionMeal[];
  macros: NutritionMacros;
}

export interface NutritionPlanVersion {
  id: string;
  startDate: string;
  endDate?: string; // undefined = current active version
  trainingDay: DayPlan;
  restDay: DayPlan;
  emptyStomach?: string[]; // shared "any day, empty stomach" items
}

export interface NutritionPlan {
  current: NutritionPlanVersion;
  history: NutritionPlanVersion[];
}

// Keep Meal alias for any remaining references
export type Meal = MealLegacy;

export interface BloodTestValue {
  name: string;      // e.g. "Hemoglobin", "Testosterone"
  value: number;
  unit: string;      // e.g. "g/dL", "ng/dL"
  textValue?: string; // for non-numeric results like "Adequate", "Normal"
  refMin?: number;
  refMax?: number;
  flag?: string;     // "H" (high) or "L" (low) from lab report
}

export interface BloodTest {
  id: string;
  date: string;       // ISO date
  label?: string;     // e.g. "Routine checkup"
  rawText?: string;   // original pasted/extracted text
  values: BloodTestValue[];
}

export interface UserCredentials {
  username: string;
  passwordHash: string;
}
