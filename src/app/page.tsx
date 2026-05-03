'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Navigation from '@/components/Navigation';

import { getMeasurements, getSetting, getSettingRemote, saveSetting, getTrainingSessions, getNutritionPlan } from '@/utils/storage';
import { Measurement, TrainingSession, NutritionPlan } from '@/types';
import { calcSessionCalories, calcRollingTDEE, calcDerivedTDEE, calcWeeklyIntake } from '@/utils/calories';
import { DumbbellIcon } from '@/components/BackgroundEffects';
import AnimatedNumber from '@/components/AnimatedNumber';
import Sparkline from '@/components/Sparkline';
import BeforeAfterSlider from '@/components/BeforeAfterSlider';

type Phase = 'bulking' | 'cutting';

interface SleepDay {
  day: string;
  score: number;
  totalSleep?: number;
  deepSleep?: number;
  remSleep?: number;
  lightSleep?: number;
  awakeTime?: number;
  efficiency?: number;
  avgHr?: number;
  avgHrv?: number;
  lowestHr?: number;
  bedtimeStart?: string;
  bedtimeEnd?: string;
  steps?: number;
  activeCalories?: number;
  totalCalories?: number;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}


export default function Dashboard() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [latestMeasurement, setLatestMeasurement] = useState<Measurement | null>(null);
  const [previousMeasurement, setPreviousMeasurement] = useState<Measurement | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [phase, setPhase] = useState<Phase>('bulking');
  const [targetWeight, setTargetWeight] = useState<number | null>(null);
  const [showTargetInput, setShowTargetInput] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [sleepData, setSleepData] = useState<SleepDay[]>([]);
  const [sleepIdx, setSleepIdx] = useState(0);

  // Subjective readiness — stored per day, synced to Firestore
  const todayStr = new Date().toISOString().split('T')[0];
  const subjKey = `subj_${todayStr}`;
  const [subjective, setSubjective] = useState<{ energy: number; soreness: number; motivation: number } | null>(null);
  useEffect(() => {
    // Reset state when day changes (avoid carrying over yesterday's values)
    setSubjective(null);
    // Instant load from localStorage
    try { const raw = localStorage.getItem(subjKey); if (raw) setSubjective(JSON.parse(raw)); } catch {}
    // Then sync from Firestore DIRECTLY (bypasses IDB since we need cross-device freshness)
    getSettingRemote(subjKey).then(v => {
      if (!v) return;
      try {
        setSubjective(JSON.parse(v));
        localStorage.setItem(subjKey, v);
      } catch {}
    }).catch(() => {});
  }, [subjKey]);
  const saveSubjective = (next: { energy: number; soreness: number; motivation: number }) => {
    setSubjective(next);
    const json = JSON.stringify(next);
    try { localStorage.setItem(subjKey, json); } catch {}
    saveSetting(subjKey, json);
  };

  const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([]);
  const [nutritionPlan, setNutritionPlan] = useState<NutritionPlan | null>(null);
  // User-set macro targets from the Nutrition plan (Target row). Falls back to
  // computed defaults below when null (first-load before Firestore returns).
  const [userTargets, setUserTargets] = useState<{ kcal: number; protein: number; carbs: number; fat: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try { const s = localStorage.getItem('macro_targets'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  useEffect(() => {
    getSettingRemote('macro_targets').then(v => {
      if (!v) return;
      try {
        const parsed = JSON.parse(v);
        setUserTargets(parsed);
        localStorage.setItem('macro_targets', v);
      } catch {}
    }).catch(() => {});
  }, []);
  const [dailyActivity, setDailyActivity] = useState<Record<string, { activeCalories: number; source?: string }>>({});
  const [glucose, setGlucose] = useState<{
    current: { value: number; valueMmol: number; trend: string; timestamp: string; isHigh: boolean; isLow: boolean } | null;
    history: { value: number; valueMmol: number; timestamp: string }[];
    stats: { timeInRange: number; avgGlucose: number; avgMmol: number; estimatedA1c: number; readings: number };
  } | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Restore caches immediately (before auth completes) for instant display
  useEffect(() => {
    try { const sc = localStorage.getItem('sleep_cache'); if (sc) { const sd = JSON.parse(sc); if (sd.length) setSleepData(sd); } } catch {}
    try { const ac = localStorage.getItem('activity_cache'); if (ac) { const ad = JSON.parse(ac); if (Object.keys(ad).length) setDailyActivity(ad); } } catch {}
    try { const gc = localStorage.getItem('glucose_cache'); if (gc) { const gd = JSON.parse(gc); if (gd.current) setGlucose(gd); } } catch {}
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Skip fetch if localStorage cache is younger than TTL ms
    const fresh = (key: string, ttlMs: number) => {
      try {
        const t = parseInt(localStorage.getItem(key + '_ts') || '0');
        return t > 0 && Date.now() - t < ttlMs;
      } catch { return false; }
    };
    const markFetched = (key: string) => {
      try { localStorage.setItem(key + '_ts', String(Date.now())); } catch {}
    };

    const refreshIDB = () => {
      getMeasurements().then(all => {
        setMeasurements(all);
        if (all.length > 0) {
          setLatestMeasurement(all[all.length - 1]);
          if (all.length > 1) setPreviousMeasurement(all[all.length - 2]);
        }
      });
      getSetting('phase').then(v => { if (v) setPhase(v as Phase); });
      getSetting('targetWeight').then(v => { if (v) setTargetWeight(parseFloat(v)); });
      getTrainingSessions().then(setTrainingSessions);
      getNutritionPlan().then(p => { if (p && 'current' in p) setNutritionPlan(p as NutritionPlan); });
    };

    // TTL matches edge cache s-maxage: glucose 60s, sleep/activity 5min, health-sync 2min
    const refreshSleep = (force = false) => {
      if (!force && fresh('sleep_cache', 5 * 60 * 1000)) return Promise.resolve();
      return fetch('/api/oura?days=7').then(r => r.json()).then(d => {
        if (d.data?.length) {
          const sorted = d.data.sort((a: SleepDay, b: SleepDay) => b.day.localeCompare(a.day));
          setSleepData(sorted);
          try { localStorage.setItem('sleep_cache', JSON.stringify(sorted)); } catch {}
          markFetched('sleep_cache');
        }
      }).catch(() => {});
    };

    const refreshActivity = async (force = false) => {
      if (!force && fresh('activity_cache', 2 * 60 * 1000)) return;
      const act: Record<string, { activeCalories: number; source?: string }> = {};
      try {
        const d = await fetch('/api/oura?days=60').then(r => r.json());
        const addDay = (day: string, steps?: number, activeCal?: number) => {
          if (steps || activeCal) act[day] = { activeCalories: activeCal || 0, source: 'oura' };
        };
        if (d.data) for (const day of d.data) addDay(day.day, day.steps, day.activeCalories);
        if (d.activity) for (const day of d.activity) addDay(day.day, day.steps, day.activeCalories);
      } catch {}
      try {
        const h = await fetch('/api/health-sync?days=60').then(r => r.json());
        if (h.activity) {
          for (const [day, data] of Object.entries(h.activity) as [string, { activeCalories: number }][]) {
            if (data.activeCalories > 0) act[day] = { activeCalories: data.activeCalories, source: 'apple-watch' };
          }
        }
      } catch {}
      if (Object.keys(act).length > 0) {
        setDailyActivity(act);
        try { localStorage.setItem('activity_cache', JSON.stringify(act)); } catch {}
        markFetched('activity_cache');
      }
    };

    const refreshGlucose = (force = false) => {
      if (!force && fresh('glucose_cache', 60 * 1000)) return Promise.resolve();
      return fetch('/api/glucose').then(r => r.json()).then(d => {
        if (d.current) {
          setGlucose(d);
          try { localStorage.setItem('glucose_cache', JSON.stringify(d)); } catch {}
          markFetched('glucose_cache');
        }
      }).catch(() => {});
    };

    const refreshAll = (force = false) => {
      refreshIDB();
      refreshSleep(force);
      refreshActivity(force);
      refreshGlucose(force);
    };

    refreshAll();
    // Glucose auto-refresh: 2min — near-real-time, edge cache absorbs repeats from multiple windows
    const glucoseInterval = setInterval(() => refreshGlucose(true), 2 * 60 * 1000);

    // PWA resume: TTL-gated, so rapid open/close doesn't burn function invocations
    const onFocus = () => refreshAll();
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshAll(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(glucoseInterval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAuthenticated]);

  const togglePhase = () => {
    const next = phase === 'bulking' ? 'cutting' : 'bulking';
    setPhase(next);
    saveSetting('phase', next);
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
          <div className="max-w-5xl mx-auto flex items-center justify-center min-h-[60vh]">
            <div className="text-white/40 text-lg">Loading...</div>
          </div>
        </main>
      </div>
    );
  }

  const formatChange = (val?: number, lowerIsBetter = false) => {
    if (val === undefined || val === 0) return null;
    const sign = val > 0 ? '+' : '';
    const isGood = lowerIsBetter ? val < 0 : val > 0;
    const colorClass = isGood ? 'change-positive' : 'change-negative';
    return <span className={colorClass}>{sign}{val}</span>;
  };

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-5xl mx-auto">
          <div className="mb-4 relative">
            <DumbbellIcon className="absolute -top-2 right-0 w-24 h-24 text-white opacity-[0.04] pointer-events-none" />
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold text-white">Dashboard</h1>
              <button onClick={logout} className="text-xs text-white/20 hover:text-white/50 transition-all px-3 py-1.5 rounded-lg hover:bg-white/5">
                Logout
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          {latestMeasurement && (() => {
            const sparkData = (field: 'weight' | 'bodyFat' | 'muscleMass' | 'arms' | 'chest' | 'waist' | 'legs') =>
              measurements.map(m => m[field]).filter((v): v is number => v != null).slice(-8);
            const fieldIcon: Record<string, string> = { weight: 'weight', bodyFat: 'body-fat', muscleMass: 'muscle-mass', arms: 'arms', chest: 'chest', waist: 'waist', legs: 'legs' };
            const iconOffset: Record<string, string> = { muscleMass: 'sm:-top-1 top-[15%]', weight: 'sm:top-0 top-[15%]' };
            const statCard = (stat: { label: string; value: string; field: 'weight' | 'bodyFat' | 'muscleMass' | 'arms' | 'chest' | 'waist' | 'legs'; lowerIsBetter?: boolean | 'phase'; hero?: boolean }, idx: number) => {
              const curVal = latestMeasurement[stat.field];
              const prevVal = previousMeasurement?.[stat.field];
              const change = (curVal != null && prevVal != null)
                ? Math.round((curVal - prevVal) * 10) / 10
                : undefined;
              // Phase-aware: weight goes up in bulking (good), down in cutting (good)
              const effectiveLower = stat.lowerIsBetter === 'phase' ? phase === 'cutting' : !!stat.lowerIsBetter;
              const isGood = change !== undefined && change !== 0 && (effectiveLower ? change < 0 : change > 0);
              const isBad = change !== undefined && change !== 0 && !isGood;
              const tint = isGood ? 'from-green-500/8 to-transparent' : isBad ? 'from-red-500/8 to-transparent' : '';
              const spark = sparkData(stat.field);
              const sparkColor = isGood ? '#22c55e' : isBad ? '#ef4444' : '#9ca3af';

              const glowShadow = isGood ? '0 0 10px rgba(34,197,94,0.25), 0 0 25px rgba(34,197,94,0.1)' : isBad ? '0 0 10px rgba(239,68,68,0.25), 0 0 25px rgba(239,68,68,0.1)' : 'none';
              return (
                <div key={stat.label} className={`glass-card p-4 stat-accent card-animate bg-gradient-to-br ${tint} relative overflow-hidden`} style={{ animationDelay: `${idx * 60}ms`, boxShadow: glowShadow }}>
                  <img src={`/icons/${fieldIcon[stat.field]}.png`} alt="" className={`!absolute ${stat.hero ? 'right-10 w-28 h-28 sm:right-20 sm:w-40 sm:h-40' : stat.field === 'muscleMass' ? 'right-4 w-28 h-28 sm:right-12 sm:w-40 sm:h-40' : 'right-6 w-24 h-24 sm:right-16 sm:w-32 sm:h-32'} ${iconOffset[stat.field] || 'top-1/2 -translate-y-1/2'} object-contain opacity-[0.30] pointer-events-none`} />
                  <div className="flex items-start justify-between relative z-10">
                    <div>
                      <p className="text-xs text-white/40 uppercase tracking-wider">{stat.label}</p>
                      <p className={`font-bold mt-1 data-value gradient-text ${stat.hero ? 'text-4xl' : 'text-2xl'}`}>{stat.value}</p>
                      {change !== undefined && change !== 0 && (
                        <p className="text-sm mt-1">{formatChange(change, effectiveLower)}</p>
                      )}
                    </div>
                    {spark.length >= 2 && <Sparkline data={spark} color={sparkColor} width={56} height={28} key={`${stat.field}-${sparkColor}`} />}
                  </div>
                </div>
              );
            };
            let idx = 0;
            return (
              <div className="flex flex-col gap-4 mb-8">
                {statCard({ label: 'Weight', value: `${latestMeasurement.weight}kg`, field: 'weight', hero: true, lowerIsBetter: 'phase' }, idx++)}
                <div className="grid grid-cols-2 gap-4">
                  {statCard({ label: 'Muscle Mass', value: latestMeasurement.muscleMass != null ? `${latestMeasurement.muscleMass}kg` : '—', field: 'muscleMass' }, idx++)}
                  {statCard({ label: 'Body Fat', value: latestMeasurement.bodyFat != null ? `${latestMeasurement.bodyFat}%` : '—', field: 'bodyFat', lowerIsBetter: true }, idx++)}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {statCard({ label: 'Chest', value: `${latestMeasurement.chest}cm`, field: 'chest' }, idx++)}
                  {statCard({ label: 'Waist', value: `${latestMeasurement.waist}cm`, field: 'waist', lowerIsBetter: true }, idx++)}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {statCard({ label: 'Legs', value: `${latestMeasurement.legs}cm`, field: 'legs' }, idx++)}
                  {statCard({ label: 'Arms', value: `${latestMeasurement.arms}cm`, field: 'arms' }, idx++)}
                </div>
              </div>
            );
          })()}

          {/* Nutrition Balance */}
            {(() => {
              // Derive BMR and weight from measurements (same as training page)
              let bmr: number | undefined;
              for (let i = measurements.length - 1; i >= 0; i--) {
                if (measurements[i].bmr) { bmr = measurements[i].bmr; break; }
              }
              const bodyWeight = measurements.length > 0 ? measurements[measurements.length - 1].weight : 80;
              const dailyKcal = nutritionPlan?.current.trainingDay.macros.kcal;
              const trainingDayProtein = nutritionPlan?.current.trainingDay.macros.protein || 0;
              if (!bmr || !dailyKcal || trainingSessions.length === 0) return null;
              const intake = dailyKcal;

              // Cache TDEE once per day — only recompute if date or plan changes
              // Include sum of activeCalories + bodyWeight + bmr in cache key to avoid stale TDEE
              // when activity source flips (oura ↔ apple-watch) or when weight/BMR changes
              const activitySum = Object.values(dailyActivity).reduce((s, a) => s + (a.activeCalories || 0), 0);
              const nbCacheKey = `nb_${new Date().toISOString().split('T')[0]}_${dailyKcal}_${trainingSessions.length}_${Object.keys(dailyActivity).length}_${activitySum}_${bmr}_${bodyWeight}`;
              const nbCacheRaw = typeof window !== 'undefined' ? localStorage.getItem('nb_cache') : null;
              const nbCache = nbCacheRaw ? JSON.parse(nbCacheRaw) : null;
              let dailyBurn: number, dailyTrainingAvg: number, dailyNeat: number, activitySource: string;
              if (nbCache?.key === nbCacheKey) {
                dailyBurn = nbCache.burn;
                dailyTrainingAvg = nbCache.training;
                dailyNeat = nbCache.neat;
                activitySource = nbCache.source || 'oura';
              } else {
                const tdee = calcRollingTDEE(trainingSessions, bodyWeight, bmr, dailyActivity);
                dailyBurn = tdee.total;
                dailyTrainingAvg = tdee.training;
                dailyNeat = tdee.neat;
                activitySource = tdee.source;
                try { localStorage.setItem('nb_cache', JSON.stringify({ key: nbCacheKey, burn: dailyBurn, training: dailyTrainingAvg, neat: dailyNeat, source: activitySource })); } catch {}
              }
              // Derived TDEE (intake-based) — same source as Energy Balance card.
              // Falls back to burn estimate if not enough measurements yet.
              const wkIntake = calcWeeklyIntake(dailyKcal, nutritionPlan!.current.trainingDay.meals).weeklyAvgKcal;
              const derived = calcDerivedTDEE(measurements, wkIntake, 28);
              const tdeeForTarget = derived ? derived.tdee : dailyBurn;

              const weekSessions = trainingSessions.filter(s => {
                const d = new Date(); d.setDate(d.getDate() - 6);
                return s.date >= d.toISOString().split('T')[0];
              });
              // Protein target: use user-set override if available (Target row on
              // Nutrition page), else fall back to bodyweight × 2.25
              const proteinTarget = userTargets?.protein ?? Math.round(bodyWeight * 2.25);
              const proteinLow = Math.round(bodyWeight * 2.0);
              const proteinHigh = Math.round(bodyWeight * 2.5);
              const proteinDiff = trainingDayProtein - proteinTarget;
              const proteinAbsDiff = Math.abs(proteinDiff);
              const proteinTolerance = bodyWeight * 0.25;
              const proteinZoneColor = proteinAbsDiff <= proteinTolerance * 0.4 ? '#22c55e' : proteinAbsDiff <= proteinTolerance ? '#f59e0b' : '#ef4444';
              const proteinZoneLabel = proteinAbsDiff <= proteinTolerance * 0.4 ? 'On Target' : proteinAbsDiff <= proteinTolerance ? 'Slightly Off' : 'Off Target';

              // Protein gauge
              const pGaugeMin = -40, pGaugeMax = 40;
              const pClampedDist = Math.max(pGaugeMin, Math.min(pGaugeMax, proteinDiff));
              const pGaugeAngle = ((pClampedDist - pGaugeMin) / (pGaugeMax - pGaugeMin)) * 270;
              const pGaugeRadius = 40;
              const pGaugeCirc = 2 * Math.PI * pGaugeRadius;
              const pGaugeArc = (270 / 360) * pGaugeCirc;
              const pGaugeOffset = pGaugeArc - (pGaugeAngle / 270) * pGaugeArc;
              const pGreenLow = Math.round(-proteinTolerance * 0.4);
              const pGreenHigh = Math.round(proteinTolerance * 0.4);
              const pGreenStartAngle = ((pGreenLow - pGaugeMin) / (pGaugeMax - pGaugeMin)) * 270;
              const pGreenEndAngle = ((pGreenHigh - pGaugeMin) / (pGaugeMax - pGaugeMin)) * 270;
              const pGreenArcLen = ((pGreenEndAngle - pGreenStartAngle) / 360) * pGaugeCirc;

              const ratio = intake / tdeeForTarget;
              const targetRatio = phase === 'bulking' ? 1.15 : 0.85; // +15% or -15%
              const diff = ratio - targetRatio;
              const absDiff = Math.abs(diff);

              // Green: within ±2pp of target, Yellow: ±2-5pp, Red: beyond ±5pp
              const zoneColor = absDiff <= 0.02 ? '#22c55e' : absDiff <= 0.05 ? '#f59e0b' : '#ef4444';
              const zoneLabel = absDiff <= 0.02 ? 'On Target' : absDiff <= 0.05 ? 'Slightly Off' : 'Off Target';
              const surplusDeficit = intake - tdeeForTarget;
              const surplusPct = Math.round((ratio - 1) * 100);

              // Bar heights (normalized)
              const maxVal = Math.max(intake, tdeeForTarget);
              const burnPct = (tdeeForTarget / maxVal) * 100;
              const intakePct = (intake / maxVal) * 100;

              // Gauge: centered on target midpoint.
              // Calorie target: prefer user-set override (Target row on Nutrition
              // page) and back-compute the implied surplus%; else use TDEE × phase%.
              const phaseSurplusPct = phase === 'bulking' ? 15 : -15;
              const targetIntake = userTargets?.kcal ?? Math.round(tdeeForTarget * (1 + phaseSurplusPct / 100));
              const targetMid = userTargets?.kcal
                ? Math.round((userTargets.kcal / tdeeForTarget - 1) * 100)
                : phaseSurplusPct;
              const distFromTarget = surplusPct - targetMid;
              // Wider range so large deviations show clearly
              const gaugeMin = -20, gaugeMax = 20;
              const clampedDist = Math.max(gaugeMin, Math.min(gaugeMax, distFromTarget));
              const gaugeAngle = ((clampedDist - gaugeMin) / (gaugeMax - gaugeMin)) * 270;
              const gaugeRadius = 40;
              const gaugeCirc = 2 * Math.PI * gaugeRadius;
              const gaugeArc = (270 / 360) * gaugeCirc;
              const gaugeOffset = gaugeArc - (gaugeAngle / 270) * gaugeArc;

              // Green zone: ±2% from target center (mapped to gauge range)
              const greenLow = -5, greenHigh = 5;
              const greenStartAngle = ((greenLow - gaugeMin) / (gaugeMax - gaugeMin)) * 270;
              const greenEndAngle = ((greenHigh - gaugeMin) / (gaugeMax - gaugeMin)) * 270;
              const greenArcLen = ((greenEndAngle - greenStartAngle) / 360) * gaugeCirc;

              // Bar chart dimensions
              const barH = 80;
              const calMax = Math.max(intake, tdeeForTarget, targetIntake) * 1.05;
              const burnH = (tdeeForTarget / calMax) * barH;
              const intakeH = (intake / calMax) * barH;
              const targetH = (targetIntake / calMax) * barH;

              // Protein bar chart
              const pMax = Math.max(trainingDayProtein, proteinTarget) * 1.1;
              const pTargetBarH = (proteinTarget / pMax) * barH;
              const pIntakeBarH = (trainingDayProtein / pMax) * barH;

              // Fuel gauge position: map surplus% from range to 0-100%
              // Range: -20% (deficit) to +30% (surplus), so 0% = maintenance at 40%
              const fuelMin = -20, fuelMax = 30;
              const fuelPos = Math.max(0, Math.min(100, ((surplusPct - fuelMin) / (fuelMax - fuelMin)) * 100));
              // Target zone position
              const fuelTargetPos = ((targetMid - fuelMin) / (fuelMax - fuelMin)) * 100;
              const fuelTargetWidth = 8; // ±4% zone

              // Calorie bar widths
              const calBarMax = Math.max(intake, targetIntake) * 1.05;
              const calIntakePct = (intake / calBarMax) * 100;
              const calTargetMarkerPct = (targetIntake / calBarMax) * 100;

              // Protein bar widths
              const protBarMax = Math.max(trainingDayProtein, proteinTarget) * 1.1;
              const protIntakePct = (trainingDayProtein / protBarMax) * 100;
              const protTargetMarkerPct = (proteinTarget / protBarMax) * 100;

              return (
                <div className="glass-card p-5 mb-6 fade-up">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-white">Nutrition Balance</h2>
                    <span className={`text-[10px] font-bold uppercase ${phase === 'bulking' ? 'text-green-400' : 'text-blue-400'}`}>{phase}</span>
                  </div>

                  {/* Fuel gauge */}
                  <div className="mb-5">
                    <div className="flex justify-between text-[10px] text-white/30 mb-1.5">
                      <span>Deficit</span><span>Maintenance</span><span>Surplus</span>
                    </div>
                    <div className="relative h-8 bg-white/[0.04] rounded-2xl overflow-hidden">
                      {/* Background gradient */}
                      <div className="absolute inset-0 rounded-2xl opacity-15" style={{ background: 'linear-gradient(90deg, #ef4444 0%, #f59e0b 35%, #22c55e 50%, #22c55e 65%, #3b82f6 100%)' }} />
                      {/* Fill to current */}
                      <div className="absolute left-0 top-0 bottom-0 rounded-2xl opacity-25" style={{ width: `${fuelPos}%`, background: `linear-gradient(90deg, transparent 60%, ${zoneColor})` }} />
                      {/* Target zone */}
                      <div className="absolute top-0 bottom-0 rounded" style={{ left: `${fuelTargetPos - fuelTargetWidth / 2}%`, width: `${fuelTargetWidth}%`, background: 'rgba(34,197,94,0.2)', border: '1px dashed rgba(34,197,94,0.3)' }} />
                      {/* Needle */}
                      <div className="absolute -top-1 -bottom-1 w-[3px] rounded-sm" style={{ left: `${fuelPos}%`, transform: 'translateX(-50%)', background: zoneColor, boxShadow: `0 0 10px ${zoneColor}80` }} />
                      {/* Center label */}
                      <div className="absolute inset-0 flex items-center justify-center gap-3">
                        <span className="text-lg font-extrabold text-white" style={{ textShadow: '0 0 10px rgba(0,0,0,0.5)' }}>{surplusPct > 0 ? '+' : ''}{surplusPct}%</span>
                        <span className="text-[10px] text-white/50">target {targetMid > 0 ? '+' : ''}{targetMid}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Calorie progress bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-white/40">Calories</span>
                      <span><strong className="text-white">{intake}</strong> <span className="text-white/30">/ {targetIntake} target</span></span>
                    </div>
                    <div className="relative h-2 bg-white/[0.04] rounded overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${Math.min(calIntakePct, 100)}%`, background: `linear-gradient(90deg, ${zoneColor}, ${zoneColor}cc)` }} />
                      {/* Target marker */}
                      <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-white/40" style={{ left: `${calTargetMarkerPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px] text-white/20 mt-1">
                      <span>TDEE: {tdeeForTarget}{derived ? '' : ' (est.)'}{userTargets?.kcal ? ' · target manual' : ''}</span>
                      <span>{surplusDeficit > 0 ? '+' : ''}{surplusDeficit} surplus</span>
                    </div>
                  </div>

                  {/* Protein progress bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-white/40">Protein</span>
                      <span><strong style={{ color: proteinZoneColor }}>{trainingDayProtein}g</strong> <span className="text-white/30">/ {proteinTarget}g target</span></span>
                    </div>
                    <div className="relative h-2 bg-white/[0.04] rounded overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${Math.min(protIntakePct, 100)}%`, background: `linear-gradient(90deg, ${proteinZoneColor}, ${proteinZoneColor}cc)` }} />
                      <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-white/40" style={{ left: `${protTargetMarkerPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px] text-white/20 mt-1">
                      <span>Target: {(proteinTarget / bodyWeight).toFixed(2)}g/kg{userTargets?.protein ? ' (manual)' : ''}</span>
                      <span>{proteinDiff > 0 ? '+' : ''}{proteinDiff}g {proteinDiff > 0 ? 'over' : 'under'}</span>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex gap-4 pt-2 border-t border-white/5 text-[10px] text-white/20">
                    <span>BMR {bmr}</span>
                    <span>{activitySource === 'apple-watch' ? '⌚ ' : ''}Training +{dailyTrainingAvg}</span>
                    {dailyNeat > 0 && <span>NEAT +{dailyNeat}</span>}
                    <span>{weekSessions.length} sessions</span>
                  </div>
                </div>
              );
            })()}

          {/* Energy Balance — derived TDEE from real intake vs weight change */}
          {nutritionPlan && measurements.length >= 2 && (() => {
            const dailyPlanKcal = nutritionPlan.current.trainingDay.macros.kcal;
            // Weekly average INCLUDES Sunday cheat meal replacement (1300 kcal swap)
            const wk = calcWeeklyIntake(dailyPlanKcal, nutritionPlan.current.trainingDay.meals);
            const intake = wk.weeklyAvgKcal;
            const cheatDiff = wk.cheatMealKcal - wk.lastMealKcal;
            const derived = calcDerivedTDEE(measurements, intake, 28);
            if (!derived) return null;

            const surplusPct = Math.round((derived.surplusKcalPerDay / derived.tdee) * 100);
            // Phase-aware target ranges: bulk +0.25..+0.5%/wk, cut -0.5..-0.75%/wk
            const targetMid = phase === 'bulking' ? 0.4 : -0.6;
            const targetSurplusPct = phase === 'bulking' ? 15 : -15;
            const recommendedIntake = Math.round(derived.tdee * (1 + targetSurplusPct / 100));
            const intakeDelta = recommendedIntake - intake;

            // Status: green if rate within ±0.15% of target, amber within ±0.3%, red otherwise
            const rateDiff = Math.abs(derived.ratePerWeekPct - targetMid);
            const status = rateDiff < 0.15 ? 'on-target' : rateDiff < 0.3 ? 'slightly-off' : 'off';
            const statusColor = status === 'on-target' ? '#22c55e' : status === 'slightly-off' ? '#f59e0b' : '#ef4444';
            const statusLabel = status === 'on-target' ? 'ON TARGET' : status === 'slightly-off' ? 'SLIGHTLY OFF' : 'OFF TARGET';

            const surplusSign = derived.surplusKcalPerDay > 0 ? '+' : '';
            const rateSign = derived.ratePerWeekPct > 0 ? '+' : '';
            const deltaSign = intakeDelta > 0 ? '+' : '';
            const targetSurplusKcal = Math.round(derived.tdee * (targetSurplusPct / 100));
            const tgtSurplusSign = targetSurplusKcal > 0 ? '+' : '';
            const tgtRateSign = targetMid > 0 ? '+' : '';

            return (
              <div className="glass-card p-5 mb-6 fade-up">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white">Energy Balance</h2>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: statusColor }}>{statusLabel}</span>
                </div>

                {/* Headline TDEE */}
                <div className="mb-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black gradient-text data-value">{derived.tdee.toLocaleString()}</span>
                    <span className="text-xs text-white/40">kcal/day TDEE</span>
                  </div>
                  <p className="text-[10px] text-white/30 mt-1">
                    derived from {derived.measurementCount} weigh-ins over {derived.daysSpan}d ({derived.weightChangeKg > 0 ? '+' : ''}{derived.weightChangeKg} kg)
                  </p>
                </div>

                {/* 3-column stat row */}
                <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                  <div>
                    <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">Intake</p>
                    <p className="text-base font-bold text-white data-value">{intake.toLocaleString()}</p>
                    <p className="text-[9px] text-white/20">kcal/day avg</p>
                    <p className="text-[9px] text-white/30 mt-0.5">target {recommendedIntake.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">Surplus</p>
                    <p className="text-base font-bold data-value" style={{ color: statusColor }}>{surplusSign}{derived.surplusKcalPerDay}</p>
                    <p className="text-[9px] text-white/20">kcal/day ({surplusSign}{surplusPct}%)</p>
                    <p className="text-[9px] text-white/30 mt-0.5">target {tgtSurplusSign}{targetSurplusKcal} ({tgtSurplusSign}{targetSurplusPct}%)</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-white/30 uppercase tracking-wider mb-0.5">Pace</p>
                    <p className="text-base font-bold data-value" style={{ color: statusColor }}>{rateSign}{derived.ratePerWeekPct}%</p>
                    <p className="text-[9px] text-white/20">BW/week</p>
                    <p className="text-[9px] text-white/30 mt-0.5">target {tgtRateSign}{targetMid}%</p>
                  </div>
                </div>

                {/* Recommendation */}
                {status !== 'on-target' && (
                  <div className="rounded-lg p-3 text-[11px]" style={{ background: `${statusColor}12`, border: `1px solid ${statusColor}30` }}>
                    <div className="font-semibold mb-1" style={{ color: statusColor }}>
                      {phase === 'bulking' ? (intakeDelta < 0 ? 'Over-pacing' : 'Under-pacing') : (intakeDelta > 0 ? 'Over-pacing' : 'Under-pacing')}
                    </div>
                    <div className="text-white/60">
                      Target {phase === 'bulking' ? '+' : ''}{targetSurplusPct}% surplus → {targetMid > 0 ? '+' : ''}{targetMid}% BW/week.
                      Adjust intake to <strong className="text-white">{recommendedIntake.toLocaleString()} kcal/day</strong> ({deltaSign}{intakeDelta}).
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-3 mt-3 border-t border-white/5 text-[10px] text-white/20">
                  <span>plan {dailyPlanKcal.toLocaleString()} + Sun cheat {cheatDiff > 0 ? '+' : ''}{cheatDiff} = {intake.toLocaleString()}/day</span>
                  <span>•</span>
                  {derived.method === 'personalized' && derived.leanChangeKg != null && derived.fatChangeKg != null ? (
                    <span>
                      lean {derived.leanChangeKg > 0 ? '+' : ''}{derived.leanChangeKg}kg / fat {derived.fatChangeKg > 0 ? '+' : ''}{derived.fatChangeKg}kg
                    </span>
                  ) : (
                    <span>5500 kcal/kg</span>
                  )}
                  <span>•</span>
                  <span>updates after each weigh-in</span>
                </div>
              </div>
            );
          })()}

          {/* Bulk Health — bulking-phase KPIs (sits with Nutrition + Energy Balance) */}
          {phase === 'bulking' && measurements.length >= 3 && (() => {
            const now = Date.now();
            const fourWeeksAgo = now - 28 * 86400000;
            const recentMeasurements = measurements.filter(m => new Date(m.date).getTime() >= fourWeeksAgo);
            const windowData = recentMeasurements.length >= 2 ? recentMeasurements : measurements.slice(-8);

            if (windowData.length < 2) return null;

            const first = windowData[0];
            const last = windowData[windowData.length - 1];
            const days = Math.max(7, (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000);

            const weightDelta = last.weight - first.weight;
            const weeks = days / 7;
            const weeklyRatePct = (weightDelta / first.weight / weeks) * 100;
            const weightRateStatus = weeklyRatePct >= 0.25 && weeklyRatePct <= 0.50 ? 'good'
              : weeklyRatePct >= 0.15 && weeklyRatePct <= 0.65 ? 'ok' : 'off';

            const waistDelta = last.waist - first.waist;
            const waistPerKg = weightDelta > 0.5 ? waistDelta / weightDelta : null;
            const waistStatus = waistPerKg == null ? 'ok'
              : waistPerKg <= 0.35 ? 'good'
              : waistPerKg <= 0.50 ? 'ok' : 'off';

            const firstBF = first.bodyFat;
            const lastBF = last.bodyFat;
            const bfDelta = firstBF != null && lastBF != null ? lastBF - firstBF : null;
            const bfStatus = bfDelta == null ? 'ok'
              : Math.abs(bfDelta) <= 1.0 ? 'good'
              : Math.abs(bfDelta) <= 1.5 ? 'ok' : 'off';

            const armDelta = last.arms - first.arms;
            const armPerKg = weightDelta > 0.5 ? armDelta / weightDelta : null;
            const armStatus = armPerKg == null ? 'ok'
              : armPerKg >= 0.25 ? 'good'
              : armPerKg >= 0.15 ? 'ok' : 'off';

            const statuses = [weightRateStatus, waistStatus, bfStatus, armStatus];
            const goodCount = statuses.filter(s => s === 'good').length;
            const offCount = statuses.filter(s => s === 'off').length;
            const overall = offCount >= 2 ? 'off' : goodCount >= 3 ? 'good' : 'ok';
            const overallLabel = overall === 'good' ? 'ON TARGET' : overall === 'ok' ? 'WATCH' : 'OFF TRACK';
            const overallColor = overall === 'good' ? '#22c55e' : overall === 'ok' ? '#f59e0b' : '#ef4444';

            const alerts: string[] = [];
            const fourteenDaysAgo = now - 14 * 86400000;
            const twoWeekMeasurements = measurements.filter(m => new Date(m.date).getTime() >= fourteenDaysAgo);
            if (twoWeekMeasurements.length >= 2) {
              const w1 = twoWeekMeasurements[0].weight;
              const w2 = twoWeekMeasurements[twoWeekMeasurements.length - 1].weight;
              const deltaPctIn14d = ((w2 - w1) / w1) * 100;
              if (deltaPctIn14d < 0.2) {
                const kcalBump = deltaPctIn14d < 0 ? 250 : 150;
                alerts.push(`Weight stalled 14d — consider +${kcalBump} kcal/day`);
              }
            }
            if (waistPerKg != null && waistPerKg > 0.5) {
              alerts.push(`Waist +${waistDelta.toFixed(1)}cm vs +${weightDelta.toFixed(1)}kg — reduce surplus ~150 kcal`);
            }
            if (bfDelta != null && bfDelta > 1.5) {
              alerts.push(`BF up ${bfDelta.toFixed(1)}% in ${Math.round(days)}d — slow the bulk`);
            }

            const sigColor = (s: string) => s === 'good' ? '#22c55e' : s === 'ok' ? '#f59e0b' : '#ef4444';

            return (
              <div className="glass-card p-3 mb-6 fade-up" style={{ fontFeatureSettings: '"tnum"' }}>
                <div className="flex items-center gap-3 mb-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: overallColor }}>
                    <path d="M3 17l6-6 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 7h7v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[10px] text-white/40 uppercase tracking-[0.15em]">Bulk Health</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider ml-auto" style={{ color: overallColor }}>{overallLabel}</span>
                  <span className="text-[9px] text-white/25 font-mono">{Math.round(days)}d</span>
                </div>

                <div className="flex items-stretch divide-x divide-white/5 border border-white/5 rounded-md overflow-hidden">
                  <div className="flex-1 px-2 py-1.5 text-center">
                    <div className="text-[8px] text-white/30 uppercase tracking-[0.15em] font-mono">Rate</div>
                    <div className="text-xs font-bold tabular-nums leading-tight" style={{ color: sigColor(weightRateStatus) }}>
                      {weeklyRatePct > 0 ? '+' : ''}{weeklyRatePct.toFixed(2)}<span className="text-[9px] font-normal text-white/40 ml-0.5">%/wk</span>
                    </div>
                    <div className="text-[8px] text-white/25 font-mono leading-tight">tgt 0.25-0.50</div>
                  </div>
                  <div className="flex-1 px-2 py-1.5 text-center">
                    <div className="text-[8px] text-white/30 uppercase tracking-[0.15em] font-mono">Waist/kg</div>
                    <div className="text-xs font-bold tabular-nums leading-tight" style={{ color: sigColor(waistStatus) }}>
                      {waistPerKg != null ? `${waistPerKg.toFixed(2)}` : '—'}<span className="text-[9px] font-normal text-white/40 ml-0.5">cm/kg</span>
                    </div>
                    <div className="text-[8px] text-white/25 font-mono leading-tight">ideal ~0.3</div>
                  </div>
                  <div className="flex-1 px-2 py-1.5 text-center">
                    <div className="text-[8px] text-white/30 uppercase tracking-[0.15em] font-mono">BF</div>
                    <div className="text-xs font-bold tabular-nums leading-tight" style={{ color: sigColor(bfStatus) }}>
                      {bfDelta != null ? `${bfDelta > 0 ? '+' : ''}${bfDelta.toFixed(1)}` : '—'}<span className="text-[9px] font-normal text-white/40 ml-0.5">%</span>
                    </div>
                    <div className="text-[8px] text-white/25 font-mono leading-tight">keep &lt;±1.5</div>
                  </div>
                  <div className="flex-1 px-2 py-1.5 text-center">
                    <div className="text-[8px] text-white/30 uppercase tracking-[0.15em] font-mono">Arm/kg</div>
                    <div className="text-xs font-bold tabular-nums leading-tight" style={{ color: sigColor(armStatus) }}>
                      {armPerKg != null ? `${armPerKg.toFixed(2)}` : '—'}<span className="text-[9px] font-normal text-white/40 ml-0.5">cm/kg</span>
                    </div>
                    <div className="text-[8px] text-white/25 font-mono leading-tight">tgt ≥0.20</div>
                  </div>
                </div>

                {alerts.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {alerts.map((a, i) => (
                      <div key={i} className="text-[9px] text-amber-400/70 font-mono">⚠ {a}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Glucose Monitor — Concept 4: Gradient Fill Chart */}
          {glucose?.current && (() => {
            const { current, history, stats } = glucose;
            const gv = current.value;
            const gValColor = (v: number) => v < 80 ? '#ef4444' : v <= 120 ? '#22c55e' : v <= 160 ? '#f59e0b' : '#ef4444';
            const color = gValColor(gv);
            const glabel = gv < 80 ? 'LOW' : gv <= 120 ? 'IN RANGE' : gv <= 160 ? 'ELEVATED' : 'HIGH';
            const tirColor = stats.timeInRange >= 70 ? '#22c55e' : stats.timeInRange >= 40 ? '#f59e0b' : '#ef4444';

            // Chart dimensions — larger chart
            const gChartW = 600, gChartH = 240;
            const gPad = { top: 10, right: 12, bottom: 30, left: 32 };
            const gIW = gChartW - gPad.left - gPad.right;
            const gIH = gChartH - gPad.top - gPad.bottom;
            const gMn = 50, gMx = 250, gRng = gMx - gMn;
            const toGY = (val: number) => gPad.top + gIH - ((Math.max(gMn, Math.min(gMx, val)) - gMn) / gRng) * gIH;
            const toGX = (i: number) => gPad.left + (i / Math.max(1, history.length - 1)) * gIW;
            const gPts = history.map((h, i) => ({ x: toGX(i), y: toGY(h.value), val: h.value }));

            // Build smooth curve path
            let gLinePath = '';
            if (gPts.length >= 2) {
              gLinePath = `M ${gPts[0].x} ${gPts[0].y}`;
              for (let i = 0; i < gPts.length - 1; i++) {
                const p0 = gPts[Math.max(0, i - 1)], p1 = gPts[i], p2 = gPts[i + 1], p3 = gPts[Math.min(gPts.length - 1, i + 2)];
                gLinePath += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
              }
            }

            // Timestamps for x-axis
            const gTimestamps = history.map(h => new Date(h.timestamp));
            const gFmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            // Find peak value
            const peakIdx = gPts.reduce((best, p, i) => p.val > (gPts[best]?.val || 0) ? i : best, 0);
            const peak = gPts[peakIdx];

            // Time label positions (evenly spaced, ~5 labels)
            const timeLabels: { x: number; label: string }[] = [];
            if (gTimestamps.length >= 2) {
              const step = Math.max(1, Math.floor(gTimestamps.length / 5));
              for (let i = 0; i < gTimestamps.length; i += step) {
                timeLabels.push({ x: toGX(i), label: gFmtTime(gTimestamps[i]) });
              }
              // Always include last
              const lastIdx = gTimestamps.length - 1;
              if (timeLabels[timeLabels.length - 1]?.x !== toGX(lastIdx)) {
                timeLabels.push({ x: toGX(lastIdx), label: gFmtTime(gTimestamps[lastIdx]) });
              }
            }

            return (
              <div className="glass-card p-4 mb-6 fade-up">
                {/* Header: value + trend + label + stats */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg">🩸</span>
                    <span className="text-3xl font-black data-value" style={{ color }}>{current.value}</span>
                    <span className="text-[11px] text-white/30">mg/dL</span>
                    <span className="text-3xl font-bold" style={{ color }}>{current.trend}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-0.5 text-right">
                      <span className="text-[10px] text-white/30">TIR <strong style={{ color: tirColor }}>{stats.timeInRange}%</strong></span>
                      <span className="text-[10px] text-white/30">Avg <strong className="text-white/60">{stats.avgGlucose}</strong></span>
                      <span className="text-[10px] text-white/30">eA1c <strong className="text-white/60">{stats.estimatedA1c}%</strong></span>
                    </div>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>{glabel}</span>
                  </div>
                </div>

                {/* Chart */}
                {gPts.length > 2 && (
                  <svg viewBox={`0 0 ${gChartW} ${gChartH}`} className="w-full" style={{ minHeight: '180px' }}>
                    <defs>
                      <linearGradient id="gAreaFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.15" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                      </linearGradient>
                      <filter id="gGlow"><feGaussianBlur stdDeviation="1.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                      {/* Per-segment gradients for smooth color transitions */}
                      {gPts.slice(0, -1).map((p, i) => {
                        const p2 = gPts[i + 1];
                        const c1 = gValColor(p.val), c2 = gValColor(p2.val);
                        return <linearGradient key={`gSeg${i}`} id={`gSeg${i}`} x1={p.x} y1="0" x2={p2.x} y2="0" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor={c1} /><stop offset="100%" stopColor={c2} />
                        </linearGradient>;
                      })}
                    </defs>

                    {/* Zone boundary lines */}
                    {[80, 120, 160].map(val => (
                      <g key={val}>
                        <line x1={gPad.left} y1={toGY(val)} x2={gPad.left + gIW} y2={toGY(val)}
                          stroke={val === 120 ? '#22c55e' : val === 80 ? '#22c55e' : '#ef4444'} strokeOpacity="0.12" strokeDasharray="4 4" />
                        <text x={gPad.left - 4} y={toGY(val) + 3} textAnchor="end" fill="white" fillOpacity="0.2" fontSize="8">{val}</text>
                      </g>
                    ))}

                    {/* Green zone band (80-120) */}
                    <rect x={gPad.left} y={toGY(120)} width={gIW} height={toGY(80) - toGY(120)} fill="#22c55e" opacity="0.04" rx="2" />

                    {/* Area fill */}
                    {gLinePath && <path d={`${gLinePath} L ${gPts[gPts.length - 1].x} ${gPad.top + gIH} L ${gPts[0].x} ${gPad.top + gIH} Z`} fill="url(#gAreaFill)" className="chart-area-fade" />}

                    {/* Per-segment curve with smooth color transitions — glow applied to group */}
                    <g filter="url(#gGlow)">
                      {gPts.length >= 2 && gPts.slice(0, -1).map((p, i) => {
                        const p2 = gPts[i + 1], p3 = gPts[Math.min(gPts.length - 1, i + 2)], p0 = gPts[Math.max(0, i - 1)];
                        return <path key={i} d={`M ${p.x} ${p.y} C ${p.x + (p2.x - p0.x) / 6} ${p.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p.x) / 6} ${p2.y - (p3.y - p.y) / 6}, ${p2.x} ${p2.y}`}
                          fill="none" stroke={`url(#gSeg${i})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />;
                      })}
                    </g>

                    {/* Peak annotation */}
                    {peak && peak.val > 140 && (
                      <g>
                        <circle cx={peak.x} cy={peak.y} r="3.5" fill="#ef4444" stroke="white" strokeWidth="1" />
                        <text x={peak.x} y={peak.y - 8} textAnchor="middle" fill="#ef4444" fontSize="10" fontWeight="700">{peak.val}</text>
                      </g>
                    )}

                    {/* Current dot with pulse */}
                    {gPts.length > 0 && (() => {
                      const last = gPts[gPts.length - 1];
                      return (
                        <g>
                          <circle cx={last.x} cy={last.y} r="8" fill={`${color}20`}>
                            <animate attributeName="r" values="6;10;6" dur="2s" repeatCount="indefinite" />
                          </circle>
                          <circle cx={last.x} cy={last.y} r="4" fill={color} stroke="white" strokeWidth="1.5" />
                        </g>
                      );
                    })()}

                    {/* Time labels along bottom */}
                    {timeLabels.map((t, i) => (
                      <text key={i} x={t.x} y={gChartH - 4} textAnchor={i === 0 ? 'start' : i === timeLabels.length - 1 ? 'end' : 'middle'}
                        fill="white" fillOpacity="0.35" fontSize="10" fontWeight="500">{t.label}</text>
                    ))}

                    {/* Vertical grid lines at time labels */}
                    {timeLabels.map((t, i) => i > 0 && i < timeLabels.length - 1 && (
                      <line key={i} x1={t.x} y1={gPad.top} x2={t.x} y2={gPad.top + gIH} stroke="white" strokeOpacity="0.03" />
                    ))}
                  </svg>
                )}
              </div>
            );
          })()}

          {/* Sleep — Concept 1B: Timeline + Day Strip */}
            {sleepData.length > 0 && (() => {
              const d = sleepData[sleepIdx] || sleepData[0];
              const scoreColor = d.score >= 85 ? '#22c55e' : d.score >= 70 ? '#f59e0b' : '#ef4444';

              // Build timeline segments from phase durations
              const total = d.totalSleep || 1;
              const deepPct = Math.round(((d.deepSleep || 0) / total) * 100);
              const remPct = Math.round(((d.remSleep || 0) / total) * 100);
              const awakePct = Math.round(((d.awakeTime || 0) / total) * 100);
              const lightPct = Math.max(0, 100 - deepPct - remPct - awakePct);

              // Generate realistic-looking segments by splitting phases
              const segments: { type: string; pct: number }[] = [];
              const splitPhase = (type: string, totalPct: number, chunks: number) => {
                if (totalPct <= 0) return;
                const base = Math.floor(totalPct / chunks);
                for (let i = 0; i < chunks; i++) {
                  const extra = i === 0 ? totalPct - base * chunks : 0;
                  segments.push({ type, pct: base + extra });
                }
              };
              // Interleave: light-deep-light-rem-light-deep-awake-rem-light
              const deepChunks = deepPct > 15 ? 2 : 1;
              const remChunks = remPct > 20 ? 2 : 1;
              const lightChunks = 3 + deepChunks + remChunks - 2;
              const lightBase = lightPct > 0 ? Math.floor(lightPct / lightChunks) : 0;
              let lightRemaining = lightPct;
              const addLight = (forceMin?: number) => {
                const amt = Math.min(lightRemaining, Math.max(forceMin || lightBase, 3));
                if (amt > 0) { segments.push({ type: 'light', pct: amt }); lightRemaining -= amt; }
              };
              addLight(8);
              splitPhase('deep', Math.floor(deepPct / deepChunks) + (deepPct % deepChunks), 1);
              addLight();
              splitPhase('rem', Math.floor(remPct / remChunks) + (remPct % remChunks), 1);
              addLight();
              if (deepChunks > 1) splitPhase('deep', Math.floor(deepPct / deepChunks), 1);
              if (awakePct > 0) segments.push({ type: 'awake', pct: awakePct });
              if (remChunks > 1) splitPhase('rem', Math.floor(remPct / remChunks), 1);
              if (lightRemaining > 0) segments.push({ type: 'light', pct: lightRemaining });

              const segColors: Record<string, string> = {
                deep: 'bg-gradient-to-b from-indigo-500 to-indigo-700',
                rem: 'bg-gradient-to-b from-cyan-500 to-cyan-600',
                light: 'bg-gradient-to-b from-slate-600 to-slate-800',
                awake: 'bg-gradient-to-b from-amber-500 to-amber-600',
              };

              // Bedtime formatting
              const fmtTime = (iso?: string) => {
                if (!iso) return '—';
                try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
              };

              return (
                <div className="glass-card p-5 mb-6 fade-up overflow-hidden">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                      <span className="text-lg">&#9790;</span> Sleep
                    </h2>
                  </div>

                  {/* Day strip */}
                  <div className="flex gap-1 mb-3">
                    {[...sleepData].reverse().map((sd, ri) => {
                      const i = sleepData.length - 1 - ri;
                      const isActive = i === sleepIdx;
                      const sc = sd.score >= 85 ? '#22c55e' : sd.score >= 70 ? '#f59e0b' : '#ef4444';
                      const dateObj = new Date(sd.day + 'T00:00:00');
                      const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'short' });
                      const dayNum = dateObj.getDate();
                      return (
                        <button key={i} onClick={() => setSleepIdx(i)}
                          className="flex-1 py-1.5 rounded-lg text-center transition-all"
                          style={{
                            border: isActive ? `1px solid ${sc}50` : '1px solid rgba(255,255,255,0.06)',
                            background: isActive ? `${sc}18` : 'rgba(255,255,255,0.03)',
                          }}>
                          <div className="text-[9px] uppercase" style={{ color: isActive ? `${sc}bb` : 'rgba(255,255,255,0.3)', fontWeight: isActive ? 600 : 400 }}>{dayName}</div>
                          <div className="text-[13px] mt-0.5" style={{ color: isActive ? sc : 'rgba(255,255,255,0.4)', fontWeight: isActive ? 800 : 700 }}>{dayNum}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Time range */}
                  <div className="flex justify-between items-center text-[11px] text-white/40 mb-1">
                    <span>{fmtTime(d.bedtimeStart)}</span>
                    <span className="text-xl font-extrabold text-white">{formatDuration(d.totalSleep)}</span>
                    <span>{fmtTime(d.bedtimeEnd)}</span>
                  </div>

                  {/* Timeline bar */}
                  <div className="flex h-12 rounded-xl overflow-hidden mb-3">
                    {segments.filter(s => s.pct > 0).map((seg, i) => (
                      <div key={i} className={`${segColors[seg.type]} flex items-center justify-center text-[9px] font-semibold text-white/80`}
                        style={{ width: `${seg.pct}%` }}>
                        {seg.pct >= 12 && seg.type === 'deep' ? 'Deep' : seg.pct >= 12 && seg.type === 'rem' ? 'REM' : ''}
                      </div>
                    ))}
                  </div>

                  {/* Metrics row */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center py-2 bg-white/[0.03] rounded-lg">
                      <div className="text-[9px] text-white/30 uppercase tracking-wider">Score</div>
                      <div className="text-base font-bold mt-0.5" style={{ color: scoreColor }}>{d.score}</div>
                    </div>
                    <div className="text-center py-2 bg-white/[0.03] rounded-lg">
                      <div className="text-[9px] text-white/30 uppercase tracking-wider">Deep</div>
                      <div className="text-base font-bold text-indigo-400 mt-0.5">{formatDuration(d.deepSleep)}</div>
                    </div>
                    <div className="text-center py-2 bg-white/[0.03] rounded-lg">
                      <div className="text-[9px] text-white/30 uppercase tracking-wider">REM</div>
                      <div className="text-base font-bold text-cyan-400 mt-0.5">{formatDuration(d.remSleep)}</div>
                    </div>
                    <div className="text-center py-2 bg-white/[0.03] rounded-lg">
                      <div className="text-[9px] text-white/30 uppercase tracking-wider">Efficiency</div>
                      <div className="text-base font-bold gradient-text mt-0.5">{d.efficiency ? `${d.efficiency}%` : '—'}</div>
                    </div>
                  </div>

                  {/* Vitals strip */}
                  <div className="flex justify-center gap-6 mt-3 pt-3 border-t border-white/5">
                    <span className="text-xs text-white/30">❤ <strong className="text-red-400">{d.avgHr ? Math.round(d.avgHr) : '—'}</strong> bpm</span>
                    <span className="text-xs text-white/30">⚡ <strong className="text-green-400">{d.avgHrv || '—'}</strong> ms</span>
                    {d.lowestHr && <span className="text-xs text-white/30">↓ <strong className="text-red-300">{Math.round(d.lowestHr)}</strong> bpm</span>}
                  </div>
                </div>
              );
            })()}

          {/* Workout Readiness Score */}
          {(() => {
            // ONLY use last night's data. If the ring wasn't worn last night,
            // don't fall back to older data — that would misrepresent current state.
            const todayStr2 = new Date().toISOString().split('T')[0];
            const lastNight = sleepData.find(d => d.day === todayStr2);

            // Baselines computed from past 14 days (excluding the most recent night,
            // so a missing night doesn't pollute the average)
            const recent = sleepData.slice(0, 14);
            const hrvValues = recent.map(d => d.avgHrv).filter((v): v is number => v != null && v > 0);
            const hrvBaseline = hrvValues.length >= 3 ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : null;
            const rhrValues = recent.map(d => d.lowestHr).filter((v): v is number => v != null && v > 0);
            const rhrBaseline = rhrValues.length >= 3 ? rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length : null;

            // Flags for missing last-night data
            const hrvStale = !lastNight?.avgHrv || lastNight.avgHrv <= 0;
            const rhrStale = !lastNight?.lowestHr || lastNight.lowestHr <= 0;
            const sleepStale = !lastNight?.score || lastNight.score <= 0;

            // Sunday cheat-meal correction: Oura's `day` field = wake-up day,
            // so Monday's data reflects Sunday night's sleep. Apply a one-night
            // compensation (+20) to HRV/RHR/Sleep scores for Monday readings only.
            // (RHR typically spikes most after a cheat meal — insulin/digestion elevates HR.)
            const isMondayData = lastNight && new Date(lastNight.day + 'T00:00:00').getDay() === 1;
            const cheatBonus = isMondayData ? 20 : 0;

            // HRV score — baseline = 65 (neutral/amber), +10% = 90, -10% = 40
            let hrvScore: number | null = null;
            let hrvDelta: number | null = null;
            if (!hrvStale && lastNight!.avgHrv && hrvBaseline) {
              hrvDelta = lastNight!.avgHrv! - hrvBaseline;
              const pctDelta = hrvDelta / hrvBaseline;
              hrvScore = Math.max(0, Math.min(100, 65 + pctDelta * 250 + cheatBonus));
            }

            // RHR score — lower is better. baseline = 65, -5% = 90, +5% = 40
            let rhrScore: number | null = null;
            let rhrDelta: number | null = null;
            if (!rhrStale && lastNight!.lowestHr && rhrBaseline) {
              rhrDelta = lastNight!.lowestHr! - rhrBaseline;
              const pctDelta = rhrDelta / rhrBaseline;
              rhrScore = Math.max(0, Math.min(100, 65 - pctDelta * 500 + cheatBonus));
            }

            // Sleep score — last night's score, with Sunday cheat compensation
            const sleepScore = !sleepStale ? Math.min(100, lastNight!.score! + cheatBonus) : null;

            // Subjective score — 3 levels (1/2/3). Soreness: 1=High(bad), 3=None(good).
            // Energy/Motivation: 1=Low(bad), 3=High(good). Same direction after mapping: higher = better.
            const scoreOf = (v: number) => (v / 3) * 100;
            const subjectiveScore = subjective
              ? (scoreOf(subjective.energy) + scoreOf(subjective.motivation) + scoreOf(subjective.soreness)) / 3
              : null;

            // Muscle-group-aware recovery: find NEXT scheduled group in rotation,
            // measure hours since THAT group was last trained (cardio excluded).
            // Rotation per Mark: Shoulders+Abs → Back+Biceps → Chest+Triceps → Legs → (repeat).
            // Cardio days fall between lifting days but don't shift the rotation.
            const ROTATION = ['Shoulders + Abs', 'Back + Biceps', 'Chest + Triceps', 'Legs'];
            const sessionTs = (s: TrainingSession) => new Date(s.savedAt || s.startedAt || s.date + 'T23:59:59').getTime();
            const weightSessions = trainingSessions
              .filter(s => s.workoutName !== 'Cardio' && ROTATION.includes(s.workoutName))
              .sort((a, b) => sessionTs(a) - sessionTs(b)); // ascending: oldest → newest
            const lastWeightSession = weightSessions[weightSessions.length - 1];
            const lastIdx = lastWeightSession ? ROTATION.indexOf(lastWeightSession.workoutName) : -1;
            const nextGroup = lastIdx === -1 ? ROTATION[0] : ROTATION[(lastIdx + 1) % ROTATION.length];
            // Most recent prior session of the next-up group
            let lastOfNextGroup: TrainingSession | undefined;
            for (let i = weightSessions.length - 1; i >= 0; i--) {
              if (weightSessions[i].workoutName === nextGroup) { lastOfNextGroup = weightSessions[i]; break; }
            }

            const lastWorkoutTs = lastOfNextGroup ? sessionTs(lastOfNextGroup) : null;
            const hoursSinceWorkout = lastWorkoutTs ? Math.floor((Date.now() - lastWorkoutTs) / 3600000) : 240;
            const daysSinceWorkout = Math.floor(hoursSinceWorkout / 24);
            const recoveryLabel = hoursSinceWorkout < 24 ? `${hoursSinceWorkout}h`
              : hoursSinceWorkout < 72 ? `${daysSinceWorkout}d ${hoursSinceWorkout % 24}h`
              : `${daysSinceWorkout}d`;
            // Scoring for muscle-group recovery (5-day cycle optimal):
            // 0-24h: 20→35 (just trained, not recovered)
            // 24-48h: 35→50 (still recovering)
            // 48-72h: 50→70 (half-recovered)
            // 72-96h (3-4d): 70→85 (mostly recovered)
            // 96-120h (4-5d): 85→100 (optimal window)
            // 120-168h (5-7d): 100→95 (still strong)
            // 168-240h (7-10d): 95→85
            // >240h: 75 (mild detraining)
            const h = hoursSinceWorkout;
            const recoveryScore = h < 24 ? 20 + h * 0.625
              : h < 48 ? 35 + (h - 24) * 0.625
              : h < 72 ? 50 + (h - 48) * 0.833
              : h < 96 ? 70 + (h - 72) * 0.625
              : h < 120 ? 85 + (h - 96) * 0.625
              : h < 168 ? 100 - (h - 120) * 0.104
              : h < 240 ? 95 - (h - 168) * 0.139
              : 75;

            // If no sleep data at all AND no subjective, don't show the card — nothing to measure
            const hasAnyFreshData = hrvScore != null || rhrScore != null || sleepScore != null || subjectiveScore != null;
            if (!hasAnyFreshData && sleepData.length === 0) return null;

            // Weighted composite
            const components: { score: number; weight: number }[] = [];
            if (hrvScore != null) components.push({ score: hrvScore, weight: 0.22 });
            if (rhrScore != null) components.push({ score: rhrScore, weight: 0.15 });
            if (sleepScore != null) components.push({ score: sleepScore, weight: 0.20 });
            if (subjectiveScore != null) components.push({ score: subjectiveScore, weight: 0.28 });
            components.push({ score: recoveryScore, weight: 0.15 });

            const totalWeight = components.reduce((s, c) => s + c.weight, 0);
            let readinessScore = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);

            // Veto: if subjective is very low (<40), cap overall at 65 (can't be "Ready" if you feel bad)
            if (subjectiveScore != null && subjectiveScore < 40) readinessScore = Math.min(readinessScore, 65);
            // Veto: if <12h since last workout, cap at 60
            if (hoursSinceWorkout < 12) readinessScore = Math.min(readinessScore, 60);

            const label = readinessScore >= 80 ? 'READY' : readinessScore >= 60 ? 'CAUTION' : 'RECOVER';
            const color = readinessScore >= 80 ? '#22c55e' : readinessScore >= 60 ? '#f59e0b' : '#ef4444';
            const emoji = readinessScore >= 80 ? '🟢' : readinessScore >= 60 ? '🟡' : '🔴';

            // Save latest readiness to localStorage so workout page can snapshot it at session start
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem('latest_readiness', JSON.stringify({
                  score: readinessScore,
                  label,
                  timestamp: new Date().toISOString(),
                  signals: components.length,
                }));
              } catch {}
            }

            // Helper for per-signal color
            const sigColor = (s: number | null) => s == null ? 'rgba(255,255,255,0.25)' : s >= 75 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444';

            return (
              <div className="glass-card p-3 mb-6 fade-up" style={{ fontFeatureSettings: '"tnum"' }}>
                {/* Top bar: icon · score · label · signal count */}
                <div className="flex items-center gap-3 mb-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color }}>
                    <rect x="3" y="8" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <rect x="19" y="11" width="2" height="4" rx="0.5" fill="currentColor" />
                    <rect x="5" y="10" width={Math.max(1, (readinessScore / 100) * 11)} height="6" rx="1" fill="currentColor" />
                  </svg>
                  <span className="text-[10px] text-white/40 uppercase tracking-[0.15em]">Readiness</span>
                  <span className="text-3xl font-black tabular-nums leading-none" style={{ color }}>{readinessScore}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
                  <span className="text-[9px] text-white/25 ml-auto font-mono">{components.length}/5</span>
                </div>

                {/* Signal strip — compact, table-like */}
                <div className="flex items-stretch divide-x divide-white/5 border border-white/5 rounded-md overflow-hidden">
                  {([
                    { label: 'HRV', value: hrvScore != null ? `${lastNight?.avgHrv}` : '—', unit: hrvScore != null ? 'ms' : '', sub: hrvScore != null && hrvDelta != null ? `${hrvDelta > 0 ? '+' : ''}${hrvDelta.toFixed(0)}` : 'no data', score: hrvScore },
                    { label: 'RHR', value: rhrScore != null ? `${Math.round(lastNight!.lowestHr!)}` : '—', unit: rhrScore != null ? 'bpm' : '', sub: rhrScore != null && rhrDelta != null ? `${rhrDelta > 0 ? '+' : ''}${rhrDelta.toFixed(0)}` : 'no data', score: rhrScore },
                    { label: 'SLP', value: sleepScore != null ? `${sleepScore}` : '—', unit: '', sub: sleepScore != null ? 'score' : 'no data', score: sleepScore },
                    { label: 'REC', value: recoveryLabel, unit: '', sub: 'last', score: recoveryScore },
                    { label: 'SUBJ', value: subjectiveScore != null ? `${Math.round(subjectiveScore)}` : '—', unit: '', sub: subjective ? 'check-in' : 'tap ↓', score: subjectiveScore },
                  ] as const).map((sig, i) => (
                    <div key={i} className={`flex-1 px-2 py-1.5 text-center ${sig.score == null ? 'opacity-40' : ''}`}>
                      <div className="text-[8px] text-white/30 uppercase tracking-[0.15em] font-mono">{sig.label}</div>
                      <div className="text-xs font-bold tabular-nums leading-tight" style={{ color: sigColor(sig.score) }}>
                        {sig.value}{sig.unit && <span className="text-[9px] font-normal text-white/40 ml-0.5">{sig.unit}</span>}
                      </div>
                      <div className="text-[8px] text-white/25 font-mono leading-tight">{sig.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Stale warning — inline and terse */}
                {(hrvStale || rhrStale || sleepStale) && (
                  <div className="text-[9px] text-amber-400/50 mt-1.5 font-mono">
                    ⚠ {[hrvStale && 'HRV', rhrStale && 'RHR', sleepStale && 'SLP'].filter(Boolean).join(' ')} — no data last night
                  </div>
                )}
                {/* Sunday cheat-meal correction indicator */}
                {isMondayData && !hrvStale && (
                  <div className="text-[9px] text-cyan-400/50 mt-1.5 font-mono">
                    ✦ Monday: +20 correction on HRV/RHR/SLP (Sunday cheat meal)
                  </div>
                )}

                {/* Subjective check-in — compact row, 3 levels: worst → best (left to right) */}
                {!subjective ? (
                  <button
                    onClick={() => {
                      saveSubjective({ energy: 2, soreness: 2, motivation: 2 });
                    }}
                    className="w-full mt-2 py-1 text-[10px] font-mono uppercase tracking-wider text-white/40 bg-white/[0.03] hover:bg-white/[0.06] rounded transition-all">
                    + Quick check-in
                  </button>
                ) : (
                  <div className="mt-2 space-y-0.5">
                    {([
                      { key: 'energy', label: 'ENERGY', options: ['Low', 'Medium', 'High'] },
                      { key: 'motivation', label: 'MOTIV', options: ['Low', 'Medium', 'High'] },
                      { key: 'soreness', label: 'SORE', options: ['High', 'Medium', 'None'] },
                    ] as const).map(({ key, label: lbl, options }) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="text-[9px] text-white/40 w-12 font-mono">{lbl}</span>
                        <div className="flex gap-0.5 flex-1">
                          {[1, 2, 3].map(n => {
                            const active = subjective[key] === n;
                            // n maps 1→worst (left), 2→middle, 3→best (right). Same for all including soreness.
                            const bg = active
                              ? (n === 3 ? 'bg-green-500/25 text-green-300' : n === 2 ? 'bg-amber-500/25 text-amber-300' : 'bg-red-500/25 text-red-300')
                              : 'bg-white/[0.04] text-white/30';
                            return (
                              <button key={n}
                                onClick={() => {
                                  saveSubjective({ ...subjective, [key]: n });
                                }}
                                className={`flex-1 py-1 text-[10px] font-mono rounded ${bg} transition-all`}>
                                {options[n - 1]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Weight Progress Chart */}
          {measurements.length >= 2 && (() => {
            const weights = measurements.map(m => m.weight);
            const startWeight = weights[0];
            const endWeight = weights[weights.length - 1];
            const totalChange = Math.round((endWeight - startWeight) * 10) / 10;

            // Calculate trend: weekly rate from linear regression
            const dates = measurements.map(m => new Date(m.date).getTime());
            const firstDate = dates[0];
            const weeks = dates.map(d => (d - firstDate) / (7 * 24 * 60 * 60 * 1000));
            // Slope from last 4 weeks of data for projection
            const fourWeeksAgo = weeks[weeks.length - 1] - 4;
            const recentIdx = weeks.findIndex(w => w >= fourWeeksAgo);
            const recentWeeks = weeks.slice(recentIdx);
            const recentWeights = weights.slice(recentIdx);
            const rn = recentWeeks.length;
            const rsumX = recentWeeks.reduce((a, b) => a + b, 0);
            const rsumY = recentWeights.reduce((a, b) => a + b, 0);
            const rsumXY = recentWeeks.reduce((a, x, i) => a + x * recentWeights[i], 0);
            const rsumX2 = recentWeeks.reduce((a, x) => a + x * x, 0);
            const slope = rn > 1 ? (rn * rsumXY - rsumX * rsumY) / (rn * rsumX2 - rsumX * rsumX) : 0;
            // Full history regression for trend line reference — use its own slope+intercept
            const n = weeks.length;
            const sumX = weeks.reduce((a, b) => a + b, 0);
            const sumY = weights.reduce((a, b) => a + b, 0);
            const sumXY = weeks.reduce((a, x, i) => a + x * weights[i], 0);
            const sumX2 = weeks.reduce((a, x) => a + x * x, 0);
            const fullSlope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
            const intercept = (sumY - fullSlope * sumX) / n;

            // Projection: extend from last point using trend
            const lastDate = new Date(measurements[measurements.length - 1].date);
            const lastWeek = weeks[weeks.length - 1];
            let projectionWeeks = 0;
            let projectionLabel = '';
            // Guard against tiny slopes producing Invalid Date / huge projections
            if (targetWeight !== null && Math.abs(slope) >= 0.05) {
              const weeksToTarget = (targetWeight - endWeight) / slope;
              if (weeksToTarget > 0) {
                projectionWeeks = Math.ceil(weeksToTarget);
                const targetDate = new Date(lastDate.getTime() + weeksToTarget * 7 * 24 * 60 * 60 * 1000);
                projectionLabel = targetDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
              }
            }

            // Build projection points (trend-based from last data point)
            const projSteps = projectionWeeks > 0 ? Math.min(projectionWeeks, 52) : 0;
            const projPoints: { week: number; weight: number; date: Date }[] = [];
            for (let i = 1; i <= projSteps; i++) {
              const w = endWeight + slope * i;
              const d = new Date(lastDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
              projPoints.push({ week: lastWeek + i, weight: w, date: d });
            }

            // Chart dimensions
            const chartWidth = 700;
            const chartHeight = 240;
            const padding = { top: 30, right: 50, bottom: 44, left: 54 };
            const innerWidth = chartWidth - padding.left - padding.right;
            const innerHeight = chartHeight - padding.top - padding.bottom;

            // Combine all weights for Y range
            const allWeights = [...weights, ...(projPoints.map(p => p.weight)), ...(targetWeight !== null ? [targetWeight] : [])];
            const minW = Math.min(...allWeights) - 1;
            const maxW = Math.max(...allWeights) + 1;
            const rangeW = maxW - minW || 1;

            // X range: all weeks including projection
            const allWeeksArr = [...weeks, ...projPoints.map(p => p.week)];
            const maxWeek = Math.max(...allWeeksArr);
            const minWeek = 0;
            const weekRange = maxWeek - minWeek || 1;

            const toX = (w: number) => padding.left + ((w - minWeek) / weekRange) * innerWidth;
            const toY = (v: number) => padding.top + innerHeight - ((v - minW) / rangeW) * innerHeight;

            const points = measurements.map((m, i) => ({
              x: toX(weeks[i]), y: toY(m.weight), val: m.weight, date: m.date
            }));

            // Smooth curve using cubic bezier (Catmull-Rom inspired)
            const smoothLine = (pts: { x: number; y: number }[]) => {
              if (pts.length < 2) return '';
              if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
              let d = `M ${pts[0].x} ${pts[0].y}`;
              for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[Math.max(0, i - 1)];
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const p3 = pts[Math.min(pts.length - 1, i + 2)];
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
              }
              return d;
            };
            const linePath = smoothLine(points);
            // Approximate path length for draw-in animation
            const lineLen = points.reduce((acc, p, i) => i === 0 ? 0 : acc + Math.hypot(p.x - points[i-1].x, p.y - points[i-1].y), 0) * 1.3;
            const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${padding.top + innerHeight} Z`;

            // Trend line across full data range — uses full-history slope/intercept for coherence
            const trendY1 = toY(intercept);
            const trendY2 = toY(intercept + fullSlope * lastWeek);

            // Projection path (dotted, from last point forward)
            const projPathPoints = [
              { x: points[points.length - 1].x, y: points[points.length - 1].y },
              ...projPoints.map(p => ({ x: toX(p.week), y: toY(p.weight) }))
            ];
            const projPath = projPathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

            const yTicks = 5;
            const yLabels = Array.from({ length: yTicks }, (_, i) => {
              const val = minW + (rangeW * i) / (yTicks - 1);
              return { val: Math.round(val * 10) / 10, y: toY(val) };
            });

            // Progress logic
            const isPositiveProgress = phase === 'bulking' ? totalChange > 0 : totalChange < 0;
            const accentColor = phase === 'bulking' ? '#22c55e' : '#3b82f6';

            // X-axis date labels
            const allDates = [
              ...measurements.map((m, i) => ({ week: weeks[i], date: m.date })),
              ...projPoints.map(p => ({ week: p.week, date: p.date.toISOString() }))
            ];
            const labelCount = 8;
            const labelStep = Math.max(1, Math.ceil(allDates.length / labelCount));

            return (
              <div className="glass-strong p-6 mb-8 fade-up relative overflow-hidden">
                {/* Animated gradient mesh background */}
                <div className="absolute inset-0 opacity-30 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 50% at 20% 30%, rgba(139,92,246,0.15) 0%, transparent 70%), radial-gradient(ellipse 50% 60% at 80% 70%, rgba(6,182,212,0.1) 0%, transparent 70%)', animation: 'mesh-drift 8s ease-in-out infinite alternate' }} />
                {/* Header with minimal pills */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-[15px] font-bold text-white">Weight Progress</h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <p className="text-[11px] text-white/40">
                        {startWeight}kg → <strong className="text-white">{endWeight}kg</strong>
                        <span className={`ml-1 font-semibold ${isPositiveProgress ? 'text-green-400' : totalChange === 0 ? 'text-white/40' : 'text-yellow-400'}`}>
                          ({totalChange > 0 ? '+' : ''}{totalChange}kg)
                        </span>
                      </p>
                      {(() => {
                        const rateColor = phase === 'bulking'
                          ? (slope >= 0.3 && slope <= 0.7 ? '#22c55e' : slope > 0 ? '#f59e0b' : '#ef4444')
                          : (slope <= -0.3 && slope >= -0.7 ? '#22c55e' : slope < 0 ? '#f59e0b' : '#ef4444');
                        const arrow = slope > 0.05 ? '↗' : slope < -0.05 ? '↘' : '→';
                        return (
                          <span className="text-[10px] font-semibold" style={{ color: rateColor }}>
                            {arrow} {slope > 0 ? '+' : ''}{slope.toFixed(2)} kg/wk
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Target pill */}
                    {showTargetInput ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={targetInput}
                          onChange={(e) => setTargetInput(e.target.value)}
                          placeholder="kg"
                          className="glass-input w-16 px-2 py-1 rounded-lg text-[10px] text-white text-center"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = parseFloat(targetInput);
                              if (v > 0) { setTargetWeight(v); saveSetting('targetWeight', String(v)); }
                              setShowTargetInput(false);
                            }
                          }}
                        />
                        <button onClick={() => { const v = parseFloat(targetInput); if (v > 0) { setTargetWeight(v); saveSetting('targetWeight', String(v)); } setShowTargetInput(false); }}
                          className="text-[10px] text-green-400 px-1">✓</button>
                        {targetWeight !== null && (
                          <button onClick={() => { setTargetWeight(null); saveSetting('targetWeight', null); setShowTargetInput(false); }}
                            className="text-[10px] text-red-400 px-1">✕</button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => { setTargetInput(targetWeight ? String(targetWeight) : ''); setShowTargetInput(true); }}
                        className="text-[10px] text-white/35 px-2.5 py-1 rounded-lg border border-white/[0.08] hover:border-white/15 transition-all"
                      >
                        → <strong className="text-white/60">{targetWeight ? `${targetWeight}kg` : 'Set'}</strong>
                      </button>
                    )}
                    {/* Phase pill */}
                    <button
                      onClick={togglePhase}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${phase === 'bulking' ? 'text-green-400 border-green-500/15 bg-green-500/[0.06]' : 'text-blue-400 border-blue-500/15 bg-blue-500/[0.06]'}`}
                    >
                      ● {phase === 'bulking' ? 'BULK' : 'CUT'}
                    </button>
                  </div>
                </div>

                {/* Weight Chart */}
                <div className="overflow-x-auto mb-4">
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full" style={{ minWidth: '340px' }}>
                    {yLabels.map((tick, i) => (
                      <g key={i}>
                        <line x1={padding.left} y1={tick.y} x2={chartWidth - padding.right} y2={tick.y} stroke="rgba(255,255,255,0.04)" />
                        <text x={padding.left - 8} y={tick.y + 3} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize="9">{tick.val}</text>
                      </g>
                    ))}

                    {targetWeight !== null && (
                      <g>
                        <line x1={padding.left} y1={toY(targetWeight)} x2={chartWidth - padding.right} y2={toY(targetWeight)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
                        <text x={chartWidth - padding.right + 4} y={toY(targetWeight) + 3} fill="#f59e0b" fontSize="9" fontWeight="bold" opacity="0.7">{targetWeight}kg</text>
                      </g>
                    )}

                    {/* Gradient defs */}
                    <defs>
                      <linearGradient id="dashWeightGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={accentColor} stopOpacity="0.35" />
                        <stop offset="60%" stopColor={accentColor} stopOpacity="0.08" />
                        <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
                      </linearGradient>
                      <filter id="glow">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <filter id="chartGlow" x="-100%" y="-100%" width="300%" height="300%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <linearGradient id="dashLineGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={accentColor} stopOpacity="0.5" />
                        <stop offset="100%" stopColor={accentColor} stopOpacity="1" />
                      </linearGradient>
                      <linearGradient id="dashBfGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="dashMmGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                      <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="1.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>

                    {/* Area fill */}
                    <path d={areaPath} fill="url(#dashWeightGrad)" className="chart-area-fade" />

                    {/* Projection line (future, subtle) */}
                    {projPoints.length > 0 && (
                      <path d={projPath} fill="none" stroke={accentColor} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
                    )}

                    {/* Main line (solid, draw-in animation) */}
                    <path d={linePath} fill="none" stroke="url(#dashLineGrad)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)"
                      strokeDasharray={lineLen} strokeDashoffset={lineLen} className="chart-line-draw" style={{ '--line-len': lineLen } as React.CSSProperties} />

                    {/* Data points */}
                    {points.map((p, i) => {
                      const isLast = i === points.length - 1;
                      const dotDelay = 0.2 + (i / points.length) * 1.2;
                      return (
                        <g key={i} className="chart-dot-pop" style={{ animationDelay: `${dotDelay}s` }}>
                          {isLast && <circle cx={p.x} cy={p.y} r="10" fill={accentColor} opacity="0.15" />}
                          {isLast && <circle cx={p.x} cy={p.y} r="6" fill={accentColor} opacity="0.25" />}
                          <circle cx={p.x} cy={p.y} r={isLast ? 4 : 2} fill={accentColor} stroke="#fff" strokeWidth={isLast ? 1.5 : 0.8} filter={isLast ? 'url(#chartGlow)' : undefined} />
                          {isLast && (
                            <text x={p.x} y={p.y - 10} textAnchor="end" fill="white" fontSize="11" fontWeight="bold">{p.val}kg</text>
                          )}
                        </g>
                      );
                    })}

                    {/* Projection endpoint */}
                    {projPoints.length > 0 && (() => {
                      const last = projPathPoints[projPathPoints.length - 1];
                      return (
                        <g>
                          <circle cx={last.x} cy={last.y} r="3" fill="#f59e0b" stroke="#fff" strokeWidth="1" opacity="0.6" />
                        </g>
                      );
                    })()}

                    {/* X-axis date labels */}
                    {allDates.filter((_, i) => i === 0 || i === allDates.length - 1 || i % labelStep === 0).map((d, i) => {
                      const x = toX(d.week);
                      return (
                        <text key={i} x={x} y={chartHeight - 6} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" transform={`rotate(-30, ${x}, ${chartHeight - 6})`}>
                          {new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </text>
                      );
                    })}

                    {/* kg label */}
                    <text x={padding.left - 10} y={padding.top - 10} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize="9">kg</text>
                  </svg>
                </div>

                {/* Stat chips */}
                <div className="flex gap-2 mb-4">
                  {(() => {
                    const rateColor = phase === 'bulking'
                      ? (slope >= 0.3 && slope <= 0.7 ? '#22c55e' : slope > 0 ? '#f59e0b' : '#ef4444')
                      : (slope <= -0.3 && slope >= -0.7 ? '#22c55e' : slope < 0 ? '#f59e0b' : '#ef4444');
                    const arrow = slope > 0.05 ? '↗' : slope < -0.05 ? '↘' : '→';
                    return (
                      <div className="flex-1 text-center py-2 rounded-lg" style={{ background: `${rateColor}10`, border: `1px solid ${rateColor}18` }}>
                        <div className="text-[9px] text-white/30 uppercase tracking-wider">Rate</div>
                        <div className="text-sm font-extrabold mt-0.5" style={{ color: rateColor }}>{arrow} {slope > 0 ? '+' : ''}{slope.toFixed(2)} kg/wk</div>
                      </div>
                    );
                  })()}
                  <div className="flex-1 text-center py-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                    <div className="text-[9px] text-white/30 uppercase tracking-wider">Gained</div>
                    <div className="text-sm font-extrabold text-white mt-0.5">{totalChange > 0 ? '+' : ''}{totalChange} kg</div>
                  </div>
                  {targetWeight !== null && (
                    <div className="flex-1 text-center py-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.1)' }}>
                      <div className="text-[9px] text-white/30 uppercase tracking-wider">To Target</div>
                      <div className="text-sm font-extrabold text-amber-400 mt-0.5">{Math.abs(Math.round((targetWeight - endWeight) * 10) / 10)} kg</div>
                    </div>
                  )}
                </div>

              {/* Body Composition Charts — same style as weight chart */}
              {(() => {
                const cW = chartWidth, cH = 160;
                const cPad = { top: 25, right: 50, bottom: 40, left: 54 };
                const cIW = cW - cPad.left - cPad.right;
                const cIH = cH - cPad.top - cPad.bottom;
                const wkMin = weeks[0] ?? 0;
                const wkMax = weeks[weeks.length - 1] ?? 1;
                const wkRange = wkMax - wkMin || 1;
                const toCX = (w: number) => cPad.left + ((w - wkMin) / wkRange) * cIW;

                // X-axis date labels (reuse from weight chart)
                const allChartDates = measurements.map(m => ({ week: weeks[measurements.indexOf(m)], date: new Date(m.date) }));
                const cLabelStep = Math.max(1, Math.floor(allChartDates.length / 6));

                const renderCompositionPill = (
                  data: { week: number; val: number; date: string }[],
                  color: string,
                  label: string,
                  unit: string,
                ) => {
                  if (data.length < 2) return null;
                  const vals = data.map(d => d.val);
                  const mn = Math.min(...vals) - 0.5;
                  const mx = Math.max(...vals) + 0.5;
                  const rng = mx - mn || 1;
                  const sparkW = 120, sparkH = 32, sparkPad = 4;
                  const wkMin = data[0].week;
                  const wkMax = data[data.length - 1].week;
                  const wkRng = wkMax - wkMin || 1;
                  const pts = data.map((d) => ({
                    x: sparkPad + ((d.week - wkMin) / wkRng) * (sparkW - sparkPad * 2),
                    y: sparkPad + (1 - (d.val - mn) / rng) * (sparkH - sparkPad * 2),
                    val: d.val,
                  }));
                  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                  const area = `${line} L ${sparkW} ${sparkH} L 0 ${sparkH} Z`;
                  const gradId = `compPill-${label.replace(/\s/g, '')}`;

                  const totalChange = Math.round((pts[pts.length - 1].val - pts[0].val) * 10) / 10;
                  const changeColor = label === 'Body Fat' ? (totalChange < 0 ? '#22c55e' : '#ef4444') : (totalChange > 0 ? '#22c55e' : '#ef4444');
                  const changeArrow = totalChange > 0 ? '↗' : totalChange < 0 ? '↘' : '→';
                  const last = pts[pts.length - 1];

                  return (
                    <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3.5 py-3 card-animate">
                      <div className="flex-shrink-0">
                        <div className="text-[9px] text-white/30 uppercase tracking-wider">{label}</div>
                        <div className="text-[22px] font-extrabold leading-none mt-0.5" style={{ color }}>{last.val}{unit}</div>
                        {totalChange !== 0 && <div className="text-[9px] font-semibold mt-1" style={{ color: changeColor }}>{changeArrow} {totalChange > 0 ? '+' : ''}{totalChange}{unit}</div>}
                      </div>
                      <svg viewBox={`0 0 ${sparkW} ${sparkH}`} className="flex-1 h-8" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d={area} fill={`url(#${gradId})`} />
                        <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                        <circle cx={last.x} cy={last.y} r="2.5" fill={color} />
                      </svg>
                    </div>
                  );
                };

                const bfData = measurements.map((m, i) => m.bodyFat != null ? { week: weeks[i], val: m.bodyFat, date: m.date } : null).filter((d): d is { week: number; val: number; date: string } => d !== null);
                const mmData = measurements.map((m, i) => m.muscleMass != null ? { week: weeks[i], val: m.muscleMass, date: m.date } : null).filter((d): d is { week: number; val: number; date: string } => d !== null);

                if (bfData.length < 2 && mmData.length < 2) return null;
                return (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    {renderCompositionPill(bfData, '#ef4444', 'Body Fat', '%')}
                    {renderCompositionPill(mmData, '#3b82f6', 'Muscle Mass', 'kg')}
                  </div>
                );
              })()}
              </div>
            );
          })()}

          {/* Photo Comparison: Previous vs Current */}
          {latestMeasurement?.photos && previousMeasurement?.photos &&
            (latestMeasurement.photos.front || latestMeasurement.photos.back) && (
            <div className="glass p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Progress Comparison</h2>
                <button
                  onClick={() => setShowPhotos(!showPhotos)}
                  className="btn-secondary text-sm px-4 py-2"
                >
                  {showPhotos ? 'Hide Photos' : 'Show Photos'}
                </button>
              </div>
              {showPhotos && (
                <div className="space-y-6">
                  {/* Front comparison */}
                  {(previousMeasurement.photos.front || latestMeasurement.photos.front) && (
                    <div>
                      <h3 className="text-sm font-medium text-white/50 uppercase tracking-wider mb-3">Front</h3>
                      {previousMeasurement.photos.front && latestMeasurement.photos.front ? (
                        <BeforeAfterSlider
                          beforeSrc={previousMeasurement.photos.front}
                          afterSrc={latestMeasurement.photos.front}
                          beforeLabel={new Date(previousMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          afterLabel={new Date(latestMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          adjustKey={`${previousMeasurement.date}_${latestMeasurement.date}_front`}
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {previousMeasurement.photos.front ? (
                              <img src={previousMeasurement.photos.front} alt="Front previous" className="w-full h-full object-cover" />
                            ) : <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>}
                          </div>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {latestMeasurement.photos.front ? (
                              <img src={latestMeasurement.photos.front} alt="Front current" className="w-full h-full object-cover" />
                            ) : <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Back comparison */}
                  {(previousMeasurement.photos.back || latestMeasurement.photos.back) && (
                    <div>
                      <h3 className="text-sm font-medium text-white/50 uppercase tracking-wider mb-3">Back</h3>
                      {previousMeasurement.photos.back && latestMeasurement.photos.back ? (
                        <BeforeAfterSlider
                          beforeSrc={previousMeasurement.photos.back}
                          afterSrc={latestMeasurement.photos.back}
                          beforeLabel={new Date(previousMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          afterLabel={new Date(latestMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          adjustKey={`${previousMeasurement.date}_${latestMeasurement.date}_back`}
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {previousMeasurement.photos.back ? (
                              <img src={previousMeasurement.photos.back} alt="Back previous" className="w-full h-full object-cover" />
                            ) : <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>}
                          </div>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {latestMeasurement.photos.back ? (
                              <img src={latestMeasurement.photos.back} alt="Back current" className="w-full h-full object-cover" />
                            ) : <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* User Manual link */}
          <div className="mt-12 pt-6 border-t border-white/5 flex justify-center">
            <a
              href="/manual"
              className="inline-flex items-center gap-2 text-xs text-white/40 hover:text-cyan-300 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4z" />
                <path d="M4 4v12a4 4 0 004 4" />
                <path d="M8 8h8M8 12h8" strokeLinecap="round" />
              </svg>
              User Manual — how the calorie & nutrition logic works
            </a>
          </div>

        </div>
      </main>
    </div>
  );
}
