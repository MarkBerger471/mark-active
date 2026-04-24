import { TrainingSet } from '@/types';

/**
 * Returns the lower bound of a target rep range as a number.
 * Examples: "6-8" → 6, "8" → 8, "12-15" → 12, "15 each leg" → 15.
 * Returns 0 for non-numeric targets like "AMRAP" or "30 min".
 */
export function parseLowerBoundReps(targetReps: string): number {
  const m = (targetReps || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Effective reps for a set:
 *   set.reps if explicitly entered, otherwise lower bound of targetReps.
 *
 * Mark calibrates weight to always hit within the target range, so the lower
 * bound is a guaranteed minimum — slightly underestimates volume but trends
 * remain accurate. Lets analyses use rep counts without forcing manual entry
 * during workouts.
 */
export function getEffectiveReps(set: TrainingSet, targetReps: string): number {
  if (set.reps != null && set.reps > 0) return set.reps;
  return parseLowerBoundReps(targetReps);
}
