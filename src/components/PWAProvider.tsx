'use client';

import { useEffect } from 'react';
import { flushSyncQueue } from '@/utils/storage';

export default function PWAProvider() {
  useEffect(() => {
    // Unregister service worker in development
    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'development') {
        navigator.serviceWorker.getRegistrations().then(regs =>
          regs.forEach(r => r.unregister())
        );
      } else {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => {
          console.warn('SW registration failed:', e);
        });
      }
    }

    // Flush pending sync on mount and when coming online
    flushSyncQueue();
    window.addEventListener('online', flushSyncQueue);
    return () => window.removeEventListener('online', flushSyncQueue);
  }, []);

  return null;
}
