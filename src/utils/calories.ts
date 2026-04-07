import { TrainingSession, NutritionMeal } from '@/types';

const CARDIO_METS: Record<string, number> = {
  'stairmaster': 9.0,
  'stair': 9.0,
  'running': 8.0,
  'run': 8.0,
  'jogging': 7.0,
  'jog': 7.0,
  'rowing': 7.0,
  'row': 7.0,
  'elliptical': 5.0,
  'cycling': 4.0,
  'bike': 4.0,
  'swimming': 7.0,
  'walking': 3.8,
  'walk': 3.8,
  'incline walk': 5.5,
  'hiit': 10.0,
  'jump rope': 10.0,
  'cardio': 5.0,
};

const COMPOUND_KEYWORDS = [
  'press', 'squat', 'deadlift', 'dead lift', 'lunge', 'row', 'pull down',
  'pulldown', 'pull up', 'pullup', 'dip', 'leg press', 'clean', 'snatch',
  'thrust', 'pullover',
];

function getCardioMET(name: string): number {
  const lower = name.toLowerCase();
  for (const [key, met] of Object.entries(CARDIO_METS)) {
    if (lower.includes(key)) return met;
  }
  return 5.0;
}

export function parseDurationMinutes(targetReps: string): number {
  const hMatch = targetReps.match(/(\d+)\s*h/i);
  const mMatch = targetReps.match(/(\d+)\s*min/i);
  let mins = 0;
  if (hMatch) mins += parseInt(hMatch[1]) * 60;
  if (mMatch) mins += parseInt(mMatch[1]);
  if (mins > 0) return mins;
  const bare = targetReps.match(/(\d+)/);
  if (bare) return parseInt(bare[1]);
  return 30;
}

export function calcSessionCalories(session: TrainingSession, bodyWeight: number): number {
  if (session.workoutName === 'Cardio') {
    let totalCals = 0;
    for (const ex of session.exercises) {
      if (ex.skipped) continue;
      if (ex.calories && ex.calories > 0) {
        totalCals += ex.calories;
      } else {
        const met = getCardioMET(ex.name);
        const mins = parseDurationMinutes(ex.targetReps);
        totalCals += met * bodyWeight * (mins / 60);
      }
    }
    return Math.round(totalCals || 5.0 * bodyWeight * 0.5);
  }

  const duration = session.durationMinutes;

  let totalSets = 0;
  let compoundSets = 0;
  let isolationSets = 0;
  for (const ex of session.exercises) {
    if (ex.skipped) continue;
    const hasDone = ex.sets.some(s => s.done);
    const isCompound = COMPOUND_KEYWORDS.some(kw => ex.name.toLowerCase().includes(kw));
    for (const set of ex.sets) {
      if (hasDone && !set.done) continue;
      totalSets++;
      if (isCompound) compoundSets++; else isolationSets++;
    }
  }

  if (totalSets === 0) return 0;

  const avgMET = (compoundSets * 6.0 + isolationSets * 3.5) / totalSets;

  const exerciseCount = session.exercises.filter(e => !e.skipped).length;
  const sessionMins = (duration && duration > 5) ? duration : totalSets * 3.2 + exerciseCount * 3;

  const workMins = sessionMins * 0.3;
  const restMins = sessionMins * 0.7;

  let totalCals = 0;
  totalCals += avgMET * bodyWeight * (workMins / 60);
  totalCals += 1.5 * bodyWeight * (restMins / 60);

  totalCals *= 1.15;

  return Math.round(totalCals);
}

export function calcRollingTDEE(
  sessions: TrainingSession[],
  bodyWeight: number,
  bmr: number,
  dailyActivity: Record<string, { activeCalories: number }>,
): { total: number; training: number; neat: number; sessions: TrainingSession[] } {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const rollingStart = new Date(now);
  rollingStart.setDate(rollingStart.getDate() - 6);
  const rollingStartStr = rollingStart.toISOString().split('T')[0];

  const rollingSessions = sessions.filter(s => s.date >= rollingStartStr && s.date <= todayStr);
  const trainingCals = rollingSessions.reduce((sum, s) => sum + calcSessionCalories(s, bodyWeight), 0);
  const dailyTraining = Math.round(trainingCals / 7);

  let totalActiveCals = 0, actDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(rollingStart);
    d.setDate(d.getDate() + i);
    const dayStr = d.toISOString().split('T')[0];
    const act = dailyActivity[dayStr];
    if (act && act.activeCalories > 0) { totalActiveCals += act.activeCalories; actDays++; }
  }
  const neat = actDays > 0 ? Math.round(totalActiveCals / actDays) : 0;

  return { total: bmr + dailyTraining + neat, training: dailyTraining, neat, sessions: rollingSessions };
}

const CHEAT_MEAL_KCAL = 1300;

// Per-100g kcal for computing last meal calories (subset of FOOD_DB)
const KCAL_PER_100G: Record<string, number> = {
  'egg white': 52, 'egg whites': 52, 'egg': 143, 'eggs': 143, 'whey': 400,
  'bread': 265, 'rye bread': 259, 'whole rye bread': 259, 'chicken': 165,
  'chicken breast': 165, 'fish': 120, 'beef': 254, 'ground beef': 254,
  'salmon': 208, 'tuna': 132, 'rice': 130, 'brown rice': 112,
  'greek yogurt': 59, 'oatmeal': 389, 'cheese': 403, 'feta': 264,
  'cottage cheese': 98, 'cream of rice': 370, 'olive oil': 884,
  'nuts': 607, 'almonds': 579, 'walnuts': 654, 'berries': 57, 'banana': 89,
  'avocado': 160, 'sweet potato': 86, 'potato': 77, 'pasta': 131,
};
const PIECE_G: Record<string, number> = { 'egg': 60, 'eggs': 60, 'banana': 120 };

function calcMealKcal(meal: NutritionMeal): number {
  let total = 0;
  for (const item of meal.items) {
    // Use stored kcal if available (already computed by nutrition page)
    if (item.kcal && item.kcal > 0) { total += item.kcal; continue; }
    const name = (item.name || '').toLowerCase().trim();
    const amount = item.amount || '';
    // Find best match (longest key)
    let per100 = 0, bestLen = 0;
    for (const [key, val] of Object.entries(KCAL_PER_100G)) {
      if ((name.includes(key) || key.includes(name)) && key.length > bestLen) { per100 = val; bestLen = key.length; }
    }
    if (per100 === 0) continue;
    const gMatch = amount.match(/([\d.]+)\s*(?:gr?|ml)/i);
    const bare = amount.match(/^([\d.]+)$/);
    let grams = 0;
    if (gMatch) { grams = parseFloat(gMatch[1]); }
    else if (bare) {
      const pw = Object.entries(PIECE_G).find(([k]) => name.includes(k));
      grams = pw ? parseFloat(bare[1]) * pw[1] : parseFloat(bare[1]);
    }
    total += Math.round(per100 * grams / 100);
  }
  return total;
}

/**
 * Compute weekly average intake accounting for Sunday cheat meal.
 * Returns { weeklyAvgKcal, lastMealKcal, cheatMealKcal }.
 */
export function calcWeeklyIntake(
  dailyKcal: number,
  meals: NutritionMeal[],
): { weeklyAvgKcal: number; lastMealKcal: number; cheatMealKcal: number } {
  let lastMealKcal = 0;
  if (meals.length > 0) {
    lastMealKcal = calcMealKcal(meals[meals.length - 1]);
  }
  if (lastMealKcal === 0 && meals.length > 0) lastMealKcal = Math.round(dailyKcal / meals.length);
  const sundayDiff = CHEAT_MEAL_KCAL - lastMealKcal;
  const weeklyAvgKcal = Math.round((dailyKcal * 7 + sundayDiff) / 7);
  return { weeklyAvgKcal, lastMealKcal, cheatMealKcal: CHEAT_MEAL_KCAL };
}
