'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { getSettingRemote, saveSetting } from '@/utils/storage';

interface PhotoAdjust { scale: number; offsetX: number; offsetY: number }
const DEFAULT_ADJUST: PhotoAdjust = { scale: 1, offsetX: 0, offsetY: 0 };

export default function BeforeAfterSlider({ beforeSrc, afterSrc, beforeLabel, afterLabel, adjustKey }: {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel: string;
  afterLabel: string;
  adjustKey?: string;
}) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const storageKey = adjustKey ? `photo_adjust_${adjustKey}` : null;

  // Synchronous loader — avoids flash of defaults before useEffect runs
  const loadAdj = (which: 'before' | 'after'): PhotoAdjust => {
    if (!storageKey || typeof window === 'undefined') return DEFAULT_ADJUST;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return DEFAULT_ADJUST;
      const data = JSON.parse(raw);
      return { ...DEFAULT_ADJUST, ...(data[which] || {}) };
    } catch { return DEFAULT_ADJUST; }
  };

  const [beforeAdj, setBeforeAdj] = useState<PhotoAdjust>(() => loadAdj('before'));
  const [afterAdj, setAfterAdj] = useState<PhotoAdjust>(() => loadAdj('after'));
  const [adjustMode, setAdjustMode] = useState(false);
  const [activePhoto, setActivePhoto] = useState<'before' | 'after'>('before');

  // Re-load when storageKey changes (e.g. new photo pair)
  useEffect(() => {
    setBeforeAdj(loadAdj('before'));
    setAfterAdj(loadAdj('after'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Sync from Firestore DIRECTLY on mount (bypass IDB for cross-device freshness)
  useEffect(() => {
    if (!storageKey) return;
    getSettingRemote(storageKey).then(v => {
      if (!v) return;
      try {
        const data = JSON.parse(v);
        if (data.before) setBeforeAdj({ ...DEFAULT_ADJUST, ...data.before });
        if (data.after) setAfterAdj({ ...DEFAULT_ADJUST, ...data.after });
        localStorage.setItem(storageKey, v);
      } catch {}
    }).catch(() => {});
  }, [storageKey]);

  // Refs always point to the latest state — prevents stale-closure when saving
  const beforeRef = useRef(beforeAdj);
  const afterRef = useRef(afterAdj);
  useEffect(() => { beforeRef.current = beforeAdj; }, [beforeAdj]);
  useEffect(() => { afterRef.current = afterAdj; }, [afterAdj]);

  const saveAdj = useCallback((b: PhotoAdjust, a: PhotoAdjust) => {
    if (!storageKey) return;
    const json = JSON.stringify({ before: b, after: a });
    try { localStorage.setItem(storageKey, json); } catch {}
    // Sync to Firestore so adjustments roam across devices
    saveSetting(storageKey, json);
  }, [storageKey]);

  const updateBefore = (next: PhotoAdjust) => { setBeforeAdj(next); saveAdj(next, afterRef.current); };
  const updateAfter = (next: PhotoAdjust) => { setAfterAdj(next); saveAdj(beforeRef.current, next); };
  const updateActive = (next: PhotoAdjust) => activePhoto === 'before' ? updateBefore(next) : updateAfter(next);
  const resetActive = () => updateActive(DEFAULT_ADJUST);

  const updatePos = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    setPos(pct);
  }, []);

  const onStart = useCallback((clientX: number) => {
    if (adjustMode) return;
    dragging.current = true;
    updatePos(clientX);
  }, [updatePos, adjustMode]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (dragging.current) updatePos(e.clientX); };
    const onMouseUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [updatePos]);

  const onTouchMove = useCallback((clientX: number) => {
    if (dragging.current) updatePos(clientX);
  }, [updatePos]);

  const onEnd = useCallback(() => { dragging.current = false; }, []);

  const transformOf = (a: PhotoAdjust) => `translate(${a.offsetX}%, ${a.offsetY}%) scale(${a.scale})`;
  const active = activePhoto === 'before' ? beforeAdj : afterAdj;

  // In adjust mode, lock divider at 50% so both photos always visible
  const dividerPos = adjustMode ? 50 : pos;
  const enterAdjustMode = () => { setAdjustMode(true); setPos(50); };
  const exitAdjustMode = () => setAdjustMode(false);

  // +/- step increments
  const adjStep = (key: keyof PhotoAdjust, delta: number) => {
    const next = { ...active, [key]: Math.round((active[key] + delta) * 100) / 100 };
    // Clamp ranges
    if (key === 'scale') next.scale = Math.max(0.5, Math.min(2, next.scale));
    if (key === 'offsetX' || key === 'offsetY') next[key] = Math.max(-50, Math.min(50, next[key]));
    updateActive(next);
  };

  return (
    <div>
      <div
        ref={containerRef}
        className={`relative aspect-[3/4] rounded-xl overflow-hidden select-none touch-none ${adjustMode ? '' : 'cursor-col-resize'}`}
        onMouseDown={e => onStart(e.clientX)}
        onTouchStart={e => onStart(e.touches[0].clientX)}
        onTouchMove={e => onTouchMove(e.touches[0].clientX)}
        onTouchEnd={onEnd}
      >
        {/* After (right side, full image) */}
        <img src={afterSrc} alt="After" className="absolute top-0 left-0 w-full min-h-full" style={{ transform: transformOf(afterAdj), transformOrigin: 'center center' }} />
        {/* Before (left side, clipped) */}
        <img src={beforeSrc} alt="Before" className="absolute top-0 left-0 w-full min-h-full" style={{ transform: transformOf(beforeAdj), transformOrigin: 'center center', clipPath: `inset(0 ${100 - dividerPos}% 0 0)` }} />

        {/* Tap zones in adjust mode (left = before, right = after) */}
        {adjustMode && (
          <>
            <button
              onClick={() => setActivePhoto('before')}
              className={`absolute top-0 left-0 bottom-0 transition-all ${activePhoto === 'before' ? 'ring-2 ring-inset ring-cyan-400/60' : ''}`}
              style={{ width: '50%' }}
              aria-label="Select before"
            />
            <button
              onClick={() => setActivePhoto('after')}
              className={`absolute top-0 right-0 bottom-0 transition-all ${activePhoto === 'after' ? 'ring-2 ring-inset ring-cyan-400/60' : ''}`}
              style={{ width: '50%' }}
              aria-label="Select after"
            />
          </>
        )}

        {/* Divider line */}
        <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${dividerPos}%`, transform: 'translateX(-50%)' }}>
          <div className="w-0.5 h-full bg-white/80" style={{ boxShadow: '0 0 8px rgba(255,255,255,0.4)' }} />
          {!adjustMode && (
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center" style={{ boxShadow: '0 0 15px rgba(255,255,255,0.5), 0 0 30px rgba(255,255,255,0.2)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M5 3L2 8L5 13M11 3L14 8L11 13" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Date labels — highlight the active one in adjust mode */}
        <div className={`absolute top-3 left-3 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] transition-all pointer-events-none ${adjustMode && activePhoto === 'before' ? 'bg-cyan-500/40 text-white font-semibold' : 'bg-black/50 text-white/80'}`}>{beforeLabel}</div>
        <div className={`absolute top-3 right-3 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] transition-all pointer-events-none ${adjustMode && activePhoto === 'after' ? 'bg-cyan-500/40 text-white font-semibold' : 'bg-black/50 text-white/80'}`}>{afterLabel}</div>

        {/* Adjust toggle button */}
        {adjustKey && (
          <button onClick={adjustMode ? exitAdjustMode : enterAdjustMode}
            className={`absolute bottom-3 right-3 backdrop-blur-sm rounded-lg px-2.5 py-1 text-[10px] transition-all ${adjustMode ? 'bg-cyan-500/60 text-white' : 'bg-black/60 text-white/80 hover:bg-black/80'}`}>
            {adjustMode ? 'Done' : '⚙ Adjust'}
          </button>
        )}
      </div>

      {/* +/- adjustment controls */}
      {adjustMode && adjustKey && (
        <div className="mt-2 p-3 bg-white/[0.04] border border-white/[0.08] rounded-xl">
          <div className="text-[10px] text-white/40 mb-2 text-center">
            Editing: <span className="text-cyan-400 font-semibold">{activePhoto === 'before' ? beforeLabel : afterLabel}</span>
            <span className="text-white/30"> — tap the other half to switch</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {/* Scale */}
            <div className="flex flex-col items-center bg-white/[0.03] rounded-lg py-2">
              <span className="text-[9px] text-white/40 uppercase tracking-wider mb-1">Scale</span>
              <span className="text-[12px] font-bold text-white mb-2">{active.scale.toFixed(2)}×</span>
              <div className="flex gap-1">
                <button onClick={() => adjStep('scale', -0.01)} className="w-7 h-7 rounded-lg bg-red-500/15 text-red-400 text-sm font-bold active:bg-red-500/30 transition-all">−</button>
                <button onClick={() => adjStep('scale', 0.01)} className="w-7 h-7 rounded-lg bg-green-500/15 text-green-400 text-sm font-bold active:bg-green-500/30 transition-all">+</button>
              </div>
            </div>
            {/* Y */}
            <div className="flex flex-col items-center bg-white/[0.03] rounded-lg py-2">
              <span className="text-[9px] text-white/40 uppercase tracking-wider mb-1">Y ↕</span>
              <span className="text-[12px] font-bold text-white mb-2">{active.offsetY > 0 ? '+' : ''}{active.offsetY.toFixed(1)}%</span>
              <div className="flex gap-1">
                <button onClick={() => adjStep('offsetY', -0.25)} className="w-7 h-7 rounded-lg bg-red-500/15 text-red-400 text-sm font-bold active:bg-red-500/30 transition-all">↑</button>
                <button onClick={() => adjStep('offsetY', 0.25)} className="w-7 h-7 rounded-lg bg-green-500/15 text-green-400 text-sm font-bold active:bg-green-500/30 transition-all">↓</button>
              </div>
            </div>
            {/* X */}
            <div className="flex flex-col items-center bg-white/[0.03] rounded-lg py-2">
              <span className="text-[9px] text-white/40 uppercase tracking-wider mb-1">X ↔</span>
              <span className="text-[12px] font-bold text-white mb-2">{active.offsetX > 0 ? '+' : ''}{active.offsetX.toFixed(1)}%</span>
              <div className="flex gap-1">
                <button onClick={() => adjStep('offsetX', -0.25)} className="w-7 h-7 rounded-lg bg-red-500/15 text-red-400 text-sm font-bold active:bg-red-500/30 transition-all">←</button>
                <button onClick={() => adjStep('offsetX', 0.25)} className="w-7 h-7 rounded-lg bg-green-500/15 text-green-400 text-sm font-bold active:bg-green-500/30 transition-all">→</button>
              </div>
            </div>
          </div>
          <button onClick={resetActive} className="block mx-auto text-[10px] text-white/30 hover:text-white/60 mt-3 transition-all">↻ Reset {activePhoto}</button>
        </div>
      )}
    </div>
  );
}
