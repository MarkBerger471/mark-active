'use client';

import { useEffect } from 'react';
import { flushSyncQueue } from '@/utils/storage';

export default function PWAProvider() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'development') {
        navigator.serviceWorker.getRegistrations().then(regs =>
          regs.forEach(r => r.unregister())
        );
      } else {
        // No mid-session reload on controllerchange — the new SW takes over
        // on the next cold launch. Forcing a reload while the cache is mid-
        // rotation has caused iOS PWA "This page couldn't load" failures.
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
          // Check for updates on every mount + on focus (PWA resume)
          reg.update().catch(() => {});
          const checkOnFocus = () => { reg.update().catch(() => {}); };
          window.addEventListener('focus', checkOnFocus);
          return () => window.removeEventListener('focus', checkOnFocus);
        }).catch((e) => {
          console.warn('SW registration failed:', e);
        });
      }
    }

    flushSyncQueue();
    window.addEventListener('online', flushSyncQueue);
    return () => window.removeEventListener('online', flushSyncQueue);
  }, []);

  return null;
}
