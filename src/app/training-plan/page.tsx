'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { getPresetWorkouts, getLastSessionForWorkout, saveTrainingSession, getTrainingSessions, deleteTrainingSession, updateSessionDuration, getMeasurements } from '@/utils/storage';
import { Workout, TrainingExercise, TrainingSession, TrainingSet, Measurement } from '@/types';
import { DumbbellIcon } from '@/components/BackgroundEffects';
import { calcSessionCalories, calcRollingTDEE, parseDurationMinutes } from '@/utils/calories';
import { hapticLight } from '@/utils/haptics';

// LEGACY — replaced by shared @/utils/calories.ts
// MET values for cardio activities (HR 120-130 range)
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
  'cycling': 6.5,
  'bike': 6.5,
  'swimming': 7.0,
  'walking': 3.8,
  'walk': 3.8,
  'incline walk': 5.5,
  'hiit': 10.0,
  'jump rope': 10.0,
  'cardio': 6.5, // generic fallback
};

// MET values for resistance exercises by category
// Compound multi-joint = higher MET, isolation single-joint = lower
const COMPOUND_KEYWORDS = [
  'press', 'squat', 'deadlift', 'dead lift', 'lunge', 'row', 'pull down',
  'pulldown', 'pull up', 'pullup', 'dip', 'leg press', 'clean', 'snatch',
  'thrust', 'pullover',
];

function getExerciseMET(name: string): number {
  const lower = name.toLowerCase();
  // Compound movements: MET ~6
  if (COMPOUND_KEYWORDS.some(kw => lower.includes(kw))) return 6.0;
  // Isolation movements: MET ~3.5
  return 3.5;
}

function getCardioMET(name: string): number {
  const lower = name.toLowerCase();
  for (const [key, met] of Object.entries(CARDIO_METS)) {
    if (lower.includes(key)) return met;
  }
  return 6.5; // default moderate cardio
}

function _localParseDurationMinutes(targetReps: string): number {
  // Parse "30 min", "45min", "1h", "1h 30min", "60 min" etc.
  const hMatch = targetReps.match(/(\d+)\s*h/i);
  const mMatch = targetReps.match(/(\d+)\s*min/i);
  let mins = 0;
  if (hMatch) mins += parseInt(hMatch[1]) * 60;
  if (mMatch) mins += parseInt(mMatch[1]);
  if (mins > 0) return mins;
  // Try bare number — assume minutes
  const bare = targetReps.match(/(\d+)/);
  if (bare) return parseInt(bare[1]);
  return 30; // default
}

// LEGACY — replaced by shared import
function _localCalcSessionCalories(session: TrainingSession, bodyWeight: number): number {
  if (session.workoutName === 'Cardio') {
    let totalCals = 0;
    for (const ex of session.exercises) {
      if (ex.skipped) continue;
      if (ex.calories && ex.calories > 0) {
        // Use manually entered calories from machine
        totalCals += ex.calories;
      } else {
        // Fallback: MET-based estimate
        const met = getCardioMET(ex.name);
        const mins = parseDurationMinutes(ex.targetReps);
        totalCals += met * bodyWeight * (mins / 60);
      }
    }
    return Math.round(totalCals || 6.5 * bodyWeight * 0.5);
  }

  // Weight training: use actual session duration if available
  const duration = session.durationMinutes;

  // Count sets to determine work vs rest split
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

  // Weighted average MET based on compound/isolation ratio
  const avgMET = totalSets > 0
    ? (compoundSets * 6.0 + isolationSets * 3.5) / totalSets
    : 4.5;

  // Use actual duration, or estimate from sets (~3.2 min per set + ~3 min per exercise transition)
  const exerciseCount = session.exercises.filter(e => !e.skipped).length;
  const sessionMins = (duration && duration > 5) ? duration : totalSets * 3.2 + exerciseCount * 3;

  // Work time is ~30% of session, rest/transition ~70%
  const workMins = sessionMins * 0.3;
  const restMins = sessionMins * 0.7;

  let totalCals = 0;
  totalCals += avgMET * bodyWeight * (workMins / 60);    // work phase
  totalCals += 1.5 * bodyWeight * (restMins / 60);       // rest phase (elevated)

  // +15% EPOC
  totalCals *= 1.15;

  return Math.round(totalCals);
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  // Get Monday of the week
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

function getWeekLabel(weekKey: string): string {
  const monday = new Date(weekKey + 'T00:00:00');
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

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
  const [sessionDate, setSessionDate] = useState('');
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [elapsedStr, setElapsedStr] = useState('');
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [editingDuration, setEditingDuration] = useState<string | null>(null);
  const [durationInput, setDurationInput] = useState('');
  const [lastSessions, setLastSessions] = useState<Record<string, TrainingSession>>({});
  const [measurementDates, setMeasurementDates] = useState<string[]>([]);
  const [latestBmr, setLatestBmr] = useState<number>(0);
  const [latestWeight, setLatestWeight] = useState<number>(80);
  const [dailyActivity, setDailyActivity] = useState<Record<string, { steps: number; activeCalories: number }>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const exercisesRef = useRef(exercises);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef(sessionId);
  const sessionDateRef = useRef(sessionDate);
  const activeWorkoutRef = useRef(activeWorkout);

  // Keep refs in sync
  exercisesRef.current = exercises;
  sessionIdRef.current = sessionId;
  sessionDateRef.current = sessionDate;
  activeWorkoutRef.current = activeWorkout;

  const flushSave = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!activeWorkoutRef.current || !sessionIdRef.current) return;
    const session: TrainingSession = {
      id: sessionIdRef.current,
      date: sessionDateRef.current || new Date().toISOString().split('T')[0],
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
            date: sessionDateRef.current || new Date().toISOString().split('T')[0],
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

  // Elapsed workout timer
  useEffect(() => {
    if (!sessionId || !activeWorkout) { setElapsedStr(''); return; }
    const startMs = parseInt(sessionId);
    if (isNaN(startMs)) return;
    const tick = () => {
      const sec = Math.floor((Date.now() - startMs) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setElapsedStr(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionId, activeWorkout]);


  useEffect(() => {
    if (isAuthenticated) {
      getTrainingSessions().then(setSessions);
      getMeasurements().then(ms => {
        setMeasurementDates(ms.map(m => m.date));
        if (ms.length > 0) {
          setLatestWeight(ms[ms.length - 1].weight);
        }
        for (let i = ms.length - 1; i >= 0; i--) {
          if (ms[i].bmr) { setLatestBmr(ms[i].bmr!); break; }
        }
      });
      // Fetch activity data from Oura (last 60 days)
      fetch('/api/oura?days=60').then(r => r.json()).then(d => {
        const act: Record<string, { steps: number; activeCalories: number }> = {};
        const addDay = (day: string, steps?: number, activeCal?: number) => {
          if (steps || activeCal) act[day] = { steps: steps || 0, activeCalories: activeCal || 0 };
        };
        if (d.data) for (const day of d.data) addDay(day.day, day.steps, day.activeCalories);
        if (d.activity) for (const day of d.activity) addDay(day.day, day.steps, day.activeCalories);
        setDailyActivity(act);
      }).catch(() => {});
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
            sets: e.sets.map(s => ({ ...s, done: false, prevDone: !!s.done })),
            skipped: false,
          }))
      : preset.exercises.map(e => ({
          ...e,
          sets: e.sets.map(s => ({ ...s, done: false })),
        }));

    const newId = Date.now().toString();
    const today = new Date().toISOString().split('T')[0];
    setExercises(exerciseData);
    setActiveWorkout(workoutName);
    setSessionId(newId);
    setSessionDate(today);
    setExpandedExercise(null);
    setSaved(true);
    setSaveStatus('saving');
    setView('workout');

    // Save immediately
    const session: TrainingSession = {
      id: newId,
      date: today,
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
    hapticLight();
    let wasDone = false;
    setExercises(prev => {
      const updated = [...prev];
      const ex = { ...updated[exIdx] };
      const sets = [...ex.sets];
      wasDone = !!sets[setIdx].done;
      sets[setIdx] = { ...sets[setIdx], done: !sets[setIdx].done };
      ex.sets = sets;
      updated[exIdx] = ex;
      return updated;
    });
    // (timer removed)
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

  const saveWorkout = async () => {
    await flushSave();
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 2000);
  };

  const finishWorkout = async () => {
    await flushSave();
    if (restIntervalRef.current) clearInterval(restIntervalRef.current);
    setRestTimer(0);
    setView('select');
    setActiveWorkout(null);
    setExercises([]);
    setSessionDate('');
    setSaveStatus('idle');
  };

  const editSession = (session: TrainingSession) => {
    setExercises(session.exercises.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s })) })));
    setActiveWorkout(session.workoutName);
    setSessionId(session.id);
    setSessionDate(session.date);
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
        <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
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

            {/* Weekly Calorie Averages */}
            {latestBmr > 0 && sessions.length > 0 && (() => {
              const now = new Date();
              const todayStr = now.toISOString().split('T')[0];

              const rolling = calcRollingTDEE(sessions, latestWeight, latestBmr, dailyActivity);
              const rollingTotal = rolling.total;
              const rollingDailyTraining = rolling.training;
              const rollingNeat = rolling.neat;
              const rollingSessions = rolling.sessions;

              const rollingStart = new Date(now);
              rollingStart.setDate(rollingStart.getDate() - 6);
              const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              const rollingLabel = `${fmt(rollingStart)} – ${fmt(now)}`;

              // Previous week: last completed Monday–Sunday
              const prevMonday = new Date(getWeekKey(todayStr) + 'T00:00:00');
              prevMonday.setDate(prevMonday.getDate() - 7);
              const prevSunday = new Date(prevMonday);
              prevSunday.setDate(prevSunday.getDate() + 6);
              const prevMondayStr = prevMonday.toISOString().split('T')[0];
              const prevSundayStr = prevSunday.toISOString().split('T')[0];

              const prevSessions = sessions.filter(s => s.date >= prevMondayStr && s.date <= prevSundayStr);
              const prevTrainingCals = prevSessions.reduce((sum, s) => sum + calcSessionCalories(s, latestWeight), 0);
              const prevDailyTraining = Math.round(prevTrainingCals / 7);

              let prevActiveCals = 0, prevActDays = 0;
              for (let i = 0; i < 7; i++) {
                const d = new Date(prevMonday);
                d.setDate(d.getDate() + i);
                const dayStr = d.toISOString().split('T')[0];
                const act = dailyActivity[dayStr];
                if (act && act.activeCalories > 0) { prevActiveCals += act.activeCalories; prevActDays++; }
              }
              const prevNeat = prevActDays > 0 ? Math.round(prevActiveCals / prevActDays) : 0;
              const prevTotal = latestBmr + prevDailyTraining + prevNeat;
              const prevLabel = `${fmt(prevMonday)} – ${fmt(prevSunday)}`;

              const cards = [
                { key: 'rolling', label: rollingLabel, total: rollingTotal, training: rollingDailyTraining, neat: rollingNeat, count: rollingSessions.length, isCurrent: true },
                { key: 'prev', label: prevLabel, total: prevTotal, training: prevDailyTraining, neat: prevNeat, count: prevSessions.length, isCurrent: false },
              ];

              return (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-white/60 mb-3">Weekly TDEE</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {cards.map(c => (
                      <div key={c.key} className={`glass-card p-4 ${c.isCurrent ? 'border border-green-500/30' : ''}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-white/40">{c.label}</span>
                          {c.isCurrent && <span className="text-[10px] text-green-400 uppercase">Current</span>}
                        </div>
                        <div className="text-xl font-bold text-white">{c.total} <span className="text-xs text-white/30 font-normal">kcal/day</span></div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-[11px] text-white/30">
                          <span>BMR {latestBmr}</span>
                          <span>Training +{c.training}</span>
                          {c.neat > 0 && <span>NEAT +{c.neat}</span>}
                          <span>{c.count} sessions</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Recent sessions */}
            {sessions.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-white mb-4">Recent Sessions</h2>
                <div className="space-y-2">
                  {(() => {
                    const sessionTs = (s: TrainingSession) => s.savedAt || s.date + 'T23:59:59.999Z';
                    const sorted = [...sessions].sort((a, b) => sessionTs(b).localeCompare(sessionTs(a))).slice(0, 20);
                    const elements: React.ReactNode[] = [];

                    // Only show measurement dividers within the range of recorded sessions
                    const oldestSessionDate = sorted.length > 0 ? sorted[sorted.length - 1].date : '';

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
                            <div className="flex items-baseline gap-2 whitespace-nowrap overflow-hidden">
                              <span className={`font-medium text-sm ${s.workoutName === 'Cardio' ? 'text-rose-400' : 'text-white'}`}>{s.workoutName}</span>
                              <span className="text-white/30 text-xs">
                                {new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {s.savedAt && (
                                  <span className="ml-1">{new Date(s.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                )}
                              </span>
                              <span className="text-[10px] text-white/20">
                                {doneExercises.length}/{s.exercises.length}
                              </span>
                            {(() => {
                              if (s.workoutName === 'Cardio') {
                                const mins = doneExercises.reduce((t, ex) => t + parseDurationMinutes(ex.targetReps), 0);
                                if (mins > 0) return <span className="text-[10px] text-blue-400/70 ml-1">{mins} min</span>;
                              } else if (editingDuration === s.id) {
                                return (
                                  <span className="ml-2 inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <input type="number" className="w-12 bg-white/10 rounded px-1 py-0.5 text-xs text-blue-400 text-center outline-none"
                                      value={durationInput} onChange={e => setDurationInput(e.target.value)} autoFocus
                                      onKeyDown={async e => {
                                        if (e.key === 'Enter') {
                                          const mins = parseInt(durationInput);
                                          if (mins > 0) { await updateSessionDuration(s.id, mins); setSessions(await getTrainingSessions()); }
                                          setEditingDuration(null);
                                        } else if (e.key === 'Escape') { setEditingDuration(null); }
                                      }}
                                      onBlur={async () => {
                                        const mins = parseInt(durationInput);
                                        if (mins > 0) { await updateSessionDuration(s.id, mins); setSessions(await getTrainingSessions()); }
                                        setEditingDuration(null);
                                      }}
                                    />
                                    <span className="text-[10px] text-white/30">min</span>
                                  </span>
                                );
                              } else if (s.durationMinutes != null && s.durationMinutes > 0) {
                                return (
                                  <span className="text-xs text-blue-400/70 ml-2 cursor-pointer hover:text-blue-400 transition-colors"
                                    onClick={e => { e.stopPropagation(); setEditingDuration(s.id); setDurationInput(String(s.durationMinutes)); }}
                                    title="Click to edit duration"
                                  >{s.durationMinutes} min</span>
                                );
                              } else {
                                const sets = doneExercises.reduce((n, ex) => n + ex.sets.length, 0);
                                const exCount = doneExercises.length;
                                if (sets > 0) return <span className="text-xs text-blue-400/40 ml-2">~{Math.round(sets * 3.2 + exCount * 3)} min</span>;
                              }
                              return null;
                            })()}
                            <span className="text-[10px] text-orange-400/80 ml-1">
                              {calcSessionCalories(s, latestWeight)} kcal
                            </span>
                            </div>
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

                    // Show measurement dividers between sessions (only within session date range)
                    const nextSessionDate = sIdx < sorted.length - 1 ? sorted[sIdx + 1].date : '';
                    if (nextSessionDate !== s.date) {
                      const between = measurementDates
                        .filter(md => md <= s.date && md > nextSessionDate && md >= oldestSessionDate)
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

  const updateCardioCalories = (cals: number | undefined) => {
    setExercises(prev => {
      const updated = [...prev];
      updated[0] = { ...updated[0], calories: cals };
      return updated;
    });
    triggerAutoSave();
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
        <main className="main-content p-4 md:p-6 pt-32 md:pt-6 pwa-main">
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

              {/* Calories from machine */}
              <div>
                <label className="text-[10px] text-white/25 uppercase tracking-widest mb-2 block">Calories (from machine)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={exercises[0]?.calories || ''}
                  onChange={e => updateCardioCalories(e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="Optional — enter machine reading"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-lg placeholder:text-white/20 focus:outline-none focus:border-va-red/50"
                />
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
      <main className="main-content p-4 md:p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-3xl mx-auto">
          {/* Workout header */}
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-white">{activeWorkout}</h1>
            <div className="flex gap-2">
              {saveStatus === 'saving' && <span className="text-xs text-white/30 self-center">Saving...</span>}
              {saveStatus === 'saved' && <span className="text-xs text-green-400/60 self-center">Saved ✓</span>}
              <button onClick={saveWorkout} className="btn-secondary text-sm px-3 py-2">Save</button>
              <button onClick={finishWorkout} className="btn-primary text-sm px-3 py-2">Finish</button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="glass rounded-full h-2 mb-6 overflow-hidden">
            <div
              className="h-full bg-va-red transition-all duration-300 rounded-full"
              style={{ width: `${totalSets > 0 ? (completedSets / totalSets) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between mb-6 -mt-4">
            <p className="text-xs text-white/30">{completedSets}/{totalSets} sets completed</p>
            <div className="flex items-center gap-2">
              {elapsedStr && (
                <span className="text-xs text-white/40 font-mono data-value">{elapsedStr}</span>
              )}
            </div>
          </div>

          {/* Exercises */}
          <div className="space-y-3">
            {exercises.map((ex, exIdx) => {
              const isExpanded = expandedExercise === exIdx;
              const warmupSets = ex.sets.filter(s => s.isWarmup);
              const workingSets = ex.sets.filter(s => !s.isWarmup);
              const doneSets = ex.sets.filter(s => s.done).length;

              const completionPct = ex.sets.length > 0 ? doneSets / ex.sets.length : 0;
              const statusTint = ex.skipped ? '' : completionPct >= 1 ? 'from-green-500/8 to-transparent' : completionPct > 0 ? 'from-amber-500/6 to-transparent' : '';

              return (
                <div
                  key={exIdx}
                  className={`glass-card overflow-hidden transition-all card-animate bg-gradient-to-r ${statusTint} ${ex.skipped ? 'opacity-40' : ''}`}
                  style={{ animationDelay: `${exIdx * 50}ms` }}
                >
                  {/* Exercise header - tap to expand */}
                  <button
                    onClick={() => setExpandedExercise(isExpanded ? null : exIdx)}
                    className="w-full p-4 flex items-center justify-between text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          completionPct >= 1 ? 'bg-green-500/20 text-green-400 shadow-[0_0_8px_rgba(34,197,94,0.3)]' :
                          completionPct > 0 ? 'bg-amber-500/20 text-amber-400' :
                          'bg-va-red/20 text-va-red'
                        }`}>{exIdx + 1}</span>
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
    <div className={`flex items-center gap-1.5 mb-2 transition-all duration-300 ${set.done ? 'opacity-40' : ''}`}>
      {/* Label */}
      <span className={`text-[10px] w-7 shrink-0 font-semibold uppercase tracking-wider ${isWarmup ? 'text-yellow-500/60' : 'text-white/25'}`}>
        {isWarmup ? 'WU' : 'SET'}
      </span>

      {/* Weight: - input + */}
      <button
        type="button"
        onClick={() => onWeightChange(exIdx, setIdx, String(Math.round((weightNum - step) * 10) / 10))}
        className="shrink-0 w-8 h-8 rounded-lg text-sm font-bold border border-red-500/20 bg-red-500/8 text-red-400 active:bg-red-500/30 transition-all"
      >−</button>
      <div className="flex-1">
        <input
          type="text"
          inputMode="decimal"
          value={formatWeight(set.weight)}
          onChange={(e) => onWeightChange(exIdx, setIdx, e.target.value)}
          className={`glass-input w-full px-2 py-2 text-sm text-center font-semibold data-value focus:shadow-[0_0_12px_rgba(185,10,10,0.2)] ${set.prevDone && !set.done ? 'border-green-500/20 bg-green-500/8' : ''}`}
          placeholder="kg"
        />
      </div>
      <button
        type="button"
        onClick={() => onWeightChange(exIdx, setIdx, String(Math.round((weightNum + step) * 10) / 10))}
        className="shrink-0 w-8 h-8 rounded-lg text-sm font-bold border border-green-500/20 bg-green-500/8 text-green-400 active:bg-green-500/30 transition-all"
      >+</button>

      {/* Reps input */}
      <div className="w-14">
        <input
          type="text"
          inputMode="numeric"
          value={set.reps ?? ''}
          onChange={(e) => onRepsChange(exIdx, setIdx, e.target.value)}
          className="glass-input w-full px-1 py-2 text-sm text-center data-value focus:shadow-[0_0_12px_rgba(185,10,10,0.2)]"
          placeholder={targetReps}
        />
      </div>

      {/* Done checkbox — animated circle fill */}
      <button
        onClick={() => onToggleDone(exIdx, setIdx)}
        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300 ${
          set.done
            ? 'bg-green-500 border-green-500 text-white shadow-[0_0_10px_rgba(34,197,94,0.4)] scale-95'
            : 'border-white/15 text-transparent hover:border-white/30 hover:scale-105'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
