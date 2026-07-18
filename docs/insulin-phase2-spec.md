# Insulin Dosing — Phase 2 Spec (adaptive advisor)

> Parked for later implementation. Phase 1 (calculator + logbook) is built and
> running locally. Phase 2 only makes sense **after a few weeks of Phase 1 data**
> (verified 3-hour outcomes), and ideally after Mark's endocrinologist has seen
> that data. This is a **safety-critical medical feature** — Phase 2 changes the
> dosing numbers, so every part below is bounded, transparent, and reviewable.

---

## Current state (Phase 1 — already built)

Files: `src/utils/insulin.ts` (pure math + types), `src/components/InsulinCard.tsx`
(dashboard card below the glucose card), `src/utils/storage.ts` (insulin settings
+ log persistence, Firestore-synced JSON blobs `insulin_settings` / `insulin_log`).

**Phase 1 does:**
- Proposes a whole-unit bolus = `carbs/ICR + (glucose−target)/ISF`, ± bounded
  trend adjustment, − IOB, floored/capped. AM/PM ICR+ISF blocks (noon cutover).
- Safety guards: low-glucose lockout, 15u max cap, IOB (linear Fiasp 4h), stale-
  reading warning, falling-glucose warnings.
- Logs each dose (meal, carbs, glucose-before, trend, proposed, **actual given**).
- **Auto-verifies 3h later** from CGM history → on-target / ran-high / ran-low.
- **Rescue-carb events** logged separately, excluded from learning, and any 3h
  window they touch is flagged confounded.
- **Info-only learning signal** (`estimateEmpiricalICR`): shows what the data
  implies the ICR should be per block, but does **not** change settings.

**Seeded params (all editable):** ICR AM 7 / PM 12 g·u⁻¹ (from 500-rule, biased
safe), ISF AM 20 / PM 40 mg·dL⁻¹·u⁻¹ (Mark's values), target 80–120 (correct
toward 100), cutover 12:00, max 15u, Fiasp DIA 4h, 3h check.

**Data the log already captures (everything Phase 2 needs):** per dose —
`timestamp, mealName, mealCarbs, glucoseBefore, trendBefore, block,
proposedUnits, actualUnits, breakdown{carbBolus,correctionBolus,trendAdjPct,iob,
icr,isf}, verify{at,glucoseAfter,status,confounded}`.

---

## Phase 2 goal

Move from "calculator Mark drives" → "adaptive advisor that learns him." The app
refines the dosing parameters from verified outcomes, **within safe bounds**,
with graduated trust and Mark's control over how much autonomy it has.

---

## Components (priority order)

### 1. Adaptive ICR / ISF per block — the core
- **Estimator:** incremental Bayesian / Kalman-style update (reuse the pattern
  from `calcKalmanTDEE`). Each block's ICR is a hidden state; each verified,
  non-confounded 3h outcome is a noisy observation of "what ICR would have hit
  target." Update posterior after each event.
- **Bounded steps:** ≤ ~5–10 % change per update. No lurching — titration only.
- **Gated:** a block starts adapting only after ≥ ~8–10 clean confirmed events.
- **Modes (Mark chooses):**
  - *suggest-and-approve* — "morning ICR should move 7→6, accept?" (default, safest)
  - *auto within a locked band* — auto-applies but only inside a ± band Mark sets;
    any parameter can be frozen.
- **Calibrated confidence:** each learned ratio carries a posterior SD; don't
  propose a change until confidence is adequate.
- **Physiology sanity check:** expect AM ICR < PM ICR (dawn phenomenon, matches
  ISF direction); flag rather than trust data that contradicts it.

### 2. Finer time blocks
- Today = 2 blocks (AM/PM). Learn per-meal ratios (breakfast, lunch 10:30,
  lunch 15:00, dinner, intra-drink) where the data supports distinct values.
- The floating intra-workout meal keys off its *actual* logged time.

### 3. Exercise-sensitivity adjustment
- The app already has `trainingSessions`. Learn how much a workout (and its
  size/recency) raises insulin sensitivity → auto-trim the dose for meals near
  training. Highest value for the intra-workout drink.

### 4. Better IOB + personal insulin duration
- Replace linear IOB with a proper Fiasp activity curve (bilinear/exponential).
- Learn Mark's *actual* insulin action duration from his glucose response
  instead of assuming 4h.

### 5. Velocity-based trend
- Use the precise glucose slope from the 15-min CGM history (not the coarse 1–5
  arrow). Learn how Mark responds to dosing while rising vs falling.

### 6. Pattern detection & alerts
- "Dinners consistently run high," "dips 2h after the intra drink," dawn-
  phenomenon strength over time. Surface for Mark + his doctor.

### 7. Per-proposal confidence
- A ± band on each proposed dose (like the TDEE CI) so Mark instantly knows when
  to trust the number vs use judgment. Widens when data is thin / novel.

### 8. Smarter correction logic
- Learn Mark's personal correction response; avoid over-correcting when IOB is
  already active/working.

### 9. Endo report
- One-tap summary: logged doses, outcomes, time-in-range, learned ratios — for
  appointments.

---

## Safety requirements (non-negotiable)

- **Never invent dosing.** All adaptation is bounded titration of Mark's own
  clinician-informed parameters, from his own verified outcomes.
- **Graduated trust / backtest.** Like the TDEE backtest, the learner earns
  autonomy by proving its predictions against actual 3h glucose. Until reliably
  accurate, it stays suggest-only.
- **Doctor in the loop** before any auto-apply; endo reviews Phase 1 data + the
  proposed learning bounds.
- Keep all Phase 1 guards (lockout, cap, IOB, stale/falling warnings) — Phase 2
  adds learning *on top of*, never replaces, the safety floor.
- Exclude confounded (rescue-carb) and out-of-range-start events from learning,
  as Phase 1 already does.

---

## Rollout sequence
1. Ship suggest-and-approve **adaptive ICR/ISF** (component 1) only.
2. Add exercise sensitivity (3) + finer blocks (2) once #1 is trusted.
3. IOB curve (4), velocity trend (5), confidence (7), alerts (6), report (9) as
   follow-ons.
4. Auto-apply mode only after backtest shows the learner's 3h predictions are
   consistently accurate AND the endo has signed off.

## Preconditions to start
- Several weeks of Phase 1 logging with verified 3h outcomes across all blocks.
- Mark confirms Phase 1 proposals match his experience.
- Endo has seen the Phase 1 data.
