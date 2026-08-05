'use client';

import { useEffect, useMemo, useState } from 'react';

// Ambulatory Glucose Profile — collapses the archived CGM (last N days) onto a
// single 24h clock as percentile bands (p10–90 / p25–75 / median) plus the
// standard metric set (TIR / below / very-low / above / GMI / CV / mean).
// Reads /api/glucose-history; time-of-day is computed in the device's local tz.

interface Reading { t: number; v: number }
interface Bin { i: number; n: number; p10: number; p25: number; p50: number; p75: number; p90: number }

const BINS = 48;                    // 30-min bins across the day
const BIN_MIN = 24 * 60 / BINS;
const IN_LO = 70, IN_HI = 140;      // this app runs tight control
const VLOW = 54;

const pctl = (s: number[], p: number) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function GlucoseAGPCard({ days = 14 }: { days?: number }) {
  const [open, setOpen] = useState(false);
  const [readings, setReadings] = useState<Reading[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/glucose-history?days=${days}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setReadings(Array.isArray(j.readings) ? j.readings : []); })
      .catch(() => { if (!cancelled) setReadings([]); });
    return () => { cancelled = true; };
  }, [days]);

  const agp = useMemo(() => {
    if (!readings || readings.length === 0) return null;
    const vals = readings.map(r => r.v);
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const pctOf = (f: (v: number) => boolean) => Math.round((vals.filter(f).length / n) * 100);
    const dayCount = new Set(readings.map(r => localDay(r.t))).size;
    // per-bin percentiles (pure grouping, no render-time mutation)
    const binOf = (t: number) => { const d = new Date(t); return Math.floor((d.getHours() * 60 + d.getMinutes()) / BIN_MIN); };
    const bins: Bin[] = Array.from({ length: BINS }, (_, i) => {
      const s = readings.filter(r => binOf(r.t) === i).map(r => r.v).sort((a, b) => a - b);
      return { i, n: s.length, p10: s.length ? pctl(s, .1) : NaN, p25: s.length ? pctl(s, .25) : NaN, p50: s.length ? pctl(s, .5) : NaN, p75: s.length ? pctl(s, .75) : NaN, p90: s.length ? pctl(s, .9) : NaN };
    }).filter(b => b.n > 0);
    return {
      n, dayCount, mean: Math.round(mean),
      gmi: Math.round((3.31 + 0.02392 * mean) * 10) / 10,   // GMI %
      cv: Math.round((sd / mean) * 100),
      tir: pctOf(v => v >= IN_LO && v <= IN_HI),
      below: pctOf(v => v < IN_LO),
      veryLow: pctOf(v => v < VLOW),
      above: pctOf(v => v > IN_HI),
      bins,
    };
  }, [readings]);

  if (readings === null) return <div className="glass-card mb-6 h-20 animate-pulse opacity-40" />;
  if (!agp) return null; // nothing archived yet

  const tirColor = agp.tir >= 70 ? '#34d399' : agp.tir >= 50 ? '#fbbf24' : '#f87171';

  return (
    <div className="glass-card mb-6 fade-up overflow-hidden">
      {/* compact */}
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
        <div className="grid items-center px-4 py-4" style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto', columnGap: 14 }}>
          <div className="flex flex-col items-center justify-center rounded-2xl px-3 py-2" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', minWidth: 60 }}>
            <span className="text-[19px] font-extrabold leading-none tabular-nums" style={{ color: '#22d3ee' }}>{agp.gmi}</span>
            <span className="text-[7px] tracking-[0.1em] text-white/30 mt-1">GMI %</span>
          </div>
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-[0.14em] text-white/30 whitespace-nowrap">Glucose profile · {agp.dayCount} day{agp.dayCount === 1 ? '' : 's'}</div>
            <div className="text-[14px] font-bold leading-snug mt-1 text-white" style={{ letterSpacing: '-.015em' }}>
              <span style={{ color: tirColor }}>{agp.tir}%</span> in range<span className="text-white/25 mx-1.5">·</span><span className={agp.below >= 5 ? 'text-red-300' : 'text-white/60'}>{agp.below}% low</span>
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-white/30 transition-transform duration-300" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
            <path d="M4 7l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="grid grid-cols-4 gap-2 mt-3" style={{ gridColumn: '1 / -1' }}>
            <Micro k="In range" v={`${agp.tir}`} u="%" color={tirColor} />
            <Micro k="Below 70" v={`${agp.below}`} u="%" color={agp.below >= 5 ? '#f87171' : undefined} />
            <Micro k="Variability" v={`${agp.cv}`} u="%CV" color={agp.cv < 36 ? '#34d399' : '#fbbf24'} />
            <Micro k="Mean" v={`${agp.mean}`} u="mg/dL" />
          </div>
        </div>
      </button>

      {/* unfold */}
      <div className="grid transition-[grid-template-rows] duration-[420ms] ease-[cubic-bezier(.4,0,.2,1)]" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4">
            <div className="py-4 border-t border-white/5">
              <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.15em] text-white/30">
                Ambulatory glucose profile<span className="normal-case tracking-[0.06em] text-[8.5px] text-cyan-300/55 border border-cyan-300/20 rounded px-1.5 py-px">last {agp.dayCount}d</span>
              </div>
              <div className="text-[11px] text-white/55 mt-1">Every day stacked on one 24-hour clock — median line, 25–75% (solid) &amp; 10–90% (faint) bands.</div>
              <AGPChart bins={agp.bins} />
              <div className="flex flex-wrap gap-3 mt-2">
                <Legend c="#22d3ee" label="Median" line />
                <Legend c="rgba(34,211,238,.28)" label="25–75%" />
                <Legend c="rgba(34,211,238,.12)" label="10–90%" />
                <Legend c="#34d399" label="70–140 target" line />
              </div>
              {agp.dayCount < 14 && (
                <div className="mt-3 text-[10.5px] leading-relaxed text-cyan-300/50 rounded-xl px-3 py-2" style={{ border: '1px solid rgba(34,211,238,.15)' }}>
                  Building your profile — <b className="text-cyan-200/70">{agp.dayCount} of 14 days</b> ({agp.n} readings). Bands tighten and get more reliable as more days bank; a full clinical AGP is 14 days.
                </div>
              )}
            </div>

            <div className="py-4 border-t border-white/5">
              <div className="text-[9.5px] uppercase tracking-[0.15em] text-white/30">Metrics · last {agp.dayCount}d</div>
              <div className="grid grid-cols-4 gap-2 mt-3">
                <Kpi k="In range" v={agp.tir} u="%" foot="70–140" color={tirColor} />
                <Kpi k="Below 70" v={agp.below} u="%" foot="low" color={agp.below >= 5 ? '#f87171' : '#e8a41c'} />
                <Kpi k="Very low" v={agp.veryLow} u="%" foot="<54" color={agp.veryLow > 0 ? '#f87171' : '#34d399'} />
                <Kpi k="Above 140" v={agp.above} u="%" foot="high" color={agp.above >= 25 ? '#fbbf24' : '#34d399'} />
                <Kpi k="GMI" v={agp.gmi} u="%" foot="~A1c" color="#22d3ee" />
                <Kpi k="Variability" v={agp.cv} u="%CV" foot={agp.cv < 36 ? 'stable' : 'swingy'} color={agp.cv < 36 ? '#34d399' : '#fbbf24'} />
                <Kpi k="Mean" v={agp.mean} u="" foot="mg/dL" color="#fff" />
                <Kpi k="Readings" v={agp.n} u="" foot="stored" color="#fff" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Micro({ k, v, u, color }: { k: string; v: string; u?: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[8px] uppercase tracking-[0.08em] text-white/25 whitespace-nowrap">{k}</div>
      <div className="text-[14px] font-bold whitespace-nowrap tabular-nums" style={{ color: color || '#fff' }}>{v}{u && <span className="text-[9px] text-white/30 font-medium"> {u}</span>}</div>
    </div>
  );
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
function Legend({ c, label, line }: { c: string; label: string; line?: boolean }) {
  return <span className="flex items-center gap-1.5 text-[10.5px] text-white/55"><span style={{ background: c, width: line ? 14 : 11, height: line ? 3 : 9, borderRadius: line ? 2 : 3, display: 'inline-block' }} />{label}</span>;
}

function AGPChart({ bins }: { bins: Bin[] }) {
  const W = 400, H = 200, padL = 26, padR = 8, padT = 10, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const gMin = 40, gMax = 260;
  const X = (i: number) => padL + plotW * ((i + 0.5) / BINS);
  const Y = (v: number) => padT + plotH * (1 - (clampN(v, gMin, gMax) - gMin) / (gMax - gMin));

  // split into contiguous runs so a sensor/coverage gap renders as a gap, not a
  // straight line across it (pure — no render-time mutation)
  const breaks = bins.map((b, i) => (i > 0 && b.i !== bins[i - 1].i + 1 ? i : -1)).filter(i => i >= 0);
  const starts = [0, ...breaks];
  const ends = [...breaks, bins.length];
  const runs = starts.map((s, k) => bins.slice(s, ends[k])).filter(r => r.length > 1);

  const bandPath = (run: Bin[], lo: (b: Bin) => number, hi: (b: Bin) => number) => {
    const top = run.map(b => `${X(b.i)},${Y(hi(b))}`);
    const bot = run.slice().reverse().map(b => `${X(b.i)},${Y(lo(b))}`);
    return `M${top.join(' L')} L${bot.join(' L')} Z`;
  };
  const line = (run: Bin[], f: (b: Bin) => number) => run.map((b, i) => `${i ? 'L' : 'M'}${X(b.i)} ${Y(f(b))}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-3" style={{ overflow: 'visible' }}>
      {/* target range shading + guide lines */}
      <rect x={padL} y={Y(IN_HI)} width={plotW} height={Y(IN_LO) - Y(IN_HI)} fill="rgba(52,211,153,.06)" />
      {[VLOW, IN_LO, IN_HI, 180, 250].map(g => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={Y(g)} y2={Y(g)} stroke={g === IN_LO || g === IN_HI ? 'rgba(52,211,153,.28)' : 'rgba(255,255,255,.07)'} strokeWidth="1" strokeDasharray={g === IN_LO || g === IN_HI ? '4 3' : '2 5'} />
          <text x={padL - 5} y={Y(g) + 3} textAnchor="end" fill="rgba(255,255,255,.32)" style={{ fontSize: 8.5 }}>{g}</text>
        </g>
      ))}
      {runs.map((run, ri) => (
        <g key={ri}>
          <path d={bandPath(run, b => b.p10, b => b.p90)} fill="rgba(34,211,238,.12)" />
          <path d={bandPath(run, b => b.p25, b => b.p75)} fill="rgba(34,211,238,.24)" />
          <path d={line(run, b => b.p50)} fill="none" stroke="#22d3ee" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {[0, 6, 12, 18, 24].map(h => (
        <text key={h} x={clampN(padL + plotW * (h / 24), padL, W - padR)} y={H - 6} textAnchor="middle" fill="rgba(255,255,255,.32)" style={{ fontSize: 9 }}>{String(h).padStart(2, '0')}</text>
      ))}
    </svg>
  );
}
