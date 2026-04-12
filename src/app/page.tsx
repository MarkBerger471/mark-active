'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Navigation from '@/components/Navigation';
import Link from 'next/link';
import { getMeasurements, getSetting, saveSetting, getTrainingSessions, getNutritionPlan } from '@/utils/storage';
import { Measurement, TrainingSession, NutritionPlan } from '@/types';
import { calcSessionCalories, calcRollingTDEE } from '@/utils/calories';
import { DumbbellIcon, ScaleIcon, ForkKnifeIcon } from '@/components/BackgroundEffects';
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

function SleepMultiRing({ score, deepPct, remPct }: { score: number; deepPct: number; remPct: number }) {
  const rings = [
    { r: 40, val: score / 100, color: score >= 85 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444', w: 6 },
    { r: 32, val: Math.min(remPct / 25, 1), color: '#06b6d4', w: 5 },
    { r: 25, val: Math.min(deepPct / 20, 1), color: '#818cf8', w: 5 },
  ];
  return (
    <div className="relative w-28 h-28">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <defs>
          <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {rings.map((ring, i) => {
          const c = 2 * Math.PI * ring.r;
          const off = c - ring.val * c;
          return (
            <g key={i}>
              <circle cx="50" cy="50" r={ring.r} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth={ring.w} />
              <circle cx="50" cy="50" r={ring.r} fill="none" stroke={ring.color} strokeWidth={ring.w} strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={off} filter="url(#ringGlow)"
                className="gauge-sweep" style={{ '--gauge-arc': c, animationDelay: `${i * 150}ms` } as React.CSSProperties} />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold gradient-text data-value">{score}</span>
        <span className="text-[8px] text-white/30 uppercase tracking-wider">Score</span>
      </div>
    </div>
  );
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
  const sleepTouchRef = useRef<{ x: number; t: number } | null>(null);
  const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([]);
  const [nutritionPlan, setNutritionPlan] = useState<NutritionPlan | null>(null);
  const [dailyActivity, setDailyActivity] = useState<Record<string, { activeCalories: number }>>({});
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

  useEffect(() => {
    if (isAuthenticated) {
      getMeasurements().then(all => {
        setMeasurements(all);
        if (all.length > 0) {
          setLatestMeasurement(all[all.length - 1]);
          if (all.length > 1) {
            setPreviousMeasurement(all[all.length - 2]);
          }
        }
      });
      // Priority 1: settings (instant from IDB)
      getSetting('phase').then(v => { if (v) setPhase(v as Phase); });
      getSetting('targetWeight').then(v => { if (v) setTargetWeight(parseFloat(v)); });
      // Priority 2: training + nutrition (instant from IDB, deferred Firestore sync)
      getTrainingSessions().then(setTrainingSessions);
      getNutritionPlan().then(p => { if (p && 'current' in p) setNutritionPlan(p as NutritionPlan); });
      // Priority 3: API calls — restore from cache first, then refresh
      try { const sc = localStorage.getItem('sleep_cache'); if (sc) { const sd = JSON.parse(sc); if (sd.length) setSleepData(sd); } } catch {}
      try { const ac = localStorage.getItem('activity_cache'); if (ac) { const ad = JSON.parse(ac); if (Object.keys(ad).length) setDailyActivity(ad); } } catch {}
      setTimeout(() => fetch('/api/oura?days=7').then(r => r.json()).then(d => {
        if (d.data) { const sorted = d.data.sort((a: SleepDay, b: SleepDay) => b.day.localeCompare(a.day)); setSleepData(sorted); try { localStorage.setItem('sleep_cache', JSON.stringify(sorted)); } catch {} }
      }).catch(() => {}), 300);
      setTimeout(() => fetch('/api/oura?days=60').then(r => r.json()).then(d => {
        const act: Record<string, { activeCalories: number }> = {};
        const addDay = (day: string, steps?: number, activeCal?: number) => {
          if (steps || activeCal) act[day] = { activeCalories: activeCal || 0 };
        };
        if (d.data) for (const day of d.data) addDay(day.day, day.steps, day.activeCalories);
        if (d.activity) for (const day of d.activity) addDay(day.day, day.steps, day.activeCalories);
        setDailyActivity(act);
        try { localStorage.setItem('activity_cache', JSON.stringify(act)); } catch {}
      }).catch(() => {}), 800);
      // Glucose data — restore from cache, then refresh via API (original 2s delay)
      try { const gc = localStorage.getItem('glucose_cache'); if (gc) { const gd = JSON.parse(gc); if (gd.current) setGlucose(gd); } } catch {}
      setTimeout(() => fetch('/api/glucose').then(r => r.json()).then(d => {
        if (d.current) { setGlucose(d); try { localStorage.setItem('glucose_cache', JSON.stringify(d)); } catch {} }
      }).catch(() => {}), 2000);
    }
  }, [isAuthenticated]);

  const togglePhase = () => {
    const next = phase === 'bulking' ? 'cutting' : 'bulking';
    setPhase(next);
    saveSetting('phase', next);
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-lg">Loading...</div>
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
              const sparkColor = isGood ? '#22c55e' : isBad ? '#ef4444' : '#22c55e';

              return (
                <div key={stat.label} className={`glass-card p-4 stat-accent card-animate bg-gradient-to-br ${tint}`} style={{ animationDelay: `${idx * 60}ms` }}>
                  <div className="flex items-start justify-between">
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
              const nbCacheKey = `nb_${new Date().toISOString().split('T')[0]}_${dailyKcal}_${trainingSessions.length}_${Object.keys(dailyActivity).length}`;
              const nbCacheRaw = typeof window !== 'undefined' ? localStorage.getItem('nb_cache') : null;
              const nbCache = nbCacheRaw ? JSON.parse(nbCacheRaw) : null;
              let dailyBurn: number, dailyTrainingAvg: number, dailyNeat: number;
              if (nbCache?.key === nbCacheKey) {
                dailyBurn = nbCache.burn;
                dailyTrainingAvg = nbCache.training;
                dailyNeat = nbCache.neat;
              } else {
                const tdee = calcRollingTDEE(trainingSessions, bodyWeight, bmr, dailyActivity);
                dailyBurn = tdee.total;
                dailyTrainingAvg = tdee.training;
                dailyNeat = tdee.neat;
                try { localStorage.setItem('nb_cache', JSON.stringify({ key: nbCacheKey, burn: dailyBurn, training: dailyTrainingAvg, neat: dailyNeat })); } catch {}
              }
              const weekSessions = trainingSessions.filter(s => {
                const d = new Date(); d.setDate(d.getDate() - 6);
                return s.date >= d.toISOString().split('T')[0];
              });
              // Protein: target = weight × 2.25 ±0.25
              const proteinTarget = Math.round(bodyWeight * 2.25);
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

              const ratio = intake / dailyBurn;
              const targetRatio = phase === 'bulking' ? 1.15 : 0.85; // +15% or -15%
              const diff = ratio - targetRatio;
              const absDiff = Math.abs(diff);

              // Green: within ±2% of target, Yellow: ±2-5%, Red: beyond ±5%
              const zoneColor = absDiff <= 0.05 ? '#22c55e' : absDiff <= 0.10 ? '#f59e0b' : '#ef4444';
              const zoneLabel = absDiff <= 0.05 ? 'On Target' : absDiff <= 0.10 ? 'Slightly Off' : 'Off Target';
              const surplusDeficit = intake - dailyBurn;
              const surplusPct = Math.round((ratio - 1) * 100);

              // Bar heights (normalized)
              const maxVal = Math.max(intake, dailyBurn);
              const burnPct = (dailyBurn / maxVal) * 100;
              const intakePct = (intake / maxVal) * 100;

              // Gauge: centered on target midpoint
              const targetMid = phase === 'bulking' ? 15 : -15;
              const targetIntake = Math.round(dailyBurn * (1 + targetMid / 100));
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
              const calMax = Math.max(intake, dailyBurn, targetIntake) * 1.05;
              const burnH = (dailyBurn / calMax) * barH;
              const intakeH = (intake / calMax) * barH;
              const targetH = (targetIntake / calMax) * barH;

              // Protein bar chart
              const pMax = Math.max(trainingDayProtein, proteinTarget) * 1.1;
              const pTargetBarH = (proteinTarget / pMax) * barH;
              const pIntakeBarH = (trainingDayProtein / pMax) * barH;

              return (
                <div className="glass-card p-5 mb-6 fade-up">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-white">Nutrition Balance</h2>
                    <span className={`text-[10px] font-bold uppercase ${phase === 'bulking' ? 'text-green-400' : 'text-blue-400'}`}>{phase}</span>
                  </div>

                  {/* Gauges row */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {/* Calorie gauge */}
                    <div className="flex flex-col items-center">
                      <div className="relative w-28 h-28 sm:w-32 sm:h-32">
                        <svg className="w-full h-full" viewBox="0 0 100 100" style={{ transform: 'rotate(135deg)' }}>
                          <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="7"
                            strokeDasharray={`${gaugeArc} ${gaugeCirc}`} strokeLinecap="round" />
                          <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke="#22c55e" strokeOpacity="0.25" strokeWidth="7"
                            strokeDasharray={`${greenArcLen} ${gaugeCirc - greenArcLen}`}
                            strokeDashoffset={-((greenStartAngle / 360) * gaugeCirc)} />
                          <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke={zoneColor} strokeWidth="7"
                            strokeDasharray={`${gaugeArc} ${gaugeCirc}`} strokeDashoffset={gaugeOffset}
                            strokeLinecap="round" className="gauge-sweep gauge-glow" style={{ '--gauge-arc': gaugeArc } as React.CSSProperties} />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xl font-bold" style={{ color: zoneColor }}>{surplusPct > 0 ? '+' : ''}{surplusPct}%</span>
                          <span className="text-[8px] text-white/30">target {targetMid > 0 ? '+' : ''}{targetMid}%</span>
                          <span className="text-[9px] font-semibold uppercase" style={{ color: zoneColor }}>{zoneLabel}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-white/40 mt-1">Calories</span>
                    </div>
                    {/* Protein gauge */}
                    <div className="flex flex-col items-center">
                      <div className="relative w-28 h-28 sm:w-32 sm:h-32">
                        <svg className="w-full h-full" viewBox="0 0 100 100" style={{ transform: 'rotate(135deg)' }}>
                          <circle cx="50" cy="50" r={pGaugeRadius} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="7"
                            strokeDasharray={`${pGaugeArc} ${pGaugeCirc}`} strokeLinecap="round" />
                          <circle cx="50" cy="50" r={pGaugeRadius} fill="none" stroke="#22c55e" strokeOpacity="0.25" strokeWidth="7"
                            strokeDasharray={`${pGreenArcLen} ${pGaugeCirc - pGreenArcLen}`}
                            strokeDashoffset={-((pGreenStartAngle / 360) * pGaugeCirc)} />
                          <circle cx="50" cy="50" r={pGaugeRadius} fill="none" stroke={proteinZoneColor} strokeWidth="7"
                            strokeDasharray={`${pGaugeArc} ${pGaugeCirc}`} strokeDashoffset={pGaugeOffset}
                            strokeLinecap="round" className="gauge-sweep gauge-glow" style={{ '--gauge-arc': pGaugeArc } as React.CSSProperties} />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xl font-bold" style={{ color: proteinZoneColor }}>{trainingDayProtein}g</span>
                          <span className="text-[8px] text-white/30">target {proteinTarget}g</span>
                          <span className="text-[9px] font-semibold uppercase" style={{ color: proteinZoneColor }}>{proteinZoneLabel}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-white/40 mt-1">Protein</span>
                    </div>
                  </div>

                  {/* Bar charts row */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Calorie bars */}
                    <div>
                      <svg viewBox="0 0 140 120" className="w-full">
                        <defs>
                          <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
                            <stop offset="100%" stopColor="#f97316" stopOpacity="0.8" />
                          </linearGradient>
                          <linearGradient id="intakeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={zoneColor} stopOpacity="0.9" />
                            <stop offset="100%" stopColor={zoneColor} stopOpacity="0.5" />
                          </linearGradient>
                        </defs>
                        {/* Bars first (behind labels) */}
                        <rect x="22" y={18 + barH - burnH} width="38" height={burnH} rx="6" fill="url(#burnGrad)" />
                        <rect x="68" y={18 + barH - intakeH} width="38" height={intakeH} rx="6" fill="url(#intakeGrad)" />
                        {/* Target line */}
                        {(() => { const tColor = phase === 'bulking' ? '#22c55e' : '#3b82f6'; const tY = 18 + barH - targetH; return (<>
                        <line x1="15" y1={tY} x2="130" y2={tY} stroke={tColor} strokeWidth="1" strokeDasharray="3 2" opacity="0.4" />
                        <text x="130" y={tY - 3} textAnchor="end" fill={tColor} fontSize="6" fontWeight="bold">{targetIntake}</text>
                        </>); })()}
                        {/* Bar value labels (inside bars) */}
                        <text x="41" y={18 + barH - burnH / 2} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">{dailyBurn}</text>
                        <text x="41" y={18 + barH + 12} textAnchor="middle" fill="white" fillOpacity="0.4" fontSize="7">Burn</text>
                        <text x="87" y={18 + barH - intakeH / 2} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">{intake}</text>
                        <text x="87" y={18 + barH - intakeH / 2 + 10} textAnchor="middle" fill={zoneColor} fontSize="7" fontWeight="bold">{intake - targetIntake > 0 ? '+' : ''}{intake - targetIntake}</text>
                        <text x="87" y={18 + barH + 12} textAnchor="middle" fill="white" fillOpacity="0.4" fontSize="7">Intake</text>
                      </svg>
                    </div>
                    {/* Protein bar */}
                    <div>
                      <svg viewBox="0 0 140 120" className="w-full">
                        <defs>
                          <linearGradient id="proteinGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={proteinZoneColor} stopOpacity="0.9" />
                            <stop offset="100%" stopColor={proteinZoneColor} stopOpacity="0.5" />
                          </linearGradient>
                        </defs>
                        {/* Bar first */}
                        <rect x="48" y={18 + barH - pIntakeBarH} width="44" height={pIntakeBarH} rx="6" fill="url(#proteinGrad)" />
                        {/* Target line */}
                        {(() => { const tY = 18 + barH - pTargetBarH; return (<>
                        <line x1="25" y1={tY} x2="130" y2={tY} stroke="#3b82f6" strokeWidth="1" strokeDasharray="3 2" opacity="0.4" />
                        <text x="130" y={tY - 3} textAnchor="end" fill="#3b82f6" fontSize="6" fontWeight="bold">{proteinTarget}g</text>
                        </>); })()}
                        {/* Bar value label (inside bar) */}
                        <text x="70" y={18 + barH - pIntakeBarH / 2} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">{trainingDayProtein}g</text>
                        <text x="70" y={18 + barH - pIntakeBarH / 2 + 10} textAnchor="middle" fill={proteinZoneColor} fontSize="7" fontWeight="bold">{proteinDiff > 0 ? '+' : ''}{proteinDiff}g</text>
                        <text x="70" y={18 + barH + 12} textAnchor="middle" fill="white" fillOpacity="0.4" fontSize="7">Protein</text>
                      </svg>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-white/5 text-xs text-white/30">
                    <div>BMR {bmr}</div>
                    <div>Training +{dailyTrainingAvg}</div>
                    {dailyNeat > 0 && <div>NEAT +{dailyNeat}</div>}
                    <div>{weekSessions.length} sessions</div>
                  </div>
                </div>
              );
            })()}

          {/* Glucose Monitor */}
          {glucose?.current && (() => {
            const { current, history, stats } = glucose;
            const gv = current.value;
            const color = gv < 80 ? '#ef4444' : gv <= 110 ? '#22c55e' : gv <= 160 ? '#f59e0b' : '#ef4444';
            const glabel = gv < 80 ? 'LOW' : gv <= 110 ? 'IN RANGE' : gv <= 160 ? 'ELEVATED' : 'HIGH';
            const gChartW = 500, gChartH = 160;
            const gPad = { top: 5, right: 10, bottom: 20, left: 30 };
            const gIW = gChartW - gPad.left - gPad.right;
            const gIH = gChartH - gPad.top - gPad.bottom;
            const gMn = 50, gMx = 300, gRng = gMx - gMn;
            const toGY = (val: number) => gPad.top + gIH - ((Math.max(gMn, Math.min(gMx, val)) - gMn) / gRng) * gIH;
            const toGX = (i: number) => gPad.left + (i / Math.max(1, history.length - 1)) * gIW;
            const gPts = history.map((h, i) => ({ x: toGX(i), y: toGY(h.value), val: h.value }));
            let gLinePath = '';
            if (gPts.length >= 2) {
              gLinePath = `M ${gPts[0].x} ${gPts[0].y}`;
              for (let i = 0; i < gPts.length - 1; i++) {
                const p0 = gPts[Math.max(0, i - 1)], p1 = gPts[i], p2 = gPts[i + 1], p3 = gPts[Math.min(gPts.length - 1, i + 2)];
                gLinePath += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
              }
            }
            const gZones = [
              { top: toGY(200), bottom: toGY(160), color: '#ef4444', opacity: 0.06 },
              { top: toGY(160), bottom: toGY(110), color: '#f59e0b', opacity: 0.05 },
              { top: toGY(110), bottom: toGY(80), color: '#22c55e', opacity: 0.08 },
              { top: toGY(80), bottom: toGY(50), color: '#ef4444', opacity: 0.06 },
            ];
            const gTimestamps = history.map(h => new Date(h.timestamp));
            const gFmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return (
              <div className="glass-card p-5 mb-6 fade-up">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2"><span className="text-lg">🩸</span> Glucose</h2>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>{glabel}</span>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <div>
                    <span className="text-5xl font-bold data-value" style={{ color }}>{current.value}</span>
                    <span className="text-sm text-white/30 ml-1">mg/dL</span>
                    <div className="text-4xl font-bold mt-1" style={{ color }}>{current.trend}</div>
                  </div>
                  <div className="flex-1" />
                  <div className="flex flex-col gap-1 text-right">
                    <span className="text-xs text-white/30">TIR <span className="text-white/60 font-bold">{stats.timeInRange}%</span></span>
                    <span className="text-xs text-white/30">Avg <span className="text-white/60 font-bold">{stats.avgGlucose}</span></span>
                    <span className="text-xs text-white/30">eA1c <span className="text-white/60 font-bold">{stats.estimatedA1c}%</span></span>
                  </div>
                </div>
                {gPts.length > 2 && (
                  <svg viewBox={`0 0 ${gChartW} ${gChartH}`} className="w-full" style={{ height: '140px' }}>
                    <defs>
                      <linearGradient id="glucoseGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
                      <filter id="glucoseGlow"><feGaussianBlur stdDeviation="1.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                    </defs>
                    {gZones.map((z, i) => <rect key={i} x={gPad.left} y={z.top} width={gIW} height={z.bottom - z.top} fill={z.color} opacity={z.opacity} />)}
                    {[80, 110, 160].map(val => (
                      <g key={val}><line x1={gPad.left} y1={toGY(val)} x2={gPad.left + gIW} y2={toGY(val)} stroke={val === 110 ? '#22c55e' : val === 80 ? '#ef4444' : '#f59e0b'} strokeOpacity="0.2" strokeDasharray="3 3" /><text x={gPad.left - 3} y={toGY(val) + 3} textAnchor="end" fill="white" fillOpacity="0.25" fontSize="7">{val}</text></g>
                    ))}
                    {gLinePath && <path d={`${gLinePath} L ${gPts[gPts.length - 1].x} ${gPad.top + gIH} L ${gPts[0].x} ${gPad.top + gIH} Z`} fill="url(#glucoseGrad)" opacity="0.5" />}
                    {gPts.length >= 2 && gPts.slice(0, -1).map((p, i) => {
                      const p2 = gPts[i + 1], p3 = gPts[Math.min(gPts.length - 1, i + 2)], p0 = gPts[Math.max(0, i - 1)];
                      const segColor = (p.val + p2.val) / 2 < 80 ? '#ef4444' : (p.val + p2.val) / 2 <= 110 ? '#22c55e' : (p.val + p2.val) / 2 <= 160 ? '#f59e0b' : '#ef4444';
                      return <path key={i} d={`M ${p.x} ${p.y} C ${p.x + (p2.x - p0.x) / 6} ${p.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p.x) / 6} ${p2.y - (p3.y - p.y) / 6}, ${p2.x} ${p2.y}`} fill="none" stroke={segColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />;
                    })}
                    {gPts.length > 0 && <circle cx={gPts[gPts.length - 1].x} cy={gPts[gPts.length - 1].y} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />}
                    {gTimestamps[0] && <text x={gPad.left} y={gChartH - 2} fill="white" fillOpacity="0.5" fontSize="10" fontWeight="500">{gFmtTime(gTimestamps[0])}</text>}
                    {gTimestamps[gTimestamps.length - 1] && <text x={gPad.left + gIW} y={gChartH - 2} textAnchor="end" fill="white" fillOpacity="0.5" fontSize="10" fontWeight="500">{gFmtTime(gTimestamps[gTimestamps.length - 1])}</text>}
                    {gTimestamps.length > 2 && (() => { const mi = Math.floor(gTimestamps.length / 2); return <text x={gPad.left + (mi / (gTimestamps.length - 1)) * gIW} y={gChartH - 2} textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="9">{gFmtTime(gTimestamps[mi])}</text>; })()}
                  </svg>
                )}
              </div>
            );
          })()}

          {/* Sleep */}
            {sleepData.length > 0 && (() => {
              const d = sleepData[sleepIdx] || sleepData[0];
              const onTouchStart = (e: React.TouchEvent) => { sleepTouchRef.current = { x: e.touches[0].clientX, t: Date.now() }; };
              const onTouchEnd = (e: React.TouchEvent) => {
                if (!sleepTouchRef.current) return;
                const dx = e.changedTouches[0].clientX - sleepTouchRef.current.x;
                const dt = Date.now() - sleepTouchRef.current.t;
                if (Math.abs(dx) > 40 && dt < 400) {
                  if (dx < 0 && sleepIdx < sleepData.length - 1) setSleepIdx(sleepIdx + 1);
                  if (dx > 0 && sleepIdx > 0) setSleepIdx(sleepIdx - 1);
                }
                sleepTouchRef.current = null;
              };
              const dayLabel = new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
              return (
                <div className="glass-card p-5 mb-6 fade-up overflow-hidden touch-pan-y"
                  onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                      <span className="text-lg">&#9790;</span> Sleep
                    </h2>
                    <span className="text-xs text-white/30">{dayLabel}</span>
                  </div>

                  {/* Dot indicators */}
                  <div className="flex justify-center gap-1.5 mb-3">
                    {sleepData.map((_, i) => (
                      <button key={i} onClick={() => setSleepIdx(i)}
                        className={`rounded-full transition-all ${i === sleepIdx ? 'w-4 h-1.5 bg-white/60' : 'w-1.5 h-1.5 bg-white/15'}`} />
                    ))}
                  </div>

                  <div className="flex items-center gap-4">
                    <SleepMultiRing score={d.score}
                      deepPct={d.totalSleep && d.deepSleep ? Math.round((d.deepSleep / d.totalSleep) * 100) : 0}
                      remPct={d.totalSleep && d.remSleep ? Math.round((d.remSleep / d.totalSleep) * 100) : 0}
                    />
                    <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
                      <div>
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">Total</span>
                        <p className="text-sm font-bold gradient-text data-value">{formatDuration(d.totalSleep)}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">Deep</span>
                        <p className="text-sm font-bold text-indigo-400 data-value" style={{ textShadow: '0 0 8px rgba(129,140,248,0.5)' }}>{formatDuration(d.deepSleep)}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">REM</span>
                        <p className="text-sm font-bold text-cyan-400 data-value">{formatDuration(d.remSleep)}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">Avg HR</span>
                        <p className="text-sm font-bold text-red-400 data-value">{d.avgHr ? `${Math.round(d.avgHr)} bpm` : '—'}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">HRV</span>
                        <p className="text-sm font-bold text-green-400 data-value" style={{ textShadow: '0 0 8px rgba(34,197,94,0.4)' }}>{d.avgHrv ? `${d.avgHrv} ms` : '—'}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase tracking-wider">Efficiency</span>
                        <p className="text-sm font-bold gradient-text data-value">{d.efficiency ? `${d.efficiency}%` : '—'}</p>
                      </div>
                    </div>
                  </div>
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
            // Full history regression for trend line reference
            const n = weeks.length;
            const sumX = weeks.reduce((a, b) => a + b, 0);
            const sumY = weights.reduce((a, b) => a + b, 0);
            const intercept = (sumY - slope * sumX) / n;

            // Projection: extend from last point using trend
            const lastDate = new Date(measurements[measurements.length - 1].date);
            const lastWeek = weeks[weeks.length - 1];
            let projectionWeeks = 0;
            let projectionLabel = '';
            if (targetWeight !== null && slope !== 0) {
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
            const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${padding.top + innerHeight} Z`;

            // Trend line across full data range
            const trendY1 = toY(intercept);
            const trendY2 = toY(intercept + slope * lastWeek);

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
                {/* Header with phase toggle */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">Weight Progress</h2>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-sm text-white/40">
                        {startWeight}kg → {endWeight}kg
                        <span className={`ml-2 font-semibold ${isPositiveProgress ? 'text-green-400' : totalChange === 0 ? 'text-white/40' : 'text-yellow-400'}`}>
                          ({totalChange > 0 ? '+' : ''}{totalChange}kg)
                        </span>
                      </p>
                      {/* Weekly rate pill */}
                      {(() => {
                        const rateColor = phase === 'bulking'
                          ? (slope >= 0.3 && slope <= 0.7 ? '#22c55e' : slope > 0 ? '#f59e0b' : '#ef4444')
                          : (slope <= -0.3 && slope >= -0.7 ? '#22c55e' : slope < 0 ? '#f59e0b' : '#ef4444');
                        const arrow = slope > 0.05 ? '↗' : slope < -0.05 ? '↘' : '→';
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: `${rateColor}20`, color: rateColor, border: `1px solid ${rateColor}30` }}>
                            {arrow} {slope > 0 ? '+' : ''}{slope.toFixed(2)} kg/wk
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-start">
                    {/* Target weight */}
                    {showTargetInput ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={targetInput}
                          onChange={(e) => setTargetInput(e.target.value)}
                          placeholder="kg"
                          className="glass-input w-20 px-3 py-1.5 rounded-lg text-sm text-white text-center"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const v = parseFloat(targetInput);
                              if (v > 0) { setTargetWeight(v); saveSetting('targetWeight', String(v)); }
                              setShowTargetInput(false);
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            const v = parseFloat(targetInput);
                            if (v > 0) { setTargetWeight(v); saveSetting('targetWeight', String(v)); }
                            setShowTargetInput(false);
                          }}
                          className="text-xs text-green-400 hover:text-green-300 px-2 py-1"
                        >Set</button>
                        {targetWeight !== null && (
                          <button
                            onClick={() => { setTargetWeight(null); saveSetting('targetWeight', null); setShowTargetInput(false); }}
                            className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                          >Clear</button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => { setTargetInput(targetWeight ? String(targetWeight) : ''); setShowTargetInput(true); }}
                        className="glass-input px-3 py-1.5 rounded-full text-xs text-white/40 hover:text-white/70 hover:border-white/20 transition-all"
                      >
                        {targetWeight ? `Target ${targetWeight}kg` : 'Set Target'}
                      </button>
                    )}

                    {/* Phase toggle */}
                    <button
                      onClick={togglePhase}
                      className="flex items-center gap-2 glass-input px-4 py-2 rounded-full cursor-pointer hover:border-white/20 transition-all"
                    >
                      <div className={`w-10 h-5 rounded-full relative transition-colors duration-300 ${phase === 'bulking' ? 'bg-green-500/40' : 'bg-blue-500/40'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 ${phase === 'bulking' ? 'left-0.5 bg-green-400' : 'left-[22px] bg-blue-400'}`} />
                      </div>
                      <span className={`text-sm font-semibold uppercase tracking-wider ${phase === 'bulking' ? 'text-green-400' : 'text-blue-400'}`}>
                        {phase}
                      </span>
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
                    <path d={areaPath} fill="url(#dashWeightGrad)" />

                    {/* Projection line (future, subtle) */}
                    {projPoints.length > 0 && (
                      <path d={projPath} fill="none" stroke={accentColor} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
                    )}

                    {/* Main line (solid) */}
                    <path d={linePath} fill="none" stroke="url(#dashLineGrad)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />

                    {/* Data points */}
                    {points.map((p, i) => {
                      const isLast = i === points.length - 1;
                      return (
                        <g key={i}>
                          {isLast && <circle cx={p.x} cy={p.y} r="7" fill={accentColor} opacity="0.12" />}
                          <circle cx={p.x} cy={p.y} r={isLast ? 4 : 2} fill={accentColor} stroke="#fff" strokeWidth={isLast ? 1.5 : 0.8} />
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

                const renderCompositionChart = (
                  data: { week: number; val: number; date: string }[],
                  color: string,
                  label: string,
                  unit: string,
                ) => {
                  if (data.length < 2) return null;
                  const vals = data.map(d => d.val);
                  const mn = Math.min(...vals) - 1;
                  const mx = Math.max(...vals) + 1;
                  const rng = mx - mn || 1;
                  const toCY = (v: number) => cPad.top + cIH - ((v - mn) / rng) * cIH;
                  const pts = data.map(d => ({ x: toCX(d.week), y: toCY(d.val), val: d.val }));
                  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                  const area = `${line} L ${pts[pts.length - 1].x} ${cPad.top + cIH} L ${pts[0].x} ${cPad.top + cIH} Z`;
                  const gradId = `compGrad-${label.replace(/\s/g, '')}`;
                  const glowId = `compGlow-${label.replace(/\s/g, '')}`;

                  // Y-axis labels
                  const yTicks = 5;
                  const yLabelsArr = Array.from({ length: yTicks }, (_, i) => {
                    const val = mn + (rng * i) / (yTicks - 1);
                    return { val: Math.round(val * 10) / 10, y: toCY(val) };
                  });

                  return (
                    <div className="glass-card p-4 card-animate overflow-hidden">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">{label}</h3>
                      </div>
                      <svg viewBox={`0 0 ${cW} ${cH}`} className="w-full">
                        <defs>
                          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                            <stop offset="60%" stopColor={color} stopOpacity="0.08" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                          </linearGradient>
                          <linearGradient id={`${gradId}Line`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
                            <stop offset="100%" stopColor={color} stopOpacity="1" />
                          </linearGradient>
                          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="2" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                          </filter>
                        </defs>

                        {/* Y-axis grid + labels */}
                        {yLabelsArr.map((tick, i) => (
                          <g key={i}>
                            <line x1={cPad.left} y1={tick.y} x2={cW - cPad.right} y2={tick.y} stroke="rgba(255,255,255,0.04)" />
                            <text x={cPad.left - 8} y={tick.y + 3} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize="9">{tick.val}</text>
                          </g>
                        ))}

                        {/* Area + line */}
                        <path d={area} fill={`url(#${gradId})`} />
                        <path d={line} fill="none" stroke={`url(#${gradId}Line)`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" filter={`url(#${glowId})`} />

                        {/* Data points with labels */}
                        {pts.map((p, i) => {
                          const isLast = i === pts.length - 1;
                          const isFirst = i === 0;
                          return (
                            <g key={i}>
                              {isLast && <circle cx={p.x} cy={p.y} r="8" fill={color} opacity="0.12" />}
                              <circle cx={p.x} cy={p.y} r={isLast ? 5 : 3.5} fill={color} stroke="#fff" strokeWidth={isLast ? 2 : 1.5} />
                              {isLast && <text x={p.x} y={p.y - 14} textAnchor="end" fill="white" fontSize="16" fontWeight="bold">{p.val}{unit}</text>}
                              {isFirst && <text x={p.x} y={p.y - 14} textAnchor="start" fill="white" fontSize="14" fontWeight="bold" opacity="0.5">{p.val}{unit}</text>}
                            </g>
                          );
                        })}

                        {/* X-axis date labels */}
                        {data.map((d, i) => {
                          if (i > 0 && i < data.length - 1 && data.length > 3) return null;
                          const x = toCX(d.week);
                          const dateObj = new Date(d.date);
                          return (
                            <text key={i} x={x} y={cH - 5} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9"
                              transform={`rotate(-30 ${x} ${cH - 5})`}>
                              {dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </text>
                          );
                        })}

                        {/* Unit label */}
                        <text x={cPad.left - 10} y={cPad.top - 8} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize="9">{unit}</text>
                      </svg>
                    </div>
                  );
                };

                const bfData = measurements.map((m, i) => m.bodyFat != null ? { week: weeks[i], val: m.bodyFat, date: m.date } : null).filter((d): d is { week: number; val: number; date: string } => d !== null);
                const mmData = measurements.map((m, i) => m.muscleMass != null ? { week: weeks[i], val: m.muscleMass, date: m.date } : null).filter((d): d is { week: number; val: number; date: string } => d !== null);

                if (bfData.length < 2 && mmData.length < 2) return null;
                return (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    {renderCompositionChart(bfData, '#ef4444', 'Body Fat', '%')}
                    {renderCompositionChart(mmData, '#3b82f6', 'Muscle Mass', 'kg')}
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

          {/* Quick Links */}
          <div className="grid md:grid-cols-3 gap-4">
            <Link href="/training-plan" className="glass-card p-6 block relative">
              <DumbbellIcon className="absolute top-4 right-4 w-16 h-16 text-va-red" />
              <div className="relative z-10">
                <div className="w-10 h-10 rounded-xl bg-va-red/15 flex items-center justify-center mb-3">
                  <span className="text-va-red text-lg">&#9670;</span>
                </div>
                <h3 className="text-lg font-semibold text-white">Training Plan</h3>
                <p className="text-sm text-white/40 mt-1">View & edit your workout split</p>
              </div>
            </Link>
            <Link href="/body-metrix" className="glass-card p-6 block relative">
              <ScaleIcon className="absolute top-4 right-4 w-16 h-16 text-blue-400" />
              <div className="relative z-10">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center mb-3">
                  <span className="text-blue-400 text-lg">&#9678;</span>
                </div>
                <h3 className="text-lg font-semibold text-white">Body Metrix</h3>
                <p className="text-sm text-white/40 mt-1">Track measurements & photos</p>
              </div>
            </Link>
            <Link href="/nutrition-plan" className="glass-card p-6 block relative">
              <ForkKnifeIcon className="absolute top-4 right-4 w-16 h-16 text-green-400" />
              <div className="relative z-10">
                <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center mb-3">
                  <span className="text-green-400 text-lg">&#9671;</span>
                </div>
                <h3 className="text-lg font-semibold text-white">Nutrition Plan</h3>
                <p className="text-sm text-white/40 mt-1">Manage your meal plan</p>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
