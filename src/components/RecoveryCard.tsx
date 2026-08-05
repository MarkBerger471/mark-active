'use client';

import { useMemo, useState } from 'react';

// Sleep night from Oura (via /api/oura). Mirrors the dashboard SleepDay plus the
// two fields the recovery composite needs (readiness, respiration) which the API
// already returns.
export interface SleepDay {
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
  avgBreath?: number;
  readinessScore?: number | null;
  bedtimeStart?: string;
  bedtimeEnd?: string;
}

export interface GluPoint { value: number; timestamp: string; epoch?: number }

const STAGE = { deep: '#8b5cf6', light: '#3aa8e8', rem: '#22c79a', awake: '#e8a41c' } as const;
type StageKey = keyof typeof STAGE;
const STAGE_ORDER: { key: StageKey; name: string }[] = [
  { key: 'awake', name: 'Awake' }, { key: 'rem', name: 'REM' },
  { key: 'light', name: 'Light' }, { key: 'deep', name: 'Deep' },
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const fmtDur = (s?: number) => {
  if (!s || s <= 0) return '—';
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const fmtClock = (e: number) => new Date(e).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const epochOf = (p: GluPoint) => p.epoch ?? Date.parse(p.timestamp) ?? 0;

// Percentile band [p10,p90] from a night's history for personalized normalizing.
function band(vals: number[], fallback: [number, number]): [number, number] {
  const s = vals.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (s.length < 4) return fallback;
  const q = (p: number) => s[Math.round((s.length - 1) * p)];
  const lo = q(0.1), hi = q(0.9);
  return hi > lo ? [lo, hi] : fallback;
}
const pct = (v: number, lo: number, hi: number) => clamp(((v - lo) / (hi - lo)) * 100, 0, 100);

// Realistic hypnogram from real stage TOTALS (ordering illustrative until the
// sleep_phase_5_min field is wired). Each stage's total time is exact.
const HYP_TEMPLATE: [StageKey, number][] = [
  ['awake', 6], ['light', 18], ['deep', 22], ['light', 12], ['deep', 14], ['light', 16], ['rem', 12],
  ['light', 20], ['awake', 3], ['deep', 8], ['light', 18], ['rem', 18], ['light', 18], ['deep', 5],
  ['light', 22], ['rem', 22], ['light', 16], ['awake', 7], ['light', 18], ['rem', 26], ['light', 12],
  ['awake', 4], ['light', 14], ['rem', 18],
];
function hypnogram(d: SleepDay): { s: StageKey; m: number }[] {
  const tot: Record<StageKey, number> = { awake: 0, light: 0, deep: 0, rem: 0 };
  HYP_TEMPLATE.forEach(([s, m]) => { tot[s] += m; });
  const real: Record<StageKey, number> = {
    awake: (d.awakeTime || 0) / 60, light: (d.lightSleep || 0) / 60,
    deep: (d.deepSleep || 0) / 60, rem: (d.remSleep || 0) / 60,
  };
  const scale: Record<StageKey, number> = {
    awake: tot.awake ? real.awake / tot.awake : 0, light: tot.light ? real.light / tot.light : 0,
    deep: tot.deep ? real.deep / tot.deep : 0, rem: tot.rem ? real.rem / tot.rem : 0,
  };
  return HYP_TEMPLATE.map(([s, m]) => ({ s, m: m * scale[s] }));
}

export default function RecoveryCard({ sleep, glucose, nowTs }:
  { sleep: SleepDay[]; glucose: GluPoint[]; nowTs: number }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(-1); // index into last7; -1 = default

  // last 7 calendar days, newest last
  const last7 = useMemo(() => {
    const byDay = new Map(sleep.map(s => [s.day, s]));
    const local = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const base = new Date(nowTs);
    const out: { day: string; data: SleepDay | null }[] = [];
    for (let i = 6; i >= 0; i--) { const dt = new Date(base); dt.setDate(base.getDate() - i); out.push({ day: local(dt), data: byDay.get(local(dt)) || null }); }
    return out;
  }, [sleep, nowTs]);

  const defaultIdx = useMemo(() => { for (let i = last7.length - 1; i >= 0; i--) if (last7[i].data) return i; return -1; }, [last7]);
  const activeIdx = pick >= 0 && pick < last7.length && last7[pick].data ? pick : defaultIdx;
  const d = (activeIdx >= 0 ? last7[activeIdx].data : null) || sleep[0];

  // overnight glucose within the selected night's in-bed window
  const overnight = useMemo(() => {
    if (!d?.bedtimeStart || !d?.bedtimeEnd) return null;
    const bs = Date.parse(d.bedtimeStart), be = Date.parse(d.bedtimeEnd);
    if (!(be > bs)) return null;
    const pts = glucose.map(p => ({ e: epochOf(p), v: p.value })).filter(p => p.e >= bs && p.e <= be && p.v > 0).sort((a, b) => a.e - b.e);
    if (pts.length < 4) return null;
    const vals = pts.map(p => p.v);
    const nadir = Math.min(...vals);
    const below = vals.filter(v => v < 70).length;
    const inR = vals.filter(v => v >= 70 && v <= 140).length;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const winMin = Math.round((be - bs) / 60000);
    const pctLow = Math.round((below / vals.length) * 100);
    return {
      bs, be, pts, nadir, tir: Math.round((inR / vals.length) * 100),
      pctLow, lowMin: Math.round((winMin * pctLow) / 100), cv: Math.round((sd / mean) * 100),
    };
  }, [d, glucose]);

  // recovery composite (transparent, personalized bands)
  const rec = useMemo(() => {
    const hist = sleep.slice(0, 14);
    const hrvB = band(hist.map(s => s.avgHrv || 0), [15, 45]);
    const rhrB = band(hist.map(s => s.lowestHr || 0), [48, 64]);
    const sleepN = clamp(d.score, 0, 100);
    const hrvN = d.avgHrv ? pct(d.avgHrv, hrvB[0], hrvB[1]) : 60;
    const rhrN = d.lowestHr ? 100 - pct(d.lowestHr, rhrB[0], rhrB[1]) : 60;
    const respN = d.avgBreath ? clamp(100 - Math.abs(d.avgBreath - 14) * 8, 40, 100) : 80;
    const base = Math.round(0.45 * sleepN + 0.30 * hrvN + 0.15 * rhrN + 0.10 * respN);
    const penalty = overnight && overnight.nadir < 70
      ? Math.min(14, Math.round(overnight.pctLow * 0.28 + (70 - overnight.nadir) * 0.35)) : 0;
    return { base, penalty, score: Math.max(0, base - penalty), parts: { sleepN, hrvN, rhrN, respN } };
  }, [d, sleep, overnight]);

  if (!sleep.length || !d) return null;

  const zone = rec.score >= 67 ? { c: '#34d399', t: 'Ready' } : rec.score >= 34 ? { c: '#fbbf24', t: 'Moderate' } : { c: '#f87171', t: 'Low' };
  const headline = overnight && overnight.nadir < 70 && overnight.lowMin >= 20
    ? <>Restless night<span className="text-white/25 mx-1.5">·</span><span className="text-red-300">{overnight.lowMin} min low</span></>
    : d.score >= 85 ? <>Strong night</> : d.score >= 70 ? <>Solid night</> : <>Rough night</>;
  const dateLabel = new Date(d.day + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="glass-card mb-6 fade-up overflow-hidden">
      {/* ---------- COMPACT ---------- */}
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
        <div className="grid items-center px-4 py-4" style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto', columnGap: 14 }}>
          <RingMini score={rec.score} color={zone.c} />
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-[0.14em] text-white/30 whitespace-nowrap overflow-hidden text-ellipsis">Today · {dateLabel}</div>
            <div className="text-[14px] font-bold leading-snug mt-1 text-white" style={{ letterSpacing: '-0.015em' }}>{headline}</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-white/30 transition-transform duration-300" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
            <path d="M4 7l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="grid grid-cols-4 gap-2 mt-3" style={{ gridColumn: '1 / -1' }}>
            <Micro k="Sleep" v={String(d.score)} />
            <Micro k="Nadir" v={overnight ? String(overnight.nadir) : '—'} u={overnight ? 'mg/dL' : undefined} color={overnight && overnight.nadir < 70 ? '#f87171' : undefined} />
            <Micro k="Readiness" v={d.readinessScore != null ? String(d.readinessScore) : '—'} />
            <Micro k="Asleep" v={d.totalSleep ? (d.totalSleep / 3600).toFixed(1) : '—'} u={d.totalSleep ? 'h' : undefined} />
          </div>
        </div>
      </button>

      {/* ---------- UNFOLD ---------- */}
      <div className="grid transition-[grid-template-rows] duration-[420ms] ease-[cubic-bezier(.4,0,.2,1)]" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4">

            {/* Recovery composite */}
            <Section eyebrow="Recovery" badge="HRV · rest HR · resp · sleep">
              <div className="text-[14px] font-bold text-white mt-1" style={{ letterSpacing: '-0.015em' }}>{rec.score} · {zone.t}</div>
              <div className="flex items-center gap-4 mt-3">
                <RingBig score={rec.score} color={zone.c} />
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <Bar label="Sleep" v={rec.parts.sleepN} raw={`${d.score}`} color="#3aa8e8" />
                  <Bar label="HRV" v={rec.parts.hrvN} raw={d.avgHrv ? `${d.avgHrv}` : '—'} color="#22c79a" />
                  <Bar label="Rest HR" v={rec.parts.rhrN} raw={d.lowestHr ? `${Math.round(d.lowestHr)}` : '—'} color="#22d3ee" />
                  <Bar label="Resp" v={rec.parts.respN} raw={d.avgBreath ? `${d.avgBreath}` : '—'} color="#8b5cf6" />
                </div>
              </div>
              {rec.penalty > 0 && overnight && (
                <div className="mt-3 text-[11px] leading-relaxed text-white/60 rounded-xl px-3 py-2.5" style={{ background: 'rgba(248,113,113,.07)', border: '1px solid rgba(248,113,113,.18)' }}>
                  Ring recovery was <b className="text-white/80">{rec.base}</b> — but your CGM logged <b className="text-red-300">~{overnight.lowMin} min under 70</b> overnight, so metabolic recovery drops to <b className="text-red-300">{rec.score}</b>. Oura & Whoop can&apos;t see this.
                </div>
              )}
            </Section>

            {/* Day strip */}
            <Section eyebrow="Night">
              <div className="flex gap-1">
                {last7.map((slot, i) => {
                  const isActive = i === activeIdx, has = !!slot.data;
                  const sc = slot.data ? (slot.data.score >= 85 ? '#34d399' : slot.data.score >= 70 ? '#e8a41c' : '#f87171') : 'rgba(255,255,255,0.25)';
                  const dt = new Date(slot.day + 'T00:00:00');
                  return (
                    <button key={slot.day} onClick={() => has && setPick(i)} disabled={!has}
                      className="flex-1 py-1.5 rounded-lg text-center transition-all"
                      style={{ border: isActive ? `1px solid ${sc}50` : '1px solid rgba(255,255,255,0.06)', background: isActive ? `${sc}18` : 'rgba(255,255,255,0.03)', opacity: has ? 1 : 0.35, cursor: has ? 'pointer' : 'default' }}>
                      <div className="text-[9px] uppercase" style={{ color: isActive ? `${sc}bb` : 'rgba(255,255,255,0.3)', fontWeight: isActive ? 600 : 400 }}>{dt.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                      <div className="text-[13px] mt-0.5" style={{ color: isActive ? sc : 'rgba(255,255,255,0.4)', fontWeight: isActive ? 800 : 700 }}>{dt.getDate()}</div>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Fused timeline */}
            <Section eyebrow="The night" badge="CGM × sleep">
              <FusedChart d={d} overnight={overnight} />
              <div className="flex flex-wrap gap-3 mt-3">
                {STAGE_ORDER.slice().reverse().map(s => <Legend key={s.key} c={STAGE[s.key]} label={s.name} />)}
                {overnight && <Legend c="#eef1f6" label="Glucose" line />}
              </div>
              {!overnight && <div className="text-[11px] text-white/35 mt-2">No overnight CGM stored for this night — the glucose overlay shows for the most recent night only.</div>}
              <div className="text-[10px] text-cyan-300/45 mt-2">Stage totals are real; the minute-shape is illustrative until the 5-min phase field is wired.</div>
            </Section>

            {/* Overnight glucose KPIs */}
            {overnight && (
              <Section eyebrow="Overnight glucose" badge="while you slept">
                <div className="grid grid-cols-4 gap-2 mt-1">
                  <Kpi k="In range" v={overnight.tir} u="%" foot="70–140" color={overnight.tir >= 70 ? '#34d399' : '#fbbf24'} />
                  <Kpi k="Nadir" v={overnight.nadir} foot="lowest" color="#f87171" />
                  <Kpi k="Below 70" v={overnight.pctLow} u="%" foot={`≈${overnight.lowMin} min`} color="#f87171" />
                  <Kpi k="Variability" v={overnight.cv} u="%" foot={overnight.cv < 36 ? 'stable' : 'swingy'} color={overnight.cv < 36 ? '#34d399' : '#fbbf24'} />
                </div>
              </Section>
            )}

            {/* Stage breakdown */}
            <Section eyebrow="Time in each stage">
              <StageBar d={d} />
            </Section>

            {/* Trend */}
            <Section eyebrow="Score & readiness · recent">
              <TrendChart nights={last7.filter(s => s.data).map(s => s.data as SleepDay)} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */
function Micro({ k, v, u, color }: { k: string; v: string; u?: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[8px] uppercase tracking-[0.08em] text-white/25 whitespace-nowrap">{k}</div>
      <div className="text-[14px] font-bold whitespace-nowrap" style={{ color: color || '#fff' }}>{v}{u && <span className="text-[9px] text-white/30 font-medium"> {u}</span>}</div>
    </div>
  );
}
function Section({ eyebrow, badge, children }: { eyebrow: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="py-4 border-t border-white/5 first:border-t-0 first:pt-2">
      <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.15em] text-white/30">
        {eyebrow}{badge && <span className="normal-case tracking-[0.06em] text-[8.5px] text-cyan-300/55 border border-cyan-300/20 rounded px-1.5 py-px">{badge}</span>}
      </div>
      {children}
    </div>
  );
}
function Legend({ c, label, line }: { c: string; label: string; line?: boolean }) {
  return <span className="flex items-center gap-1.5 text-[10.5px] text-white/55"><span style={{ background: c, width: line ? 14 : 9, height: line ? 3 : 9, borderRadius: line ? 2 : 3, display: 'inline-block' }} />{label}</span>;
}
function Kpi({ k, v, u, foot, color }: { k: string; v: number; u?: string; foot: string; color: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ border: '1px solid rgba(255,255,255,.075)', background: 'rgba(255,255,255,.02)' }}>
      <div className="text-[8.5px] uppercase tracking-[0.07em] text-white/30">{k}</div>
      <div className="text-[17px] font-bold mt-0.5 tabular-nums" style={{ color }}>{v}{u && <span className="text-[9.5px] text-white/30 font-medium">{u}</span>}</div>
      <div className="text-[9px] text-white/20 mt-px">{foot}</div>
    </div>
  );
}
function Bar({ label, v, raw, color }: { label: string; v: number; raw: string; color: string }) {
  return (
    <div className="grid items-center gap-2" style={{ gridTemplateColumns: '46px 1fr 30px' }}>
      <span className="text-[9.5px] uppercase tracking-[0.04em] text-white/30">{label}</span>
      <span className="h-[6px] rounded relative overflow-hidden" style={{ background: 'rgba(255,255,255,.06)' }}>
        <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${v}%`, background: color, opacity: 0.85 }} />
      </span>
      <span className="text-[10px] font-bold text-right text-white/80 tabular-nums">{raw}</span>
    </div>
  );
}
function RingMini({ score, color }: { score: number; color: string }) {
  const r = 25, c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: 60, height: 60 }}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="5.5" />
        <circle cx="30" cy="30" r={r} fill="none" stroke={color} strokeWidth="5.5" strokeLinecap="round" transform="rotate(-90 30 30)" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-extrabold leading-none text-white">{score}</span>
        <span className="text-[7px] tracking-[0.1em] text-white/30 mt-px">RECOVERY</span>
      </div>
    </div>
  );
}
function RingBig({ score, color }: { score: number; color: string }) {
  const r = 43, c = 2 * Math.PI * r;
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" className="shrink-0">
      <circle cx="52" cy="52" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="8" />
      <circle cx="52" cy="52" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" transform="rotate(-90 52 52)" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      <text x="52" y="49" textAnchor="middle" fill="#fff" style={{ fontSize: 29, fontWeight: 800 }}>{score}</text>
      <text x="52" y="66" textAnchor="middle" fill="rgba(255,255,255,.42)" style={{ fontSize: 8.5, letterSpacing: '.12em' }}>{score >= 67 ? 'READY' : score >= 34 ? 'MODERATE' : 'LOW'}</text>
    </svg>
  );
}
function StageBar({ d }: { d: SleepDay }) {
  const tib = (d.deepSleep || 0) + (d.lightSleep || 0) + (d.remSleep || 0) + (d.awakeTime || 0) || 1;
  const rows: { key: StageKey; name: string; v: number }[] = [
    { key: 'deep', name: 'Deep', v: d.deepSleep || 0 }, { key: 'light', name: 'Light', v: d.lightSleep || 0 },
    { key: 'rem', name: 'REM', v: d.remSleep || 0 }, { key: 'awake', name: 'Awake', v: d.awakeTime || 0 },
  ];
  return (
    <>
      <div className="flex h-6 rounded-lg overflow-hidden gap-[2px] mt-3">
        {rows.map(r => r.v > 0 && <div key={r.key} style={{ flex: r.v, background: STAGE[r.key], opacity: 0.92 }} />)}
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {rows.map(r => (
          <span key={r.key} className="flex items-center gap-1.5 text-[10.5px] text-white/55">
            <span style={{ background: STAGE[r.key], width: 9, height: 9, borderRadius: 3, display: 'inline-block' }} />
            {r.name} <b className="text-white/85 font-semibold">{fmtDur(r.v)}</b>
            <span className="text-white/25 text-[9.5px]">{Math.round((r.v / tib) * 100)}%</span>
          </span>
        ))}
      </div>
    </>
  );
}

function FusedChart({ d, overnight }: { d: SleepDay; overnight: { bs: number; be: number; pts: { e: number; v: number }[] } | null }) {
  const W = 400, padL = 6, padR = 34, plotW = W - padL - padR;
  const top = 4, laneH = 21, gap = 5;
  const laneY = (k: StageKey) => top + STAGE_ORDER.findIndex(x => x.key === k) * (laneH + gap);
  const hypB = top + 4 * (laneH + gap) - gap;
  const segs = hypnogram(d);
  const sumM = segs.reduce((a, b) => a + b.m, 0) || 1;

  // time domain: prefer the real in-bed window, else just the hypnogram span
  const bs = overnight?.bs ?? (d.bedtimeStart ? Date.parse(d.bedtimeStart) : 0);
  const be = overnight?.be ?? (d.bedtimeEnd ? Date.parse(d.bedtimeEnd) : sumM * 60000);
  const winMs = be - bs || sumM * 60000;
  const X = (e: number) => padL + plotW * ((e - bs) / winMs);

  const gTop = hypB + 28, gH = 66, gMin = 40, gMax = 170;
  const gY = (v: number) => gTop + gH * (1 - (v - gMin) / (gMax - gMin));
  const iw = overnight?.pts ?? [];
  const dp = iw.map((p, i) => `${i ? 'L' : 'M'}${X(p.e).toFixed(1)} ${gY(p.v).toFixed(1)}`).join(' ');

  let acc = 0;
  const bars = segs.map((seg, i) => {
    const x0 = padL + plotW * (acc / sumM), w = plotW * (seg.m / sumM); acc += seg.m;
    return <rect key={i} x={x0 + 0.5} y={laneY(seg.s)} width={Math.max(0.6, w - 1)} height={laneH} rx="4" fill={STAGE[seg.s]} fillOpacity={0.9} />;
  });

  return (
    <svg viewBox={`0 0 ${W} ${overnight ? 244 : hypB + 24}`} className="w-full mt-3" style={{ overflow: 'visible' }}>
      {STAGE_ORDER.map(st => <text key={st.key} x={padL} y={laneY(st.key) - 3} fill={STAGE[st.key]} style={{ fontSize: 8, fontWeight: 600 }}>{st.name}</text>)}
      {bars}
      {overnight && <>
        <rect x={padL} y={gY(70)} width={plotW} height={gY(gMin) - gY(70)} fill="rgba(248,113,113,.09)" />
        {[70, 140].map(g => <g key={g}>
          <line x1={padL} x2={W - padR} y1={gY(g)} y2={gY(g)} stroke="rgba(255,255,255,.09)" strokeWidth="1" strokeDasharray={g === 70 ? '3 3' : '2 4'} />
          <text x={W - padR + 5} y={gY(g) + 3} fill="rgba(255,255,255,.32)" style={{ fontSize: 9 }}>{g}</text>
        </g>)}
        <path d={dp} fill="none" stroke="#eef1f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.85} />
        {iw.map((p, i) => {
          const low = p.v < 70;
          return <g key={i}>
            {low && <line x1={X(p.e)} x2={X(p.e)} y1={gY(p.v)} y2={hypB} stroke="rgba(248,113,113,.15)" strokeWidth="1" />}
            <circle cx={X(p.e)} cy={gY(p.v)} r={low ? 3.2 : 2} fill={low ? '#f87171' : '#eef1f6'} stroke="#12122a" strokeWidth={low ? 1.4 : 1} />
          </g>;
        })}
        <text x={padL} y={hypB + 15} fill="rgba(255,255,255,.32)" style={{ fontSize: 8, letterSpacing: '.1em' }}>GLUCOSE mg/dL</text>
        {[0, 0.25, 0.5, 0.75, 1].map(f => { const e = bs + winMs * f; return <text key={f} x={clamp(X(e), 12, W - 16)} y={gTop + gH + 15} textAnchor="middle" fill="rgba(255,255,255,.32)" style={{ fontSize: 9 }}>{fmtClock(e)}</text>; })}
      </>}
    </svg>
  );
}

function TrendChart({ nights }: { nights: SleepDay[] }) {
  const W = 400, padL = 8, padR = 8, padT = 14, padB = 22, H = 132;
  const plotW = W - padL - padR, plotH = H - padT - padB, yMin = 40, yMax = 100;
  const y = (v: number) => padT + plotH * (1 - (v - yMin) / (yMax - yMin));
  if (nights.length === 0) return <div className="text-[11px] text-white/35 mt-2">Not enough nights yet.</div>;
  const n = nights.length, step = plotW / n, bw = Math.min(32, step * 0.44);
  const band = (s: number) => s >= 85 ? '#34d399' : s >= 70 ? '#22d3ee' : s >= 60 ? '#e8a41c' : '#f87171';
  const readi = nights.map((d, i) => ({ x: padL + step * (i + 0.5), y: y(d.readinessScore ?? d.score) }));
  const rp = readi.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2" style={{ overflow: 'visible' }}>
      {[60, 80, 100].map(g => <g key={g}><line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,.06)" /><text x={padL} y={y(g) - 3} fill="rgba(255,255,255,.32)" style={{ fontSize: 9 }}>{g}</text></g>)}
      {nights.map((d, i) => {
        const cx = padL + step * (i + 0.5);
        return <g key={d.day}>
          <rect x={cx - bw / 2} y={y(d.score)} width={bw} height={padT + plotH - y(d.score)} rx="4" fill={band(d.score)} fillOpacity={0.9} />
          <text x={cx} y={y(d.score) - 5} textAnchor="middle" fill="rgba(255,255,255,.7)" style={{ fontSize: 10, fontWeight: 700 }}>{d.score}</text>
          <text x={cx} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,.32)" style={{ fontSize: 9 }}>{new Date(d.day + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</text>
        </g>;
      })}
      <path d={rp} fill="none" stroke="#22d3ee" strokeWidth="2" strokeOpacity={0.9} />
      {readi.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="#22d3ee" stroke="#12122a" strokeWidth="1.5" />)}
      <text x={W - padR} y={padT - 2} textAnchor="end" fill="#22d3ee" style={{ fontSize: 9, fontWeight: 600 }}>— Readiness</text>
    </svg>
  );
}
