const CACHE='occulert-v7';
const STATIC=[
    '/',
    '/index.html',
    '/app.html',
    '/app-v2.html',
    '/app-ai-v3.html',
    '/manifest.json',
    '/occulert-logo-alt.png',
    '/occulert-logo.png',
    '/occulert-logo-main.png'
  ];

self.addEventListener('install',e=>{
    e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
    e.waitUntil(
          caches.keys()
            .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
            .then(()=>self.clients.claim())
        );
});

self.addEventListener('fetch',e=>{
    const req=e.request;
    // Network-first for HTML navigation requests
                        if(req.mode==='navigate'||req.url.match(/\.(html)$/)){
                              e.respondWith(
                                      fetch(req)
                                        .then(r=>{
                                                    if(r.ok){const c=r.clone();caches.open(CACHE).then(cache=>cache.put(req,c));}
                                                    return r;
                                        })
                                        .catch(()=>caches.match(req))
                                    );
                              return;
                        }
    // Cache-first for static assets
                        e.respondWith(
                              caches.match(req).then(r=>r||fetch(req).then(res=>{
                                      if(res.ok&&req.url.startsWith(self.location.origin)){
                                                const c=res.clone();
                                                caches.open(CACHE).then(cache=>cache.put(req,c));
                                      }
                                      return res;
                              }))
                            );
});
