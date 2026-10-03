import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { prepareDetectorPage } from './helpers/detector-runtime.mjs';
test.use({ serviceWorkers: 'allow' });
const root=resolve('.'),config=JSON.parse(readFileSync('vercel.json','utf8'));
test('optional pinned Tasks runtime performs unknown-face inference online and offline under CSP',async({page})=>{
  test.setTimeout(180_000);
  let offline=false;
  const server=createServer((request,response)=>{
    if(offline){response.destroy();return}
    const path=new URL(request.url,'http://localhost').pathname;
    for(const rule of config.headers)if(new RegExp(`^${rule.source}$`).test(path))for(const {key,value} of rule.headers)response.setHeader(key,value);
    response.setHeader('Cache-Control','no-store');
    const file=resolve(root,path==='/'?'index.html':path.slice(1));
    if(!file.startsWith(root+'/')||!existsSync(file)){response.statusCode=404;response.end();return}
    response.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.json':'application/json'})[extname(file)]||'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,outside=[],runtimeRequests=[];
  page.on('request',request=>{if(request.url().includes('/tasks-vision-'))runtimeRequests.push(request.url());if(request.url().startsWith('http')&&!request.url().startsWith(origin))outside.push(request.url().split('?')[0])});
  const infer=()=>page.evaluate(async()=>{
    const comparison=OcculertTasksComparison.create();await comparison.ready;
    const ready=comparison.snapshot().status;
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.currentTime=1;
    canvas.getContext('2d').fillRect(0,0,640,480);
    comparison.sample(canvas,null,0);const snapshot=comparison.snapshot();comparison.stop();return {ready,snapshot};
  });
  try{
    await prepareDetectorPage(page);
    await page.goto(origin+'/app.html',{waitUntil:'domcontentloaded'});
    expect(await page.evaluate(()=>OcculertTasksComparison.enabled)).toBe(false);
    await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready});
    await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(runtimeRequests).toEqual([]);
    await page.goto(origin+'/app.html?detector=tasks',{waitUntil:'domcontentloaded'});
    expect(await page.evaluate(()=>OcculertTasksComparison.enabled)).toBe(true);
    const first=await infer();expect(first.ready).toBe('ready');expect(first.snapshot.totalSamples).toBe(1);expect(first.snapshot.validSamples).toBe(0);expect(first.snapshot.meanClosureScore).toBeNull();
    expect(await page.evaluate(()=>window.detectorCspViolations)).toEqual([]);
    offline=true;
    await page.goto(origin+'/app.html?detector=tasks',{waitUntil:'domcontentloaded'});
    const second=await infer();expect(second.ready).toBe('ready');expect(second.snapshot.totalSamples).toBe(1);expect(second.snapshot.validSamples).toBe(0);
    expect(await page.evaluate(()=>window.detectorCspViolations)).toEqual([]);expect(outside).toEqual([]);
    await page.evaluate(async()=>{for(const name of await caches.keys()){const cache=await caches.open(name);for(const request of await cache.keys())if(request.url.endsWith('/face_landmarker.task'))await cache.put(request,new Response('corrupted model'))}});
    const corrupted=await infer();expect(corrupted.ready).toBe('unavailable');expect(corrupted.snapshot.totalSamples).toBe(0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
