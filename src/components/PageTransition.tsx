'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const navOrder = ['/', '/training-plan', '/body-metrix', '/nutrition-plan', '/vitals'];

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const [animClass, setAnimClass] = useState('');

  useEffect(() => {
    if (prevPath.current === pathname) return;
    const prevIdx = navOrder.indexOf(prevPath.current);
    const currIdx = navOrder.indexOf(pathname);
    const goingRight = currIdx > prevIdx;

    // Slide out, then slide in from the opposite side
    setAnimClass(goingRight ? 'slide-out-left' : 'slide-out-right');

    const timer = setTimeout(() => {
      setAnimClass(goingRight ? 'slide-in-right' : 'slide-in-left');
      setTimeout(() => setAnimClass(''), 250);
    }, 120);

    prevPath.current = pathname;
    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <div className={`page-transition ${animClass}`}>
      {children}
    </div>
  );
}
