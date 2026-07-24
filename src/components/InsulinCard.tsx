'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { NutritionPlan, NutritionMeal } from '@/types';
import {
  calcBolus, calcIOB, verifyDose, estimateEmpiricalICR, estimateEmpiricalISF, learnedICRs, learnedISFs, learnedMealICRs, timeBlock, tddSanityCheck,
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
// ISO timestamp → local "YYYY-MM-DDTHH:mm" for a <input type="datetime-local">.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Unique id per log entry — the old `d${nowTs}` scheme reused the (fixed)
// mount timestamp, so every entry logged in a session collided, which broke
// edit/delete/keys.
const uid = (prefix: 'd' | 'r') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Repair a loaded log so every entry has a unique id (fixes the historical
// duplicate-id data written by the old scheme). Returns whether anything moved.
function ensureUniqueIds(log: InsulinEvent[]): { log: InsulinEvent[]; changed: boolean } {
  const seen = new Set<string>();
  let changed = false;
  const out = log.map(e => {
    let id = e.id;
    if (!id || seen.has(id)) { id = uid(e.kind === 'rescue' ? 'r' : 'd'); changed = true; }
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
  return { log: out, changed };
}

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
  const [editId, setEditId] = useState<string | null>(null);
  const [editMeal, setEditMeal] = useState('');
  const [editUnits, setEditUnits] = useState(0);
  const [editTime, setEditTime] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Refresh with optical feedback: spin the icon + flash for ~700ms.
  const doRefresh = useCallback(() => {
    setRefreshTick(t => t + 1);
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  }, []);

  useEffect(() => {
    getInsulinSettings().then(setSettings);
    getInsulinLog().then(l => {
      const { log: fixed, changed } = ensureUniqueIds(l);
      setLog(fixed);
      if (changed) saveInsulinLog(fixed); // one-time repair of duplicate ids
    });
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

  // Most recent past dose for the selected meal — a reference: what you gave
  // last time, and how it turned out once the insulin had acted (glucose at the
  // 3h check, in-target / high / low).
  const lastForMeal = useMemo(() => {
    if (!meal) return null;
    return doses
      .filter(d => d.mealName === meal.name)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] ?? null;
  }, [doses, meal]);

  // Learning mode (opt-in): bounded, shrinkage-learned ICR feeds the SUGGESTION
  // only. When off, effectiveSettings === settings (no change to the dose math).
  const learned = useMemo(
    () => (settings?.learningMode ? learnedICRs(doses, settings) : {}),
    [settings, doses],
  );
  const learnedIsf = useMemo(
    () => (settings?.learningMode ? learnedISFs(doses, settings) : {}),
    [settings, doses],
  );
  // Per-meal learned ICR — keeps lunch's ratio off breakfast's (both "morning").
  const mealLearned = useMemo(
    () => (settings?.learningMode ? learnedMealICRs(doses, settings) : {}),
    [settings, doses],
  );
  const effectiveSettings = useMemo(() => {
    if (!settings || !settings.learningMode) return settings;
    return {
      ...settings,
      icrMorning: learned.morning?.icr ?? settings.icrMorning,
      icrEvening: learned.evening?.icr ?? settings.icrEvening,
      isfMorning: learnedIsf.morning?.isf ?? settings.isfMorning,
      isfEvening: learnedIsf.evening?.isf ?? settings.isfEvening,
    };
  }, [settings, learned, learnedIsf]);

  const proposal = useMemo(() => {
    if (!effectiveSettings || !glucose?.current || !meal) return null;
    const gc = glucose.current;
    const ageMin = (nowTs - new Date(gc.timestamp).getTime()) / 60000;
    const rescueInLastHour = rescues.some(r => nowTs - new Date(r.timestamp).getTime() < 3600000);
    // Per-meal learned ICR overrides the pooled block ICR for THIS meal.
    let s = effectiveSettings;
    const ml = mealLearned[meal.name];
    if (ml) {
      const blk = timeBlock(now, s.cutoverHour);
      s = blk === 'morning' ? { ...s, icrMorning: ml.icr } : { ...s, icrEvening: ml.icr };
    }
    return calcBolus({ glucose: gc.value, glucoseAgeMin: ageMin, trendRaw: gc.trendRaw, mealCarbs: meal.carbs, now, recentDoses: doses, rescueInLastHour, settings: s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSettings, glucose, meal, doses, rescues, nowTs, refreshTick, mealLearned]);

  useEffect(() => { if (proposal) setActualUnits(proposal.proposed); }, [proposal?.proposed, selectedMeal]); // eslint-disable-line react-hooks/exhaustive-deps

  const iob = settings ? calcIOB(doses, now, settings.diaHours) : 0;
  const empirical = useMemo(() => settings ? estimateEmpiricalICR(doses, settings) : {}, [doses, settings]);
  const empiricalIsf = useMemo(() => settings ? estimateEmpiricalISF(doses, settings) : {}, [doses, settings]);

  // Actual average daily bolus: total logged units over the last 7 days ÷ the
  // number of distinct days that actually have a dose — so a day you forgot to
  // log can't drag it down, and it reflects reality incl. corrections.
  const actualDailyBolus = useMemo(() => {
    const cutoff = nowTs - 7 * 86400000;
    const recent = doses.filter(d => new Date(d.timestamp).getTime() >= cutoff);
    const days = new Set(recent.map(d => localDay(new Date(d.timestamp)))).size;
    const sum = recent.reduce((s, d) => s + (d.actualUnits || 0), 0);
    return { avg: days ? sum / days : 0, days };
  }, [doses, nowTs]);
  // Expected daily bolus straight from the plan: Σ (meal carbs ÷ block ICR).
  // Used until there's real logged data. (Corrections aren't included.)
  const planBolus = useMemo(() => {
    if (!settings) return 0;
    return meals.reduce((s, m) => {
      if (m.correction || m.carbs <= 0) return s;
      const icr = (m.hour != null && m.hour < settings.cutoverHour) ? settings.icrMorning : settings.icrEvening;
      return s + (icr > 0 ? m.carbs / icr : 0);
    }, 0);
  }, [meals, settings]);
  // Priority: your manual override → your actual logged average (needs ≥2 days
  // of data) → the plan estimate.
  const bolusSource: 'manual' | 'actual' | 'plan' | 'none' =
    settings && (settings.typicalBolus || 0) > 0 ? 'manual'
    : actualDailyBolus.days >= 2 ? 'actual'
    : planBolus > 0 ? 'plan' : 'none';
  const effectiveBolus = bolusSource === 'manual' ? settings!.typicalBolus
    : bolusSource === 'actual' ? actualDailyBolus.avg
    : bolusSource === 'plan' ? planBolus : 0;
  const tddCheck = settings ? tddSanityCheck(settings, effectiveBolus) : null;

  const saveDose = useCallback(async () => {
    if (!settings || !glucose?.current || !meal || !proposal) return;
    const gc = glucose.current;
    const dose: InsulinDose = {
      id: uid('d'), kind: 'dose', timestamp: new Date().toISOString(), mealName: meal.name, mealCarbs: meal.carbs,
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
    const ev: RescueEvent = { id: uid('r'), kind: 'rescue', timestamp: new Date().toISOString(), carbs: c };
    const next = [ev, ...log]; setLog(next); await saveInsulinLog(next); setRescueCarbs('');
  }, [rescueCarbs, log, nowTs]);

  const updateSetting = (patch: Partial<InsulinSettings>) => {
    if (!settings) return; const next = { ...settings, ...patch }; setSettings(next); saveInsulinSettings(next);
  };

  // Log editing — relabel / re-unit / delete a past entry.
  const deleteEntry = useCallback(async (id: string) => {
    const next = log.filter(e => e.id !== id);
    setLog(next); await saveInsulinLog(next);
    setEditId(cur => (cur === id ? null : cur));
  }, [log]);
  const openEdit = (e: InsulinDose) => { setEditId(e.id); setEditMeal(e.mealName); setEditUnits(e.actualUnits); setEditTime(toLocalInput(e.timestamp)); };
  const saveEntryEdit = useCallback(async () => {
    if (!editId) return;
    const ts = editTime ? new Date(editTime).toISOString() : undefined;
    const next = log
      .map(e => (e.id === editId && e.kind === 'dose')
        ? { ...e, mealName: editMeal, actualUnits: editUnits, ...(ts ? { timestamp: ts } : {}) } : e)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setLog(next); await saveInsulinLog(next); setEditId(null);
  }, [editId, editMeal, editUnits, editTime, log]);

  // Reliable select-all on focus (iOS number inputs ignore .select(); text does).
  const selectAll = (el: HTMLInputElement) => setTimeout(() => { try { el.select(); } catch {} }, 0);

  if (!settings) return null;
  const gc = glucose?.current;
  const recent = log.slice(0, 7);  // last 7 ≈ one day — always shown
  const older = log.slice(7);      // everything else — behind show/hide
  const locked = proposal?.lockout;

  const fmtTime = (ts: string) => new Date(ts).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const mealOptions = meals.map(m => m.name);
  const renderEntry = (e: InsulinEvent) => {
    // Inline editor for a dose row (relabel meal + change units).
    if (editId === e.id && e.kind === 'dose') {
      const opts = mealOptions.includes(editMeal) ? mealOptions : [editMeal, ...mealOptions];
      return (
        <div key={e.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 space-y-1 text-[9px]">
          <div className="flex items-center gap-1.5">
            <span className="text-white/30 shrink-0">time</span>
            <input type="datetime-local" value={editTime} onChange={ev => setEditTime(ev.target.value)}
              className="min-w-0 flex-1 rounded bg-white/5 px-1 py-0.5 text-white/80 border border-white/10 outline-none" />
          </div>
          <div className="flex items-center gap-1.5">
            <select value={editMeal} onChange={ev => setEditMeal(ev.target.value)}
              className="min-w-0 flex-1 rounded bg-white/5 px-1 py-0.5 text-white/80 border border-white/10 outline-none">
              {opts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <input type="text" inputMode="decimal" value={editUnits} onFocus={ev => selectAll(ev.currentTarget)}
              onChange={ev => setEditUnits(parseFloat(ev.target.value) || 0)}
              className="w-9 rounded bg-white/5 px-1 py-0.5 text-right text-white/80 border border-white/10 outline-none no-spinners" />
            <span className="text-white/30">u</span>
            <button onClick={saveEntryEdit} className="rounded border border-cyan-400/30 px-1.5 py-0.5 text-cyan-300/80">save</button>
            <button onClick={() => setEditId(null)} className="text-white/30 px-1">✕</button>
          </div>
        </div>
      );
    }
    return e.kind === 'rescue' ? (
      <div key={e.id} className="flex items-center justify-between gap-2 text-[9px]">
        <span className="text-amber-300/50">{fmtTime(e.timestamp)} · rescue {e.carbs}g</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-white/20">excluded</span>
          <button onClick={() => deleteEntry(e.id)} className="text-red-400/40 hover:text-red-400/80">✕</button>
        </div>
      </div>
    ) : (
      <div key={e.id} className="flex items-center justify-between gap-2 text-[9px]">
        <span className="text-white/45 min-w-0 truncate">{fmtTime(e.timestamp)} · {e.mealName} · <strong className="text-white/65">{e.actualUnits}u</strong> @{e.glucoseBefore}</span>
        <div className="flex items-center gap-2 shrink-0">
          {e.verify ? (
            <span className={e.verify.confounded ? 'text-white/25' : e.verify.status === 'on-target' ? 'text-green-400/70' : e.verify.status === 'high' ? 'text-amber-300/70' : 'text-red-400/70'}>
              3h {e.verify.glucoseAfter} {e.verify.confounded ? '(conf.)' : e.verify.status === 'on-target' ? '✓' : e.verify.status === 'high' ? '↑' : '↓'}
            </span>
          ) : <span className="text-white/20">pending</span>}
          <button onClick={() => openEdit(e)} className="text-white/30 hover:text-cyan-300/70">✎</button>
          <button onClick={() => deleteEntry(e.id)} className="text-red-400/40 hover:text-red-400/80">✕</button>
        </div>
      </div>
    );
  };

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
            <button onClick={doRefresh} className={`flex items-center gap-1 transition-all active:scale-90 ${refreshing ? 'text-cyan-300' : 'hover:text-cyan-300/80'}`}>
              <span className={`inline-block ${refreshing ? 'animate-spin' : ''}`}>↻</span> refresh
            </button>
            <button onClick={() => setShowSettings(s => !s)} className="hover:text-white/60 transition-colors">{showSettings ? 'close' : 'setup'}</button>
          </div>
        </div>
      </div>

      <div className="px-5 pb-4">
        {/* Settings (compact) */}
        {showSettings && (
          <div className="mb-4 space-y-2">
            <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-xl border border-white/8 bg-black/20 p-3 text-[10px]">
              {([
                ['ICR AM', 'icrMorning'], ['ICR PM', 'icrEvening'], ['cutover h', 'cutoverHour'],
                ['ISF AM', 'isfMorning'], ['ISF PM', 'isfEvening'], ['max u', 'maxDose'],
                ['tgt low', 'targetLow'], ['tgt mid', 'targetMid'], ['tgt high', 'targetHigh'],
                ['DIA h', 'diaHours'], ['check h', 'checkAfterHours'],
              ] as [string, keyof InsulinSettings][]).map(([label, key]) => (
                <label key={key} className="flex items-center justify-between gap-1 text-white/40">
                  <span className="truncate">{label}</span>
                  <input type="text" inputMode="decimal" value={settings[key] as number} onFocus={e => selectAll(e.currentTarget)}
                    onChange={e => updateSetting({ [key]: parseFloat(e.target.value) || 0 } as Partial<InsulinSettings>)}
                    className="w-11 rounded bg-white/5 px-1.5 py-0.5 text-right font-mono tabular-nums text-white/80 no-spinners border border-white/5 focus:border-cyan-400/40 outline-none" />
                </label>
              ))}
            </div>

            {/* Basal + TDD sanity check — CONTEXT ONLY, never used for dosing. */}
            <div className="rounded-xl border border-white/8 bg-black/20 p-3 text-[10px]">
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-white/50">
                  <span>Basal u/day</span>
                  <input type="text" inputMode="decimal" value={settings.basalDose || 0} onFocus={e => selectAll(e.currentTarget)}
                    onChange={e => updateSetting({ basalDose: parseFloat(e.target.value) || 0 })}
                    className="w-14 rounded bg-white/5 px-1.5 py-0.5 text-right font-mono tabular-nums text-white/80 no-spinners border border-white/5 focus:border-cyan-400/40 outline-none" />
                </label>
                <label className="flex items-center gap-2 text-white/50">
                  <span>Bolus u/day</span>
                  <input type="text" inputMode="decimal" value={settings.typicalBolus || 0} onFocus={e => selectAll(e.currentTarget)}
                    onChange={e => updateSetting({ typicalBolus: parseFloat(e.target.value) || 0 })}
                    className="w-14 rounded bg-white/5 px-1.5 py-0.5 text-right font-mono tabular-nums text-white/80 no-spinners border border-white/5 focus:border-cyan-400/40 outline-none" />
                </label>
                {tddCheck && <span className="text-white/30 ml-auto">TDD ~{tddCheck.tdd.toFixed(0)}u · basal {tddCheck.basalPct.toFixed(0)}%</span>}
              </div>
              {!tddCheck ? (
                <div className="mt-1 text-white/25">Enter your daily basal to cross-check ICR/ISF against the TDD rules. Basal is never part of the dose math.</div>
              ) : (
                <div className="mt-1.5 text-white/35 leading-relaxed">
                  {tddCheck.reliable && (
                    <span><span className="text-cyan-300/50">Sanity check (not used for dosing):</span> 500-rule ICR ~{tddCheck.expectedICR.toFixed(1)} g/u · 1800-rule ISF ~{tddCheck.expectedISF.toFixed(0)} mg/dL/u. </span>
                  )}
                  {tddCheck.notes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {tddCheck.notes.map((n, i) => <li key={i} className={tddCheck.reliable ? 'text-amber-300/60' : 'text-white/30'}>{tddCheck.reliable ? '⚠ ' : ''}{n}</li>)}
                    </ul>
                  ) : <span className="text-green-400/50">Looks consistent with the TDD rules.</span>}
                  {bolusSource === 'actual' && (
                    <div className="mt-1 text-white/25">Bolus/day = your logged doses averaged over the last 7 days ({actualDailyBolus.days} day{actualDailyBolus.days === 1 ? '' : 's'} with data). Enter a value in Bolus u/day to override.</div>
                  )}
                  {bolusSource === 'plan' && (
                    <div className="mt-1 text-white/25">Bolus/day estimated from your meal plan (Σ carbs ÷ ICR) — log a couple of days of doses and it switches to your actual average. Enter a value to override.</div>
                  )}
                </div>
              )}
            </div>

            {/* Fast learning — single-outcome, direction-gated. Suggestion only. */}
            <div className="rounded-xl border border-white/8 bg-black/20 p-3 text-[10px] space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.learningMode} onChange={e => updateSetting({ learningMode: e.target.checked })} className="mt-0.5 accent-cyan-500" />
                <span className="text-white/45"><strong className="text-white/70">Fast learning</strong> — each verified 3-hour outcome corrects the suggested ICR &amp; ISF toward what would have hit target, so a miss today is mostly fixed by tomorrow. A single off-direction reading is damped; a consistent miss corrects hard. You still set your own units.</span>
              </label>
              {settings.learningMode && (
                <div className="flex items-center gap-2 pl-6">
                  <span className="text-white/40 shrink-0">Speed</span>
                  <input type="range" min={0.3} max={1} step={0.05}
                    value={settings.learnSpeed ?? 0.7}
                    onChange={e => updateSetting({ learnSpeed: parseFloat(e.target.value) })}
                    className="flex-1 accent-cyan-500" />
                  <span className="text-white/60 tabular-nums w-16 text-right">
                    {(() => { const s = settings.learnSpeed ?? 0.7; return s >= 0.85 ? `${s.toFixed(2)} full` : s >= 0.6 ? `${s.toFixed(2)} fast` : `${s.toFixed(2)} calm`; })()}
                  </span>
                </div>
              )}
            </div>
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
            {/* Proposed hero — dose (left) and glucose (right) at equal size */}
            <div className={`mb-1 rounded-2xl border p-4 ${locked ? 'border-red-500/30 bg-red-500/[0.07]' : 'border-cyan-400/15 bg-gradient-to-br from-cyan-500/[0.06] to-blue-600/[0.03]'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-white/40">Proposed dose</span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className={`text-5xl font-black data-value leading-none ${locked ? 'text-red-400' : 'bg-gradient-to-br from-white to-cyan-200 bg-clip-text text-transparent'}`}>{proposal.proposed}</span>
                    <span className="text-sm text-white/40">units</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase tracking-wider text-white/40">Glucose</span>
                  {/* Same thresholds as the main glucose card (page.tsx gValColor):
                      <80 red · ≤120 green · ≤160 amber · >160 red */}
                  <div className="flex items-baseline justify-end gap-1.5 mt-0.5"
                    style={{ color: gc.value < 80 ? '#ef4444' : gc.value <= 120 ? '#22c55e' : gc.value <= 160 ? '#f59e0b' : '#ef4444' }}>
                    <span className="text-5xl font-black data-value tabular-nums leading-none">{gc.value}</span>
                    <span className="text-lg">{gc.trend}</span>
                  </div>
                </div>
              </div>
              {!locked && (
                <div className="mt-2 text-[9px] text-white/30">
                  {proposal.block}
                  {proposal.breakdown.carbBolus > 0 ? ` · carb ${Math.round(proposal.breakdown.carbBolus)}u` : ''}
                  {proposal.breakdown.correctionBolus > 0 ? ` + corr ${Math.round(proposal.breakdown.correctionBolus)}u` : ''}
                  {proposal.breakdown.correctionBolus < 0 ? ` − low ${Math.abs(Math.round(proposal.breakdown.correctionBolus))}u` : ''}
                  {proposal.breakdown.carbBolus === 0 && proposal.breakdown.correctionBolus === 0 ? ' · nothing to dose' : ''}
                  {proposal.breakdown.trendAdjPct !== 0 ? ` · trend ${proposal.breakdown.trendAdjPct > 0 ? '+' : ''}${proposal.breakdown.trendAdjPct}%` : ''}
                  {proposal.breakdown.iob > 0 ? ` · −${Math.round(proposal.breakdown.iob)}u IOB` : ''}
                  {` · ICR ${proposal.breakdown.icr} · ISF ${proposal.breakdown.isf}`}
                </div>
              )}
              {/* Reference: last time you dosed this meal + how it landed after
                  the insulin had acted (glucose at the 3h check). */}
              {lastForMeal && (
                <div className="mt-2 pt-2 border-t border-white/[0.06] text-xs text-white/45 flex items-center justify-between gap-2">
                  <span>
                    Last {meal?.correction ? 'correction' : 'time'}: <strong className="text-white/70">{lastForMeal.actualUnits}u</strong>
                    <span className="text-white/30"> @{lastForMeal.glucoseBefore} · {new Date(lastForMeal.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </span>
                  {lastForMeal.verify ? (
                    <span className={lastForMeal.verify.confounded ? 'text-white/30' : lastForMeal.verify.status === 'on-target' ? 'text-green-400/80' : lastForMeal.verify.status === 'high' ? 'text-amber-300/80' : 'text-red-400/80'}>
                      → {lastForMeal.verify.glucoseAfter}{lastForMeal.verify.confounded ? ' (conf.)' : lastForMeal.verify.status === 'on-target' ? ' in target' : lastForMeal.verify.status === 'high' ? ' too high' : ' too low'}
                    </span>
                  ) : <span className="text-white/25">outcome pending</span>}
                </div>
              )}
            </div>

            {/* Warnings */}
            {proposal.warnings.length > 0 && (
              <div className="mb-2 mt-2 space-y-1">
                {proposal.warnings.map((w, i) => (
                  <div key={i} className={`text-xs flex items-start gap-1 ${locked && i === 0 ? 'text-red-300' : 'text-amber-300/80'}`}><span>⚠</span><span>{w}</span></div>
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
        </div>

        {/* Learning signal */}
        {(() => {
          const lm = settings.learningMode;
          const blk = (
            label: string,
            licr?: { seed: number; icr: number; n: number }, lisf?: { seed: number; isf: number; n: number },
            eicr?: { icr: number; n: number }, eisf?: { isf: number; n: number },
          ) => {
            const parts: string[] = [];
            if (lm && licr) parts.push(`ICR ${licr.seed}→${licr.icr} (${licr.n})`); else if (eicr) parts.push(`ICR ~${eicr.icr} (${eicr.n})`);
            if (lm && lisf) parts.push(`ISF ${lisf.seed}→${lisf.isf} (${lisf.n})`); else if (eisf) parts.push(`ISF ~${eisf.isf} (${eisf.n})`);
            return parts.length ? `${label} ${parts.join(' · ')}` : '';
          };
          const str = [
            blk('AM', learned.morning, learnedIsf.morning, empirical.morning, empiricalIsf.morning),
            blk('PM', learned.evening, learnedIsf.evening, empirical.evening, empiricalIsf.evening),
          ].filter(Boolean).join(' · ');
          if (!str) return null;
          return (
            <div className={`mt-1.5 text-[9px] leading-relaxed ${lm ? 'text-cyan-300/70' : 'text-cyan-300/40'}`}>
              {lm ? 'Learning ON · ' : 'Learning · '}{str}{lm ? ' — applied to the suggestion.' : ` — turn on Learning mode in setup to apply this.`}
            </div>
          );
        })()}

        {/* Per-meal learned ICR — this meal is dosed off its OWN history, not the
            pooled block ICR, so e.g. lunch no longer inherits breakfast's ratio. */}
        {settings.learningMode && meal && !meal.correction && mealLearned[meal.name] && (
          <div className="mt-1 text-[9px] leading-relaxed text-cyan-300/70">
            {meal.name}: ICR {mealLearned[meal.name].seed}→{mealLearned[meal.name].icr} ({mealLearned[meal.name].n} outcome{mealLearned[meal.name].n === 1 ? '' : 's'}) — learned from this meal alone.
          </div>
        )}

        {/* History — last 7 (≈ one day) always shown; older behind a toggle */}
        {log.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
            {recent.map(renderEntry)}
            {showHistory && older.map(renderEntry)}
            {older.length > 0 && (
              <button onClick={() => setShowHistory(s => !s)}
                className="mt-1 w-full text-center text-[9px] uppercase tracking-wider text-white/25 hover:text-white/50 transition-colors">
                {showHistory ? '▲ hide older' : `▼ show ${older.length} older`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
