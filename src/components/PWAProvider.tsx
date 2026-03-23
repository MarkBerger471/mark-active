'use client';

import { useEffect } from 'react';
import { flushSyncQueue } from '@/utils/storage';

export default function PWAProvider() {
  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => {
        console.warn('SW registration failed:', e);
      });
    }

    // Flush pending sync on mount and when coming online
    flushSyncQueue();
    window.addEventListener('online', flushSyncQueue);
    return () => window.removeEventListener('online', flushSyncQueue);
  }, []);

  return null;
}
