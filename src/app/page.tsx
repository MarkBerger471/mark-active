'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navigation from '@/components/Navigation';
import Link from 'next/link';
import { getMeasurements, getSetting, saveSetting, getTrainingSessions, getNutritionPlan } from '@/utils/storage';
import { Measurement, TrainingSession, NutritionPlan } from '@/types';
import { calcSessionCalories } from '@/utils/calories';
import { DumbbellIcon, ScaleIcon, ForkKnifeIcon } from '@/components/BackgroundEffects';

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

function SleepScoreRing({ score }: { score: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 85 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative w-24 h-24">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="white" strokeOpacity="0.08" strokeWidth="7" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{score}</span>
        <span className="text-[9px] text-white/30 uppercase">Score</span>
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
  const [sleepExpanded, setSleepExpanded] = useState(false);
  const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([]);
  const [nutritionPlan, setNutritionPlan] = useState<NutritionPlan | null>(null);
  const [dailyActivity, setDailyActivity] = useState<Record<string, { activeCalories: number }>>({});

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
      getSetting('phase').then(v => { if (v) setPhase(v as Phase); });
      getSetting('targetWeight').then(v => { if (v) setTargetWeight(parseFloat(v)); });
      fetch('/api/oura?days=7').then(r => r.json()).then(d => {
        if (d.data) setSleepData(d.data.sort((a: SleepDay, b: SleepDay) => b.day.localeCompare(a.day)));
      }).catch(() => {});
      getTrainingSessions().then(setTrainingSessions);
      getNutritionPlan().then(p => { if (p && 'current' in p) setNutritionPlan(p as NutritionPlan); });
      // Fetch activity data (same as training page - 60 days)
      fetch('/api/oura?days=60').then(r => r.json()).then(d => {
        const act: Record<string, { activeCalories: number }> = {};
        if (d.data) for (const day of d.data) { if (day.activeCalories) act[day.day] = { activeCalories: day.activeCalories }; }
        if (d.activity) for (const day of d.activity) { if (day.activeCalories) act[day.day] = { activeCalories: day.activeCalories }; }
        setDailyActivity(act);
      }).catch(() => {});
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

  const formatChange = (val?: number) => {
    if (val === undefined || val === 0) return null;
    const sign = val > 0 ? '+' : '';
    const colorClass = val > 0 ? 'change-positive' : 'change-negative';
    return <span className={colorClass}>{sign}{val}</span>;
  };

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:ml-64 p-6 pt-32 md:pt-6 pwa-main">
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
            const statCard = (stat: { label: string; value: string; field: 'weight' | 'bodyFat' | 'muscleMass' | 'arms' | 'chest' | 'waist' | 'legs' }) => {
              const curVal = latestMeasurement[stat.field];
              const prevVal = previousMeasurement?.[stat.field];
              const change = (curVal != null && prevVal != null)
                ? Math.round((curVal - prevVal) * 10) / 10
                : undefined;
              return (
                <div key={stat.label} className="glass-card p-4 stat-accent">
                  <p className="text-xs text-white/40 uppercase tracking-wider">{stat.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
                  {change !== undefined && change !== 0 && (
                    <p className="text-sm mt-1">{formatChange(change)}</p>
                  )}
                </div>
              );
            };
            return (
              <div className="flex flex-col gap-4 mb-8">
                {statCard({ label: 'Weight', value: `${latestMeasurement.weight}kg`, field: 'weight' })}
                <div className="grid grid-cols-2 gap-4">
                  {statCard({ label: 'Muscle Mass', value: latestMeasurement.muscleMass != null ? `${latestMeasurement.muscleMass}kg` : '—', field: 'muscleMass' })}
                  {statCard({ label: 'Body Fat', value: latestMeasurement.bodyFat != null ? `${latestMeasurement.bodyFat}%` : '—', field: 'bodyFat' })}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {statCard({ label: 'Chest', value: `${latestMeasurement.chest}cm`, field: 'chest' })}
                  {statCard({ label: 'Waist', value: `${latestMeasurement.waist}cm`, field: 'waist' })}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {statCard({ label: 'Legs', value: `${latestMeasurement.legs}cm`, field: 'legs' })}
                  {statCard({ label: 'Arms', value: `${latestMeasurement.arms}cm`, field: 'arms' })}
                </div>
              </div>
            );
          })()}

          {/* Calorie Balance + Sleep */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {/* Sleep Widget — second on mobile, first on desktop */}
            {sleepData.length > 0 && (() => {
              const last = sleepData[0];
              return (
                <div className="glass-card p-5 order-2 md:order-1">
                  <button
                    onClick={() => setSleepExpanded(!sleepExpanded)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                      <span className="text-lg">&#9790;</span> Sleep
                    </h2>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-white/30">{formatDuration(last.totalSleep)}</span>
                      <span className={`text-white/20 transition-transform duration-200 ${sleepExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-4 mt-3">
                    <SleepScoreRing score={last.score} />
                    <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1">
                      <div>
                        <span className="text-[9px] text-white/30 uppercase">Total</span>
                        <p className="text-xs font-semibold text-white">{formatDuration(last.totalSleep)}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase">Deep</span>
                        <p className="text-xs font-semibold text-indigo-400">{formatDuration(last.deepSleep)}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase">REM</span>
                        <p className="text-xs font-semibold text-cyan-400">{formatDuration(last.remSleep)}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase">Avg HR</span>
                        <p className="text-xs font-semibold text-red-400">{last.avgHr ? `${Math.round(last.avgHr)} bpm` : '—'}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase">HRV</span>
                        <p className="text-xs font-semibold text-green-400">{last.avgHrv ? `${last.avgHrv} ms` : '—'}</p>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase">Efficiency</span>
                        <p className="text-xs font-semibold text-white/70">{last.efficiency ? `${last.efficiency}%` : '—'}</p>
                      </div>
                    </div>
                  </div>

                  {last.totalSleep && last.deepSleep && last.remSleep && last.lightSleep && (
                    <div className="mt-3">
                      <div className="flex rounded-full overflow-hidden h-2">
                        <div className="bg-indigo-500" style={{ width: `${(last.deepSleep / last.totalSleep) * 100}%` }} />
                        <div className="bg-cyan-500" style={{ width: `${(last.remSleep / last.totalSleep) * 100}%` }} />
                        <div className="bg-blue-300/40" style={{ width: `${(last.lightSleep / last.totalSleep) * 100}%` }} />
                      </div>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[9px] text-indigo-400">Deep {Math.round((last.deepSleep / last.totalSleep) * 100)}%</span>
                        <span className="text-[9px] text-cyan-400">REM {Math.round((last.remSleep / last.totalSleep) * 100)}%</span>
                        <span className="text-[9px] text-blue-300/50">Light {Math.round((last.lightSleep / last.totalSleep) * 100)}%</span>
                      </div>
                    </div>
                  )}

                  {sleepExpanded && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="space-y-1.5">
                        {sleepData.map(d => (
                          <div key={d.day} className="flex items-center gap-2 text-xs">
                            <span className="text-white/30 w-14">
                              {new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
                            </span>
                            <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${d.score}%`, backgroundColor: d.score >= 85 ? '#22c55e' : d.score >= 70 ? '#f59e0b' : '#ef4444' }} />
                            </div>
                            <span className="text-white/50 w-6 text-right font-semibold">{d.score}</span>
                            <span className="text-white/30 w-12 text-right">{formatDuration(d.totalSleep)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Calorie Balance Chart */}
            {(() => {
              const bmr = latestMeasurement?.bmr;
              const bodyWeight = latestMeasurement?.weight || 80;
              const trainingDayKcal = nutritionPlan?.current.trainingDay.macros.kcal;
              if (!bmr || !trainingDayKcal || trainingSessions.length === 0) return null;

              // Exact same logic as training page getWeekKey + TDEE calc
              const getWk = (dateStr: string) => {
                const dd = new Date(dateStr);
                const day = dd.getDay();
                const diff = dd.getDate() - day + (day === 0 ? -6 : 1);
                const mon = new Date(dd.setDate(diff));
                return mon.toISOString().split('T')[0];
              };
              const now = new Date();
              const todayStr = now.toISOString().split('T')[0];
              const currentWeekKey = getWk(todayStr);
              const wkMonday = new Date(currentWeekKey + 'T00:00:00');
              const daysInWeek = Math.max(1, Math.min(7, Math.floor((now.getTime() - wkMonday.getTime()) / 86400000) + 1));

              const weekSessions = trainingSessions.filter(s => getWk(s.date) === currentWeekKey);
              const weekTrainingCals = weekSessions.reduce((sum, s) => sum + calcSessionCalories(s, bodyWeight), 0);
              const dailyTrainingAvg = Math.round(weekTrainingCals / daysInWeek);

              // NEAT from Oura activeCalories
              let totalActiveCals = 0, actDays = 0;
              for (let i = 0; i < daysInWeek; i++) {
                const d = new Date(wkMonday);
                d.setDate(d.getDate() + i);
                const dayStr = d.toISOString().split('T')[0];
                const act = dailyActivity[dayStr];
                if (act && act.activeCalories > 0) { totalActiveCals += act.activeCalories; actDays++; }
              }
              const dailyNeat = actDays > 0 ? Math.round(totalActiveCals / actDays) : 0;
              const dailyBurn = bmr + dailyTrainingAvg + dailyNeat;

              // Calculate Sunday cheat meal adjustment
              // Last meal replaced with 1300 kcal cheat on Sunday
              // Meal 5: egg white 150g(78) + egg 2×60g(186) + rye bread 200g(530) + whey 25g(100) ≈ 894 kcal
              const KCAL_PER_100G: Record<string, number> = {
                'egg white': 52, 'egg': 155, 'whey': 400, 'bread': 265, 'rye bread': 265,
                'whole rye bread': 265, 'chicken': 165, 'fish': 120, 'beef': 250, 'rice': 130,
                'greek yogurt': 59, 'oatmeal': 389, 'cheese': 403, 'feta': 264, 'cottage cheese': 98,
                'cream of rice': 370, 'olive oil': 884, 'nuts': 607, 'berries': 57, 'banana': 89,
              };
              const PIECE_G: Record<string, number> = { 'egg': 60, 'banana': 120 };
              const meals = nutritionPlan?.current.trainingDay.meals || [];
              let lastMealKcal = 0;
              if (meals.length > 0) {
                const lastMeal = meals[meals.length - 1];
                for (const item of lastMeal.items) {
                  const name = (item.name || '').toLowerCase().trim();
                  const amount = item.amount || '';
                  // Find kcal/100g
                  let per100 = 0;
                  for (const [key, val] of Object.entries(KCAL_PER_100G)) {
                    if (name.includes(key) || key.includes(name)) { per100 = val; break; }
                  }
                  if (per100 === 0) continue;
                  // Parse grams
                  const gMatch = amount.match(/([\d.]+)\s*(?:gr?|ml)/i);
                  const bare = amount.match(/^([\d.]+)$/);
                  let grams = 0;
                  if (gMatch) { grams = parseFloat(gMatch[1]); }
                  else if (bare) {
                    const pw = Object.entries(PIECE_G).find(([k]) => name.includes(k));
                    grams = pw ? parseFloat(bare[1]) * pw[1] : parseFloat(bare[1]);
                  }
                  lastMealKcal += Math.round(per100 * grams / 100);
                }
              }
              if (lastMealKcal === 0 && meals.length > 0) lastMealKcal = Math.round(trainingDayKcal / meals.length);
              const cheatMealKcal = 1300;
              const sundayDiff = cheatMealKcal - lastMealKcal;
              // Weekly: 6 normal days + 1 Sunday with cheat
              const weeklyIntake = trainingDayKcal * 7 + sundayDiff;
              const intake = Math.round(weeklyIntake / 7);
              const ratio = intake / dailyBurn;
              const targetRatio = phase === 'bulking' ? 1.15 : 0.85; // +15% or -15%
              const diff = ratio - targetRatio;
              const absDiff = Math.abs(diff);

              // Green: within ±2% of target, Yellow: ±2-5%, Red: beyond ±5%
              const zoneColor = absDiff <= 0.02 ? '#22c55e' : absDiff <= 0.05 ? '#f59e0b' : '#ef4444';
              const zoneLabel = absDiff <= 0.02 ? 'On Target' : absDiff <= 0.05 ? 'Slightly Off' : 'Off Target';
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
              const greenLow = -2, greenHigh = 2;
              const greenStartAngle = ((greenLow - gaugeMin) / (gaugeMax - gaugeMin)) * 270;
              const greenEndAngle = ((greenHigh - gaugeMin) / (gaugeMax - gaugeMin)) * 270;
              const greenArcLen = ((greenEndAngle - greenStartAngle) / 360) * gaugeCirc;

              // Bar chart dimensions
              const barH = 80;
              const calMax = Math.max(intake, dailyBurn, targetIntake) * 1.05;
              const burnH = (dailyBurn / calMax) * barH;
              const intakeH = (intake / calMax) * barH;
              const targetH = (targetIntake / calMax) * barH;

              return (
                <div className="glass-card p-5 order-1 md:order-2">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-white">Calorie Balance</h2>
                    <span className={`text-[10px] font-bold uppercase ${phase === 'bulking' ? 'text-green-400' : 'text-blue-400'}`}>{phase}</span>
                  </div>

                  <div className="flex items-center gap-4 max-h-48">
                    {/* Gauge */}
                    <div className="relative w-28 h-28 shrink-0">
                      <svg className="w-28 h-28" viewBox="0 0 100 100" style={{ transform: 'rotate(135deg)' }}>
                        {/* Background arc */}
                        <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke="white" strokeOpacity="0.06" strokeWidth="8"
                          strokeDasharray={`${gaugeArc} ${gaugeCirc}`} strokeLinecap="round" />
                        {/* Green target zone (±2% from target) */}
                        <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke="#22c55e" strokeOpacity="0.25" strokeWidth="8"
                          strokeDasharray={`${greenArcLen} ${gaugeCirc - greenArcLen}`}
                          strokeDashoffset={-((greenStartAngle / 360) * gaugeCirc)} />
                        {/* Value arc */}
                        <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke={zoneColor} strokeWidth="8"
                          strokeDasharray={`${gaugeArc} ${gaugeCirc}`} strokeDashoffset={gaugeOffset}
                          strokeLinecap="round" className="transition-all duration-700" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold" style={{ color: zoneColor }}>{surplusPct > 0 ? '+' : ''}{surplusPct}%</span>
                        <span className="text-[7px] text-white/30">target {targetMid > 0 ? '+' : ''}{targetMid}%</span>
                        <span className="text-[8px] uppercase" style={{ color: zoneColor }}>{zoneLabel}</span>
                      </div>
                    </div>

                    {/* Bar chart */}
                    <div className="flex-1">
                      <svg viewBox="0 0 160 130" className="w-full max-h-40">
                        {/* Target line */}
                        {(() => { const tColor = phase === 'bulking' ? '#22c55e' : '#3b82f6'; return (<>
                        <line x1="5" y1={18 + barH - targetH} x2="115" y2={18 + barH - targetH} stroke={tColor} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />
                        <text x="118" y={18 + barH - targetH + 4} textAnchor="start" fill={tColor} fontSize="10" fontWeight="bold">{targetIntake}</text>
                        </>); })()}
                        {/* Burn bar */}
                        <rect x="10" y={18 + barH - burnH} width="45" height={burnH} rx="5" fill="#f97316" fillOpacity="0.7" />
                        <text x="32" y={18 + barH - burnH - 5} textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">{dailyBurn}</text>
                        <text x="32" y={18 + barH + 14} textAnchor="middle" fill="white" fillOpacity="0.4" fontSize="10">Burn</text>
                        {/* Intake bar */}
                        <rect x="62" y={18 + barH - intakeH} width="45" height={intakeH} rx="5" fill={zoneColor} fillOpacity="0.7" />
                        <text x="84" y={18 + barH - intakeH - 5} textAnchor="middle" fill="white" fontSize="12" fontWeight="bold">{intake}</text>
                        <text x="84" y={18 + barH + 14} textAnchor="middle" fill="white" fillOpacity="0.4" fontSize="10">Intake</text>
                      </svg>
                    </div>
                  </div>

                  {/* Status line */}
                  <div className="text-center mt-2">
                    <p className="text-[11px] text-white/40">
                      {intake - targetIntake > 0 ? '+' : ''}{intake - targetIntake} kcal vs target
                      <span className="text-white/25 ml-2">({phase === 'bulking' ? '+10% to +20%' : '-20% to -10%'})</span>
                    </p>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-white/5 text-[10px] text-white/30">
                    <div>BMR {bmr}</div>
                    <div>Training +{Math.round(weekTrainingCals / daysInWeek)}</div>
                    {dailyNeat > 0 && <div>NEAT +{dailyNeat}</div>}
                    <div>{weekSessions.length} sessions</div>
                  </div>
                </div>
              );
            })()}
          </div>

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
            const n = weeks.length;
            const sumX = weeks.reduce((a, b) => a + b, 0);
            const sumY = weights.reduce((a, b) => a + b, 0);
            const sumXY = weeks.reduce((a, x, i) => a + x * weights[i], 0);
            const sumX2 = weeks.reduce((a, x) => a + x * x, 0);
            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX); // kg per week
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
            const hasBf = measurements.some(m => m.bodyFat != null);
            const hasMm = measurements.some(m => m.muscleMass != null);
            const hasSecondary = hasBf || hasMm;
            const padding = { top: 30, right: (hasBf && hasMm) ? 140 : hasSecondary ? 80 : 60, bottom: 44, left: 54 };
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

            const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
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
              <div className="glass-strong p-6 mb-8">
                {/* Header with phase toggle */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Weight Progress</h2>
                    <p className="text-sm text-white/40 mt-0.5">
                      {startWeight}kg → {endWeight}kg
                      <span className={`ml-2 font-semibold ${isPositiveProgress ? 'text-green-400' : totalChange === 0 ? 'text-white/40' : 'text-yellow-400'}`}>
                        ({totalChange > 0 ? '+' : ''}{totalChange}kg)
                      </span>
                    </p>
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
                        className="flex items-center gap-1.5 glass-input px-3 py-1.5 rounded-full text-xs text-white/50 hover:text-white/80 hover:border-white/20 transition-all"
                      >
                        🎯 {targetWeight ? `${targetWeight}kg` : 'Set Target'}
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

                {/* Motivational message */}
                <div className={`rounded-xl px-4 py-2.5 mb-4 border ${isPositiveProgress ? 'bg-green-500/10 border-green-500/20' : totalChange === 0 ? 'bg-white/5 border-white/10' : 'bg-yellow-500/10 border-yellow-500/20'}`}>
                  <p className={`text-sm font-medium ${isPositiveProgress ? 'text-green-400' : totalChange === 0 ? 'text-white/50' : 'text-yellow-400'}`}>
                    {isPositiveProgress
                      ? phase === 'bulking'
                        ? `You gained ${Math.abs(totalChange)}kg — keep pushing, the gains are real!`
                        : `You dropped ${Math.abs(totalChange)}kg — shredding it, stay disciplined!`
                      : totalChange === 0
                        ? 'Holding steady — time to dial in and make moves!'
                        : phase === 'bulking'
                          ? `Down ${Math.abs(totalChange)}kg — eat more, train harder, you got this!`
                          : `Up ${Math.abs(totalChange)}kg — tighten up the diet, the cut will come!`
                    }
                  </p>
                </div>

                {/* Target info */}
                {targetWeight !== null && projectionWeeks > 0 && (() => {
                  // Calculate previous projection (without last measurement) to show date shift
                  let dateDiffWeeks = 0;
                  if (measurements.length >= 3) {
                    const prevMeasurements = measurements.slice(0, -1);
                    const prevWeights = prevMeasurements.map(m => m.weight);
                    const prevDates = prevMeasurements.map(m => new Date(m.date).getTime());
                    const prevFirstDate = prevDates[0];
                    const prevWeeksArr = prevDates.map(d => (d - prevFirstDate) / (7 * 24 * 60 * 60 * 1000));
                    const pn = prevWeeksArr.length;
                    const pSumX = prevWeeksArr.reduce((a, b) => a + b, 0);
                    const pSumY = prevWeights.reduce((a, b) => a + b, 0);
                    const pSumXY = prevWeeksArr.reduce((a, x, i) => a + x * prevWeights[i], 0);
                    const pSumX2 = prevWeeksArr.reduce((a, x) => a + x * x, 0);
                    const prevSlope = (pn * pSumXY - pSumX * pSumY) / (pn * pSumX2 - pSumX * pSumX);
                    if (prevSlope !== 0) {
                      const prevEndWeight = prevWeights[prevWeights.length - 1];
                      const prevLastDate = new Date(prevMeasurements[prevMeasurements.length - 1].date);
                      const prevWeeksToTarget = (targetWeight - prevEndWeight) / prevSlope;
                      if (prevWeeksToTarget > 0) {
                        const prevTargetDate = prevLastDate.getTime() + prevWeeksToTarget * 7 * 24 * 60 * 60 * 1000;
                        const currentWeeksToTarget = (targetWeight - endWeight) / slope;
                        const currentTargetDate = lastDate.getTime() + currentWeeksToTarget * 7 * 24 * 60 * 60 * 1000;
                        dateDiffWeeks = Math.round((currentTargetDate - prevTargetDate) / (7 * 24 * 60 * 60 * 1000));
                      }
                    }
                  }
                  const dateDiffColor = dateDiffWeeks < 0 ? 'text-green-400' : dateDiffWeeks > 0 ? 'text-red-400' : 'text-white/40';
                  const absDiff = Math.abs(dateDiffWeeks);
                  const dateDiffLabel = absDiff === 1 ? '1 week' : `${absDiff} weeks`;
                  return (
                  <div className="rounded-xl px-4 py-2.5 mb-4 border bg-white/5 border-white/10">
                    <p className="text-sm text-white/60">
                      Target <span className="text-white font-semibold">{targetWeight}kg</span>
                      {' — '}at current trend ({slope > 0 ? '+' : ''}{(slope).toFixed(2)}kg/week), reaching by{' '}
                      <span className="text-white font-semibold">{projectionLabel}</span>
                      {' '}(~{projectionWeeks} weeks)
                      {dateDiffWeeks !== 0 && (
                        <span className={`ml-2 font-semibold ${dateDiffColor}`}>
                          {dateDiffWeeks < 0 ? `${dateDiffLabel} earlier` : `${dateDiffLabel} later`}
                        </span>
                      )}
                    </p>
                  </div>
                  );
                })()}
                {targetWeight !== null && projectionWeeks === 0 && slope !== 0 && (
                  <div className="rounded-xl px-4 py-2.5 mb-4 border bg-yellow-500/10 border-yellow-500/20">
                    <p className="text-sm text-yellow-400">
                      Target {targetWeight}kg — current trend goes the wrong direction. {phase === 'bulking' ? 'Keep gaining!' : 'Keep cutting!'}
                    </p>
                  </div>
                )}

                {/* Chart */}
                <div className="overflow-x-auto">
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full" style={{ minWidth: '340px' }}>
                    {/* Y-axis grid + labels */}
                    {yLabels.map((tick, i) => (
                      <g key={i}>
                        <line x1={padding.left} y1={tick.y} x2={chartWidth - padding.right} y2={tick.y} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                        <text x={padding.left - 10} y={tick.y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10">{tick.val}</text>
                      </g>
                    ))}

                    {/* Target weight line */}
                    {targetWeight !== null && (
                      <g>
                        <line x1={padding.left} y1={toY(targetWeight)} x2={chartWidth - padding.right} y2={toY(targetWeight)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
                        <text x={chartWidth - padding.right + 4} y={toY(targetWeight) + 4} fill="#f59e0b" fontSize="10" fontWeight="bold">{targetWeight}kg</text>
                      </g>
                    )}

                    {/* Gradient defs */}
                    <defs>
                      <linearGradient id="dashWeightGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={accentColor} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="dashLineGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={accentColor} stopOpacity="0.5" />
                        <stop offset="100%" stopColor={accentColor} stopOpacity="1" />
                      </linearGradient>
                      <linearGradient id="dashBfGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#b90a0a" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#b90a0a" stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="dashMmGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Body Fat % curve (secondary axis) */}
                    {(() => {
                      const bfData = measurements
                        .map((m, i) => m.bodyFat != null ? { week: weeks[i], val: m.bodyFat, date: m.date } : null)
                        .filter((d): d is { week: number; val: number; date: string } => d !== null);
                      if (bfData.length < 2) return null;

                      const bfMin = Math.min(...bfData.map(d => d.val)) - 0.5;
                      const bfMax = Math.max(...bfData.map(d => d.val)) + 0.5;
                      const bfRange = bfMax - bfMin || 1;
                      // When MM is also shown, BF% uses the top half of the chart
                      const bfTop = padding.top;
                      const bfBottom = hasMm ? padding.top + innerHeight * 0.45 : padding.top + innerHeight;
                      const bfHeight = bfBottom - bfTop;
                      const toBfY = (v: number) => bfBottom - ((v - bfMin) / bfRange) * bfHeight;

                      const bfPoints = bfData.map(d => ({ x: toX(d.week), y: toBfY(d.val), val: d.val }));
                      const bfLine = bfPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

                      const bfColor = '#b90a0a';
                      const bfTicks = 4;
                      const bfLabels = Array.from({ length: bfTicks }, (_, i) => {
                        const val = bfMin + (bfRange * i) / (bfTicks - 1);
                        return { val: Math.round(val * 10) / 10, y: toBfY(val) };
                      });

                      return (
                        <g>
                          {/* Right Y-axis labels */}
                          {bfLabels.map((tick, i) => (
                            <text key={`bf-y-${i}`} x={chartWidth - padding.right + 10} y={tick.y + 4} textAnchor="start" fill={bfColor} fontSize="9" opacity="0.6">{tick.val}%</text>
                          ))}
                          <text x={chartWidth - padding.right + 10} y={padding.top - 10} textAnchor="start" fill={bfColor} fontSize="9" opacity="0.4">BF%</text>

                          {/* Area fill */}
                          <path d={`${bfLine} L ${bfPoints[bfPoints.length - 1].x} ${bfBottom} L ${bfPoints[0].x} ${bfBottom} Z`} fill="url(#dashBfGrad)" />

                          {/* Line */}
                          <path d={bfLine} fill="none" stroke={bfColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />

                          {/* Points */}
                          {bfPoints.map((p, i) => {
                            const isLast = i === bfPoints.length - 1;
                            const isFirst = i === 0;
                            return (
                              <g key={`bf-${i}`}>
                                <circle cx={p.x} cy={p.y} r={isLast ? 4 : 2.5} fill={bfColor} stroke="#fff" strokeWidth={isLast ? 1.5 : 1} opacity="0.8" />
                                {(isFirst || isLast) && (
                                  <text x={p.x + (isLast ? -4 : 4)} y={p.y - 10} textAnchor={isLast ? 'end' : 'start'} fill={bfColor} fontSize="10" fontWeight="bold">{p.val}%</text>
                                )}
                              </g>
                            );
                          })}
                        </g>
                      );
                    })()}

                    {/* Muscle Mass curve (secondary axis) */}
                    {(() => {
                      const mmData = measurements
                        .map((m, i) => m.muscleMass != null ? { week: weeks[i], val: m.muscleMass, date: m.date } : null)
                        .filter((d): d is { week: number; val: number; date: string } => d !== null);
                      if (mmData.length < 2) return null;

                      const mmMin = Math.min(...mmData.map(d => d.val)) - 0.5;
                      const mmMax = Math.max(...mmData.map(d => d.val)) + 0.5;
                      const mmRange = mmMax - mmMin || 1;
                      // When BF% is also shown, MM uses the bottom half of the chart
                      const mmTop = hasBf ? padding.top + innerHeight * 0.55 : padding.top;
                      const mmBottom = padding.top + innerHeight;
                      const mmHeight = mmBottom - mmTop;
                      const toMmY = (v: number) => mmBottom - ((v - mmMin) / mmRange) * mmHeight;

                      const mmPoints = mmData.map(d => ({ x: toX(d.week), y: toMmY(d.val), val: d.val }));
                      const mmLine = mmPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

                      const mmColor = '#3b82f6';
                      const mmTicks = 4;
                      const mmLabels = Array.from({ length: mmTicks }, (_, i) => {
                        const val = mmMin + (mmRange * i) / (mmTicks - 1);
                        return { val: Math.round(val * 10) / 10, y: toMmY(val) };
                      });

                      // Offset right axis if BF% is also shown
                      const mmAxisX = hasBf ? chartWidth - padding.right + 75 : chartWidth - padding.right + 10;

                      return (
                        <g>
                          {mmLabels.map((tick, i) => (
                            <text key={`mm-y-${i}`} x={mmAxisX} y={tick.y + 4} textAnchor="start" fill={mmColor} fontSize="9" opacity="0.6">{tick.val}</text>
                          ))}
                          <text x={mmAxisX} y={padding.top - 10} textAnchor="start" fill={mmColor} fontSize="9" opacity="0.4">MM kg</text>

                          <path d={`${mmLine} L ${mmPoints[mmPoints.length - 1].x} ${padding.top + innerHeight} L ${mmPoints[0].x} ${padding.top + innerHeight} Z`} fill="url(#dashMmGrad)" />
                          <path d={mmLine} fill="none" stroke={mmColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />

                          {mmPoints.map((p, i) => {
                            const isLast = i === mmPoints.length - 1;
                            const isFirst = i === 0;
                            return (
                              <g key={`mm-${i}`}>
                                <circle cx={p.x} cy={p.y} r={isLast ? 4 : 2.5} fill={mmColor} stroke="#fff" strokeWidth={isLast ? 1.5 : 1} opacity="0.8" />
                                {(isFirst || isLast) && (
                                  <text x={p.x + (isLast ? -4 : 4)} y={p.y - 10} textAnchor={isLast ? 'end' : 'start'} fill={mmColor} fontSize="10" fontWeight="bold">{p.val}kg</text>
                                )}
                              </g>
                            );
                          })}
                        </g>
                      );
                    })()}

                    {/* Area fill */}
                    <path d={areaPath} fill="url(#dashWeightGrad)" />

                    {/* Trend line (historical) */}
                    <line
                      x1={points[0].x} y1={trendY1}
                      x2={points[points.length - 1].x} y2={trendY2}
                      stroke={accentColor}
                      strokeWidth="1.5"
                      strokeDasharray="6 4"
                      opacity="0.4"
                    />

                    {/* Projection line (future) */}
                    {projPoints.length > 0 && (
                      <path d={projPath} fill="none" stroke={accentColor} strokeWidth="2" strokeDasharray="6 4" opacity="0.5" />
                    )}

                    {/* Main line (solid) */}
                    <path d={linePath} fill="none" stroke="url(#dashLineGrad)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

                    {/* Data points */}
                    {points.map((p, i) => {
                      const isLast = i === points.length - 1;
                      const isFirst = i === 0;
                      return (
                        <g key={i}>
                          {isLast && <circle cx={p.x} cy={p.y} r="8" fill={accentColor} opacity="0.15" />}
                          <circle cx={p.x} cy={p.y} r={isLast ? 5 : 3.5} fill={accentColor} stroke="#fff" strokeWidth={isLast ? 2 : 1.5} />
                          {(isFirst || isLast) && (
                            <text x={p.x} y={p.y - 12} textAnchor={isLast ? 'end' : 'start'} fill="white" fontSize="11" fontWeight="bold">{p.val}kg</text>
                          )}
                        </g>
                      );
                    })}

                    {/* Projection endpoint */}
                    {projPoints.length > 0 && (() => {
                      const last = projPathPoints[projPathPoints.length - 1];
                      const lastProj = projPoints[projPoints.length - 1];
                      return (
                        <g>
                          <circle cx={last.x} cy={last.y} r="4" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
                          <text x={last.x} y={last.y - 10} textAnchor="end" fill="#f59e0b" fontSize="10" fontWeight="bold">
                            {Math.round(lastProj.weight * 10) / 10}kg
                          </text>
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
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-white/30 mb-2 text-center">
                            {new Date(previousMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {previousMeasurement.photos.front ? (
                              <img src={previousMeasurement.photos.front} alt="Front previous" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-white/30 mb-2 text-center">
                            {new Date(latestMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {latestMeasurement.photos.front ? (
                              <img src={latestMeasurement.photos.front} alt="Front current" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Back comparison */}
                  {(previousMeasurement.photos.back || latestMeasurement.photos.back) && (
                    <div>
                      <h3 className="text-sm font-medium text-white/50 uppercase tracking-wider mb-3">Back</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-white/30 mb-2 text-center">
                            {new Date(previousMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {previousMeasurement.photos.back ? (
                              <img src={previousMeasurement.photos.back} alt="Back previous" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-white/30 mb-2 text-center">
                            {new Date(latestMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                            {latestMeasurement.photos.back ? (
                              <img src={latestMeasurement.photos.back} alt="Back current" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white/20 text-sm">No photo</div>
                            )}
                          </div>
                        </div>
                      </div>
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
