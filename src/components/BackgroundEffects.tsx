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
