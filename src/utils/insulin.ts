/**
 * Insulin bolus calculator — Phase 1 (decision support + logbook).
 *
 * ⚠️ SAFETY: This applies STANDARD bolus math to the user's OWN clinician-
 * informed parameters. It does not invent dosing. Every proposal is shown with
 * its full breakdown and must be reviewed by the user. Hard guards: low-glucose
 * lockout, max-dose cap, insulin-on-board subtraction, stale-data warnings.
 *
 * Standard mealtime bolus (rapid-acting / Fiasp):
 *   carb bolus       = meal_carbs / ICR              (ICR = g carb per unit)
 *   correction bolus = (glucose − target) / ISF       (ISF = mg/dL per unit)
 *   proposed         = (carb + correction) · trendAdj − IOB   (floored 0, capped)
 *
 * ICR/ISF differ by time of day (dawn phenomenon → morning more resistant).
 */

export type TimeBlock = 'morning' | 'evening';

export interface InsulinSettings {
  icrMorning: number;   // g carb per unit, morning block
  icrEvening: number;   // g carb per unit, evening block
  isfMorning: number;   // mg/dL dropped per unit, morning block
  isfEvening: number;   // mg/dL dropped per unit, evening block
  targetLow: number;    // mg/dL — bottom of in-range
  targetHigh: number;   // mg/dL — top of in-range (correct only above this)
  targetMid: number;    // mg/dL — glucose we correct toward
  cutoverHour: number;  // hour (0-23) where morning block flips to evening
  maxDose: number;      // hard cap on a single proposed dose (units)
  diaHours: number;     // duration of insulin action for IOB (Fiasp ≈ 4h)
  checkAfterHours: number; // verify glucose this long after a dose (e.g. 3h)
  basalDose: number;    // long-acting basal units/day — CONTEXT ONLY. Feeds the
                        // TDD plausibility cross-check + endo report. It is
                        // NEVER part of the bolus math (basal is background
                        // insulin; subtracting it from a meal bolus would
                        // under-dose). 0 = not set.
  typicalBolus: number; // typical total bolus units/day for the TDD check.
                        // 0 = derive from the logged doses (needs ~2 weeks of
                        // complete logging to be accurate). CONTEXT ONLY.
  learningMode: boolean; // opt-in: apply the bounded shrinkage-learned ICR to
                         // the SUGGESTED dose. Never auto-doses — you still log
                         // your own units. Off by default.
}

// Seeded conservatively (biased toward under-dosing) from the user's ISF via
// the clinical 500-rule (ICR ≈ 0.28·ISF), rounded UP to err safe. All editable.
export const DEFAULT_INSULIN_SETTINGS: InsulinSettings = {
  icrMorning: 7,
  icrEvening: 12,
  isfMorning: 20,
  isfEvening: 40,
  targetLow: 80,
  targetHigh: 120,
  targetMid: 100,
  cutoverHour: 12,
  maxDose: 15,
  diaHours: 4,
  checkAfterHours: 3,
  basalDose: 0,
  typicalBolus: 0,
  learningMode: false,
};

// Rough plausibility cross-check on ICR/ISF from the classic total-daily-dose
// rules — GUIDANCE ONLY, never used in the dose calculation:
//   TDD  = basal + average daily bolus
//   ICR  ≈ 500 / TDD   (500-rule, g carb per unit)
//   ISF  ≈ 1800 / TDD  (1800-rule for rapid-acting, mg/dL per unit)
//   basal ≈ 40–60 % of TDD
// Flags settings that sit far outside these ballparks so the user can sanity-
// check them with their endocrinologist.
export interface TddCheck {
  tdd: number;
  basalPct: number;
  expectedICR: number;
  expectedISF: number;
  reliable: boolean;   // false when no bolus data yet (TDD would be basal-only)
  notes: string[];
}

export function tddSanityCheck(settings: InsulinSettings, avgDailyBolus: number): TddCheck | null {
  const basal = settings.basalDose || 0;
  if (basal <= 0) return null;
  const bolus = Math.max(0, avgDailyBolus);
  const tdd = basal + bolus;
  const basalPct = (basal / tdd) * 100;
  const expectedICR = 500 / tdd;
  const expectedISF = 1800 / tdd;
  if (bolus <= 0) {
    return { tdd, basalPct, expectedICR, expectedISF, reliable: false,
      notes: ['No recent bolus logged yet — TDD is basal-only, so the ICR/ISF cross-check is skipped.'] };
  }
  const icrAvg = (settings.icrMorning + settings.icrEvening) / 2;
  const isfAvg = (settings.isfMorning + settings.isfEvening) / 2;
  const notes: string[] = [];
  if (basalPct < 30) notes.push(`Basal is ${Math.round(basalPct)}% of TDD (typical 40–60%) — basal may be low or bolus high.`);
  else if (basalPct > 65) notes.push(`Basal is ${Math.round(basalPct)}% of TDD (typical 40–60%) — basal may be high or bolus low.`);
  if (icrAvg > expectedICR * 1.5 || icrAvg < expectedICR * 0.6) notes.push(`Your ICR (avg ~${icrAvg.toFixed(0)} g/u) is far from the 500-rule estimate (~${expectedICR.toFixed(1)} g/u).`);
  if (isfAvg > expectedISF * 1.6 || isfAvg < expectedISF * 0.6) notes.push(`Your ISF (avg ~${isfAvg.toFixed(0)} mg/dL/u) is far from the 1800-rule estimate (~${expectedISF.toFixed(0)}).`);
  return { tdd, basalPct, expectedICR, expectedISF, reliable: true, notes };
}

export interface InsulinDose {
  id: string;
  kind: 'dose';
  timestamp: string;    // ISO — when the bolus was given
  mealName: string;
  mealCarbs: number;
  glucoseBefore: number; // mg/dL at dose time
  trendBefore?: number;  // 1-5 CGM trend arrow
  block: TimeBlock;
  proposedUnits: number;
  actualUnits: number;   // what the user actually injected
  breakdown: DoseBreakdown;
  // Filled in ~checkAfterHours later from CGM history:
  verify?: {
    at: string;          // ISO time of the reading used
    glucoseAfter: number;
    status: 'on-target' | 'high' | 'low';
    confounded: boolean; // true if a rescue-carb event fell in the window
  };
}

export interface RescueEvent {
  id: string;
  kind: 'rescue';
  timestamp: string;
  carbs: number;         // rescue carbs eaten to treat a low
  note?: string;
}

export type InsulinEvent = InsulinDose | RescueEvent;

export interface DoseBreakdown {
  carbBolus: number;
  correctionBolus: number;
  trendAdjPct: number;   // e.g. +10, -20
  iob: number;
  icr: number;
  isf: number;
}

export interface BolusProposal {
  proposed: number;      // final units, rounded, capped, floored
  block: TimeBlock;
  breakdown: DoseBreakdown;
  warnings: string[];
  lockout: boolean;      // true = do NOT bolus for correction (treat low first)
  stale: boolean;        // glucose reading too old to trust
}

export function timeBlock(date: Date, cutoverHour: number): TimeBlock {
  return date.getHours() < cutoverHour ? 'morning' : 'evening';
}

/**
 * Insulin-on-board from recent Fiasp doses. Linear decay over DIA — simple and
 * hand-verifiable. Slightly conservative for stacking purposes at the tail.
 */
export function calcIOB(doses: InsulinDose[], now: Date, diaHours: number): number {
  let iob = 0;
  const nowMs = now.getTime();
  for (const d of doses) {
    const elapsedH = (nowMs - new Date(d.timestamp).getTime()) / 3600000;
    if (elapsedH < 0 || elapsedH >= diaHours) continue;
    const remaining = 1 - elapsedH / diaHours;
    iob += d.actualUnits * remaining;
  }
  return Math.round(iob * 10) / 10;
}

/**
 * Trend adjustment as a % of the (carb+correction) subtotal, bounded and
 * conservative. Rising glucose → dose slightly up; falling → down + warn.
 */
function trendAdjustment(trendRaw?: number): { pct: number; warn?: string } {
  switch (trendRaw) {
    case 5: return { pct: 10 };                                   // rising fast
    case 4: return { pct: 5 };                                    // rising
    case 2: return { pct: -10, warn: 'Glucose falling — dose reduced; recheck sooner.' };
    case 1: return { pct: -20, warn: 'Glucose falling fast — consider holding/reducing and rechecking before you bolus.' };
    default: return { pct: 0 };                                   // stable / unknown
  }
}

/** Doses are whole units only. */
function roundUnits(x: number): number {
  return Math.round(x);
}

/**
 * Compute the proposed bolus. Pure function — all inputs explicit so it's
 * testable and the UI can show every term.
 */
export function calcBolus(opts: {
  glucose: number;
  glucoseAgeMin: number;   // minutes since the reading
  trendRaw?: number;
  mealCarbs: number;
  now: Date;
  recentDoses: InsulinDose[];
  rescueInLastHour: boolean;
  settings: InsulinSettings;
}): BolusProposal {
  const { glucose, glucoseAgeMin, trendRaw, mealCarbs, now, recentDoses, rescueInLastHour, settings } = opts;
  const block = timeBlock(now, settings.cutoverHour);
  const icr = block === 'morning' ? settings.icrMorning : settings.icrEvening;
  const isf = block === 'morning' ? settings.isfMorning : settings.isfEvening;
  const warnings: string[] = [];

  const stale = glucoseAgeMin > 15;
  if (stale) warnings.push(`Glucose reading is ${Math.round(glucoseAgeMin)} min old — refresh before dosing.`);

  // Low glucose: never CORRECT into a low, but if a meal is being logged still
  // show its carb-coverage dose (you're about to eat) — just flag the low.
  const fallingFast = trendRaw === 1;
  const low = glucose < settings.targetLow || (glucose < settings.targetMid && fallingFast);

  const carbBolus = mealCarbs > 0 ? mealCarbs / icr : 0;
  // Correct only when clearly above range (and never into a low); toward mid.
  const correctionBolus = (!low && glucose > settings.targetHigh) ? (glucose - settings.targetMid) / isf : 0;

  if (low) {
    warnings.unshift(carbBolus > 0
      ? `Glucose ${glucose} is low — correction skipped; only the meal's carb dose is shown. Treat the low too.`
      : `Glucose ${glucose} is low — nothing to dose. Treat the low.`);
  }

  const { pct: trendPct, warn: trendWarn } = trendAdjustment(trendRaw);
  if (trendWarn) warnings.push(trendWarn);

  const subtotal = (carbBolus + correctionBolus) * (1 + trendPct / 100);
  const iob = calcIOB(recentDoses, now, settings.diaHours);
  if (iob > 0) warnings.push(`${iob}u insulin still active (IOB) — subtracted to avoid stacking.`);

  let proposed = roundUnits(Math.max(0, subtotal - iob));

  if (proposed > settings.maxDose) {
    proposed = settings.maxDose;
    warnings.push(`Hit your ${settings.maxDose}u cap — verify carefully.`);
  }
  if (rescueInLastHour) {
    warnings.push('Recent rescue carbs — this event is excluded from learning so it doesn\'t skew your ratios.');
  }

  // Lockout only when low AND there's nothing to safely propose (no carbs).
  const lockout = low && carbBolus <= 0;

  return {
    proposed, block, lockout, stale,
    breakdown: {
      carbBolus: Math.round(carbBolus * 10) / 10,
      correctionBolus: Math.round(correctionBolus * 10) / 10,
      trendAdjPct: trendPct,
      iob,
      icr, isf,
    },
    warnings,
  };
}

/**
 * Verify a dose from CGM history ~checkAfterHours later. `historyAt` returns the
 * glucose nearest a given time (or null). `rescueBetween` says whether a rescue
 * event fell in the dose→check window (which confounds the outcome).
 */
export function verifyDose(
  dose: InsulinDose,
  settings: InsulinSettings,
  glucoseAtCheck: number | null,
  rescueInWindow: boolean,
  checkTimeIso: string,
): InsulinDose['verify'] | null {
  if (glucoseAtCheck == null) return null;
  let status: 'on-target' | 'high' | 'low';
  if (glucoseAtCheck < settings.targetLow) status = 'low';
  else if (glucoseAtCheck > settings.targetHigh) status = 'high';
  else status = 'on-target';
  return { at: checkTimeIso, glucoseAfter: glucoseAtCheck, status, confounded: rescueInWindow };
}

/**
 * INFO-ONLY learning signal (Phase 1 does not auto-change parameters). From
 * clean, verified, non-confounded doses where glucose started roughly in range
 * (so the dose was ~all carb bolus), back-calculate the ICR that would have
 * landed the 3h glucose on target. Returns the median per block + sample count.
 *
 * Logic: if a meal's carb bolus left glucose HIGH at 3h, the effective ICR was
 * too weak (needs fewer g/unit); if LOW, too strong. We nudge the implied ICR
 * by the correction the miss implies, then aggregate.
 */
export function estimateEmpiricalICR(
  doses: InsulinDose[],
  settings: InsulinSettings,
): { morning?: { icr: number; n: number }; evening?: { icr: number; n: number } } {
  const perBlock: Record<TimeBlock, number[]> = { morning: [], evening: [] };

  for (const d of doses) {
    if (!d.verify || d.verify.confounded) continue;
    if (d.actualUnits <= 0 || d.mealCarbs <= 0) continue;
    // Only use doses that started near range so the dose is ~all carb coverage.
    if (d.glucoseBefore > settings.targetHigh + 20 || d.glucoseBefore < settings.targetLow) continue;
    const isf = d.block === 'morning' ? settings.isfMorning : settings.isfEvening;
    // Units that WOULD have hit target: actual ± the miss the 3h glucose implies.
    // glucoseAfter above mid → we under-dosed → needed extra = (after−mid)/isf.
    const miss = (d.verify.glucoseAfter - settings.targetMid) / isf; // +ve = needed more
    const idealUnits = d.actualUnits + miss;
    if (idealUnits <= 0) continue;
    const impliedIcr = d.mealCarbs / idealUnits;
    if (impliedIcr > 0 && impliedIcr < 60) perBlock[d.block].push(impliedIcr);
  }

  const median = (arr: number[]) => {
    if (arr.length === 0) return undefined;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const out: { morning?: { icr: number; n: number }; evening?: { icr: number; n: number } } = {};
  const mm = median(perBlock.morning); if (mm != null) out.morning = { icr: Math.round(mm * 10) / 10, n: perBlock.morning.length };
  const me = median(perBlock.evening); if (me != null) out.evening = { icr: Math.round(me * 10) / 10, n: perBlock.evening.length };
  return out;
}

export interface LearnedICR { icr: number; seed: number; n: number; }
export interface LearnedISF { isf: number; seed: number; n: number; }

function medianOf(arr: number[]): number | undefined {
  if (arr.length === 0) return undefined;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Shrink a data estimate toward the seed by data weight, then hard-bound near
// the seed. Shared by ICR + ISF learning.
//   learned = seed + (dataMedian − seed)·n/(n+K),  clamped to seed·[1±maxDev]
function shrinkToward(seed: number, dataMedian: number, n: number, K: number, maxDev: number): number {
  const shrunk = seed + (dataMedian - seed) * (n / (n + K));
  return Math.round(Math.min(seed * (1 + maxDev), Math.max(seed * (1 - maxDev), shrunk)) * 10) / 10;
}

/**
 * Bayesian-shrinkage ICR per block for the SUGGESTED dose. Blends the seed with
 * the clean verified outcomes (from estimateEmpiricalICR), weighted by how many
 * there are, hard-bounded near the seed. Barely moves on thin data; shifts toward
 * the data as clean outcomes accumulate. Suggestion only — never auto-doses, and
 * never touches the safety guards.
 */
export function learnedICRs(
  doses: InsulinDose[],
  settings: InsulinSettings,
  opts?: { priorK?: number; maxDev?: number },
): { morning?: LearnedICR; evening?: LearnedICR } {
  const K = opts?.priorK ?? 6;          // prior strength (pseudo-count of the seed)
  const maxDev = opts?.maxDev ?? 0.30;  // never move more than ±30 % from the seed
  const emp = estimateEmpiricalICR(doses, settings);
  const out: { morning?: LearnedICR; evening?: LearnedICR } = {};
  (['morning', 'evening'] as TimeBlock[]).forEach(block => {
    const seed = block === 'morning' ? settings.icrMorning : settings.icrEvening;
    const e = emp[block];
    if (!e || e.n <= 0 || seed <= 0) return;
    out[block] = { icr: shrinkToward(seed, e.icr, e.n, K, maxDev), seed, n: e.n };
  });
  return out;
}

/**
 * Implied ISF from CORRECTION-dominated verified outcomes only: glucose started
 * high (> targetHigh) with carbs ≈ 0, so the 3h change is (mostly) the insulin's
 * own drop rather than a carb+correction mix.  impliedISF = (before − after)/units.
 * Meals (carbs > 0) are excluded — their dose blends carb + correction and would
 * contaminate the estimate.
 */
export function estimateEmpiricalISF(
  doses: InsulinDose[],
  settings: InsulinSettings,
): { morning?: { isf: number; n: number }; evening?: { isf: number; n: number } } {
  const perBlock: Record<TimeBlock, number[]> = { morning: [], evening: [] };
  for (const d of doses) {
    if (!d.verify || d.verify.confounded) continue;
    if (d.actualUnits <= 0 || d.mealCarbs > 0) continue;         // correction-only
    if (d.glucoseBefore <= settings.targetHigh) continue;        // must have been high
    const impliedIsf = (d.glucoseBefore - d.verify.glucoseAfter) / d.actualUnits;
    if (impliedIsf > 0 && impliedIsf < 200) perBlock[d.block].push(impliedIsf);
  }
  const out: { morning?: { isf: number; n: number }; evening?: { isf: number; n: number } } = {};
  const mm = medianOf(perBlock.morning); if (mm != null) out.morning = { isf: Math.round(mm * 10) / 10, n: perBlock.morning.length };
  const me = medianOf(perBlock.evening); if (me != null) out.evening = { isf: Math.round(me * 10) / 10, n: perBlock.evening.length };
  return out;
}

/** Bayesian-shrinkage ISF per block for the SUGGESTED dose (see
 *  estimateEmpiricalISF). Same bounded shrinkage as learnedICRs. Suggestion only. */
export function learnedISFs(
  doses: InsulinDose[],
  settings: InsulinSettings,
  opts?: { priorK?: number; maxDev?: number },
): { morning?: LearnedISF; evening?: LearnedISF } {
  const K = opts?.priorK ?? 6;
  const maxDev = opts?.maxDev ?? 0.30;
  const emp = estimateEmpiricalISF(doses, settings);
  const out: { morning?: LearnedISF; evening?: LearnedISF } = {};
  (['morning', 'evening'] as TimeBlock[]).forEach(block => {
    const seed = block === 'morning' ? settings.isfMorning : settings.isfEvening;
    const e = emp[block];
    if (!e || e.n <= 0 || seed <= 0) return;
    out[block] = { isf: shrinkToward(seed, e.isf, e.n, K, maxDev), seed, n: e.n };
  });
  return out;
}
