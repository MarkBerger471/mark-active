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
    let inner: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      setAnimClass('page-fade-in');
      inner = setTimeout(() => setAnimClass(''), 200);
    }, 100);
    prevPath.current = pathname;
    return () => { clearTimeout(timer); if (inner) clearTimeout(inner); };
  }, [pathname]);

  return (
    <div className={`page-transition ${animClass}`}>
      {children}
    </div>
  );
}
