import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const budget=JSON.parse(readFileSync('startup-performance-budgets.json','utf8'));
test('controlled cold driver startup stays within its measured software budget',async({browser},testInfo)=>{
  const samples=[], baseURL=testInfo.project.use.baseURL;
  expect(new URL(baseURL).hostname).toBe('127.0.0.1');
  expect(budget.coldSamplesPerBrowser).toBe(5);
  for(let index=0;index<budget.coldSamplesPerBrowser;index++) {
    const context=await browser.newContext({baseURL,viewport:{width:390,height:844},serviceWorkers:'block'});
    const page=await context.newPage(), blockedOrigins=new Set(), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==new URL(baseURL).origin) {blockedOrigins.add(url.origin);return route.abort('blockedbyclient');}
      return route.continue();
    });
    await page.addInitScript(()=>{
      let startup;
      window.__startupMeasurement={readyAt:null,cameraCalls:0};
      Object.defineProperty(window,'OcculertStartup',{configurable:true,get:()=>startup,set:value=>{
        startup=Object.freeze({...value,ready:core=>{
          const ready=value.ready(core);
          if(ready && window.__startupMeasurement.readyAt===null)window.__startupMeasurement.readyAt=performance.now();
          return ready;
        }});
      }});
      if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
        window.__startupMeasurement.cameraCalls++;throw Error('No camera access permitted in startup benchmark');
      }});
    });
    try {
      await page.goto('/app.html',{waitUntil:'load'});
      await expect.poll(()=>page.evaluate(()=>window.OcculertStartup?.isReady())).toBe(true);
      expect(errors).toEqual([]);
      const sample=await page.evaluate(()=>{
        const navigation=performance.getEntriesByType('navigation')[0];
        const scripts=[...document.scripts].map(script=>({path:script.src?new URL(script.src).pathname:null,async:script.async,defer:script.defer,type:script.type||'classic',parserBlocking:Boolean(script.src&&!script.async&&!script.defer&&script.type!=='module')}));
        return {...window.__startupMeasurement,domContentLoaded:navigation.domContentLoadedEventEnd,load:navigation.loadEventEnd,
          resources:performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).origin===location.origin).map(entry=>({path:new URL(entry.name).pathname,initiatorType:entry.initiatorType,duration:entry.duration,transferSize:entry.transferSize,encodedBodySize:entry.encodedBodySize,decodedBodySize:entry.decodedBodySize})),scripts};
      });
      expect(sample.cameraCalls).toBe(0);
      expect(sample.readyAt).toBeGreaterThan(0);
      expect(sample.readyAt).toBeLessThanOrEqual(budget.maxDriverReadyMs);
      samples.push({...sample,blockedOrigins:[...blockedOrigins].sort()});
    } finally {await context.close();}
  }
  const ordered=samples.map(sample=>sample.readyAt).sort((a,b)=>a-b);
  const receipt={schema:1,checkedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:30000}).trim(),worktreeDirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8',timeout:30000}).trim()),lockSha256:createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),sourceHashes:Object.fromEntries(['app.html','asset-versions.json','asset-integrity.json','tests/startup-performance.spec.mjs','startup-performance-budgets.json'].map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),browser:testInfo.project.name,browserVersion:browser.version(),node:process.version,platform:process.platform,architecture:process.arch,conditions:{origin:'owned loopback source',viewport:{width:390,height:844},coldBrowserContext:true,serviceWorkers:'blocked',externalRequests:'aborted',camera:'prohibited',detectorInference:'not started',cpuThrottle:'none',networkThrottle:'none'},budget,maxMs:ordered.at(-1),medianMs:ordered[2],samples,physicalAcceptance:false,detectionAccuracy:null};
  await testInfo.attach('controlled-startup-receipt',{body:JSON.stringify(receipt,null,2),contentType:'application/json'});
});
