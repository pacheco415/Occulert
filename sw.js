const CACHE='occulert-v5';
const STATIC=['/','index.html','app.html','manifest.json','occulert-logo-alt.png','occulert-logo.png','occulert-logo-main.png'];
self.addEventListener('install',e=>{
e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
if(e.request.mode==='navigate'){
e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
return;
}
e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
if(res.ok){const c=res.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c));}
return res;
})));
});
