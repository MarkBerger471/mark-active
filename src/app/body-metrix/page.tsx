'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { getMeasurements, saveMeasurement, deleteMeasurement, fileToBase64 } from '@/utils/storage';
import { Measurement } from '@/types';
import SliderField from '@/components/SliderField';

export default function BodyMetrix() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [expandedPhotos, setExpandedPhotos] = useState<string | null>(null);

  // Form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [arms, setArms] = useState('');
  const [chest, setChest] = useState('');
  const [waist, setWaist] = useState('');
  const [legs, setLegs] = useState('');
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [energy, setEnergy] = useState('');
  const [hunger, setHunger] = useState('');
  const [tiredness, setTiredness] = useState('');
  const [digestion, setDigestion] = useState('');
  const [sleepHours, setSleepHours] = useState(7.5);
  const [cardio, setCardio] = useState(5);
  const [trainings, setTrainings] = useState(5);
  const [foodChanges, setFoodChanges] = useState(95);
  const [photos, setPhotos] = useState<{ front?: string; sideLeft?: string; sideRight?: string; back?: string }>({});

  const bulkPhotoRef = useRef<HTMLInputElement>(null);
  const singlePhotoRef = useRef<HTMLInputElement>(null);
  const [singlePhotoTarget, setSinglePhotoTarget] = useState<'front' | 'sideLeft' | 'back' | 'sideRight'>('front');
  const [swapSource, setSwapSource] = useState<'front' | 'sideLeft' | 'back' | 'sideRight' | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      getMeasurements().then(setMeasurements);
    }
  }, [isAuthenticated]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-lg">Loading...</div>
      </div>
    );
  }

  const handlePhotoUpload = async (angle: 'front' | 'sideLeft' | 'sideRight' | 'back', file: File | undefined) => {
    if (!file) return;
    const base64 = await fileToBase64(file);
    setPhotos(prev => ({ ...prev, [angle]: base64 }));
  };

  const handleBulkUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const order: ('front' | 'sideLeft' | 'back' | 'sideRight')[] = ['front', 'sideLeft', 'back', 'sideRight'];
    // Copy files to array immediately — FileList is a live ref that gets cleared
    const fileArr = Array.from(files).slice(0, 4);
    const results = await Promise.all(fileArr.map(f => fileToBase64(f)));
    const newPhotos: typeof photos = {};
    results.forEach((base64, i) => {
      newPhotos[order[i]] = base64;
    });
    setPhotos(prev => ({ ...prev, ...newPhotos }));
  };

  const handleSwap = (target: 'front' | 'sideLeft' | 'back' | 'sideRight') => {
    if (!swapSource) {
      setSwapSource(target);
      return;
    }
    if (swapSource === target) {
      setSwapSource(null);
      return;
    }
    setPhotos(prev => {
      const updated = { ...prev };
      const temp = updated[swapSource];
      updated[swapSource] = updated[target];
      updated[target] = temp;
      return updated;
    });
    setSwapSource(null);
  };

  const prefillFromLast = async () => {
    const all = await getMeasurements();
    const last = all.length > 0 ? all[all.length - 1] : null;
    setDate(new Date().toISOString().split('T')[0]);
    setArms(last ? String(last.arms) : '');
    setChest(last ? String(last.chest) : '');
    setWaist(last ? String(last.waist) : '');
    setLegs(last ? String(last.legs) : '');
    setWeight(last ? String(last.weight) : '');
    setBodyFat(last?.bodyFat != null ? String(last.bodyFat) : '');
    setEnergy(last?.energy || '');
    setHunger(last?.hunger || '');
    setTiredness(last?.tiredness || '');
    setDigestion(last?.digestion || '');
    setSleepHours(last?.sleepHours ?? 7.5);
    setCardio(last?.cardio ?? 5);
    setTrainings(last?.trainings ?? 5);
    setFoodChanges(last?.foodChanges ?? 95);
    setPhotos({});
    if (bulkPhotoRef.current) bulkPhotoRef.current.value = '';
    if (singlePhotoRef.current) singlePhotoRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const measurement: Measurement = {
      date,
      arms: parseFloat(arms) || 0,
      chest: parseFloat(chest) || 0,
      waist: parseFloat(waist) || 0,
      legs: parseFloat(legs) || 0,
      weight: parseFloat(weight) || 0,
      bodyFat: bodyFat ? parseFloat(bodyFat) : undefined,
      energy: energy || undefined,
      hunger: hunger || undefined,
      tiredness: tiredness || undefined,
      digestion: digestion || undefined,
      sleepHours,
      cardio,
      trainings,
      foodChanges,
      photos,
    };
    await saveMeasurement(measurement);
    setMeasurements(await getMeasurements());
    setShowForm(false);
  };

  // Auto-calculate change vs previous measurement
  const getChange = (current: Measurement, previous: Measurement | null, field: 'arms' | 'chest' | 'waist' | 'legs' | 'weight' | 'bodyFat'): number | undefined => {
    if (!previous) return undefined;
    const curVal = current[field];
    const prevVal = previous[field];
    if (curVal == null || prevVal == null) return undefined;
    const diff = Math.round((curVal - prevVal) * 10) / 10;
    return diff;
  };

  const handleDelete = async (dateStr: string) => {
    if (confirm('Delete this measurement entry?')) {
      await deleteMeasurement(dateStr);
      setMeasurements(await getMeasurements());
    }
  };

  const formatChange = (val?: number) => {
    if (val === undefined || val === 0) return null;
    const sign = val > 0 ? '+' : '';
    const colorClass = val > 0 ? 'change-positive' : 'change-negative';
    return <span className={colorClass}>{sign}{val}</span>;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Reverse chronological for timeline
  const sortedMeasurements = [...measurements].reverse();

  // SVG Chart for any measurement field
  const renderChart = (field: 'weight' | 'arms' | 'chest' | 'waist' | 'legs', label: string, unit: string, color: string, gradientId: string) => {
    if (measurements.length < 2) return null;

    const chartWidth = 600;
    const chartHeight = 180;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;

    const values = measurements.map(m => m[field]);
    const minVal = Math.min(...values) - 1;
    const maxVal = Math.max(...values) + 1;
    const range = maxVal - minVal || 1;

    const points = measurements.map((m, i) => {
      const x = padding.left + (measurements.length === 1 ? innerWidth / 2 : (i / (measurements.length - 1)) * innerWidth);
      const y = padding.top + innerHeight - ((m[field] - minVal) / range) * innerHeight;
      return { x, y, val: m[field], date: m.date };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${padding.top + innerHeight} Z`;

    const yTicks = 4;
    const yLabels = Array.from({ length: yTicks }, (_, i) => {
      const val = minVal + (range * i) / (yTicks - 1);
      return { val: Math.round(val * 10) / 10, y: padding.top + innerHeight - (i / (yTicks - 1)) * innerHeight };
    });

    const firstVal = values[0];
    const lastVal = values[values.length - 1];
    const totalChange = Math.round((lastVal - firstVal) * 10) / 10;
    const changeSign = totalChange > 0 ? '+' : '';
    const changeColor = totalChange > 0 ? 'text-green-400' : totalChange < 0 ? 'text-red-400' : 'text-white/40';

    return (
      <div className="bg-white/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-white/70">{label} ({unit})</h4>
          <span className={`text-sm font-bold ${changeColor}`}>
            {changeSign}{totalChange}{unit}
          </span>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full" style={{ minWidth: '300px' }}>
            {yLabels.map((tick, i) => (
              <g key={i}>
                <line x1={padding.left} y1={tick.y} x2={chartWidth - padding.right} y2={tick.y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                <text x={padding.left - 8} y={tick.y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="10">{tick.val}</text>
              </g>
            ))}
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
                <text x={p.x} y={p.y - 10} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9">{p.val}</text>
                {(i === 0 || i === points.length - 1 || measurements.length <= 8 || i % Math.ceil(measurements.length / 6) === 0) && (
                  <text x={p.x} y={chartHeight - 6} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" transform={`rotate(-30, ${p.x}, ${chartHeight - 6})`}>
                    {new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>
    );
  };

  const photoAngles: { key: 'front' | 'sideLeft' | 'back' | 'sideRight'; label: string }[] = [
    { key: 'front', label: 'Front' },
    { key: 'sideLeft', label: 'Side Left' },
    { key: 'back', label: 'Back' },
    { key: 'sideRight', label: 'Side Right' },
  ];

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:ml-64 p-6 pb-24 md:pb-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-white">Body Metrix</h1>
              <p className="text-white/40 mt-1">Track your weekly measurements and progress photos</p>
            </div>
            <button
              onClick={() => {
                if (!showForm) prefillFromLast();
                setShowForm(!showForm);
              }}
              className="btn-primary"
            >
              {showForm ? 'Cancel' : '+ Add Entry'}
            </button>
          </div>

          {/* Add Measurement Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="glass-strong p-6 mb-8">
              <h2 className="text-lg font-semibold text-white mb-4">New Measurement</h2>

              {/* Date */}
              <div className="mb-6">
                <label className="block text-sm text-white/60 mb-2">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="glass-input w-full px-4 py-3"
                  required
                />
              </div>

              {/* Measurements Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {[
                  { label: 'Weight (kg)', value: weight, setValue: setWeight, step: 0.1, req: true },
                  { label: 'Body Fat (%)', value: bodyFat, setValue: setBodyFat, step: 0.1, req: false },
                  { label: 'Arms (cm)', value: arms, setValue: setArms, step: 0.5, req: true },
                  { label: 'Chest (cm)', value: chest, setValue: setChest, step: 0.5, req: true },
                  { label: 'Waist (cm)', value: waist, setValue: setWaist, step: 0.5, req: true },
                  { label: 'Legs (cm)', value: legs, setValue: setLegs, step: 0.5, req: true },
                ].map(field => (
                  <div key={field.label}>
                    <label className="block text-sm text-white/60 mb-2">{field.label}</label>
                    <div className="flex items-stretch gap-3">
                      <button
                        type="button"
                        onClick={() => field.setValue(String(Math.round((parseFloat(field.value || '0') - field.step) * 10) / 10))}
                        className="shrink-0 w-12 py-3 rounded-xl text-xl font-bold transition-colors border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 active:bg-red-500/30"
                      >−</button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={field.value}
                        onChange={e => field.setValue(e.target.value)}
                        placeholder="0"
                        className="glass-input min-w-0 flex-1 px-3 py-3 text-center text-lg font-semibold"
                        required={field.req}
                      />
                      <button
                        type="button"
                        onClick={() => field.setValue(String(Math.round((parseFloat(field.value || '0') + field.step) * 10) / 10))}
                        className="shrink-0 w-12 py-3 rounded-xl text-xl font-bold transition-colors border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 active:bg-green-500/30"
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
              {measurements.length > 0 && (
                <p className="text-xs text-white/30 mb-4">Changes will be auto-calculated vs. your previous entry.</p>
              )}

              {/* Text status fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {([
                  { label: 'Energy levels', value: energy, setValue: setEnergy, placeholder: 'feel good, tired etc' },
                  { label: 'Hunger', value: hunger, setValue: setHunger, placeholder: 'normal, hungry, too full' },
                  { label: 'Tiredness', value: tiredness, setValue: setTiredness, placeholder: 'normal, too much etc' },
                  { label: 'Digestion', value: digestion, setValue: setDigestion, placeholder: 'no problem, issues etc' },
                ]).map(field => (
                  <div key={field.label}>
                    <label className="block text-sm text-white/60 mb-2">{field.label}</label>
                    <input
                      type="text"
                      value={field.value}
                      onChange={e => field.setValue(e.target.value)}
                      placeholder={field.placeholder}
                      className="glass-input w-full px-4 py-3"
                    />
                  </div>
                ))}
              </div>

              {/* Slider fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <SliderField
                  label="Sleep (hours/night)"
                  value={sleepHours}
                  onChange={setSleepHours}
                  min={5} max={10} step={0.5}
                  targetMin={7} targetMax={8}
                  unit="h"
                />
                <SliderField
                  label="Cardio (sessions/week)"
                  value={cardio}
                  onChange={setCardio}
                  min={0} max={7} step={1}
                  targetMin={4} targetMax={6}
                  unit="x"
                />
                <SliderField
                  label="Trainings (sessions/week)"
                  value={trainings}
                  onChange={setTrainings}
                  min={0} max={7} step={1}
                  targetMin={4} targetMax={6}
                  unit="x"
                />
                <SliderField
                  label="Food adherence"
                  value={foodChanges}
                  onChange={setFoodChanges}
                  min={0} max={100} step={5}
                  targetMin={95} targetMax={100}
                  unit="%"
                />
              </div>

              {/* Photo Uploads */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm text-white/60">Progress Photos</label>
                  <button
                    type="button"
                    onClick={() => bulkPhotoRef.current?.click()}
                    className="btn-secondary text-xs px-3 py-1.5"
                  >
                    Upload all 4
                  </button>
                </div>
                <p className="text-[10px] text-white/25 mb-3">
                  Upload 4 photos at once (order: front, side-left, back, side-right) or tap a slot to upload individually.
                  {swapSource && <span className="text-va-red ml-1">Tap another photo to swap positions.</span>}
                </p>
                <input
                  ref={bulkPhotoRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => { handleBulkUpload(e.target.files).then(() => { if (bulkPhotoRef.current) bulkPhotoRef.current.value = ''; }); }}
                />
                <input
                  ref={singlePhotoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { handlePhotoUpload(singlePhotoTarget, e.target.files?.[0]); if (singlePhotoRef.current) singlePhotoRef.current.value = ''; }}
                />
                <div className="photo-grid">
                  {photoAngles.map(angle => (
                    <div key={angle.key} className="flex flex-col gap-2">
                      <label className="text-xs text-white/40 text-center">{angle.label}</label>
                      <div
                        className={`aspect-[3/4] rounded-xl overflow-hidden bg-white/5 border flex items-center justify-center cursor-pointer transition-colors relative ${
                          swapSource === angle.key
                            ? 'border-va-red ring-2 ring-va-red/30'
                            : swapSource && photos[angle.key]
                              ? 'border-white/20 hover:border-va-red/50'
                              : 'border-white/10 hover:border-va-red/30'
                        }`}
                        onClick={() => {
                          if (photos[angle.key] && (swapSource || Object.values(photos).filter(Boolean).length > 1)) {
                            handleSwap(angle.key);
                          } else {
                            setSinglePhotoTarget(angle.key);
                            singlePhotoRef.current?.click();
                          }
                        }}
                      >
                        {photos[angle.key] ? (
                          <>
                            <img src={photos[angle.key]} alt={angle.label} className="w-full h-full object-cover" />
                            {swapSource === angle.key && (
                              <div className="absolute inset-0 bg-va-red/20 flex items-center justify-center">
                                <span className="text-white text-xs font-bold bg-black/50 px-2 py-1 rounded">Tap to swap</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-white/20 text-center p-2">
                            <div className="text-2xl mb-1">+</div>
                            <div className="text-xs">{angle.label}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" className="btn-primary w-full py-3">
                Save Measurement
              </button>
            </form>
          )}

          {/* Measurement Timeline */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Measurement History</h2>
            {sortedMeasurements.length === 0 ? (
              <div className="glass-card p-8 text-center text-white/30">
                No measurements yet. Add your first entry above.
              </div>
            ) : (
              <div className="space-y-4">
                {sortedMeasurements.map((m) => {
                  // Find previous measurement (chronologically before this one)
                  const chronologicalIndex = measurements.findIndex(entry => entry.date === m.date);
                  const previous = chronologicalIndex > 0 ? measurements[chronologicalIndex - 1] : null;

                  const isExpanded = expandedEntry === m.date;

                  return (
                  <div key={m.date} className="glass-card p-6">
                    <div
                      className="flex items-center justify-between mb-4 cursor-pointer"
                      onClick={() => setExpandedEntry(isExpanded ? null : m.date)}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-white/30 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                        <h3 className="text-white font-semibold text-lg">{formatDate(m.date)}</h3>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(m.date); }}
                        className="btn-secondary text-sm px-3 py-1 text-white/40 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>

                    {/* Measurement Values */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                      {([
                        { label: 'Weight', value: `${m.weight}kg`, field: 'weight' as const, unit: 'kg' },
                        { label: 'Body Fat', value: m.bodyFat != null ? `${m.bodyFat}%` : '—', field: 'bodyFat' as const, unit: '%' },
                        { label: 'Arms', value: `${m.arms}cm`, field: 'arms' as const, unit: 'cm' },
                        { label: 'Chest', value: `${m.chest}cm`, field: 'chest' as const, unit: 'cm' },
                        { label: 'Waist', value: `${m.waist}cm`, field: 'waist' as const, unit: 'cm' },
                        { label: 'Legs', value: `${m.legs}cm`, field: 'legs' as const, unit: 'cm' },
                      ]).map(stat => {
                        const change = getChange(m, previous, stat.field);
                        return (
                        <div key={stat.label} className="bg-white/5 rounded-xl p-3">
                          <p className="text-xs text-white/40 uppercase tracking-wider">{stat.label}</p>
                          <p className="text-lg font-bold text-white">{stat.value}</p>
                          {change !== undefined && change !== 0 && (
                            <p className="text-sm">{formatChange(change)}</p>
                          )}
                          {change === 0 && (
                            <p className="text-sm change-neutral">0</p>
                          )}
                          {change === undefined && (
                            <p className="text-sm text-white/20">—</p>
                          )}
                        </div>
                        );
                      })}
                    </div>

                    {/* Status fields */}
                    {(m.energy || m.hunger || m.tiredness || m.digestion || m.sleepHours || m.cardio || m.trainings || m.foodChanges) && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                        {([
                          { label: 'Energy', value: m.energy },
                          { label: 'Hunger', value: m.hunger },
                          { label: 'Tiredness', value: m.tiredness },
                          { label: 'Digestion', value: m.digestion },
                          { label: 'Sleep', value: m.sleepHours != null ? `${m.sleepHours}h` : undefined },
                          { label: 'Cardio', value: m.cardio != null ? `${m.cardio}x` : undefined },
                          { label: 'Trainings', value: m.trainings != null ? `${m.trainings}x` : undefined },
                          { label: 'Food', value: m.foodChanges != null ? `${m.foodChanges}%` : undefined },
                        ]).map(field => field.value ? (
                          <div key={field.label} className="bg-white/5 rounded-lg p-2">
                            <p className="text-[10px] text-white/30 uppercase tracking-wider">{field.label}</p>
                            <p className="text-xs text-white/70 mt-0.5">{field.value}</p>
                          </div>
                        ) : null)}
                      </div>
                    )}

                    {/* Photos toggle */}
                    {m.photos && Object.values(m.photos).some(Boolean) && (
                      <>
                        <button
                          onClick={() => setExpandedPhotos(expandedPhotos === m.date ? null : m.date)}
                          className="btn-secondary text-sm px-4 py-2 mb-3"
                        >
                          {expandedPhotos === m.date ? 'Hide Photos' : 'Show Photos'}
                        </button>
                        {expandedPhotos === m.date && (
                          <div className="photo-grid">
                            {(['front', 'sideLeft', 'back', 'sideRight'] as const).map(angle => {
                              const src = m.photos[angle];
                              if (!src) return null;
                              return (
                                <div key={angle} className="aspect-[3/4] rounded-xl overflow-hidden bg-white/5">
                                  <img src={src} alt={angle} className="w-full h-full object-cover" />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}

                    {/* Progression Charts (expanded) */}
                    {isExpanded && measurements.length >= 2 && (
                      <div className="mt-6 pt-6 border-t border-white/10">
                        <h4 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-4">Progression Charts</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {renderChart('weight', 'Weight', 'kg', '#b90a0a', 'grad-weight')}
                          {renderChart('arms', 'Arms', 'cm', '#3b82f6', 'grad-arms')}
                          {renderChart('chest', 'Chest', 'cm', '#8b5cf6', 'grad-chest')}
                          {renderChart('waist', 'Waist', 'cm', '#f59e0b', 'grad-waist')}
                          {renderChart('legs', 'Legs', 'cm', '#22c55e', 'grad-legs')}
                        </div>
                      </div>
                    )}
                    {isExpanded && measurements.length < 2 && (
                      <div className="mt-6 pt-6 border-t border-white/10">
                        <p className="text-sm text-white/30 text-center">Add at least 2 entries to see progression charts.</p>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
