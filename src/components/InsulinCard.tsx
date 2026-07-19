'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { NutritionPlan, NutritionMeal } from '@/types';
import {
  calcBolus, calcIOB, verifyDose, estimateEmpiricalICR,
  type InsulinSettings, type InsulinDose, type RescueEvent, type InsulinEvent,
} from '@/utils/insulin';
import { getInsulinSettings, saveInsulinSettings, getInsulinLog, saveInsulinLog } from '@/utils/storage';

interface GlucoseState {
  current: { value: number; valueMmol: number; trend: string; trendRaw?: number; timestamp: string; isHigh: boolean; isLow: boolean } | null;
  history: { value: number; valueMmol: number; timestamp: string }[];
}

function mealCarbs(meal: NutritionMeal): number {
  let c = 0;
  for (const it of meal.items) c += it.carbs || 0;
  for (const sup of meal.supplements || []) {
    const s = sup.toLowerCase();
    if (/maltodextrin|dextrose|cluster dextrin/.test(s)) {
      const g = parseFloat((s.match(/(\d[\d.]*)\s*g\b/) || [])[1] || '0');
      if (isFinite(g)) c += g * 0.95;
    }
  }
  return Math.round(c);
}

function mealHour(name: string): number | null {
  const m = name.match(/(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1]) + parseInt(m[2]) / 60 : null;
}

const isIntra = (n: string) => /during workout|intra/i.test(n);

// Correction = insulin to bring down a high glucose, no meal/carbs. Repeatable
// (unlike meals, which are once-per-day).
const CORRECTION = 'Correction';
// Local calendar-day key for the "once per day" rule.
const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

type PickerMeal = { name: string; carbs: number; hour: number | null; timed: boolean; correction: boolean; done: boolean };

// Horizontal snap scroll wheel for whole-unit selection.
function UnitScroller({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const userScrolling = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ITEM = 54;

  // Programmatically centre on `value` when it changes externally.
  useEffect(() => {
    const el = ref.current;
    if (!el || userScrolling.current) return;
    el.scrollTo({ left: value * ITEM, behavior: 'smooth' });
  }, [value]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    userScrolling.current = true;
    const idx = Math.max(0, Math.min(max, Math.round(el.scrollLeft / ITEM)));
    if (idx !== value) onChange(idx);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { userScrolling.current = false; }, 160);
  };

  const nums = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <div className="relative">
      {/* centre selection frame */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-cyan-300/40 bg-gradient-to-b from-cyan-400/10 to-blue-500/5 shadow-[0_0_20px_rgba(34,211,238,0.15)]" />
      {/* edge fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-12 bg-gradient-to-r from-[#12122a] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-12 bg-gradient-to-l from-[#12122a] to-transparent" />
      <div ref={ref} onScroll={onScroll}
        className="relative z-10 flex overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}>
        <div style={{ minWidth: `calc(50% - ${ITEM / 2}px)` }} className="shrink-0" />
        {nums.map(n => (
          <div key={n} className="flex shrink-0 snap-center items-center justify-center" style={{ width: ITEM, height: 68 }}>
            <span className={`font-black tabular-nums transition-all duration-150 ${n === value ? 'text-4xl text-white drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]' : Math.abs(n - value) === 1 ? 'text-xl text-white/40' : 'text-base text-white/20'}`}>{n}</span>
          </div>
        ))}
        <div style={{ minWidth: `calc(50% - ${ITEM / 2}px)` }} className="shrink-0" />
      </div>
    </div>
  );
}

export default function InsulinCard({ glucose, nutritionPlan, nowTs }: { glucose: GlucoseState | null; nutritionPlan: NutritionPlan | null; nowTs: number }) {
  const [settings, setSettings] = useState<InsulinSettings | null>(null);
  const [log, setLog] = useState<InsulinEvent[]>([]);
  const [selectedMeal, setSelectedMeal] = useState<string>('');
  const [actualUnits, setActualUnits] = useState<number>(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [rescueCarbs, setRescueCarbs] = useState<string>('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getInsulinSettings().then(setSettings);
    getInsulinLog().then(setLog);
  }, []);

  const doses = useMemo(() => log.filter((e): e is InsulinDose => e.kind === 'dose'), [log]);
  const rescues = useMemo(() => log.filter((e): e is RescueEvent => e.kind === 'rescue'), [log]);

  useEffect(() => {
    if (!settings || !glucose?.history?.length) return;
    let changed = false;
    const hist = glucose.history;
    const nearestAt = (targetMs: number): number | null => {
      let best: number | null = null, bestDiff = Infinity;
      for (const h of hist) { const diff = Math.abs(new Date(h.timestamp).getTime() - targetMs); if (diff < bestDiff) { bestDiff = diff; best = h.value; } }
      return bestDiff <= 30 * 60000 ? best : null;
    };
    const next = log.map(e => {
      if (e.kind !== 'dose' || e.verify) return e;
      const checkMs = new Date(e.timestamp).getTime() + settings.checkAfterHours * 3600000;
      if (nowTs < checkMs) return e;
      const gv = nearestAt(checkMs);
      if (gv == null) return e;
      const rescueInWindow = rescues.some(r => { const t = new Date(r.timestamp).getTime(); return t >= new Date(e.timestamp).getTime() && t <= checkMs; });
      const v = verifyDose(e, settings, gv, rescueInWindow, new Date(checkMs).toISOString());
      if (v) { changed = true; return { ...e, verify: v }; }
      return e;
    });
    if (changed) { setLog(next); saveInsulinLog(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, glucose, nowTs]);

  // Meals already logged today (excludes Correction, which is repeatable).
  const todayKey = localDay(new Date(nowTs));
  const doneToday = useMemo(() => {
    const s = new Set<string>();
    for (const dz of doses) if (dz.mealName !== CORRECTION && localDay(new Date(dz.timestamp)) === todayKey) s.add(dz.mealName);
    return s;
  }, [doses, todayKey]);

  // Picker list = Correction chip first, then the plan meals (with done flags).
  const meals = useMemo<PickerMeal[]>(() => {
    if (!nutritionPlan) return [];
    const plan = nutritionPlan.current.trainingDay.meals
      .map(m => {
        const hour = mealHour(m.name);
        return { name: m.name, carbs: mealCarbs(m), hour, timed: hour != null, correction: false, done: doneToday.has(m.name) };
      })
      .filter(m => m.carbs > 0 || isIntra(m.name));
    const correction: PickerMeal = { name: CORRECTION, carbs: 0, hour: null, timed: false, correction: true, done: false };
    return [correction, ...plan];
  }, [nutritionPlan, doneToday]);

  // The "next" meal = earliest not-yet-done TIMED meal that's current/upcoming
  // (within 2h grace of its scheduled time). Floating workout meals aren't in
  // the auto-sequence. When everything's done → Correction.
  const nextMealName = useMemo(() => {
    const d = new Date(nowTs); const nowH = d.getHours() + d.getMinutes() / 60;
    const timedNotDone = meals.filter(m => m.timed && !m.done).sort((a, b) => (a.hour! - b.hour!));
    const next = timedNotDone.find(m => m.hour! >= nowH - 2) ?? timedNotDone[0];
    return next?.name ?? CORRECTION;
  }, [meals, nowTs]);

  // Auto-advance the marker to the next meal whenever it changes (i.e. after a
  // meal is logged). Manual taps hold until the next auto-change.
  const lastAutoRef = useRef<string>('');
  useEffect(() => {
    if (nextMealName && nextMealName !== lastAutoRef.current) {
      lastAutoRef.current = nextMealName;
      setSelectedMeal(nextMealName);
    }
  }, [nextMealName]);

  // Keep the selected meal centred in the horizontal strip.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = stripRef.current; if (!c) return;
    const btn = c.querySelector('[data-sel="1"]') as HTMLElement | null;
    if (btn) c.scrollTo({ left: btn.offsetLeft - (c.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' });
  }, [selectedMeal, meals]);

  const meal = meals.find(m => m.name === selectedMeal);
  const now = new Date(nowTs);

  const proposal = useMemo(() => {
    if (!settings || !glucose?.current || !meal) return null;
    const gc = glucose.current;
    const ageMin = (nowTs - new Date(gc.timestamp).getTime()) / 60000;
    const rescueInLastHour = rescues.some(r => nowTs - new Date(r.timestamp).getTime() < 3600000);
    return calcBolus({ glucose: gc.value, glucoseAgeMin: ageMin, trendRaw: gc.trendRaw, mealCarbs: meal.carbs, now, recentDoses: doses, rescueInLastHour, settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, glucose, meal, doses, rescues, nowTs, refreshTick]);

  useEffect(() => { if (proposal) setActualUnits(proposal.proposed); }, [proposal?.proposed, selectedMeal]); // eslint-disable-line react-hooks/exhaustive-deps

  const iob = settings ? calcIOB(doses, now, settings.diaHours) : 0;
  const empirical = useMemo(() => settings ? estimateEmpiricalICR(doses, settings) : {}, [doses, settings]);

  const saveDose = useCallback(async () => {
    if (!settings || !glucose?.current || !meal || !proposal) return;
    const gc = glucose.current;
    const dose: InsulinDose = {
      id: `d${nowTs}`, kind: 'dose', timestamp: now.toISOString(), mealName: meal.name, mealCarbs: meal.carbs,
      glucoseBefore: gc.value, trendBefore: gc.trendRaw, block: proposal.block,
      proposedUnits: proposal.proposed, actualUnits, breakdown: proposal.breakdown,
    };
    const next = [dose, ...log];
    setLog(next); await saveInsulinLog(next);
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, glucose, meal, proposal, actualUnits, log, nowTs]);

  const saveRescue = useCallback(async () => {
    const c = parseFloat(rescueCarbs); if (!c || c <= 0) return;
    const ev: RescueEvent = { id: `r${nowTs}`, kind: 'rescue', timestamp: new Date().toISOString(), carbs: c };
    const next = [ev, ...log]; setLog(next); await saveInsulinLog(next); setRescueCarbs('');
  }, [rescueCarbs, log, nowTs]);

  const updateSetting = (patch: Partial<InsulinSettings>) => {
    if (!settings) return; const next = { ...settings, ...patch }; setSettings(next); saveInsulinSettings(next);
  };

  if (!settings) return null;
  const gc = glucose?.current;
  const recent = log.slice(0, 6);
  const locked = proposal?.lockout;

  return (
    <div className="glass-card mb-6 fade-up overflow-hidden">
      {/* premium gradient header strip */}
      <div className="relative px-5 pt-4 pb-3">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.08] via-blue-500/[0.04] to-transparent pointer-events-none" />
        <div className="relative flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-base">💉</span> Insulin <span className="text-[10px] font-normal text-cyan-300/50 tracking-wider uppercase">Fiasp</span>
          </h2>
          <div className="flex items-center gap-2.5 text-[9px] uppercase tracking-wider text-white/25">
            <button onClick={() => setRefreshTick(t => t + 1)} className="hover:text-cyan-300/80 transition-colors">↻ refresh</button>
            <button onClick={() => setShowSettings(s => !s)} className="hover:text-white/60 transition-colors">{showSettings ? 'close' : 'setup'}</button>
          </div>
        </div>
      </div>

      <div className="px-5 pb-4">
        {/* Settings (compact) */}
        {showSettings && (
          <div className="mb-4 grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-xl border border-white/8 bg-black/20 p-3 text-[10px]">
            {([
              ['ICR AM', 'icrMorning'], ['ICR PM', 'icrEvening'], ['cutover h', 'cutoverHour'],
              ['ISF AM', 'isfMorning'], ['ISF PM', 'isfEvening'], ['max u', 'maxDose'],
              ['tgt low', 'targetLow'], ['tgt mid', 'targetMid'], ['tgt high', 'targetHigh'],
              ['DIA h', 'diaHours'], ['check h', 'checkAfterHours'],
            ] as [string, keyof InsulinSettings][]).map(([label, key]) => (
              <label key={key} className="flex items-center justify-between gap-1 text-white/40">
                <span className="truncate">{label}</span>
                <input type="number" step="1" value={settings[key]}
                  onChange={e => updateSetting({ [key]: parseFloat(e.target.value) || 0 } as Partial<InsulinSettings>)}
                  className="w-11 rounded bg-white/5 px-1.5 py-0.5 text-right font-mono tabular-nums text-white/80 no-spinners border border-white/5 focus:border-cyan-400/40 outline-none" />
              </label>
            ))}
          </div>
        )}

        {/* MEAL picker — big, scrollable; auto-centres on the next meal.
            Done meals are greyed + non-selectable (no meal twice a day).
            "⚡ Correction" is always available and repeatable. */}
        <div ref={stripRef} className="mb-4 flex gap-2 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden pb-1" style={{ scrollbarWidth: 'none' }}>
          {meals.map(m => {
            const on = m.name === selectedMeal;
            const isCorr = m.correction;
            const done = m.done;
            return (
              <button key={m.name} data-sel={on ? '1' : '0'} disabled={done}
                onClick={() => !done && setSelectedMeal(m.name)}
                className={`snap-center shrink-0 rounded-2xl border px-4 py-2.5 text-left transition-all ${
                  done ? 'border-white/[0.04] bg-white/[0.015] opacity-50 cursor-default'
                  : on
                    ? (isCorr ? 'border-amber-300/40 bg-gradient-to-br from-amber-500/20 to-orange-600/10 shadow-[0_2px_20px_rgba(251,191,36,0.12)]'
                              : 'border-cyan-300/40 bg-gradient-to-br from-cyan-500/20 to-blue-600/10 shadow-[0_2px_20px_rgba(34,211,238,0.12)]')
                    : 'border-white/[0.06] bg-white/[0.03]'}`}>
                <div className={`text-sm font-bold leading-tight ${on ? (isCorr ? 'text-amber-100' : 'text-white') : 'text-white/45'}`}>
                  {isCorr ? '⚡ Correction' : m.name}
                </div>
                <div className={`text-[10px] ${on ? (isCorr ? 'text-amber-200/70' : 'text-cyan-200/70') : 'text-white/30'}`}>
                  {done ? '✓ done' : isCorr ? 'high glucose' : `${m.carbs} g carbs`}
                </div>
              </button>
            );
          })}
        </div>

        {!gc ? (
          <div className="text-xs text-white/30">No current glucose reading — can&apos;t propose a dose.</div>
        ) : proposal && (
          <>
            {/* Proposed hero */}
            <div className={`mb-1 rounded-2xl border p-4 ${locked ? 'border-red-500/30 bg-red-500/[0.07]' : 'border-cyan-400/15 bg-gradient-to-br from-cyan-500/[0.06] to-blue-600/[0.03]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Proposed dose</span>
                <span className="text-[10px] text-white/40">
                  glucose <strong className="text-white/70">{gc.value}</strong> <span className="text-cyan-300/70">{gc.trend}</span>
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className={`text-5xl font-black data-value ${locked ? 'text-red-400' : 'bg-gradient-to-br from-white to-cyan-200 bg-clip-text text-transparent'}`}>{proposal.proposed}</span>
                <span className="text-sm text-white/40">units</span>
              </div>
              {!locked && (
                <div className="mt-1 text-[9px] text-white/30">
                  {proposal.block}
                  {proposal.breakdown.carbBolus > 0 ? ` · carb ${Math.round(proposal.breakdown.carbBolus)}u` : ''}
                  {proposal.breakdown.correctionBolus > 0 ? ` + corr ${Math.round(proposal.breakdown.correctionBolus)}u` : ''}
                  {proposal.breakdown.carbBolus === 0 && proposal.breakdown.correctionBolus === 0 ? ' · nothing to dose' : ''}
                  {proposal.breakdown.trendAdjPct !== 0 ? ` · trend ${proposal.breakdown.trendAdjPct > 0 ? '+' : ''}${proposal.breakdown.trendAdjPct}%` : ''}
                  {proposal.breakdown.iob > 0 ? ` · −${Math.round(proposal.breakdown.iob)}u IOB` : ''}
                  {` · ICR ${proposal.breakdown.icr} · ISF ${proposal.breakdown.isf}`}
                </div>
              )}
            </div>

            {/* Warnings */}
            {proposal.warnings.length > 0 && (
              <div className="mb-2 mt-2 space-y-1">
                {proposal.warnings.map((w, i) => (
                  <div key={i} className={`text-[10px] flex items-start gap-1 ${locked && i === 0 ? 'text-red-300' : 'text-amber-300/80'}`}><span>⚠</span><span>{w}</span></div>
                ))}
              </div>
            )}

            {/* ACTUAL — big scroller */}
            <div className="mt-3 rounded-2xl border border-white/[0.06] bg-black/20 pt-2 pb-1">
              <div className="text-center text-[10px] uppercase tracking-wider text-white/35">Units given — scroll to set</div>
              <UnitScroller value={actualUnits} max={settings.maxDose + 5} onChange={setActualUnits} />
            </div>

            {/* Big log button */}
            <button onClick={saveDose} disabled={locked && actualUnits === 0}
              className={`mt-3 w-full rounded-2xl py-4 text-base font-bold tracking-wide transition-all disabled:opacity-40 ${saved ? 'bg-green-500/20 text-green-300 border border-green-400/40' : 'text-white shadow-[0_6px_24px_rgba(34,211,238,0.25)] bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500'}`}>
              {saved ? '✓  Dose logged' : `Log ${actualUnits} units`}
            </button>
          </>
        )}

        {/* Compact footer */}
        <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-white/30">
          <span>IOB <strong className="text-white/55">{Math.round(iob)}u</strong></span>
          <div className="flex items-center gap-1">
            <span className="text-white/25">low? rescue</span>
            <input type="number" value={rescueCarbs} onChange={e => setRescueCarbs(e.target.value)} placeholder="g"
              className="w-10 rounded bg-white/5 px-1.5 py-0.5 text-center no-spinners border border-white/5 outline-none focus:border-amber-400/40" />
            <button onClick={saveRescue} className="rounded border border-amber-400/25 px-1.5 py-0.5 text-amber-300/70 hover:text-amber-300">log</button>
          </div>
          <button onClick={() => setShowHistory(s => !s)} className="text-white/25 hover:text-white/50 uppercase tracking-wider">{showHistory ? 'hide' : 'log'}</button>
        </div>

        {/* Learning signal */}
        {(empirical.morning || empirical.evening) && (
          <div className="mt-1.5 text-[9px] text-cyan-300/40 leading-relaxed">
            Learning · {empirical.morning ? `AM data → ICR ~${empirical.morning.icr} (${empirical.morning.n})` : ''}{empirical.morning && empirical.evening ? ' · ' : ''}{empirical.evening ? `PM ~${empirical.evening.icr} (${empirical.evening.n})` : ''} — review with your doctor before changing.
          </div>
        )}

        {/* History (collapsed by default, tiny) */}
        {showHistory && recent.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
            {recent.map(e => e.kind === 'rescue' ? (
              <div key={e.id} className="flex items-center justify-between text-[9px]">
                <span className="text-amber-300/50">{new Date(e.timestamp).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · rescue {e.carbs}g</span>
                <span className="text-white/20">excluded</span>
              </div>
            ) : (
              <div key={e.id} className="flex items-center justify-between text-[9px]">
                <span className="text-white/45">{new Date(e.timestamp).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {e.mealName} · <strong className="text-white/65">{e.actualUnits}u</strong> @{e.glucoseBefore}</span>
                {e.verify ? (
                  <span className={e.verify.confounded ? 'text-white/25' : e.verify.status === 'on-target' ? 'text-green-400/70' : e.verify.status === 'high' ? 'text-amber-300/70' : 'text-red-400/70'}>
                    3h {e.verify.glucoseAfter} {e.verify.confounded ? '(conf.)' : e.verify.status === 'on-target' ? '✓' : e.verify.status === 'high' ? '↑' : '↓'}
                  </span>
                ) : <span className="text-white/20">pending</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
