'use client';

import { useRef, useCallback } from 'react';

interface SliderFieldProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
  step: number;
  targetMin: number;
  targetMax: number;
  unit: string;
}

export default function SliderField({ label, value, onChange, min, max, step, targetMin, targetMax, unit }: SliderFieldProps) {
  const range = max - min;
  const steps = Math.round(range / step);
  const isOnTarget = value >= targetMin && value <= targetMax;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const getZoneColor = (stepVal: number): string => {
    if (stepVal >= targetMin && stepVal <= targetMax) return 'bg-green-500/70';
    const distFromTarget = stepVal < targetMin
      ? targetMin - stepVal
      : stepVal - targetMax;
    const maxDist = Math.max(targetMin - min, max - targetMax);
    const ratio = maxDist > 0 ? distFromTarget / maxDist : 1;
    if (ratio <= 0.5) return 'bg-yellow-500/60';
    return 'bg-red-500/50';
  };

  const stepValues: number[] = [];
  for (let i = 0; i <= steps; i++) {
    stepValues.push(Math.round((min + i * step) * 100) / 100);
  }

  // Each segment spans from one step boundary to the next.
  // Segment i covers from stepValues[i] to stepValues[i+1].
  // So there are `steps` segments (not steps+1).
  const segWidth = 100 / steps;

  const xToValue = useCallback((clientX: number) => {
    if (!trackRef.current) return value;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + pct * range;
    const snapped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, Math.round(snapped * 100) / 100));
  }, [min, max, step, range, value]);

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onChange(xToValue(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onChange(xToValue(e.clientX));
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  // Thumb and tick position: value mapped to 0%–100%
  const valToPct = (v: number) => ((v - min) / range) * 100;
  const thumbPct = valToPct(value);

  return (
    <div className="col-span-1 md:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm text-white/60">{label}</label>
        <span className={`text-lg font-bold ${isOnTarget ? 'text-green-400' : getZoneColor(value).includes('yellow') ? 'text-yellow-400' : 'text-red-400'}`}>
          {value}{unit}
        </span>
      </div>

      <div
        className="relative select-none touch-none"
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Segmented color bar — absolutely positioned segments */}
        <div className="relative h-3 rounded-lg overflow-hidden pointer-events-none">
          {Array.from({ length: steps }, (_, i) => {
            // Segment i sits between stepValues[i] and stepValues[i+1]
            // Color based on the midpoint value of the segment
            const midVal = stepValues[i] + step / 2;
            const isActive = midVal <= value + step / 2;
            const zone = getZoneColor(midVal);
            return (
              <div
                key={i}
                className={`absolute top-0 h-full transition-opacity duration-150 ${zone} ${isActive ? 'opacity-100' : 'opacity-25'}`}
                style={{
                  left: `${i * segWidth}%`,
                  width: `calc(${segWidth}% - 2px)`,
                  marginLeft: i === 0 ? 0 : '2px',
                  borderRadius: i === 0 ? '8px 0 0 8px' : i === steps - 1 ? '0 8px 8px 0' : undefined,
                }}
              />
            );
          })}
        </div>

        {/* Custom thumb */}
        <div
          className="absolute top-1/2 pointer-events-none"
          style={{ left: `${thumbPct}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#d41010] to-[#b90a0a] border border-white/30 shadow-[0_2px_10px_rgba(0,0,0,0.4),0_0_8px_rgba(185,10,10,0.5)]" />
        </div>

        {/* Invisible hit area */}
        <div className="absolute inset-0 -top-3 -bottom-3 cursor-grab active:cursor-grabbing" />
      </div>

      {/* Tick marks and labels — same valToPct as thumb */}
      <div className="relative mt-1.5">
        {stepValues.map((sv, i) => {
          const isTarget = sv >= targetMin && sv <= targetMax;
          const isCurrent = sv === value;
          const pct = valToPct(sv);
          const showLabel = i === 0 || i === stepValues.length - 1 || isTarget || isCurrent || (steps <= 12 && i % 2 === 0) || (steps > 12 && i % Math.ceil(steps / 8) === 0);
          return (
            <div
              key={i}
              className="absolute flex flex-col items-center"
              style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
            >
              <div className={`w-[1px] ${isTarget ? 'h-2 bg-green-400/60' : 'h-1.5 bg-white/15'}`} />
              {showLabel && (
                <span className={`text-[9px] mt-0.5 whitespace-nowrap ${isCurrent ? 'text-white font-bold' : isTarget ? 'text-green-400/70' : 'text-white/25'}`}>
                  {sv}{i === 0 || i === stepValues.length - 1 ? unit : ''}
                </span>
              )}
            </div>
          );
        })}
        <div className="h-6" />
      </div>
    </div>
  );
}
