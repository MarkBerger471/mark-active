'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

export default function BeforeAfterSlider({ beforeSrc, afterSrc, beforeLabel, afterLabel }: {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel: string;
  afterLabel: string;
}) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePos = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    setPos(pct);
  }, []);

  const onStart = useCallback((clientX: number) => {
    dragging.current = true;
    updatePos(clientX);
  }, [updatePos]);

  // Window-level listeners so drag continues when pointer leaves the slider
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

  return (
    <div
      ref={containerRef}
      className="relative aspect-[3/4] rounded-xl overflow-hidden cursor-col-resize select-none touch-none"
      onMouseDown={e => onStart(e.clientX)}
      onTouchStart={e => onStart(e.touches[0].clientX)}
      onTouchMove={e => onTouchMove(e.touches[0].clientX)}
      onTouchEnd={onEnd}
    >
      {/* After (full) */}
      <img src={afterSrc} alt="After" className="absolute top-0 left-0 w-full min-h-full" />
      {/* Before (clipped to left portion — same element size as after) */}
      <img src={beforeSrc} alt="Before" className="absolute top-0 left-0 w-full min-h-full" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      {/* Divider line + drag handle */}
      <div className="absolute top-0 bottom-0" style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}>
        <div className="w-0.5 h-full bg-white/80" style={{ boxShadow: '0 0 8px rgba(255,255,255,0.4)' }} />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center" style={{ boxShadow: '0 0 15px rgba(255,255,255,0.5), 0 0 30px rgba(255,255,255,0.2)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M5 3L2 8L5 13M11 3L14 8L11 13" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      {/* Date labels */}
      <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] text-white/80">{beforeLabel}</div>
      <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] text-white/80">{afterLabel}</div>
    </div>
  );
}
