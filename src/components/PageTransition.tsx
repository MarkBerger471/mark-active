'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const navOrder = ['/', '/training-plan', '/body-metrix', '/nutrition-plan', '/vitals'];

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const [animClass, setAnimClass] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prevPath.current === pathname) return;
    const prevIdx = navOrder.indexOf(prevPath.current);
    const currIdx = navOrder.indexOf(pathname);
    const dir = currIdx > prevIdx ? 'left' : 'right';

    // Start exit animation
    setAnimClass(dir === 'left' ? 'page-exit-left' : 'page-exit-right');

    const timer = setTimeout(() => {
      // Switch to enter animation
      setAnimClass(dir === 'left' ? 'page-enter-left' : 'page-enter-right');
      setTimeout(() => setAnimClass(''), 300);
    }, 150);

    prevPath.current = pathname;
    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <div ref={containerRef} className={`page-transition ${animClass}`}>
      {children}
    </div>
  );
}
