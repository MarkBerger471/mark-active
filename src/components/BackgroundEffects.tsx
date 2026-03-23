'use client';

export default function BackgroundEffects() {
  return (
    <>
      <div className="app-bg" />
      <div className="orb orb-red" />
      <div className="orb orb-blue" />
      <div className="orb orb-purple" />
    </>
  );
}

// Decorative fitness SVG icons for cards
export function DumbbellIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <rect x="8" y="24" width="8" height="16" rx="2" fill="currentColor" opacity="0.15" />
      <rect x="48" y="24" width="8" height="16" rx="2" fill="currentColor" opacity="0.15" />
      <rect x="4" y="27" width="6" height="10" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="54" y="27" width="6" height="10" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="16" y="30" width="32" height="4" rx="2" fill="currentColor" opacity="0.12" />
    </svg>
  );
}

export function HeartPulseIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <path
        d="M32 52s-18-12-18-24c0-6.6 5.4-12 12-12 4.2 0 6 2 6 2s1.8-2 6-2c6.6 0 12 5.4 12 12 0 12-18 24-18 24z"
        fill="currentColor"
        opacity="0.08"
      />
      <path
        d="M12 32h10l4-8 4 16 4-12 4 6h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.12"
      />
    </svg>
  );
}

export function ScaleIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <rect x="12" y="20" width="40" height="32" rx="6" fill="currentColor" opacity="0.08" />
      <circle cx="32" cy="36" r="10" stroke="currentColor" strokeWidth="2" opacity="0.1" />
      <line x1="32" y1="28" x2="38" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.15" />
      <circle cx="32" cy="36" r="2" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

// Muscle group icons for workout cards
export function ShouldersIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Head */}
      <circle cx="32" cy="12" r="6" fill="currentColor" opacity="0.15" />
      {/* Neck */}
      <rect x="29" y="18" width="6" height="4" fill="currentColor" opacity="0.1" />
      {/* Torso */}
      <path d="M24 28v20h16V28" fill="currentColor" opacity="0.08" />
      {/* Shoulders highlighted */}
      <path d="M24 22c-8 0-14 4-14 8v4h14V22z" fill="currentColor" opacity="0.35" />
      <path d="M40 22c8 0 14 4 14 8v4H40V22z" fill="currentColor" opacity="0.35" />
      {/* Deltoid caps */}
      <ellipse cx="14" cy="28" rx="5" ry="6" fill="currentColor" opacity="0.25" />
      <ellipse cx="50" cy="28" rx="5" ry="6" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

export function LegsIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Torso faded */}
      <path d="M22 4h20v16H22z" fill="currentColor" opacity="0.06" />
      {/* Hips */}
      <path d="M20 18h24v8H20z" fill="currentColor" opacity="0.1" />
      {/* Legs highlighted */}
      <path d="M20 26h10v24c0 2-2 4-4 4h-2c-2 0-4-2-4-4V26z" fill="currentColor" opacity="0.3" />
      <path d="M34 26h10v24c0 2-2 4-4 4h-2c-2 0-4-2-4-4V26z" fill="currentColor" opacity="0.3" />
      {/* Quad detail */}
      <path d="M22 30c2 4 2 10 0 16" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <path d="M42 30c-2 4-2 10 0 16" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      {/* Calves */}
      <ellipse cx="25" cy="44" rx="3" ry="6" fill="currentColor" opacity="0.2" />
      <ellipse cx="39" cy="44" rx="3" ry="6" fill="currentColor" opacity="0.2" />
    </svg>
  );
}

export function ChestIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Head */}
      <circle cx="32" cy="8" r="5" fill="currentColor" opacity="0.1" />
      {/* Shoulders */}
      <path d="M18 18c-6 0-10 3-10 6v2h14v-8z" fill="currentColor" opacity="0.08" />
      <path d="M46 18c6 0 10 3 10 6v2H42v-8z" fill="currentColor" opacity="0.08" />
      {/* Chest highlighted */}
      <path d="M18 18h28v16H18z" fill="currentColor" opacity="0.12" />
      <ellipse cx="25" cy="26" rx="8" ry="7" fill="currentColor" opacity="0.3" />
      <ellipse cx="39" cy="26" rx="8" ry="7" fill="currentColor" opacity="0.3" />
      {/* Pec line */}
      <path d="M32 20v12" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      {/* Arms with triceps */}
      <path d="M8 26v16c0 2 2 3 4 3s4-1 4-3V26" fill="currentColor" opacity="0.2" />
      <path d="M48 26v16c0 2 2 3 4 3s4-1 4-3V26" fill="currentColor" opacity="0.2" />
      {/* Lower body faded */}
      <path d="M18 34h28v20H18z" fill="currentColor" opacity="0.04" />
    </svg>
  );
}

export function BackIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      {/* Head */}
      <circle cx="32" cy="8" r="5" fill="currentColor" opacity="0.1" />
      {/* Back highlighted - V taper */}
      <path d="M16 16h32v6l-4 22H20L16 22v-6z" fill="currentColor" opacity="0.3" />
      {/* Spine */}
      <path d="M32 16v28" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      {/* Lat detail */}
      <path d="M20 20c-4 2-6 8-4 14" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <path d="M44 20c4 2 6 8 4 14" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      {/* Arms with biceps */}
      <path d="M8 22v14c0 2 2 3 4 3s4-1 4-3V22" fill="currentColor" opacity="0.2" />
      <path d="M48 22v14c0 2 2 3 4 3s4-1 4-3V22" fill="currentColor" opacity="0.2" />
      {/* Bicep bump */}
      <ellipse cx="10" cy="30" rx="3" ry="5" fill="currentColor" opacity="0.15" />
      <ellipse cx="54" cy="30" rx="3" ry="5" fill="currentColor" opacity="0.15" />
      {/* Lower body faded */}
      <path d="M20 44h24v12H20z" fill="currentColor" opacity="0.04" />
    </svg>
  );
}

export function ForkKnifeIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <path d="M20 8v18c0 4 4 6 4 6v24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.12" />
      <path d="M14 8v10c0 6 6 8 6 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.1" />
      <path d="M26 8v10c0 6-6 8-6 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.1" />
      <path d="M40 8c0 0 0 14 0 18s4 6 4 6v24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.12" />
      <path d="M44 8v16" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.08" />
    </svg>
  );
}

export function FlameIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <path
        d="M32 6c0 0-16 14-16 30 0 10 7 18 16 18s16-8 16-18C48 20 32 6 32 6z"
        fill="currentColor"
        opacity="0.08"
      />
      <path
        d="M32 26c0 0-6 6-6 14 0 4 3 8 6 8s6-4 6-8c0-8-6-14-6-14z"
        fill="currentColor"
        opacity="0.06"
      />
    </svg>
  );
}
