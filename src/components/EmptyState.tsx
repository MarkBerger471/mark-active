'use client';

const icons: Record<string, React.ReactNode> = {
  bloodtest: (
    <svg viewBox="0 0 64 64" fill="none" className="w-16 h-16 opacity-30">
      <path d="M32 8c-4 8-12 16-12 26a12 12 0 0024 0c0-10-8-18-12-26z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M26 36a6 6 0 006 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  dumbbell: (
    <svg viewBox="0 0 64 64" fill="none" className="w-16 h-16 opacity-30">
      <rect x="8" y="22" width="8" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="48" y="22" width="8" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="16" y="26" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="44" y="26" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
      <line x1="20" y1="32" x2="44" y2="32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  scale: (
    <svg viewBox="0 0 64 64" fill="none" className="w-16 h-16 opacity-30">
      <rect x="12" y="16" width="40" height="36" rx="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="34" r="10" stroke="currentColor" strokeWidth="2" />
      <line x1="32" y1="34" x2="38" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  fork: (
    <svg viewBox="0 0 64 64" fill="none" className="w-16 h-16 opacity-30">
      <path d="M24 8v18c0 4 4 6 8 6s8-2 8-6V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="32" x2="32" y2="56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="28" y1="8" x2="28" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="36" y1="8" x2="36" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

export default function EmptyState({ icon = 'dumbbell', message, action, onAction }: {
  icon?: keyof typeof icons;
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="glass-card p-10 flex flex-col items-center justify-center text-center fade-up">
      <div className="text-white/40 mb-4 animate-pulse" style={{ animationDuration: '3s' }}>
        {icons[icon] || icons.dumbbell}
      </div>
      <p className="text-white/40 mb-4 text-sm">{message}</p>
      {action && onAction && (
        <button onClick={onAction} className="btn-primary text-sm">{action}</button>
      )}
    </div>
  );
}
