'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const [animClass, setAnimClass] = useState('');

  useEffect(() => {
    if (prevPath.current === pathname) return;
    // Skip the fade-out entirely — it just delays the new content from
    // showing. Fade-in only, kept short so navigation feels instant.
    setAnimClass('page-fade-in');
    const timer = setTimeout(() => setAnimClass(''), 90);
    prevPath.current = pathname;
    return () => { clearTimeout(timer); };
  }, [pathname]);

  return (
    <div className={`page-transition ${animClass}`}>
      {children}
    </div>
  );
}
