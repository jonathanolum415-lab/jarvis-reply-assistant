const CACHE_NAME = 'jarvis-shell-v7';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add('./').catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('jarvis-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./', copy));
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then(cache => cache.match('./')))
    );
    return;
  }

  if (event.request.destination === 'script' || event.request.destination === 'style') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        try {
          const response = await fetch(event.request, { cache: 'no-cache' });
          if (response.ok) {
            await cache.put(event.request, response.clone());
            return response;
          }
          return cached || response;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
