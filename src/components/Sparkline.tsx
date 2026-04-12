'use client';

let sparkId = 0;

export default function Sparkline({ data, color = '#22c55e', width = 60, height = 20 }: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const id = `spark-${++sparkId}`;
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = data.map((v, i) => ({
    x: padding + (i / (data.length - 1)) * innerW,
    y: padding + innerH - ((v - min) / range) * innerH,
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="opacity-60">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2" fill={color} />
    </svg>
  );
}
