import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
test('the owned Inter font renders English and Spanish without Google requests',async({page})=>{
 const external=[];
 await page.route('https://fonts.googleapis.com/**',route=>{external.push(route.request().url());return route.abort();});
 await page.route('https://fonts.gstatic.com/**',route=>{external.push(route.request().url());return route.abort();});
 await page.goto('/');
 await expect.poll(()=>page.evaluate(async()=>{
   const faces=await document.fonts.load('600 16px Inter','Eyes open · Conducción segura');
   return faces.length>0&&faces.every(face=>face.status==='loaded');
 })).toBe(true);
 const urls=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.name.includes('.woff2')).map(entry=>new URL(entry.name).pathname));
 expect(urls).toContain('/vendor/inter-5.3.0/inter-latin-wght-normal.woff2');
 expect(urls.every(url=>url.startsWith('/vendor/inter-5.3.0/'))).toBe(true);
 expect(external).toEqual([]);
});

test.describe('owned fonts with the service worker',()=>{
 test.use({serviceWorkers:'allow'});
 test('a font cached after activation remains usable offline',async({page})=>{
  const root=resolve('.'),state={offline:false};
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.wasm':'application/wasm'};
  const publicExtension=/\.(?:html|js|css|json|woff2|wasm|binarypb|data|svg|png|webp|avif|ico)$/;
  const server=createServer((request,response)=>{
    if(state.offline){response.destroy();return;}
    const path=new URL(request.url,'http://localhost').pathname;
    const file=resolve(root,path==='/'?'index.html':path.slice(1));
    if(!file.startsWith(root+'/')||!publicExtension.test(file)||!existsSync(file)){response.statusCode=404;response.end();return;}
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    await page.goto(origin);
    await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    const path='/vendor/inter-5.3.0/inter-latin-wght-normal.woff2';
    // Load under worker control; observe completed caching before cutting the
    // actual origin. WebKit offline emulation can bypass worker recovery.
    await page.evaluate(async path=>{const response=await fetch(path);if(!response.ok)throw Error('font unavailable');await response.arrayBuffer();},path);
    await expect.poll(()=>page.evaluate(async path=>!!(await caches.match(path)),path)).toBe(true);
    state.offline=true;
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await expect.poll(()=>page.evaluate(async()=>{
      const faces=await document.fonts.load('600 16px Inter','Conducción segura');
      return faces.length>0&&faces.every(face=>face.status==='loaded');
    })).toBe(true);
    await expect(page.locator('#siteNav')).toHaveCSS('position','fixed');
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
 });
});
