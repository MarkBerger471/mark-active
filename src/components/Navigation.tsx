'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect, useRef } from 'react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '◉' },
  { href: '/training-plan', label: 'Training', icon: '◆' },
  { href: '/body-metrix', label: 'Body Metrix', icon: '◎' },
  { href: '/nutrition-plan', label: 'Nutrition', icon: '◇' },
  { href: '/vitals', label: 'Vitals', icon: '♡' },
];

export default function Navigation() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [online, setOnline] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const mobileRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Animated pill position for mobile
  useEffect(() => {
    const idx = navItems.findIndex(i => i.href === pathname);
    const el = mobileRefs.current[idx];
    if (el) {
      const parent = el.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setPillStyle({ left: elRect.left - parentRect.left, width: elRect.width });
      }
    }
  }, [pathname]);

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        className={`hidden md:flex fixed left-0 top-0 h-full flex-col p-6 z-50 glass-strong rounded-none rounded-r-2xl transition-all duration-300 ${collapsed ? 'w-20' : 'w-64'}`}
        onMouseEnter={() => setCollapsed(false)}
        onMouseLeave={() => setCollapsed(true)}
      >
        <div className={`mb-10 overflow-hidden transition-all duration-300 ${collapsed ? 'opacity-0 h-0 mb-4' : 'opacity-100'}`}>
          <h1 className="text-2xl font-bold text-white tracking-tight whitespace-nowrap">
            <span className="text-va-red">MARK</span> ACTIVE
          </h1>
          <div className="h-0.5 w-12 bg-gradient-to-r from-va-red to-transparent mt-2 rounded-full" />
          <p className="text-xs text-va-gray-dark mt-2 tracking-widest uppercase flex items-center gap-2 whitespace-nowrap">
            Body Tracker
            <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} title={online ? 'Online' : 'Offline'} />
          </p>
        </div>

        {collapsed && (
          <div className="flex items-center justify-center mb-6 mt-2">
            <span className="text-va-red text-xl font-bold">M</span>
          </div>
        )}

        <div className="flex-1 space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-va-red/20 text-white border border-va-red/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                } ${collapsed ? 'justify-center px-2' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="text-lg">{item.icon}</span>
                <span className={`font-medium transition-all duration-300 ${collapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'}`}>{item.label}</span>
              </Link>
            );
          })}
        </div>

      </nav>

      {/* Mobile top bar */}
      <nav className="md:hidden fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-[env(safe-area-inset-top,8px)]">
        <div className="glass-strong rounded-2xl max-w-5xl w-full">
          <div className="flex justify-around items-center py-2 px-2 relative">
            {/* Animated pill */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-[calc(100%-8px)] rounded-xl bg-va-red/10 transition-all duration-300 ease-out"
              style={{ left: pillStyle.left, width: pillStyle.width }}
            />
            {navItems.map((item, i) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  ref={el => { mobileRefs.current[i] = el; }}
                  className={`relative z-10 flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-colors duration-200 min-w-[50px] ${
                    isActive ? 'text-va-red' : 'text-white/40'
                  }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-[10px] font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
