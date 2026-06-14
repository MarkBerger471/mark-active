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

// ─────────────────────────────────────────────────────────────────────────
// Kalman-filter TDEE estimator (state-space / Bayesian).
//
// The body-weight time series is modelled as a linear-Gaussian state-space
// system, for which the Kalman filter is the provably optimal (minimum-MSE)
// estimator:
//
//   State  x = [ W ; T ]   W = true (de-noised) body weight (kg)
//                          T = TDEE (kcal/day), a slowly-drifting hidden state
//
//   Dynamics over a step of dt days with mean daily intake I (kcal):
//     W_k = W_{k-1} + (I − T_{k-1}) · dt / ρ        ρ = 5500 kcal/kg
//     T_k = T_{k-1} + (random walk)                 adaptive thermogenesis drift
//
//   Observation: the scale reads true weight plus water/glycogen noise:
//     z_k = W_k + ε,   ε ~ N(0, R)
//
// Advantages over windowed OLS:
//   • optimally separates the slow TDEE signal from fast water noise;
//   • tracks a *changing* TDEE (OLS assumes it's constant across the window —
//     false during a cut, where adaptive thermogenesis lowers TDEE);
//   • emits a self-consistent, calibrated uncertainty (sqrt of the posterior
//     variance) rather than a bolted-on standard error;
//   • hyper-parameters (R, the TDEE drift rate) are fitted from the data by
//     maximum innovation-likelihood — no hand-tuning.
// ─────────────────────────────────────────────────────────────────────────

const KALMAN_RHO = 5500; // kcal per kg of mixed tissue (same constant as OLS path)

interface KalmanStep {
  date: string;
  weight: number;        // observed weigh-in
  filteredWeight: number; // posterior true-weight estimate
  filteredWeightSd: number; // posterior true-weight standard deviation
  tdee: number;          // posterior TDEE estimate after this observation
  tdeeSd: number;        // posterior TDEE standard deviation
  innovation: number;    // observed − predicted weight (one-step-ahead)
  innovationSd: number;  // sqrt of innovation variance S
}

export interface KalmanTDEE {
  tdee: number;
  tdeeCI95: number;      // 1.96 · posterior SD of TDEE
  weightFiltered: number; // current de-noised weight
  measurementCount: number;
  daysSpan: number;
  rDay: number;          // fitted observation-noise variance (kg²)
  qTDay: number;         // fitted TDEE drift variance (kcal²/day)
  series: { date: string; tdee: number; sd: number }[];
}

// Run the forward filter over a date-sorted list of {date, weight} points with
// a constant mean daily intake. Returns the per-step trace plus the summed
// innovation log-likelihood (used to fit the hyper-parameters).
// Systematic-ish uncertainty in the mean daily intake estimate (kcal/day):
// cheat-meal estimate, the +100 untracked extras, week-to-week logging
// variance. This must be modelled as weight process noise — otherwise the
// filter misattributes intake error to TDEE drift and runs away.
const KALMAN_INTAKE_SD = 110;

function runKalman(
  pts: { date: string; weight: number }[],
  intakeKcal: number,
  qT: number,    // TDEE random-walk variance, kcal²/day
  qW: number,    // baseline weight process-noise variance, kg²/day
  R: number,     // observation-noise variance, kg²
  tdee0: number, // prior TDEE mean
): { steps: KalmanStep[]; logLik: number } {
  // State x = [W, T]; covariance P (2×2, row-major [p00,p01,p10,p11]).
  let W = pts[0].weight;
  let T = tdee0;
  // Initial covariance: weight known to ~observation noise; TDEE very uncertain.
  let p00 = R, p01 = 0, p10 = 0, p11 = 400 * 400; // TDEE SD prior ±400 kcal
  const steps: KalmanStep[] = [];
  let logLik = 0;

  // Seed step (first observation already in W; no innovation).
  steps.push({ date: pts[0].date, weight: pts[0].weight, filteredWeight: W, filteredWeightSd: Math.sqrt(p00), tdee: T, tdeeSd: Math.sqrt(p11), innovation: 0, innovationSd: Math.sqrt(p00 + R) });

  for (let k = 1; k < pts.length; k++) {
    const dt = Math.max(0.5, (new Date(pts[k].date).getTime() - new Date(pts[k - 1].date).getTime()) / 86400000);

    // ── Predict ──
    // F = [[1, -dt/ρ], [0, 1]]; control adds intake energy to weight.
    const a = -dt / KALMAN_RHO;
    const Wp = W + a * T + (intakeKcal * dt) / KALMAN_RHO;
    const Tp = T;
    // P_pred = F P Fᵀ + Q
    // F P:
    const f00 = p00 + a * p10, f01 = p01 + a * p11;
    const f10 = p10,            f11 = p11;
    // (F P) Fᵀ  (Fᵀ = [[1,0],[a,1]])
    let pp00 = f00 + a * f01;
    let pp01 = f01;
    let pp10 = f10 + a * f11;
    let pp11 = f11;
    // + Q (process noise).
    //  - weight: baseline biological noise (∝dt) PLUS the weight-prediction
    //    error from intake uncertainty over this interval, (σ_I·dt/ρ)² (∝dt²).
    //    The intake term is what stops the filter from blaming intake error on
    //    a swinging TDEE.
    //  - TDEE: random-walk drift (∝dt).
    const intakeW = (KALMAN_INTAKE_SD * dt) / KALMAN_RHO;
    pp00 += qW * dt + intakeW * intakeW;
    pp11 += qT * dt;
    // symmetrise
    pp01 = pp10 = (pp01 + pp10) / 2;

    // ── Update with observation z = weight (H = [1,0]) ──
    // Robust update: a weigh-in sitting many SDs off the prediction is almost
    // certainly water/glycogen/gut noise, not real signal. Inflate that
    // observation's noise (Huber-style R inflation keyed on the normalized
    // innovation) so a single bloat-day can't be read as a TDEE swing. Without
    // this, the two May water-days masquerade as adaptive thermogenesis.
    const z = pts[k].weight;
    const yk = z - Wp;             // innovation
    const S0 = pp00 + R;
    const nu = Math.abs(yk) / Math.sqrt(S0); // normalized innovation
    const TAU = 2.0;
    const Reff = nu > TAU ? R * (nu / TAU) * (nu / TAU) : R;
    const S = pp00 + Reff;       // innovation variance with robust noise
    const k0 = pp00 / S;          // Kalman gain (2×1)
    const k1 = pp10 / S;
    W = Wp + k0 * yk;
    T = Tp + k1 * yk;
    // P = (I - K H) P_pred
    p00 = (1 - k0) * pp00;
    p01 = (1 - k0) * pp01;
    p10 = pp10 - k1 * pp00;
    p11 = pp11 - k1 * pp01;
    p01 = p10 = (p01 + p10) / 2;

    // accumulate Gaussian innovation log-likelihood (under the robust noise)
    logLik += -0.5 * (Math.log(2 * Math.PI * S) + (yk * yk) / S);

    steps.push({ date: pts[k].date, weight: z, filteredWeight: W, filteredWeightSd: Math.sqrt(Math.max(0, p00)), tdee: T, tdeeSd: Math.sqrt(Math.max(0, p11)), innovation: yk, innovationSd: Math.sqrt(S) });
  }

  return { steps, logLik };
}

// Estimate observation noise R from the scatter of weigh-ins around a local
// OLS trend (the water/glycogen noise). Floored so the filter can't become
// over-confident from a lucky-clean stretch.
function estimateObservationNoise(pts: { date: string; weight: number }[]): number {
  const n = pts.length;
  if (n < 3) return 0.9 * 0.9;
  const t0 = new Date(pts[0].date).getTime();
  const xs = pts.map(p => (new Date(p.date).getTime() - t0) / 86400000);
  const ys = pts.map(p => p.weight);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const intc = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const f = intc + slope * xs[i]; sse += (ys[i] - f) ** 2; }
  const variance = sse / (n - 2);
  return Math.max(0.4 * 0.4, variance); // floor at (0.4 kg)²
}

/**
 * Kalman-filter TDEE estimate. Hyper-parameters self-calibrated from the data:
 *   R  (scale noise)  → measured residual scatter of the weigh-ins;
 *   qT (TDEE drift)   → chosen by maximum innovation-likelihood over a grid.
 *
 * `startDate` anchors the lower bound of the data window (same convention as
 * calcDerivedTDEE). `tdeePrior` seeds the initial TDEE (falls back to a
 * naive intake-minus-trend estimate).
 */
export function calcKalmanTDEE(
  measurements: Measurement[],
  intakeKcal: number,
  startDate?: string,
  asOfDate?: string,
  tdeePrior?: number,
): KalmanTDEE | null {
  if (!measurements || !intakeKcal) return null;
  const endStr = (asOfDate ? new Date(asOfDate + 'T00:00:00') : new Date()).toISOString().split('T')[0];
  const sorted = [...measurements].filter(m => m.weight).sort((a, b) => a.date.localeCompare(b.date));
  const pts = sorted
    .filter(m => (!startDate || m.date >= startDate) && m.date <= endStr)
    .map(m => ({ date: m.date, weight: m.weight }));
  if (pts.length < 3) return null;

  const R = estimateObservationNoise(pts);
  const qW = 0.0015; // weight model-error variance per day (intake + ρ error)

  // Prior TDEE: intake − (OLS weight slope × ρ). Robust starting point.
  const t0 = new Date(pts[0].date).getTime();
  const xs = pts.map(p => (new Date(p.date).getTime() - t0) / 86400000);
  const ys = pts.map(p => p.weight);
  const n = pts.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const prior = tdeePrior ?? Math.round(intakeKcal - slope * KALMAN_RHO);

  // Fit qT by maximum innovation-likelihood over a physiologically-bounded grid.
  // σ_T = 0 means a constant TDEE (OLS-equivalent); the upper end bounds how
  // fast adaptive thermogenesis can realistically move TDEE. If the data don't
  // support drift, ML picks ~0 and the filter collapses to the optimal
  // constant-TDEE estimate instead of chasing noise.
  let bestQ = 0, bestLL = -Infinity;
  for (const sigmaT of [0, 1.5, 3, 4.5, 6, 8]) {
    const q = sigmaT * sigmaT;
    const { logLik } = runKalman(pts, intakeKcal, q, qW, R, prior);
    if (logLik > bestLL) { bestLL = logLik; bestQ = q; }
  }

  const { steps } = runKalman(pts, intakeKcal, bestQ, qW, R, prior);
  const last = steps[steps.length - 1];
  const daysSpan = Math.round((new Date(pts[n - 1].date).getTime() - t0) / 86400000);

  // Innovation-based covariance scaling (a.k.a. consistency check / NIS).
  // If the filter's predicted innovation variance S is honest, the normalized
  // innovation squared (y²/S) averages ~1. When the data is bumpier than the
  // model thinks (water-day outliers create model-vs-reality gaps the filter
  // can't see), NIS > 1 and the raw posterior CI is overconfident. Scale the
  // reported CI by √NIS so the ± number is empirically calibrated — this is
  // what the backtest's coverage check validates, and it's why you can trust
  // the interval without checking by hand. Floored at 1 (never shrink).
  let nisSum = 0, nisN = 0;
  for (let k = 1; k < steps.length; k++) {
    const s = steps[k];
    if (s.innovationSd > 0) { nisSum += (s.innovation / s.innovationSd) ** 2; nisN++; }
  }
  const nis = nisN > 0 ? nisSum / nisN : 1;
  const calScale = Math.sqrt(Math.max(1, nis));

  return {
    tdee: Math.round(last.tdee),
    tdeeCI95: Math.round(1.96 * last.tdeeSd * calScale),
    weightFiltered: Math.round(last.filteredWeight * 10) / 10,
    measurementCount: n,
    daysSpan,
    rDay: Math.round(R * 1000) / 1000,
    qTDay: bestQ,
    series: steps.map(s => ({ date: s.date, tdee: Math.round(s.tdee), sd: Math.round(s.tdeeSd * calScale) })),
  };
}

export interface KalmanBacktest {
  horizonDays: number;    // prediction horizon the long-range MAE is measured at
  count: number;          // number of long-horizon predictions evaluated
  maeKalman: number;      // Kalman weight-trajectory MAE at the horizon (kg)
  maeNaive: number;       // "weight stays flat" baseline MAE at the horizon (kg)
  maeOls: number;         // OLS trend-extrapolation MAE at the horizon (kg)
  improvementPct: number; // Kalman MAE improvement over naive (%, +ve = better)
  coverage95: number;     // fraction of actual weights inside the 95% interval (all horizons)
  coverageCount: number;  // number of points the coverage was measured over
}

// Fit + run the self-calibrated filter on a training prefix; returns the final
// filtered state (deduplicated so the estimator and backtest agree exactly).
function fitKalman(train: { date: string; weight: number }[], intakeKcal: number) {
  const R = estimateObservationNoise(train);
  const qW = 0.0015;
  const t0 = new Date(train[0].date).getTime();
  const xs = train.map(p => (new Date(p.date).getTime() - t0) / 86400000);
  const ys = train.map(p => p.weight);
  const m = train.length;
  const mx = xs.reduce((s, v) => s + v, 0) / m, my = ys.reduce((s, v) => s + v, 0) / m;
  let num = 0, den = 0;
  for (let j = 0; j < m; j++) { num += (xs[j] - mx) * (ys[j] - my); den += (xs[j] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const prior = Math.round(intakeKcal - slope * KALMAN_RHO);
  let bestQ = 0, bestLL = -Infinity;
  for (const sigmaT of [0, 1.5, 3, 4.5, 6, 8]) {
    const q = sigmaT * sigmaT;
    const { logLik } = runKalman(train, intakeKcal, q, qW, R, prior);
    if (logLik > bestLL) { bestLL = logLik; bestQ = q; }
  }
  const { steps } = runKalman(train, intakeKcal, bestQ, qW, R, prior);
  // Same NIS calibration scale the live estimator applies.
  let nisSum = 0, nisN = 0;
  for (let k = 1; k < steps.length; k++) {
    if (steps[k].innovationSd > 0) { nisSum += (steps[k].innovation / steps[k].innovationSd) ** 2; nisN++; }
  }
  const calScale = Math.sqrt(Math.max(1, nisN > 0 ? nisSum / nisN : 1));
  return { state: steps[steps.length - 1], R, slope, intc: my - slope * mx, t0, mx, R0: R, calScale };
}

/**
 * Walk-forward backtest. Two honest tests of trust:
 *
 *  1. Long-horizon accuracy — predict each held-out weigh-in ~3 weeks ahead of
 *     the training cut, comparing Kalman vs a flat "weight stays put" baseline
 *     and vs OLS trend extrapolation. We deliberately do NOT score one-step
 *     prediction: over a few days, weight is dominated by unpredictable water
 *     noise, so "next ≈ last" is near-optimal *by physics* and tells us nothing
 *     about TDEE quality. The TDEE estimate only proves its worth over a
 *     horizon where the cumulative (intake − TDEE) signal outgrows the noise.
 *
 *  2. Calibration — across all held-out points, the fraction that land inside
 *     the model's stated 95 % predictive interval should be ≈95 %. This is what
 *     lets you trust the ± number without checking by hand.
 */
export function backtestKalmanTDEE(
  measurements: Measurement[],
  intakeKcal: number,
  startDate?: string,
): KalmanBacktest | null {
  if (!measurements || !intakeKcal) return null;
  const sorted = [...measurements].filter(m => m.weight).sort((a, b) => a.date.localeCompare(b.date));
  const all = sorted.filter(m => !startDate || m.date >= startDate).map(m => ({ date: m.date, weight: m.weight }));
  const warm = 4;
  if (all.length < warm + 2) return null;

  const HORIZON = 21; // days — long enough that real trend > water noise
  const ms = (d: string) => new Date(d).getTime();

  let absK = 0, absN = 0, absO = 0, hCount = 0;       // long-horizon accuracy
  let inside = 0, covCount = 0;                         // calibration (all horizons)

  for (let i = warm; i < all.length - 1; i++) {
    const train = all.slice(0, i + 1);
    const fit = fitKalman(train, intakeKcal);
    const s = fit.state;

    for (let j = i + 1; j < all.length; j++) {
      const target = all[j];
      const dt = (ms(target.date) - ms(train[i].date)) / 86400000;
      if (dt <= 0) continue;

      // Kalman energy-balance forward projection of the de-noised weight.
      const predW = s.filteredWeight + ((intakeKcal - s.tdee) * dt) / KALMAN_RHO;
      // Predictive variance of the *observed* weight at the target date:
      //   • current de-noised-weight posterior variance (the filter isn't
      //     certain where true weight is right now);
      //   • TDEE uncertainty projected forward — a wrong TDEE compounds
      //     linearly into weight over the horizon;
      //   • intake-estimate uncertainty over the horizon;
      //   • baseline biological process noise over the horizon;
      //   • a fresh dose of scale/water noise at the target weigh-in.
      const wNow = s.filteredWeightSd;
      const tdeeTerm = (s.tdeeSd * dt) / KALMAN_RHO;
      const intakeTerm = (KALMAN_INTAKE_SD * dt) / KALMAN_RHO;
      const predVar = wNow * wNow + tdeeTerm * tdeeTerm + intakeTerm * intakeTerm + 0.0015 * dt + fit.R0;
      const predSd = Math.sqrt(predVar) * fit.calScale; // apply the same calibration scaling

      // Calibration: count every horizon.
      if (Math.abs(target.weight - predW) <= 1.96 * predSd) inside++;
      covCount++;

      // Long-horizon accuracy: only score points near the chosen horizon.
      if (Math.abs(dt - HORIZON) <= 4) {
        const naiveW = train[i].weight; // flat
        const xT = (ms(target.date) - fit.t0) / 86400000;
        const olsPred = fit.intc + fit.slope * xT;
        absK += Math.abs(target.weight - predW);
        absN += Math.abs(target.weight - naiveW);
        absO += Math.abs(target.weight - olsPred);
        hCount++;
      }
    }
  }

  if (hCount === 0) return null;
  const maeK = absK / hCount, maeN = absN / hCount;
  return {
    horizonDays: HORIZON,
    count: hCount,
    maeKalman: Math.round(maeK * 1000) / 1000,
    maeNaive: Math.round(maeN * 1000) / 1000,
    maeOls: Math.round((absO / hCount) * 1000) / 1000,
    improvementPct: Math.round((1 - maeK / maeN) * 1000) / 10,
    coverage95: Math.round((inside / covCount) * 1000) / 1000,
    coverageCount: covCount,
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
