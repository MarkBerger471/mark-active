'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

interface PhotoAdjust { scale: number; offsetX: number; offsetY: number }
const DEFAULT_ADJUST: PhotoAdjust = { scale: 1, offsetX: 0, offsetY: 0 };

export default function BeforeAfterSlider({ beforeSrc, afterSrc, beforeLabel, afterLabel, adjustKey }: {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel: string;
  afterLabel: string;
  adjustKey?: string; // unique key per photo pair, e.g. "2026-04-12_2026-04-19_front"
}) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Photo adjustments — persisted per pair
  const storageKey = adjustKey ? `photo_adjust_${adjustKey}` : null;
  const [beforeAdj, setBeforeAdj] = useState<PhotoAdjust>(DEFAULT_ADJUST);
  const [afterAdj, setAfterAdj] = useState<PhotoAdjust>(DEFAULT_ADJUST);
  const [showControls, setShowControls] = useState(false);
  const [activePhoto, setActivePhoto] = useState<'before' | 'after'>('before');

  // Load saved adjustments on mount / key change
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.before) setBeforeAdj({ ...DEFAULT_ADJUST, ...data.before });
        if (data.after) setAfterAdj({ ...DEFAULT_ADJUST, ...data.after });
      }
    } catch {}
  }, [storageKey]);

  // Save adjustments
  const saveAdj = useCallback((b: PhotoAdjust, a: PhotoAdjust) => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ before: b, after: a })); } catch {}
  }, [storageKey]);

  const updateBefore = (next: PhotoAdjust) => { setBeforeAdj(next); saveAdj(next, afterAdj); };
  const updateAfter = (next: PhotoAdjust) => { setAfterAdj(next); saveAdj(beforeAdj, next); };
  const resetActive = () => {
    if (activePhoto === 'before') updateBefore(DEFAULT_ADJUST);
    else updateAfter(DEFAULT_ADJUST);
  };

  const updatePos = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    setPos(pct);
  }, []);

  const onStart = useCallback((clientX: number) => {
    if (showControls) return; // disable slider drag while adjusting
    dragging.current = true;
    updatePos(clientX);
  }, [updatePos, showControls]);

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
  const updateActive = (next: PhotoAdjust) => activePhoto === 'before' ? updateBefore(next) : updateAfter(next);

  return (
    <div>
      <div
        ref={containerRef}
        className={`relative aspect-[3/4] rounded-xl overflow-hidden select-none touch-none ${showControls ? '' : 'cursor-col-resize'}`}
        onMouseDown={e => onStart(e.clientX)}
        onTouchStart={e => onStart(e.touches[0].clientX)}
        onTouchMove={e => onTouchMove(e.touches[0].clientX)}
        onTouchEnd={onEnd}
      >
        {/* After (full) */}
        <img src={afterSrc} alt="After" className="absolute top-0 left-0 w-full min-h-full" style={{ transform: transformOf(afterAdj), transformOrigin: 'center center' }} />
        {/* Before (clipped to left portion) */}
        <img src={beforeSrc} alt="Before" className="absolute top-0 left-0 w-full min-h-full" style={{ transform: transformOf(beforeAdj), transformOrigin: 'center center', clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
        {/* Divider line + drag handle */}
        {!showControls && (
          <div className="absolute top-0 bottom-0" style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}>
            <div className="w-0.5 h-full bg-white/80" style={{ boxShadow: '0 0 8px rgba(255,255,255,0.4)' }} />
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center" style={{ boxShadow: '0 0 15px rgba(255,255,255,0.5), 0 0 30px rgba(255,255,255,0.2)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M5 3L2 8L5 13M11 3L14 8L11 13" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        )}
        {/* Date labels */}
        <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] text-white/80">{beforeLabel}</div>
        <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] text-white/80">{afterLabel}</div>
        {/* Adjust toggle */}
        {adjustKey && (
          <button onClick={() => setShowControls(s => !s)}
            className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1 text-[10px] text-white/80 hover:bg-black/80 transition-all">
            {showControls ? 'Done' : '⚙ Adjust'}
          </button>
        )}
      </div>

      {/* Adjustment controls */}
      {showControls && adjustKey && (
        <div className="mt-2 p-3 bg-white/[0.04] border border-white/[0.08] rounded-xl">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setActivePhoto('before')}
              className={`flex-1 text-[11px] py-1.5 rounded-lg transition-all ${activePhoto === 'before' ? 'bg-white/15 text-white' : 'bg-white/[0.03] text-white/40'}`}>
              ◀ {beforeLabel}
            </button>
            <button onClick={() => setActivePhoto('after')}
              className={`flex-1 text-[11px] py-1.5 rounded-lg transition-all ${activePhoto === 'after' ? 'bg-white/15 text-white' : 'bg-white/[0.03] text-white/40'}`}>
              {afterLabel} ▶
            </button>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] text-white/50">
              <span className="w-12">Scale</span>
              <input type="range" min="0.5" max="2" step="0.01" value={active.scale}
                onChange={e => updateActive({ ...active, scale: parseFloat(e.target.value) })}
                className="flex-1 accent-white" />
              <span className="w-10 text-right text-white/70">{active.scale.toFixed(2)}×</span>
            </label>
            <label className="flex items-center gap-2 text-[10px] text-white/50">
              <span className="w-12">↕ Y</span>
              <input type="range" min="-30" max="30" step="0.5" value={active.offsetY}
                onChange={e => updateActive({ ...active, offsetY: parseFloat(e.target.value) })}
                className="flex-1 accent-white" />
              <span className="w-10 text-right text-white/70">{active.offsetY > 0 ? '+' : ''}{active.offsetY.toFixed(1)}%</span>
            </label>
            <label className="flex items-center gap-2 text-[10px] text-white/50">
              <span className="w-12">↔ X</span>
              <input type="range" min="-30" max="30" step="0.5" value={active.offsetX}
                onChange={e => updateActive({ ...active, offsetX: parseFloat(e.target.value) })}
                className="flex-1 accent-white" />
              <span className="w-10 text-right text-white/70">{active.offsetX > 0 ? '+' : ''}{active.offsetX.toFixed(1)}%</span>
            </label>
          </div>
          <button onClick={resetActive} className="text-[10px] text-white/30 hover:text-white/60 mt-2 transition-all">↻ Reset {activePhoto}</button>
        </div>
      )}
    </div>
  );
}
