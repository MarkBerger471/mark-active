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
  // Longest-match wins so "incline walk" picks up its own MET, not "walk"'s
  let best = 5.0;
  let bestLen = 0;
  for (const [key, met] of Object.entries(CARDIO_METS)) {
    if (lower.includes(key) && key.length > bestLen) {
      best = met;
      bestLen = key.length;
    }
  }
  return best;
}

export function parseDurationMinutes(targetReps: string): number {
  // Support fractional hours/minutes (e.g. "1.5h", "0.5h 10min")
  const hMatch = targetReps.match(/([\d.]+)\s*h/i);
  const mMatch = targetReps.match(/([\d.]+)\s*min/i);
  let mins = 0;
  if (hMatch) { const v = parseFloat(hMatch[1]); if (isFinite(v)) mins += v * 60; }
  if (mMatch) { const v = parseFloat(mMatch[1]); if (isFinite(v)) mins += v; }
  if (mins > 0) return Math.round(mins);
  const bare = targetReps.match(/([\d.]+)/);
  if (bare) { const v = parseFloat(bare[1]); if (isFinite(v) && v > 0) return Math.round(v); }
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

  // Session-wide check: once ANY set is marked done, only count done sets across all exercises.
  // This prevents un-started exercises from inflating the kcal estimate mid-workout.
  const hasAnyDone = session.exercises.some(e => e.sets.some(s => s.done));

  let totalSets = 0;
  let compoundSets = 0;
  let isolationSets = 0;
  for (const ex of session.exercises) {
    if (ex.skipped) continue;
    const isCompound = COMPOUND_KEYWORDS.some(kw => ex.name.toLowerCase().includes(kw));
    for (const set of ex.sets) {
      if (hasAnyDone && !set.done) continue;
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
  dailyActivity: Record<string, { activeCalories: number; source?: string }>,
): { total: number; training: number; neat: number; sessions: TrainingSession[]; source: string } {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const rollingStart = new Date(now);
  rollingStart.setDate(rollingStart.getDate() - 6);
  return calcWindowTDEE(sessions, bodyWeight, bmr, dailyActivity, rollingStart, now);
}

/**
 * Compute TDEE averaged over a fixed date window [start, end] inclusive.
 * Same watch-vs-oura logic as calcRollingTDEE, but over an arbitrary window
 * (e.g. a calendar week Monday–Sunday).
 *
 * Averages across the FULL window length in days — so a partially-elapsed
 * current week still divides by 7, matching the "daily average" semantics.
 */
export function calcWindowTDEE(
  sessions: TrainingSession[],
  bodyWeight: number,
  bmr: number,
  dailyActivity: Record<string, { activeCalories: number; source?: string }>,
  startDate: Date,
  endDate: Date,
): { total: number; training: number; neat: number; sessions: TrainingSession[]; source: string } {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

  const rollingSessions = sessions.filter(s => s.date >= startStr && s.date <= endStr);

  // Separate watch days vs non-watch days
  let watchTotalCals = 0, watchDays = 0;
  let ouraTotalCals = 0, ouraDays = 0;
  const nonWatchDates: string[] = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dayStr = d.toISOString().split('T')[0];
    const act = dailyActivity[dayStr];
    if (act && act.activeCalories > 0) {
      if (act.source === 'apple-watch') {
        // Watch day: activeCalories includes gym + NEAT (single source)
        watchTotalCals += act.activeCalories;
        watchDays++;
      } else {
        // Oura/fallback day: NEAT only, add training separately
        ouraTotalCals += act.activeCalories;
        ouraDays++;
        nonWatchDates.push(dayStr);
      }
    } else {
      nonWatchDates.push(dayStr);
    }
  }

  // Training calories only for non-watch days (watch already includes gym)
  const nonWatchSessions = rollingSessions.filter(s => nonWatchDates.includes(s.date));
  const nonWatchTrainingCals = nonWatchSessions.reduce((sum, s) => sum + calcSessionCalories(s, bodyWeight), 0);
  // Session-estimated training across ALL days (used only for display split)
  const allTrainingCals = rollingSessions.reduce((sum, s) => sum + calcSessionCalories(s, bodyWeight), 0);

  // Weighted daily average across the full window length
  // Always include training cals — even if no wearables, logged sessions count toward TDEE
  const totalActivity = watchTotalCals + ouraTotalCals + nonWatchTrainingCals;
  const dailyActivityAvg = Math.round(totalActivity / days);

  // For display: split into training + neat using session estimates across ALL days
  // (watch days bundle training+NEAT in one number — subtract estimated training to surface NEAT)
  const dailyTraining = Math.round(allTrainingCals / days);
  const neat = dailyActivityAvg - dailyTraining;
  const source = watchDays > ouraDays ? 'apple-watch' : watchDays > 0 ? 'mixed' : 'oura';

  return { total: bmr + dailyActivityAvg, training: dailyTraining, neat: Math.max(0, neat), sessions: rollingSessions, source };
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
