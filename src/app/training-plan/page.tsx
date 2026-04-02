'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { getPresetWorkouts, getLastSessionForWorkout, saveTrainingSession, getTrainingSessions, deleteTrainingSession, getMeasurements } from '@/utils/storage';
import { Workout, TrainingExercise, TrainingSession, TrainingSet } from '@/types';
import { DumbbellIcon } from '@/components/BackgroundEffects';

const workoutImages: Record<string, string> = {
  'Shoulders + Abs': '/muscles/shoulders.png',
  Legs: '/muscles/legs.png',
  'Chest + Triceps': '/muscles/chest.png',
  'Back + Biceps': '/muscles/back.png',
  Cardio: '/muscles/cardio.png',
};

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
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [lastSessions, setLastSessions] = useState<Record<string, TrainingSession>>({});
  const [measurementDates, setMeasurementDates] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const exercisesRef = useRef(exercises);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef(sessionId);
  const activeWorkoutRef = useRef(activeWorkout);

  // Keep refs in sync
  exercisesRef.current = exercises;
  sessionIdRef.current = sessionId;
  activeWorkoutRef.current = activeWorkout;

  const flushSave = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!activeWorkoutRef.current || !sessionIdRef.current) return;
    const session: TrainingSession = {
      id: sessionIdRef.current,
      date: new Date().toISOString().split('T')[0],
      workoutName: activeWorkoutRef.current,
      exercises: exercisesRef.current,
    };
    await saveTrainingSession(session);
  }, []);

  const triggerAutoSave = useCallback(() => {
    if (!activeWorkoutRef.current) return;
    setSaveStatus('saving');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await flushSave();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
    }, 1000);
  }, [flushSave]);

  // Flush save on unmount or navigation away
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        // Fire-and-forget save on cleanup
        const id = sessionIdRef.current;
        const workout = activeWorkoutRef.current;
        const exs = exercisesRef.current;
        if (id && workout) {
          saveTrainingSession({
            id,
            date: new Date().toISOString().split('T')[0],
            workoutName: workout,
            exercises: exs,
          });
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      getTrainingSessions().then(setSessions);
      getMeasurements().then(ms => setMeasurementDates(ms.map(m => m.date)));
      // Load last session for each workout
      Promise.all(workouts.map(async w => {
        const last = await getLastSessionForWorkout(w.name);
        return [w.name, last] as const;
      })).then(results => {
        const map: Record<string, TrainingSession> = {};
        results.forEach(([name, session]) => { if (session) map[name] = session; });
        setLastSessions(map);
      });
    }
  }, [isAuthenticated, view, workouts]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-lg">Loading...</div>
      </div>
    );
  }

  const startWorkout = async (workoutName: string) => {
    const preset = workouts.find(w => w.name === workoutName);
    if (!preset) return;

    // Load from last session if available, otherwise use preset
    const lastSession = await getLastSessionForWorkout(workoutName);
    const exerciseData: TrainingExercise[] = lastSession
      ? lastSession.exercises
          .filter(e => workoutName === 'Cardio' || e.name !== 'Cardio')
          .map(e => ({
            ...e,
            sets: e.sets.map(s => ({ ...s, done: true })),
            skipped: false,
          }))
      : preset.exercises.map(e => ({
          ...e,
          sets: e.sets.map(s => ({ ...s, done: true })),
        }));

    const newId = Date.now().toString();
    setExercises(exerciseData);
    setActiveWorkout(workoutName);
    setSessionId(newId);
    setExpandedExercise(null);
    setSaved(true);
    setSaveStatus('saving');
    setView('workout');

    // Save immediately
    const session: TrainingSession = {
      id: newId,
      date: new Date().toISOString().split('T')[0],
      workoutName,
      exercises: exerciseData,
    };
    await saveTrainingSession(session);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
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
    triggerAutoSave();
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
    triggerAutoSave();
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
    triggerAutoSave();
  };

  const toggleSkipExercise = (exIdx: number) => {
    setExercises(prev => {
      const updated = [...prev];
      updated[exIdx] = { ...updated[exIdx], skipped: !updated[exIdx].skipped };
      return updated;
    });
    triggerAutoSave();
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
    triggerAutoSave();
  };

  const removeSet = (exIdx: number, setIdx: number) => {
    setExercises(prev => {
      const updated = [...prev];
      const ex = { ...updated[exIdx] };
      ex.sets = ex.sets.filter((_, i) => i !== setIdx);
      updated[exIdx] = ex;
      return updated;
    });
    triggerAutoSave();
  };

  const finishWorkout = async () => {
    await flushSave();
    setView('select');
    setActiveWorkout(null);
    setExercises([]);
    setSaveStatus('idle');
  };

  const editSession = (session: TrainingSession) => {
    setExercises(session.exercises.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s })) })));
    setActiveWorkout(session.workoutName);
    setSessionId(session.id);
    setExpandedExercise(null);
    setSaved(true);
    setSaveStatus('idle');
    setView('workout');
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Delete this session?')) return;
    await deleteTrainingSession(id);
    setSessions(await getTrainingSessions());
  };

  const formatWeight = (w: number | string) => {
    if (w === 0 || w === '0' || w === '') return 'BW';
    return `${w}`;
  };

  // Get all previous sessions of same workout, ordered newest first
  const getPreviousSessions = (session: TrainingSession): TrainingSession[] => {
    const thisTime = session.savedAt || session.date;
    return sessions
      .filter(s => s.workoutName === session.workoutName && s.id !== session.id && (s.savedAt || s.date) < thisTime)
      .sort((a, b) => (b.savedAt || b.date).localeCompare(a.savedAt || a.date));
  };

  // Search back through sessions to find the last time an exercise was done with data
  const findPrevExerciseData = (exerciseName: string, prevSessions: TrainingSession[]): { sets: number; reps: number; maxWeight: number } | null => {
    for (const ps of prevSessions) {
      const hasDone = ps.exercises.some(e => e.sets.some(set => set.done));
      const ex = ps.exercises.find(e => e.name === exerciseName && !e.skipped);
      if (!ex) continue;
      const isDone = (set: TrainingSet) => hasDone ? set.done : true;
      const working = ex.sets.filter(set => !set.isWarmup && isDone(set));
      if (working.length === 0) continue;
      const maxW = Math.max(...working.map(set => typeof set.weight === 'number' ? set.weight : parseFloat(set.weight as string) || 0));
      const defReps = parseInt(ex.targetReps) || 0;
      const totalReps = working.reduce((sum, set) => sum + (set.reps || defReps), 0);
      return { sets: working.length, reps: totalReps, maxWeight: maxW };
    }
    return null;
  };

  const renderDiff = (current: number, previous: number | undefined) => {
    if (previous == null) return null;
    const diff = current - previous;
    if (diff === 0) return null;
    const color = diff > 0 ? 'text-green-400' : 'text-red-400';
    const sign = diff > 0 ? '+' : '';
    return <span className={`${color} text-[10px] ml-1`}>{sign}{diff % 1 === 0 ? diff : diff.toFixed(1)}</span>;
  };

  // Select workout view
  if (view === 'select') {
    return (
      <div className="min-h-screen">
        <Navigation />
        <main className="md:ml-64 p-6 pt-32 md:pt-6 pwa-main">
          <div className="max-w-5xl mx-auto">
            <div className="mb-4 relative">
              <DumbbellIcon className="absolute -top-2 right-0 w-24 h-24 text-white opacity-[0.04] pointer-events-none" />
              <h1 className="text-3xl font-bold text-white">Training</h1>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              {workouts.map((w, i) => {
                const lastSession = lastSessions[w.name];
                const colors = ['from-red-500/10', 'from-blue-500/10', 'from-amber-500/10', 'from-green-500/10', 'from-rose-600/20'];
                return (
                  <button
                    key={w.name}
                    onClick={() => startWorkout(w.name)}
                    className={`glass-card p-6 text-left transition-all active:scale-[0.98] relative${w.name === 'Cardio' ? ' sm:col-span-2 border border-rose-500/20' : ''}`}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${colors[i % 5]} to-transparent rounded-2xl opacity-50`} />
                    {workoutImages[w.name] ? (
                      <img src={workoutImages[w.name]} alt={w.name} className="absolute bottom-1 right-1 h-20 opacity-40 pointer-events-none" />
                    ) : (
                      <DumbbellIcon className="absolute bottom-3 right-3 w-14 h-14 text-white opacity-[0.15]" />
                    )}
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
                  {(() => {
                    const sessionTs = (s: TrainingSession) => s.savedAt || s.date + 'T23:59:59.999Z';
                    const sorted = [...sessions].sort((a, b) => sessionTs(b).localeCompare(sessionTs(a))).slice(0, 20);
                    const elements: React.ReactNode[] = [];

                    const renderMeasurementDivider = (md: string) => (
                      <div key={`divider-${md}`} className="flex items-center gap-3 py-1">
                        <div className="flex-1 h-px bg-va-red/30" />
                        <span className="text-[10px] text-va-red/50 uppercase tracking-widest shrink-0">
                          Measurement {new Date(md + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                        <div className="flex-1 h-px bg-va-red/30" />
                      </div>
                    );

                    sorted.forEach((s, sIdx) => {

                    const isExpanded = expandedSession === s.id;
                    const prevSessions = isExpanded ? getPreviousSessions(s) : [];
                    const hasDoneFlags = s.exercises.some(e => e.sets.some(set => set.done));
                    const doneExercises = s.exercises.filter(e => !e.skipped && (hasDoneFlags ? e.sets.some(set => set.done) : true));
                    elements.push(
                      <div key={s.id} className="glass-card overflow-hidden">
                        <div
                          className="p-4 flex items-center justify-between cursor-pointer"
                          onClick={() => setExpandedSession(isExpanded ? null : s.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <span className={`font-medium ${s.workoutName === 'Cardio' ? 'text-rose-400' : 'text-white'}`}>{s.workoutName}</span>
                            <span className="text-white/30 text-sm ml-3">
                              {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              {s.savedAt && (
                                <span className="ml-1">{new Date(s.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                              )}
                            </span>
                            <span className="text-xs text-white/20 ml-2">
                              {doneExercises.length}/{s.exercises.length}
                            </span>
                          </div>
                          <div className="flex gap-2 ml-2 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); editSession(s); }}
                              className="text-xs text-white/30 hover:text-white/70 px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
                            >
                              Edit
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                              className="text-xs text-white/30 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {isExpanded && doneExercises.length > 0 && s.workoutName === 'Cardio' && (
                          <div className="px-4 pb-3 border-t border-white/5">
                            <table className="w-full text-xs mt-2">
                              <thead>
                                <tr className="text-white/30 text-left">
                                  <th className="pb-1 font-normal">Activity</th>
                                  <th className="pb-1 font-normal text-right">Duration</th>
                                </tr>
                              </thead>
                              <tbody>
                                {doneExercises.map((ex, i) => (
                                  <tr key={i} className="text-white/70 border-t border-white/5">
                                    <td className="py-1 pr-2">{ex.name}</td>
                                    <td className="py-1 text-right">{ex.targetReps}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {isExpanded && doneExercises.length > 0 && s.workoutName !== 'Cardio' && (
                          <div className="px-4 pb-3 border-t border-white/5">
                            <table className="w-full text-xs mt-2">
                              <thead>
                                <tr className="text-white/30 text-left">
                                  <th className="pb-1 font-normal">Exercise</th>
                                  <th className="pb-1 font-normal text-right">WU</th>
                                  <th className="pb-1 font-normal text-right">Sets</th>
                                  <th className="pb-1 font-normal text-right">Max kg</th>
                                  <th className="pb-1 font-normal text-right">Reps</th>
                                </tr>
                              </thead>
                              <tbody>
                                {doneExercises.map((ex, i) => {
                                  const isDone = (set: TrainingSet) => hasDoneFlags ? set.done : true;
                                  const warmupSets = ex.sets.filter(set => set.isWarmup && isDone(set));
                                  const workingSets = ex.sets.filter(set => !set.isWarmup && isDone(set));
                                  if (workingSets.length === 0 && warmupSets.length === 0) return null;
                                  const maxWeight = workingSets.length > 0 ? Math.max(...workingSets.map(set => typeof set.weight === 'number' ? set.weight : parseFloat(set.weight as string) || 0)) : 0;
                                  const defaultReps = parseInt(ex.targetReps) || 0;
                                  const totalReps = workingSets.reduce((sum, set) => sum + (set.reps || defaultReps), 0);
                                  const setCount = workingSets.length;
                                  const wuCount = warmupSets.length;

                                  // Find previous data for this exercise (search back through history)
                                  const prevData = findPrevExerciseData(ex.name, prevSessions);
                                  const prevSetCount = prevData?.sets ?? (prevSessions.length > 0 ? 0 : undefined);
                                  const prevTotalReps = prevData?.reps ?? (prevSessions.length > 0 ? 0 : undefined);
                                  const prevMaxWeight = prevData?.maxWeight;

                                  return (
                                    <tr key={i} className="text-white/70 border-t border-white/5">
                                      <td className="py-1 pr-2 truncate max-w-[140px]">{ex.name}</td>
                                      <td className="py-1 text-right whitespace-nowrap text-white/30">
                                        {wuCount > 0 ? wuCount : '-'}
                                      </td>
                                      <td className="py-1 text-right whitespace-nowrap">
                                        {setCount}{renderDiff(setCount, prevSetCount)}
                                      </td>
                                      <td className="py-1 text-right whitespace-nowrap">
                                        {formatWeight(maxWeight)}{maxWeight > 0 && renderDiff(maxWeight, prevMaxWeight)}
                                      </td>
                                      <td className="py-1 text-right whitespace-nowrap">
                                        {totalReps}{renderDiff(totalReps, prevTotalReps)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );

                    // Show measurement lines below this session if they belong here
                    // A measurement for date X goes below the last session on date X (or the first session after date X)
                    const nextSessionDate = sIdx < sorted.length - 1 ? sorted[sIdx + 1].date : '';
                    // Only insert measurements here if the next session is from an earlier date
                    if (nextSessionDate !== s.date) {
                      const between = measurementDates
                        .filter(md => md <= s.date && md > nextSessionDate)
                        .sort((a, b) => b.localeCompare(a));
                      for (const md of between) elements.push(renderMeasurementDivider(md));
                    }
                    });
                    return elements;
                  })()}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Active workout view
  const isCardio = activeWorkout === 'Cardio';
  const completedSets = exercises.reduce((acc, ex) => acc + ex.sets.filter(s => s.done).length, 0);
  const totalSets = exercises.reduce((acc, ex) => acc + ex.sets.length, 0);

  const updateCardioName = (name: string) => {
    setExercises(prev => {
      const updated = [...prev];
      updated[0] = { ...updated[0], name };
      return updated;
    });
  };

  const updateCardioDuration = (mins: number) => {
    setExercises(prev => {
      const updated = [...prev];
      updated[0] = { ...updated[0], targetReps: `${mins} min` };
      return updated;
    });
  };

  const getCardioDuration = (): number => {
    if (!exercises[0]) return 30;
    return parseInt(exercises[0].targetReps) || 30;
  };

  if (isCardio) {
    const duration = getCardioDuration();
    return (
      <div className="min-h-screen">
        <Navigation />
        <main className="md:ml-64 p-4 md:p-6 pt-32 md:pt-6 pwa-main">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-white">Cardio</h1>
              <div className="flex gap-2">
                {saveStatus === 'saving' && <span className="text-xs text-white/30 self-center">Saving...</span>}
                {saveStatus === 'saved' && <span className="text-xs text-green-400/60 self-center">Saved ✓</span>}
                <button onClick={finishWorkout} className="btn-primary text-sm px-4 py-2">Finish</button>
              </div>
            </div>

            <div className="glass-card p-6 space-y-6">
              {/* Activity name */}
              <div>
                <label className="text-[10px] text-white/25 uppercase tracking-widest mb-2 block">Activity</label>
                <input
                  type="text"
                  value={exercises[0]?.name === 'Cardio' ? '' : exercises[0]?.name || ''}
                  onChange={e => updateCardioName(e.target.value || 'Cardio')}
                  placeholder="e.g. Running, Rowing, Cycling..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-lg placeholder:text-white/20 focus:outline-none focus:border-va-red/50"
                />
              </div>

              {/* Duration */}
              <div>
                <label className="text-[10px] text-white/25 uppercase tracking-widest mb-2 block">Duration</label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => updateCardioDuration(Math.max(5, duration - 5))}
                    className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 text-white text-xl font-bold hover:bg-white/10 transition-all"
                  >−</button>
                  <span className="text-3xl font-bold text-white min-w-[100px] text-center">{duration} min</span>
                  <button
                    onClick={() => updateCardioDuration(duration + 5)}
                    className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 text-white text-xl font-bold hover:bg-white/10 transition-all"
                  >+</button>
                </div>
              </div>

              {/* Target heart rate */}
              <div>
                <label className="text-[10px] text-white/25 uppercase tracking-widest mb-2 block">Target Heart Rate</label>
                <p className="text-xl text-white font-semibold">120–130 <span className="text-sm text-white/40 font-normal">bpm</span></p>
              </div>

              {/* Done toggle */}
              <button
                onClick={() => toggleSetDone(0, 0)}
                className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                  exercises[0]?.sets[0]?.done
                    ? 'bg-green-700 text-white'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {exercises[0]?.sets[0]?.done ? '✓ Done' : 'Mark as Done'}
              </button>
            </div>

            <button
              onClick={finishWorkout}
              className="w-full mt-6 mb-4 py-4 rounded-2xl font-bold text-lg transition-all btn-primary"
            >
              Finish Workout
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:ml-64 p-4 md:p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-3xl mx-auto">
          {/* Workout header */}
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-white">{activeWorkout}</h1>
            <div className="flex gap-2">
              {saveStatus === 'saving' && <span className="text-xs text-white/30 self-center">Saving...</span>}
              {saveStatus === 'saved' && <span className="text-xs text-green-400/60 self-center">Saved ✓</span>}
              <button
                onClick={finishWorkout}
                className="btn-primary text-sm px-4 py-2"
              >
                Finish
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

                          <div className="flex gap-3 pt-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); addSet(exIdx); }}
                              className="text-xs text-va-red hover:text-va-red-light py-2"
                            >
                              + Add Set
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeSet(exIdx, ex.sets.length - 1); }}
                              className="text-xs text-white/30 hover:text-red-400 py-2"
                              disabled={workingSets.length <= 1}
                              style={{ opacity: workingSets.length <= 1 ? 0.3 : 1 }}
                            >
                              − Remove Set
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom finish button */}
          <button
            onClick={finishWorkout}
            className="w-full mt-6 mb-4 py-4 rounded-2xl font-bold text-lg transition-all btn-primary"
          >
            Finish Workout
          </button>

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
  const step = 1;

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
