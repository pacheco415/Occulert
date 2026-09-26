const CACHE = 'occulert-v54';
// Keep integrity pins for both variants, but install only the supported one.
const RUNTIME_ASSETS = [
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh.binarypb",
    "integrity": "sha256-E5VGvwWuuzPiYRtrlF86FinDFsqSTjPOwVR8hd3vn1M="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh.js",
    "integrity": "sha256-XbhVWsgMoq1zZvuz6lPA0JWWCfyau3uL43p07BrEupw="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh_solution_packed_assets.data",
    "integrity": "sha256-2+WQXFgsBGLNrqF+fm7OqS7aqMzMUVxeLnKR8su1+5k="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh_solution_packed_assets_loader.js",
    "integrity": "sha256-5d6GhbKZGEgT987GaOSZAjk3rlIbcPYM0PxIMpMERuA="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh_solution_simd_wasm_bin.data",
    "integrity": "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh_solution_simd_wasm_bin.js",
    "integrity": "sha256-dZNXRJl3mk8xwM8oKjB3RwDP4euZBtJhb1nNUeQmtF8="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh_solution_simd_wasm_bin.wasm",
    "integrity": "sha256-+56c/ouDqRTkDqsu/TsNkqYfgqfJaFifIjqyp+Mx0xQ="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh_solution_wasm_bin.js",
    "integrity": "sha256-zjGcQRxldU6Pmr+RH/JxYiv+WF4CfQM9OyYT7Tx+yiI="
  },
  {
    "url": "/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/face_mesh_solution_wasm_bin.wasm",
    "integrity": "sha256-VFIvolxQW/CUJC+Wm05JGRJesNrcy1aPKvFxu9ZYZfk="
  }
];
const RUNTIME_INTEGRITY = new Map(RUNTIME_ASSETS.map(asset => [asset.url, asset.integrity]));
function selectedRuntimeAssets() {
  let simd = false;
  try { simd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,9,1,7,0,65,0,253,15,26,11])); } catch (_) {}
  return RUNTIME_ASSETS.filter(asset => {
    if (asset.url.includes('solution_simd_wasm_bin.')) return simd;
    if (asset.url.includes('solution_wasm_bin.')) return !simd;
    return true;
  });
}
const SELECTED_RUNTIME_ASSETS = selectedRuntimeAssets();
const STATIC_ASSETS = [
  ...SELECTED_RUNTIME_ASSETS.map(asset => asset.url),
  '/',
  '/index.html',
  '/base.v47.css',
  '/app.html',
  '/manifest.json',
  '/favicon.ico',
  '/homepage.v51.css',
  '/liquid-glass.v47.css',
  '/accessibility.v52.css',
  '/portal.v47.css',
  '/homepage.js',
  '/driver-app.v47.css',
  '/driver-app.v60.js',
  '/lang.v47.js',
  '/security-utils.v47.js',
  '/static-page.v52.js'
];

const NETWORK_ONLY_ASSETS = new Set([
  '/auth-helper.v47.js',
  '/passkey-auth.v47.js',
  '/auth-helper.v49.js',
  '/auth-helper.v60.js',
  '/occulert-backend.v47.js',
  '/occulert-backend.v58.js',
  '/occulert-backend.v60.js',
  '/passkey-auth.v49.js',
  '/passkey-auth.v60.js',
  '/supabase-loader.v47.js',
  '/passwordless-auth.v49.js',
  '/passwordless-auth.v60.js',
]);
const NETWORK_FIRST_ASSETS = new Set([
  '/driver-app.v60.js',
]);
const CRITICAL_OFFLINE_ASSETS = [
  ...SELECTED_RUNTIME_ASSETS.map(asset => asset.url),
  '/base.v47.css',
  '/app.html',
  '/driver-app.v47.css',
  '/driver-app.v60.js',
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

function fetchWithDeadline(request, timeoutMs = NETWORK_FIRST_TIMEOUT_MS, fetchOptions, readResponse) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const options = Object.assign({}, fetchOptions, controller ? { signal: controller.signal } : {});
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
    Promise.resolve().then(() => fetch(request, options)).then(response => {
      if (settled) return null;
      return readResponse ? readResponse(response, () => !settled) : response;
    }).then(finish, () => finish(null));
  });
}

function bufferNetworkOnlyScript(response, isPending) {
  return response.arrayBuffer().then(bytes => {
    if (!isPending()) return null;
    const headers = new Headers(response.headers);
    // Fetch decodes the body. Forwarding the original wire length or encoding
    // would describe different bytes in the reconstructed script response.
    headers.delete('content-encoding');
    headers.delete('content-length');
    const body = [204, 205, 304].includes(response.status) ? null : bytes;
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  });
}

function completeNetworkResponse(response, isPending) {
  // Verify the complete transfer before delivering or caching it. Returning
  // the native response preserves its final URL, redirects, and decoding.
  return response.clone().arrayBuffer().then(() => isPending() ? response : null);
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
        await Promise.allSettled(STATIC_ASSETS.map(url => {
          const integrity = RUNTIME_INTEGRITY.get(url);
          return cache.add(integrity ? new Request(new URL(url, self.location.origin), { integrity }) : url);
        }));
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
    event.respondWith(fetchWithDeadline(req, NETWORK_FIRST_TIMEOUT_MS, { cache: 'no-store' }, bufferNetworkOnlyScript)
      .then(response => response || Response.error()));
    return;
  }
  if (url.origin === self.location.origin && NETWORK_FIRST_ASSETS.has(url.pathname)) {
    const networkAttempt = fetchWithDeadline(req, NETWORK_FIRST_TIMEOUT_MS, undefined, completeNetworkResponse);
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
    const networkAttempt = fetchWithDeadline(req, NETWORK_FIRST_TIMEOUT_MS, undefined, completeNetworkResponse);
    const cacheUpdate = networkAttempt
      .then(response => response && response.ok ? cacheResponseBestEffort(req, response) : null)
      .catch(() => null);
    if (typeof event.waitUntil === 'function') event.waitUntil(cacheUpdate);
    event.respondWith((async () => {
      const networkResponse = await networkAttempt;
      if (networkResponse && networkResponse.ok) return networkResponse;
      const cachedResponse = await caches.match(req) || await caches.match('/index.html');
      return cachedResponse || networkResponse || Response.error();
    })());
    return;
  }

  event.respondWith(
    caches.match(req).then(match => {
      if (match) return match;
      const integrity = url.origin === self.location.origin && RUNTIME_INTEGRITY.get(url.pathname);
      return fetch(integrity ? new Request(req, { integrity }) : req).then(res => {
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
