'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const [animClass, setAnimClass] = useState('');

  useEffect(() => {
    if (prevPath.current === pathname) return;
    setAnimClass('page-fade-out');
    const timer = setTimeout(() => {
      setAnimClass('page-fade-in');
      setTimeout(() => setAnimClass(''), 200);
    }, 100);
    prevPath.current = pathname;
    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <div className={`page-transition ${animClass}`}>
      {children}
    </div>
  );
}
