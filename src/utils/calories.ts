import { TrainingSession, NutritionMeal, Measurement, NutritionPlan, NutritionPlanVersion } from '@/types';

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

/**
 * TDEE from real intake vs measured weight change.
 *
 *   surplus_kcal = weight_change_kg * 5500
 *   tdee = avg_intake - surplus_kcal / days
 *
 * Weight change comes from a **linear regression** of weight vs. day across
 * all weigh-ins in the window — not endpoint-minus-start. This damps single
 * weigh-in noise (water, glycogen, BIA) without slowing reactivity to a real
 * intake change, which is what we want during active phase tuning.
 *
 * Uses a fixed 5500 kcal/kg "mixed gain" multiplier. Tried a BF%-personalized
 * version (lean×1800 + fat×7700) but BIA-scale noise (±0.5pp) inflates lean
 * change and produces unstable TDEE estimates on short windows. Mixed is the
 * conservative, coach-standard choice.
 *
 * When BF% is available we still return lean/fat change numbers for display
 * (computed against the regression-fit endpoints, not raw weigh-ins).
 */
export function calcDerivedTDEE(
  measurements: Measurement[],
  dailyIntakeKcal: number,
  windowDays: number = 28,
  asOfDate?: string,
  startDate?: string,
): {
  tdee: number;
  weightChangeKg: number;
  daysSpan: number;
  surplusKcalPerDay: number;
  ratePerWeekPct: number;
  measurementCount: number;
  leanChangeKg?: number;
  fatChangeKg?: number;
  method: 'personalized' | 'mixed';
  /** 95 % confidence interval half-width on the TDEE estimate (kcal/day).
   *  Derived from the regression slope's standard error: tighter when there
   *  are more weigh-ins and they sit close to the fitted line. Roughly:
   *    <150 = tight, 150-300 = moderate, >300 = noisy. */
  tdeeCI95?: number;
} | null {
  if (!measurements || measurements.length < 2 || !dailyIntakeKcal) return null;

  const KCAL_PER_KG_MIXED = 5500;
  const KCAL_PER_KG_LEAN = 1800;
  const KCAL_PER_KG_FAT = 7700;

  const sorted = [...measurements].filter(m => m.weight).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;

  // Window ending at asOfDate (default today). If startDate is supplied
  // it anchors the lower bound (window grows as time passes); otherwise
  // we use a trailing windowDays span.
  const endRef = asOfDate ? new Date(asOfDate + 'T00:00:00') : new Date();
  let cutoffStr: string;
  if (startDate) {
    cutoffStr = startDate;
  } else {
    const cutoff = new Date(endRef);
    cutoff.setDate(cutoff.getDate() - windowDays);
    cutoffStr = cutoff.toISOString().split('T')[0];
  }
  const endStr = endRef.toISOString().split('T')[0];
  const window = sorted.filter(m => m.date >= cutoffStr && m.date <= endStr);
  if (window.length < 2) return null;

  const start = window[0];
  const end = window[window.length - 1];
  const daysSpan = Math.max(1, Math.round((new Date(end.date).getTime() - new Date(start.date).getTime()) / 86400000));

  // Linear regression: weight ~ days-since-window-start
  const t0 = new Date(start.date).getTime();
  const pts = window.map(m => ({
    x: (new Date(m.date).getTime() - t0) / 86400000,
    y: m.weight,
  }));
  const n = pts.length;
  const meanX = pts.reduce((s, p) => s + p.x, 0) / n;
  const meanY = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.x - meanX) * (p.y - meanY); den += (p.x - meanX) ** 2; }
  // Fall back to endpoint diff if all weigh-ins land on the same day (no x-spread)
  const slopePerDay = den > 0 ? num / den : (end.weight - start.weight) / daysSpan;
  const intercept = meanY - slopePerDay * meanX;
  const fittedStartWeight = intercept;
  const fittedEndWeight = intercept + slopePerDay * daysSpan;
  const weightChangeKg = slopePerDay * daysSpan;
  const ratePerWeekPct = fittedStartWeight > 0
    ? (slopePerDay * 7 / fittedStartWeight) * 100
    : 0;

  // Smoothed BF% at each window end: average the nearest 3 measurements.
  // Looks in the full sorted list, not just the window, so the smoothing
  // window can reach back before the cutoff when data is sparse.
  const avgBfNear = (index: number): number | null => {
    const nearby: number[] = [];
    // Walk outward from the target index, collect up to 3 BF% readings
    for (let offset = 0; offset < sorted.length && nearby.length < 3; offset++) {
      for (const i of offset === 0 ? [index] : [index - offset, index + offset]) {
        if (i < 0 || i >= sorted.length) continue;
        const bf = sorted[i].bodyFat;
        if (bf != null && bf > 0) nearby.push(bf);
        if (nearby.length >= 3) break;
      }
    }
    if (nearby.length === 0) return null;
    return nearby.reduce((s, v) => s + v, 0) / nearby.length;
  };

  const startIdx = sorted.findIndex(m => m.date === start.date);
  const endIdx = sorted.findIndex(m => m.date === end.date);
  const startBf = avgBfNear(startIdx);
  const endBf = avgBfNear(endIdx);

  // Always use 5500 kcal/kg mixed multiplier for the TDEE number itself.
  // Personalized BF%-based calc is unreliable on short windows due to BIA noise.
  const surplusKcal: number = weightChangeKg * KCAL_PER_KG_MIXED;
  const method: 'personalized' | 'mixed' = 'mixed';
  // Still compute lean/fat change for display (informational only)
  let leanChangeKg: number | undefined;
  let fatChangeKg: number | undefined;
  if (startBf != null && endBf != null) {
    const startFat = fittedStartWeight * (startBf / 100);
    const endFat = fittedEndWeight * (endBf / 100);
    const startLean = fittedStartWeight - startFat;
    const endLean = fittedEndWeight - endFat;
    leanChangeKg = endLean - startLean;
    fatChangeKg = endFat - startFat;
  }
  void KCAL_PER_KG_LEAN; void KCAL_PER_KG_FAT; // constants kept for reference

  const surplusKcalPerDay = Math.round(surplusKcal / daysSpan);
  const tdee = dailyIntakeKcal - surplusKcalPerDay;

  // 95 % confidence interval on the TDEE estimate. Derived from the OLS
  // standard error of the slope:
  //   resid_i  = y_i - (intercept + slope·x_i)
  //   σ²       = Σ resid² / (n - 2)            (sample residual variance)
  //   SE(slope) = √(σ² / Σ(x - x̄)²)
  //   SE(TDEE)  = SE(slope) · 5500             (kcal per kg per day)
  // For small n we use a Student-t critical value at 95 % two-sided.
  // Skip when n < 3 (no degrees of freedom for σ̂) or when den is 0.
  let tdeeCI95: number | undefined;
  if (n >= 3 && den > 0) {
    let sse = 0;
    for (const p of pts) {
      const fitted = intercept + slopePerDay * p.x;
      sse += (p.y - fitted) ** 2;
    }
    const sigma2 = sse / (n - 2);
    const seSlope = Math.sqrt(sigma2 / den);
    // t critical for df = n-2 at α=0.05 (two-sided). Lookup table for the
    // small-N values that matter; >=30 use the normal-approx 1.96.
    const tCrit = (() => {
      const tbl: Record<number, number> = { 1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23, 15: 2.13, 20: 2.09, 25: 2.06, 30: 2.04 };
      const df = n - 2;
      if (tbl[df]) return tbl[df];
      if (df >= 30) return 1.96;
      const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
      const upper = keys.find(k => k > df) ?? 30;
      const lower = [...keys].reverse().find(k => k < df) ?? 1;
      // Linear interp
      return tbl[lower] + ((df - lower) / (upper - lower)) * (tbl[upper] - tbl[lower]);
    })();
    tdeeCI95 = Math.round(tCrit * seSlope * KCAL_PER_KG_MIXED);
  }

  return {
    tdee: Math.round(tdee),
    weightChangeKg: Math.round(weightChangeKg * 10) / 10,
    daysSpan,
    surplusKcalPerDay,
    ratePerWeekPct: Math.round(ratePerWeekPct * 100) / 100,
    measurementCount: window.length,
    leanChangeKg: leanChangeKg != null ? Math.round(leanChangeKg * 10) / 10 : undefined,
    fatChangeKg: fatChangeKg != null ? Math.round(fatChangeKg * 10) / 10 : undefined,
    method,
    tdeeCI95,
  };
}

/**
 * Science-based macro recommendation given bodyweight, TDEE estimate, and phase.
 *
 * Sources:
 *  - Protein: ISSN position stand, Schoenfeld 2018, Helms (MASS) — 1.6-2.4 g/kg,
 *    upper end for trained / TRT users. Use 2.25 for bulk, 2.4 for cut.
 *  - Fat: Lyle McDonald, Andy Galpin — 0.8-1.0 g/kg minimum for hormonal health.
 *    Express as % of total kcal so it tracks intake (25% bulk, 30% cut).
 *  - Surplus: Helms MASS, Israetel RP — +10-20% bulk, -15-25% cut.
 *  - Carbs: remainder. Drives training performance.
 */
export function calcRecommendedMacros(
  bodyWeightKg: number,
  tdeeKcal: number,
  phase: 'bulking' | 'cutting',
): { kcal: number; protein: number; carbs: number; fat: number } {
  const surplusPct = phase === 'bulking' ? 0.15 : -0.20;
  const kcal = Math.round((tdeeKcal * (1 + surplusPct)) / 50) * 50; // round to nearest 50

  // Standard bulk protein recommendation (ISSN, Schoenfeld, Helms/MASS).
  // The UI separately surfaces a lower "NNU-adjusted" target when whole-day
  // NNU is high — but the main Recommended row uses the classical value so
  // nothing is left on the table if Mark misses an EAA dose.
  const proteinPerKg = phase === 'bulking' ? 2.25 : 2.4;
  const protein = Math.round(bodyWeightKg * proteinPerKg);

  const fatPctOfKcal = phase === 'bulking' ? 0.25 : 0.30;
  const fat = Math.round((kcal * fatPctOfKcal) / 9);

  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return { kcal, protein, carbs, fat };
}

const CHEAT_MEAL_KCAL = 800;
// Average daily extras not in the logged meal plan: coffee with milk + small
// snacks throughout the day. Folded into intake so derived TDEE / surplus
// calculations reflect what's actually being eaten.
const DAILY_EXTRAS_KCAL = 100;

// Per-100g kcal for computing last meal calories (subset of FOOD_DB)
const KCAL_PER_100G: Record<string, number> = {
  'egg white': 52, 'egg whites': 52, 'egg': 143, 'eggs': 143, 'whey': 400,
  'bread': 265, 'rye bread': 170, 'whole rye bread': 170, 'chicken': 165,
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
): { weeklyAvgKcal: number; lastMealKcal: number; cheatMealKcal: number; extrasKcal: number } {
  let lastMealKcal = 0;
  if (meals.length > 0) {
    lastMealKcal = calcMealKcal(meals[meals.length - 1]);
  }
  if (lastMealKcal === 0 && meals.length > 0) lastMealKcal = Math.round(dailyKcal / meals.length);
  const sundayDiff = CHEAT_MEAL_KCAL - lastMealKcal;
  const weeklyAvgKcal = Math.round((dailyKcal * 7 + sundayDiff + DAILY_EXTRAS_KCAL * 7) / 7);
  return { weeklyAvgKcal, lastMealKcal, cheatMealKcal: CHEAT_MEAL_KCAL, extrasKcal: DAILY_EXTRAS_KCAL };
}

/**
 * Find which nutrition plan version was active on a given date.
 * Falls back to current if no version covers that date.
 */
export function getPlanForDate(plan: NutritionPlan, dateStr: string): NutritionPlanVersion {
  const cur = plan.current;
  if (cur && cur.startDate <= dateStr && (!cur.endDate || cur.endDate >= dateStr)) return cur;
  for (const v of plan.history || []) {
    if (v.startDate <= dateStr && (!v.endDate || v.endDate >= dateStr)) return v;
  }
  return cur;
}

/**
 * Compute a TDEE timeline using the actual plan that was active at each
 * sample date, plus a longer-window baseline. The 28d series should
 * oscillate around the baseline if lifestyle is stable.
 */
export function calcTdeeSeries(
  measurements: Measurement[],
  plan: NutritionPlan,
  sampleDates: string[],
  windowDays: number = 28,
): { date: string; tdee: number | null; planChanged: boolean }[] {
  return sampleDates.map((date) => {
    const planAtEnd = getPlanForDate(plan, date);
    const wkIntake = calcWeeklyIntake(planAtEnd.trainingDay.macros.kcal, planAtEnd.trainingDay.meals).weeklyAvgKcal;
    const result = calcDerivedTDEE(measurements, wkIntake, windowDays, date);
    // Flag if the plan changed mid-window — that sample mixes intakes
    const cutoff = new Date(date + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - windowDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const planAtStart = getPlanForDate(plan, cutoffStr);
    const planChanged = planAtStart.id !== planAtEnd.id;
    return { date, tdee: result ? result.tdee : null, planChanged };
  });
}
