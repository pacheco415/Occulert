const CACHE = 'occulert-v36';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.html',
  '/product-hub.html',
  '/manifest.json',
  '/privacy.html',
  '/safety.html',
  '/fleet-dashboard.html',
  '/fleet-onboarding.html',
  '/accept-invite.html',
  '/session-history.html',
  '/driver-profiles.html',
  '/pilot-signup.html',
  '/favicon.ico',
  '/occulert-logo-alt.png',
  '/occulert-logo.png',
  '/occulert-logo-main.png',
  '/homepage.css?v=31',
  '/homepage-journey-cinematic-v1.jpg',
  '/liquid-glass.css',
  '/portal.css?v=3',
  '/homepage.js',
  '/driver-app.css',
  '/lang.js',
  '/security-utils.js',
  '/faq.html',
  '/features.html',
  '/install.html',
  '/about.html',
  '/how-it-works.html'
];

const NETWORK_ONLY_ASSETS = new Set([
  '/auth-helper.js',
  '/occulert-backend.js',
  '/passkey-auth.js',
  '/supabase-loader.js',
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
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
        if (req.destination === 'image') return caches.match('/occulert-logo-main.png');
        return Response.error();
      });
    })
  );
});
