import type { TrainingSession, TrainingSet, TrainingExercise } from '@/types';
import { calcSessionCalories } from './calories';

const SHARE_RECIPIENT = '+66827116441';

function isDone(set: TrainingSet, hasDoneFlags: boolean): boolean {
  return hasDoneFlags ? !!set.done : true;
}

function fmtWeight(w: number | string): string {
  const n = typeof w === 'number' ? w : parseFloat(w as string) || 0;
  return n % 1 === 0 ? `${n}` : n.toFixed(1);
}

function topSets(exercises: TrainingExercise[], hasDoneFlags: boolean): string[] {
  const ranked = exercises
    .filter(ex => !ex.skipped)
    .map(ex => {
      const working = ex.sets.filter(s => !s.isWarmup && isDone(s, hasDoneFlags));
      if (working.length === 0) return null;
      const max = Math.max(...working.map(s => typeof s.weight === 'number' ? s.weight : parseFloat(s.weight as string) || 0));
      const top = working.find(s => (typeof s.weight === 'number' ? s.weight : parseFloat(s.weight as string) || 0) === max)!;
      const reps = top.reps ?? (parseInt(ex.targetReps) || 0);
      return { name: ex.name, weight: max, reps, volume: max * reps * working.length };
    })
    .filter((x): x is { name: string; weight: number; reps: number; volume: number } => x != null)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5);
  return ranked.map(r => `• ${r.name}: ${fmtWeight(r.weight)}kg × ${r.reps}`);
}

export function formatSessionMessage(session: TrainingSession, bodyWeight: number): string {
  const isCardio = session.workoutName === 'Cardio';
  const date = new Date(session.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const kcal = calcSessionCalories(session, bodyWeight);
  const duration = session.durationMinutes;
  const hasDoneFlags = session.exercises.some(ex => ex.sets.some(s => s.done !== undefined));
  const doneExercises = session.exercises.filter(ex => !ex.skipped && ex.sets.some(s => isDone(s, hasDoneFlags)));

  if (isCardio) {
    const lines = [`🚴 Cardio — ${date}`];
    for (const ex of doneExercises) {
      lines.push(`${ex.name}: ${ex.targetReps}${ex.calories ? ` (${ex.calories} kcal)` : ''}`);
    }
    if (duration) lines.push(`Total: ${duration} min · ~${kcal} kcal`);
    else lines.push(`~${kcal} kcal`);
    return lines.join('\n');
  }

  const totalSets = doneExercises.reduce((sum, ex) => sum + ex.sets.filter(s => !s.isWarmup && isDone(s, hasDoneFlags)).length, 0);
  const totalVolume = doneExercises.reduce((sum, ex) => {
    return sum + ex.sets.filter(s => !s.isWarmup && isDone(s, hasDoneFlags)).reduce((vSum, s) => {
      const w = typeof s.weight === 'number' ? s.weight : parseFloat(s.weight as string) || 0;
      const r = s.reps ?? (parseInt(ex.targetReps) || 0);
      return vSum + w * r;
    }, 0);
  }, 0);

  const lines = [`💪 ${session.workoutName} — ${date}`];
  const headerBits: string[] = [];
  if (duration) headerBits.push(`${duration} min`);
  headerBits.push(`${doneExercises.length} exercises`);
  headerBits.push(`${totalSets} sets`);
  if (totalVolume > 0) headerBits.push(`${Math.round(totalVolume).toLocaleString('en-US')} kg vol`);
  lines.push(headerBits.join(' · '));
  lines.push(`~${kcal} kcal`);

  const tops = topSets(session.exercises, hasDoneFlags);
  if (tops.length > 0) {
    lines.push('');
    lines.push('Top sets:');
    lines.push(...tops);
  }
  return lines.join('\n');
}

export function shareSessionToWhatsApp(session: TrainingSession, bodyWeight: number): void {
  const message = formatSessionMessage(session, bodyWeight);
  const url = `https://wa.me/${SHARE_RECIPIENT.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}
