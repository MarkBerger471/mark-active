'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '◉' },
  { href: '/training-plan', label: 'Training', icon: '◆' },
  { href: '/body-metrix', label: 'Body Metrix', icon: '◎' },
  { href: '/nutrition-plan', label: 'Nutrition', icon: '◇' },
];

export default function Navigation() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex fixed left-0 top-0 h-full w-64 flex-col p-6 z-50 glass-strong rounded-none rounded-r-2xl">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            <span className="text-va-red">MARK</span> ACTIVE
          </h1>
          <div className="h-0.5 w-12 bg-gradient-to-r from-va-red to-transparent mt-2 rounded-full" />
          <p className="text-xs text-va-gray-dark mt-2 tracking-widest uppercase flex items-center gap-2">
            Body Tracker
            <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} title={online ? 'Online' : 'Offline'} />
          </p>
        </div>

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
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <button
          onClick={logout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
        >
          <span className="text-lg">⎋</span>
          <span className="font-medium">Logout</span>
        </button>
      </nav>

      {/* Mobile top bar */}
      <nav className="md:hidden fixed top-0 left-0 right-0 z-50 flex justify-center px-6 pt-2">
        <div className="glass-strong rounded-2xl max-w-5xl w-full">
          <div className="flex justify-around items-center py-2 px-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-all min-w-[50px] ${
                    isActive ? 'text-va-red' : 'text-white/40'
                  }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-[10px] font-medium">{item.label}</span>
                </Link>
              );
            })}
            <button
              onClick={logout}
              className="flex flex-col items-center gap-1 px-3 py-1 text-white/40 min-w-[50px]"
            >
              <span className="text-lg">⎋</span>
              <span className="text-[10px] font-medium">Logout</span>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}
