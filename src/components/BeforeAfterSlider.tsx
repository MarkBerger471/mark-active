'use client';

import { useRef, useState, useCallback } from 'react';

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

  const onMove = useCallback((clientX: number) => {
    if (dragging.current) updatePos(clientX);
  }, [updatePos]);

  const onEnd = useCallback(() => { dragging.current = false; }, []);

  // Both images: fill container width, natural height, top-anchored.
  // clip-path ensures identical element dimensions for pixel-perfect alignment.
  // min-h-full prevents gaps if an image is shorter than the container.
  return (
    <div
      ref={containerRef}
      className="relative aspect-[3/4] rounded-xl overflow-hidden cursor-col-resize select-none touch-none"
      onMouseDown={e => onStart(e.clientX)}
      onMouseMove={e => onMove(e.clientX)}
      onMouseUp={onEnd}
      onMouseLeave={onEnd}
      onTouchStart={e => onStart(e.touches[0].clientX)}
      onTouchMove={e => onMove(e.touches[0].clientX)}
      onTouchEnd={onEnd}
    >
      {/* After (full) */}
      <img src={afterSrc} alt="After" className="absolute top-0 left-0 w-full min-h-full" />
      {/* Before (clipped to left portion — same element size as after) */}
      <img src={beforeSrc} alt="Before" className="absolute top-0 left-0 w-full min-h-full" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      {/* Divider line + drag handle */}
      <div className="absolute top-0 bottom-0" style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}>
        <div className="w-0.5 h-full bg-white/80" />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
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
