const CACHE_NAME = 'bb-shell-v52';
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
// Precache the app-shell HTML + the PWA manifest so a repeat/standalone launch
// paints from cache with zero network wait (stale-while-revalidate below keeps
// them fresh). Static JS/CSS are hashed and cached cache-first on first fetch.
const PAGES = ['/', '/login', '/body-metrix', '/training-plan', '/nutrition-plan', '/vitals', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  if (IS_LOCALHOST) {
    self.skipWaiting();
    return;
  }
  // Per-URL precache so a single failing route doesn't void the entire shell
  // (cache.addAll is atomic — one bad URL leaves the cache empty).
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PAGES.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  // Intentionally NOT calling self.clients.claim(): existing tabs keep using
  // the previous SW until next cold launch. Avoids mid-session disruption
  // (the controllerchange-triggered reload could land on an empty cache
  // window and surface as "This page couldn't load" on iOS).
});

// Cache a response only if it's a real OK page (not redirect, not error)
function cacheable(response) {
  return response && response.ok && response.status === 200 && !response.redirected;
}

// Last-resort fallback so respondWith never resolves to undefined.
async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    const cachedRoot = await caches.match('/');
    if (cachedRoot) return cachedRoot;
  }
  return new Response('', { status: 504, statusText: 'Offline' });
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

  // Skip Next.js App Router RSC payloads and data fetches. These are
  // versioned per build and should never come from a stale cache; the
  // router handles its own retries far better than we can here.
  if (url.searchParams.has('_rsc') || url.pathname.startsWith('/_next/data/')) return;

  // Static assets (immutable, hash-based filenames) — cache first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (cacheable(response)) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
            }
            return response;
          })
          .catch(() => offlineFallback(event.request));
      })
    );
    return;
  }

  // Navigation — stale-while-revalidate, never resolves to undefined
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
          .catch(() => null);
        if (cached) return cached;
        return networkPromise.then((res) => res || offlineFallback(event.request));
      })
    );
    return;
  }

  // Other resources — stale-while-revalidate, with offline fallback
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
        .catch(() => null);
      if (cached) return cached;
      return networkPromise.then((res) => res || offlineFallback(event.request));
    })
  );
});
