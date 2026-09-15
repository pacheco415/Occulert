const CACHE = 'occulert-v47';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/base.v47.css',
  '/app.html',
  '/manifest.json',
  '/favicon.ico',
  '/homepage.v47.css',
  '/liquid-glass.v47.css',
  '/portal.v47.css',
  '/homepage.js',
  '/driver-app.v47.css',
  '/driver-app.v47.js',
  '/lang.v47.js',
  '/security-utils.v47.js'
];

const NETWORK_ONLY_ASSETS = new Set([
  '/auth-helper.v47.js',
  '/occulert-backend.v47.js',
  '/passkey-auth.v47.js',
  '/supabase-loader.v47.js',
]);
const NETWORK_FIRST_ASSETS = new Set([
  '/driver-app.v47.js',
]);
const CRITICAL_OFFLINE_ASSETS = [
  '/base.v47.css',
  '/app.html',
  '/driver-app.v47.css',
  '/driver-app.v47.js',
];
const NETWORK_FIRST_TIMEOUT_MS = 2500;
const CACHE_WRITE_TIMEOUT_MS = 1000;

function settleWithin(promise, timeoutMs, fallback = null) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), timeoutMs);
    Promise.resolve(promise).then(finish, () => finish(fallback));
  });
}

function fetchWithDeadline(request, timeoutMs = NETWORK_FIRST_TIMEOUT_MS) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const requestPromise = Promise.resolve().then(() => fetch(request, controller ? { signal: controller.signal } : undefined));
  return new Promise(resolve => {
    let settled = false;
    const finish = response => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const timer = setTimeout(() => {
      if (controller) controller.abort();
      finish(null);
    }, timeoutMs);
    requestPromise.then(finish, () => finish(null));
  });
}

function cacheResponseBestEffort(request, response, timeoutMs = CACHE_WRITE_TIMEOUT_MS) {
  let copy;
  try {
    copy = response.clone();
  } catch (error) {
    return Promise.resolve();
  }
  const update = caches.open(CACHE).then(cache => cache.put(request, copy));
  return settleWithin(update, timeoutMs);
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)));
        const criticalResponses = await Promise.all(CRITICAL_OFFLINE_ASSETS.map(url => cache.match(url)));
        if (criticalResponses.some(response => !response)) throw new Error('Critical offline assets were not cached');
        await self.skipWaiting();
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/app.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/app.html');
    })
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  if (url.origin === self.location.origin && NETWORK_ONLY_ASSETS.has(url.pathname)) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }
  if (url.origin === self.location.origin && NETWORK_FIRST_ASSETS.has(url.pathname)) {
    const networkAttempt = fetchWithDeadline(req);
    const cacheUpdate = networkAttempt
      .then(response => response && response.ok ? cacheResponseBestEffort(req, response) : null)
      .catch(() => null);
    if (typeof event.waitUntil === 'function') event.waitUntil(cacheUpdate);
    event.respondWith((async () => {
      const networkResponse = await networkAttempt;
      if (networkResponse && networkResponse.ok) return networkResponse;
      const cachedResponse = await caches.match(req);
      if (cachedResponse) return cachedResponse;
      return networkResponse || Response.error();
    })());
    return;
  }

  if (req.mode === 'navigate' || req.url.endsWith('.html')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(match => match || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(match => {
      if (match) return match;
      return fetch(req).then(res => {
        if (res && res.ok && req.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        if (req.destination === 'image') return caches.match('/favicon.ico');
        return Response.error();
      });
    })
  );
});
