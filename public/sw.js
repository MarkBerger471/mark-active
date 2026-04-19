const CACHE_NAME = 'bb-shell-v42';
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const PAGES = ['/', '/login', '/body-metrix', '/training-plan', '/nutrition-plan', '/vitals'];

self.addEventListener('install', (event) => {
  if (IS_LOCALHOST) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PAGES).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Helper: cache a response only if it's a real OK page (not redirect, not error)
function cacheable(response) {
  return response && response.ok && response.status === 200 && !response.redirected;
}

self.addEventListener('fetch', (event) => {
  if (IS_LOCALHOST) return;

  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Skip Firebase/Firestore — handled by IDB layer
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com')
  ) return;

  // Skip API routes — straight to network
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (immutable, hash-based filenames) — cache first, never refetch
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (cacheable(response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests — TRUE stale-while-revalidate
  // Serve from cache instantly; fetch in background to update cache for next time.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkPromise = fetch(event.request)
          .then((response) => {
            if (cacheable(response)) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
            }
            return response;
          })
          .catch(() => cached || caches.match('/'));
        // If we have a cached response, return it instantly — no waiting on network
        return cached || networkPromise;
      })
    );
    return;
  }

  // Other resources — stale-while-revalidate (instant from cache, refresh in background)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkPromise = fetch(event.request)
        .then((response) => {
          if (cacheable(response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkPromise;
    })
  );
});
