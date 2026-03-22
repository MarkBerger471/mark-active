'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navigation from '@/components/Navigation';
import { getPresetWorkouts, getLastSessionForWorkout, saveTrainingSession, getTrainingSessions, deleteTrainingSession } from '@/utils/storage';
import { Workout, TrainingExercise, TrainingSession, TrainingSet } from '@/types';
import { DumbbellIcon } from '@/components/BackgroundEffects';

type View = 'select' | 'workout' | 'history';

export default function TrainingPlanPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<View>('select');
  const [workouts] = useState<Workout[]>(getPresetWorkouts);
  const [activeWorkout, setActiveWorkout] = useState<string | null>(null);
  const [exercises, setExercises] = useState<TrainingExercise[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      setSessions(getTrainingSessions());
    }
  }, [isAuthenticated, view]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-lg">Loading...</div>
      </div>
    );
  }

  const startWorkout = (workoutName: string) => {
    const preset = workouts.find(w => w.name === workoutName);
    if (!preset) return;

    // Load from last session if available, otherwise use preset
    const lastSession = getLastSessionForWorkout(workoutName);
    const exerciseData: TrainingExercise[] = lastSession
      ? lastSession.exercises.map(e => ({
          ...e,
          sets: e.sets.map(s => ({ ...s, done: false })),
          skipped: false,
        }))
      : preset.exercises.map(e => ({
          ...e,
          sets: e.sets.map(s => ({ ...s, done: false })),
        }));

    setExercises(exerciseData);
    setActiveWorkout(workoutName);
    setSessionId(Date.now().toString());
    setExpandedExercise(0);
    setSaved(false);
    setView('workout');
  };

  const updateSetWeight = (exIdx: number, setIdx: number, weight: string) => {
    setExercises(prev => {
      const updated = [...prev];
      const ex = { ...updated[exIdx] };
      const sets = [...ex.sets];
      sets[setIdx] = { ...sets[setIdx], weight: weight === '' ? '' : (isNaN(Number(weight)) ? weight : Number(weight)) };
      ex.sets = sets;
      updated[exIdx] = ex;
      return updated;
    });
  };

  const updateSetReps = (exIdx: number, setIdx: number, reps: string) => {
    setExercises(prev => {
      const updated = [...prev];
      const ex = { ...updated[exIdx] };
      const sets = [...ex.sets];
      sets[setIdx] = { ...sets[setIdx], reps: reps === '' ? undefined : Number(reps) };
      ex.sets = sets;
      updated[exIdx] = ex;
      return updated;
    });
  };

  const toggleSetDone = (exIdx: number, setIdx: number) => {
    setExercises(prev => {
      const updated = [...prev];
      const ex = { ...updated[exIdx] };
      const sets = [...ex.sets];
      sets[setIdx] = { ...sets[setIdx], done: !sets[setIdx].done };
      ex.sets = sets;
      updated[exIdx] = ex;
      return updated;
    });
  };

  const toggleSkipExercise = (exIdx: number) => {
    setExercises(prev => {
      const updated = [...prev];
      updated[exIdx] = { ...updated[exIdx], skipped: !updated[exIdx].skipped };
      return updated;
    });
  };

  const addSet = (exIdx: number) => {
    setExercises(prev => {
      const updated = [...prev];
      const ex = { ...updated[exIdx] };
      const lastWorkingSet = [...ex.sets].reverse().find(s => !s.isWarmup);
      ex.sets = [...ex.sets, { weight: lastWorkingSet?.weight || 0, isWarmup: false, done: false }];
      updated[exIdx] = ex;
      return updated;
    });
  };

  const removeSet = (exIdx: number, setIdx: number) => {
    setExercises(prev => {
      const updated = [...prev];
      const ex = { ...updated[exIdx] };
      ex.sets = ex.sets.filter((_, i) => i !== setIdx);
      updated[exIdx] = ex;
      return updated;
    });
  };

  const saveWorkout = () => {
    if (!activeWorkout) return;
    const session: TrainingSession = {
      id: sessionId,
      date: new Date().toISOString().split('T')[0],
      workoutName: activeWorkout,
      exercises,
    };
    saveTrainingSession(session);
    setSaved(true);
  };

  const finishWorkout = () => {
    if (!saved) {
      if (!confirm('You haven\'t saved yet. Discard this session?')) return;
    }
    setView('select');
    setActiveWorkout(null);
    setExercises([]);
  };

  const editSession = (session: TrainingSession) => {
    setExercises(session.exercises.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s })) })));
    setActiveWorkout(session.workoutName);
    setSessionId(session.id);
    setExpandedExercise(0);
    setSaved(false);
    setView('workout');
  };

  const handleDeleteSession = (id: string) => {
    if (!confirm('Delete this session?')) return;
    deleteTrainingSession(id);
    setSessions(getTrainingSessions());
  };

  const formatWeight = (w: number | string) => {
    if (w === 0 || w === '0' || w === '') return 'BW';
    return `${w}`;
  };

  // Select workout view
  if (view === 'select') {
    return (
      <div className="min-h-screen">
        <Navigation />
        <main className="md:ml-64 p-6 pb-24 md:pb-6">
          <div className="max-w-5xl mx-auto">
            <div className="mb-8 relative">
              <DumbbellIcon className="absolute -top-2 right-0 w-24 h-24 text-white opacity-[0.04] pointer-events-none" />
              <h1 className="text-3xl font-bold text-white">Training</h1>
              <p className="text-white/40 mt-1">Choose your workout</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              {workouts.map((w, i) => {
                const lastSession = getLastSessionForWorkout(w.name);
                const colors = ['from-red-500/10', 'from-blue-500/10', 'from-amber-500/10', 'from-green-500/10'];
                return (
                  <button
                    key={w.name}
                    onClick={() => startWorkout(w.name)}
                    className="glass-card p-6 text-left transition-all active:scale-[0.98] relative"
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${colors[i % 4]} to-transparent rounded-2xl opacity-50`} />
                    <DumbbellIcon className="absolute bottom-3 right-3 w-14 h-14 text-white opacity-[0.06]" />
                    <div className="relative z-10">
                      <h3 className="text-xl font-bold text-white mb-1">{w.name}</h3>
                      <p className="text-sm text-white/40">{w.exercises.length} exercises</p>
                      {lastSession && (
                        <p className="text-xs text-white/25 mt-2">
                          Last: {new Date(lastSession.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Recent sessions */}
            {sessions.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-white mb-4">Recent Sessions</h2>
                <div className="space-y-2">
                  {[...sessions].reverse().slice(0, 10).map((s) => (
                    <div key={s.id} className="glass-card p-4 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <span className="text-white font-medium">{s.workoutName}</span>
                        <span className="text-white/30 text-sm ml-3">
                          {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        <span className="text-xs text-white/20 ml-2">
                          {s.exercises.filter(e => !e.skipped).length}/{s.exercises.length}
                        </span>
                      </div>
                      <div className="flex gap-2 ml-2 shrink-0">
                        <button
                          onClick={() => editSession(s)}
                          className="text-xs text-white/30 hover:text-white/70 px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteSession(s.id)}
                          className="text-xs text-white/30 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Active workout view
  const completedSets = exercises.reduce((acc, ex) => acc + ex.sets.filter(s => s.done).length, 0);
  const totalSets = exercises.reduce((acc, ex) => acc + ex.sets.length, 0);

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:ml-64 p-4 md:p-6 pb-32 md:pb-6">
        <div className="max-w-3xl mx-auto">
          {/* Workout header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <button onClick={finishWorkout} className="text-sm text-white/30 hover:text-white/60 mb-1">&larr; Back</button>
              <h1 className="text-2xl font-bold text-white">{activeWorkout}</h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveWorkout}
                className={`btn-primary text-sm px-4 py-2 ${saved ? '!bg-green-700' : ''}`}
              >
                {saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="glass rounded-full h-2 mb-6 overflow-hidden">
            <div
              className="h-full bg-va-red transition-all duration-300 rounded-full"
              style={{ width: `${totalSets > 0 ? (completedSets / totalSets) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-white/30 mb-6 -mt-4">{completedSets}/{totalSets} sets completed</p>

          {/* Exercises */}
          <div className="space-y-3">
            {exercises.map((ex, exIdx) => {
              const isExpanded = expandedExercise === exIdx;
              const warmupSets = ex.sets.filter(s => s.isWarmup);
              const workingSets = ex.sets.filter(s => !s.isWarmup);
              const doneSets = ex.sets.filter(s => s.done).length;

              return (
                <div
                  key={exIdx}
                  className={`glass-card overflow-hidden transition-all ${ex.skipped ? 'opacity-40' : ''}`}
                >
                  {/* Exercise header - tap to expand */}
                  <button
                    onClick={() => setExpandedExercise(isExpanded ? null : exIdx)}
                    className="w-full p-4 flex items-center justify-between text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-va-red font-bold">{exIdx + 1}</span>
                        <h3 className={`text-white font-semibold truncate ${ex.skipped ? 'line-through' : ''}`}>
                          {ex.name}
                        </h3>
                      </div>
                      <p className="text-xs text-white/30 mt-0.5">
                        {workingSets.length} sets &times; {ex.targetReps} reps
                        {warmupSets.length > 0 && ` + ${warmupSets.length} WU`}
                        {ex.notes && ` · ${ex.notes}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-2">
                      <span className="text-xs text-white/30">{doneSets}/{ex.sets.length}</span>
                      <span className={`text-white/20 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                    </div>
                  </button>

                  {/* Expanded: sets detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      {/* Skip button */}
                      <div className="flex justify-end mb-3">
                        <button
                          onClick={() => toggleSkipExercise(exIdx)}
                          className="text-xs text-white/30 hover:text-white/60 px-2 py-1"
                        >
                          {ex.skipped ? 'Unskip' : 'Skip exercise'}
                        </button>
                      </div>

                      {!ex.skipped && (
                        <>
                          {/* Warmup sets */}
                          {warmupSets.length > 0 && (
                            <div className="mb-3">
                              <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Warm-up</p>
                              {ex.sets.map((set, setIdx) => {
                                if (!set.isWarmup) return null;
                                return (
                                  <SetRow
                                    key={setIdx}
                                    set={set}
                                    setIdx={setIdx}
                                    exIdx={exIdx}
                                    isWarmup
                                    targetReps={ex.targetReps}
                                    onWeightChange={updateSetWeight}
                                    onRepsChange={updateSetReps}
                                    onToggleDone={toggleSetDone}
                                    formatWeight={formatWeight}
                                  />
                                );
                              })}
                            </div>
                          )}

                          {/* Working sets */}
                          <div className="mb-3">
                            <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Working sets</p>
                            {ex.sets.map((set, setIdx) => {
                              if (set.isWarmup) return null;
                              return (
                                <SetRow
                                  key={setIdx}
                                  set={set}
                                  setIdx={setIdx}
                                  exIdx={exIdx}
                                  isWarmup={false}
                                  targetReps={ex.targetReps}
                                  onWeightChange={updateSetWeight}
                                  onRepsChange={updateSetReps}
                                  onToggleDone={toggleSetDone}
                                  formatWeight={formatWeight}
                                />
                              );
                            })}
                          </div>

                          <button
                            onClick={() => addSet(exIdx)}
                            className="text-xs text-va-red hover:text-va-red-light w-full text-center py-2"
                          >
                            + Add Set
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom save bar (mobile) */}
          <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:left-64 p-4 z-40">
            <div className="glass-strong rounded-2xl p-3 flex gap-3 max-w-3xl mx-auto">
              <button onClick={finishWorkout} className="btn-secondary flex-1 py-3 text-sm">
                Finish
              </button>
              <button
                onClick={saveWorkout}
                className={`btn-primary flex-1 py-3 text-sm ${saved ? '!bg-green-700' : ''}`}
              >
                {saved ? 'Saved ✓' : 'Save Workout'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// Individual set row component
function SetRow({
  set, setIdx, exIdx, isWarmup, targetReps,
  onWeightChange, onRepsChange, onToggleDone, formatWeight,
}: {
  set: TrainingSet;
  setIdx: number;
  exIdx: number;
  isWarmup: boolean;
  targetReps: string;
  onWeightChange: (exIdx: number, setIdx: number, weight: string) => void;
  onRepsChange: (exIdx: number, setIdx: number, reps: string) => void;
  onToggleDone: (exIdx: number, setIdx: number) => void;
  formatWeight: (w: number | string) => string;
}) {
  const weightNum = typeof set.weight === 'number' ? set.weight : parseFloat(set.weight as string) || 0;
  const step = weightNum >= 40 ? 5 : 2.5;

  return (
    <div className={`flex items-center gap-1.5 mb-2 ${set.done ? 'opacity-50' : ''}`}>
      {/* Label */}
      <span className={`text-xs w-7 shrink-0 ${isWarmup ? 'text-yellow-500/60' : 'text-white/30'}`}>
        {isWarmup ? 'WU' : 'SET'}
      </span>

      {/* Weight: - input + */}
      <button
        type="button"
        onClick={() => onWeightChange(exIdx, setIdx, String(Math.round((weightNum - step) * 10) / 10))}
        className="shrink-0 w-8 h-8 rounded-lg text-sm font-bold border border-red-500/30 bg-red-500/10 text-red-400 active:bg-red-500/30"
      >−</button>
      <div className="flex-1">
        <input
          type="text"
          inputMode="decimal"
          value={formatWeight(set.weight)}
          onChange={(e) => onWeightChange(exIdx, setIdx, e.target.value)}
          className="glass-input w-full px-2 py-2 text-sm text-center"
          placeholder="kg"
        />
      </div>
      <button
        type="button"
        onClick={() => onWeightChange(exIdx, setIdx, String(Math.round((weightNum + step) * 10) / 10))}
        className="shrink-0 w-8 h-8 rounded-lg text-sm font-bold border border-green-500/30 bg-green-500/10 text-green-400 active:bg-green-500/30"
      >+</button>

      {/* Reps input */}
      <div className="w-14">
        <input
          type="text"
          inputMode="numeric"
          value={set.reps ?? ''}
          onChange={(e) => onRepsChange(exIdx, setIdx, e.target.value)}
          className="glass-input w-full px-1 py-2 text-sm text-center"
          placeholder={targetReps}
        />
      </div>

      {/* Done checkbox */}
      <button
        onClick={() => onToggleDone(exIdx, setIdx)}
        className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-all ${
          set.done
            ? 'bg-green-600 border-green-600 text-white'
            : 'border-white/15 text-transparent hover:border-white/30'
        }`}
      >
        ✓
      </button>
    </div>
  );
}
