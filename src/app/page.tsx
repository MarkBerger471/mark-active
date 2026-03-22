'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navigation from '@/components/Navigation';
import Link from 'next/link';
import { getMeasurements } from '@/utils/storage';
import { Measurement } from '@/types';
import { DumbbellIcon, ScaleIcon, ForkKnifeIcon } from '@/components/BackgroundEffects';

type Phase = 'bulking' | 'cutting';

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [latestMeasurement, setLatestMeasurement] = useState<Measurement | null>(null);
  const [previousMeasurement, setPreviousMeasurement] = useState<Measurement | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('bb_phase') as Phase) || 'bulking';
    }
    return 'bulking';
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      const all = getMeasurements();
      setMeasurements(all);
      if (all.length > 0) {
        setLatestMeasurement(all[all.length - 1]);
        if (all.length > 1) {
          setPreviousMeasurement(all[all.length - 2]);
        }
      }
    }
  }, [isAuthenticated]);

  const togglePhase = () => {
    const next = phase === 'bulking' ? 'cutting' : 'bulking';
    setPhase(next);
    localStorage.setItem('bb_phase', next);
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
      <main className="md:ml-64 p-6 pb-24 md:pb-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8 relative">
            <DumbbellIcon className="absolute -top-2 right-0 w-24 h-24 text-white opacity-[0.04] pointer-events-none" />
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
            <p className="text-white/40 mt-1">Your bodybuilding progress at a glance</p>
          </div>

          {/* Quick Stats */}
          {latestMeasurement && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              {([
                { label: 'Weight', value: `${latestMeasurement.weight}kg`, field: 'weight' as const },
                { label: 'Arms', value: `${latestMeasurement.arms}cm`, field: 'arms' as const },
                { label: 'Chest', value: `${latestMeasurement.chest}cm`, field: 'chest' as const },
                { label: 'Waist', value: `${latestMeasurement.waist}cm`, field: 'waist' as const },
                { label: 'Legs', value: `${latestMeasurement.legs}cm`, field: 'legs' as const },
              ]).map((stat) => {
                const change = previousMeasurement
                  ? Math.round((latestMeasurement[stat.field] - previousMeasurement[stat.field]) * 10) / 10
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
              })}
            </div>
          )}

          {/* Weight Progress Chart */}
          {measurements.length >= 2 && (() => {
            const chartWidth = 700;
            const chartHeight = 220;
            const padding = { top: 30, right: 24, bottom: 44, left: 54 };
            const innerWidth = chartWidth - padding.left - padding.right;
            const innerHeight = chartHeight - padding.top - padding.bottom;

            const weights = measurements.map(m => m.weight);
            const minW = Math.min(...weights) - 1;
            const maxW = Math.max(...weights) + 1;
            const rangeW = maxW - minW || 1;
            const startWeight = weights[0];
            const endWeight = weights[weights.length - 1];
            const totalChange = Math.round((endWeight - startWeight) * 10) / 10;

            // Progress logic: bulking = weight up is good, cutting = weight down is good
            const isPositiveProgress = phase === 'bulking' ? totalChange > 0 : totalChange < 0;
            const progressColor = isPositiveProgress ? '#22c55e' : totalChange === 0 ? '#94a3b8' : '#f59e0b';
            const accentColor = phase === 'bulking' ? '#22c55e' : '#3b82f6';

            const points = measurements.map((m, i) => {
              const x = padding.left + (measurements.length === 1 ? innerWidth / 2 : (i / (measurements.length - 1)) * innerWidth);
              const y = padding.top + innerHeight - ((m.weight - minW) / rangeW) * innerHeight;
              return { x, y, val: m.weight, date: m.date };
            });

            const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${padding.top + innerHeight} Z`;

            const yTicks = 5;
            const yLabels = Array.from({ length: yTicks }, (_, i) => {
              const val = minW + (rangeW * i) / (yTicks - 1);
              return { val: Math.round(val * 10) / 10, y: padding.top + innerHeight - (i / (yTicks - 1)) * innerHeight };
            });

            // Trend line (first to last)
            const trendY1 = points[0].y;
            const trendY2 = points[points.length - 1].y;

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

                  {/* Phase toggle */}
                  <button
                    onClick={togglePhase}
                    className="flex items-center gap-2 glass-input px-4 py-2 rounded-full cursor-pointer hover:border-white/20 transition-all self-start"
                  >
                    <div className={`w-10 h-5 rounded-full relative transition-colors duration-300 ${phase === 'bulking' ? 'bg-green-500/40' : 'bg-blue-500/40'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 ${phase === 'bulking' ? 'left-0.5 bg-green-400' : 'left-[22px] bg-blue-400'}`} />
                    </div>
                    <span className={`text-sm font-semibold uppercase tracking-wider ${phase === 'bulking' ? 'text-green-400' : 'text-blue-400'}`}>
                      {phase}
                    </span>
                  </button>
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
                    </defs>

                    {/* Area fill */}
                    <path d={areaPath} fill="url(#dashWeightGrad)" />

                    {/* Trend line */}
                    <line
                      x1={points[0].x} y1={trendY1}
                      x2={points[points.length - 1].x} y2={trendY2}
                      stroke={progressColor}
                      strokeWidth="1.5"
                      strokeDasharray="6 4"
                      opacity="0.5"
                    />

                    {/* Main line */}
                    <path d={linePath} fill="none" stroke="url(#dashLineGrad)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

                    {/* Data points */}
                    {points.map((p, i) => {
                      const isLast = i === points.length - 1;
                      const isFirst = i === 0;
                      return (
                        <g key={i}>
                          {isLast && <circle cx={p.x} cy={p.y} r="8" fill={accentColor} opacity="0.15" />}
                          <circle cx={p.x} cy={p.y} r={isLast ? 5 : 3.5} fill={isLast ? accentColor : accentColor} stroke="#fff" strokeWidth={isLast ? 2 : 1.5} />
                          {(isFirst || isLast) && (
                            <text x={p.x} y={p.y - 12} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">{p.val}kg</text>
                          )}
                          {(isFirst || isLast || measurements.length <= 10 || i % Math.ceil(measurements.length / 8) === 0) && (
                            <text x={p.x} y={chartHeight - 6} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" transform={`rotate(-30, ${p.x}, ${chartHeight - 6})`}>
                              {new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* kg label */}
                    <text x={padding.left - 10} y={padding.top - 10} textAnchor="end" fill="rgba(255,255,255,0.2)" fontSize="9">kg</text>
                  </svg>
                </div>
              </div>
            );
          })()}

          {/* Latest Photos */}
          {latestMeasurement?.photos && Object.values(latestMeasurement.photos).some(Boolean) && (
            <div className="glass p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  Latest Progress — {new Date(latestMeasurement.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </h2>
                <button
                  onClick={() => setShowPhotos(!showPhotos)}
                  className="btn-secondary text-sm px-4 py-2"
                >
                  {showPhotos ? 'Hide Photos' : 'Show Photos'}
                </button>
              </div>
              {showPhotos && (
                <div className="photo-grid">
                  {(['front', 'sideLeft', 'back', 'sideRight'] as const).map((angle) => {
                    const src = latestMeasurement.photos[angle];
                    if (!src) return null;
                    return (
                      <div key={angle} className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                        <img
                          src={src}
                          alt={angle}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    );
                  })}
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
