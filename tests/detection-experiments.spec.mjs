import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {adaptTrace} from '../benchmark/parked-detection-trace.mjs';
import {prepareDetectorPage} from './helpers/detector-runtime.mjs';
const versions=JSON.parse(readFileSync('asset-versions.json','utf8'));
const query='?fatigue-timing=elapsed&ear-units=pixels&noface-escalation=1&perclos=time&pitch-gate=1';
async function ready(page){await expect.poll(()=>page.evaluate(()=>window.OcculertStartup?.isReady())).toBe(true)}
async function softwareFrames(page,{tasks=false}={}){
 return page.evaluate(({tasks})=>{
  window.__fixtureTime=0;const startWall=Date.now();Date.now=()=>startWall+window.__fixtureTime;performance.now=()=>window.__fixtureTime;
  Object.defineProperty(video,'videoWidth',{configurable:true,value:360});Object.defineProperty(video,'videoHeight',{configurable:true,value:480});
  canvas.width=360;canvas.height=480;running=true;sessionStart=startWall;localSessionId='parked-browser-fixture';fatigue=0;confidence=100;alerts=0;lastAlert=0;
  calibrating=true;calibrated=false;calibrationUntil=startWall+3200;calibrationSamples=[];perclosWindow=[];earHistory=[];noseYHistory=[];
  eyesClosedSince=0;turnedSince=0;totalDistractionMs=0;noFaceSince=0;lastFaceSeen=0;microsleeps=0;lastMicro=0;maxFatigue=0;fatigueSampleSum=0;fatigueSampleCount=0;
  experimentController.begin();
  const face=(ear=.4,nose=.6)=>{const lm=Array.from({length:468},()=>({x:.5,y:.5}));for(const [idx,cx]of [[LEFT,.62],[RIGHT,.38]]){const h=ear*.1*360/480/2,xy=[[cx-.05,.5],[cx-.02,.5-h],[cx+.02,.5-h],[cx+.05,.5],[cx+.02,.5+h],[cx-.02,.5+h]];idx.forEach((n,i)=>lm[n]={x:xy[i][0],y:xy[i][1]})}lm[4]={x:.5,y:.55};lm[234]={x:.25,y:.6};lm[454]={x:.75,y:.6};lm[1]={x:.5,y:nose};lm[152]={x:.5,y:.8};return lm};
  const frame=(time,ear=.4,nose=.6)=>{window.__fixtureTime=time;if(tasks)experimentController.capture({videoWidth:360,videoHeight:480,currentTime:time/1000});onResults({multiFaceLandmarks:[face(ear,nose)]})};
  for(let t=0;t<=3240;t+=135)frame(t);
  for(let t=3375;t<=5535;t+=135)frame(t,.08,.7);
  const down={microsleeps,eyesClosedSince,totalDistractionMs,timePerclos:experimentController.summary().timePerclos};
  for(let t=5670;t<=7695;t+=135)frame(t,.08,.6);
  const front={microsleeps,eyesClosedSince,timePerclos:experimentController.summary().timePerclos};
  running=false;experimentController.stop();return {down,front,calibration:experimentController.exportData().session.calibration};
 },{tasks});
}

test('ordinary startup requests no optional runtime, and duplicate flags leave every mode off',async({page})=>{
 const optional=[];page.on('request',request=>{if(/detection-experiments|tasks-vision-/.test(request.url()))optional.push(request.url())});
 await page.goto('/app.html');await ready(page);expect(optional).toEqual([]);
 await page.goto('/app.html?detector=tasks&detector=tasks&perclos=TIME&pitch-gate=true');await ready(page);expect(optional).toEqual([]);
 expect(await page.evaluate(()=>experimentFlags.any)).toBe(false);
});

test('failed owned helper never authorizes camera or cloud work and offers parked reload',async({page})=>{
 let camera=0;await page.exposeFunction('__cameraAttempt',()=>camera++);
 await page.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{enumerateDevices:async()=>[],getUserMedia:async()=>{await window.__cameraAttempt();throw Error('Unexpected camera')}}})});
 await page.route('**/'+versions['detection-experiments.js'],route=>route.abort());await page.goto('/app.html?perclos=time');
 await expect(page.getByRole('heading',{name:'App could not load',exact:true})).toBeVisible({timeout:12000});
 await expect(page.locator('#startBtn')).toBeDisabled();expect(camera).toBe(0);expect(await page.evaluate(()=>cloudReady)).toBe(false);
});

test('combined actual monitor keeps down-looking closure unknown and counts later frontal closure with local-only setup',async({page})=>{
 await page.goto('/app.html'+query);await ready(page);await expect(page.locator('#cloudConsent')).toBeDisabled();
 const result=await softwareFrames(page);expect(result.calibration.usable).toBe(true);expect(result.calibration.pitchAvailable).toBe(true);
 expect(result.down.microsleeps).toBe(0);expect(result.down.eyesClosedSince).toBe(0);expect(result.down.timePerclos.observedMs).toBe(0);expect(result.down.totalDistractionMs).toBeGreaterThan(1800);
 expect(result.front.microsleeps).toBe(1);expect(result.front.timePerclos.perclos).toBe(100);
});

test('actual export button downloads scalar JSON only after a parked session stops',async({page})=>{
 await page.goto('/app.html'+query+'&detector=tasks');await ready(page);
 await softwareFrames(page,{tasks:true});const downloadPromise=page.waitForEvent('download');await page.locator('#exportDetectionTrace').click();const download=await downloadPromise;
 expect(download.suggestedFilename()).toBe('occulert-parked-detection.json');const stream=await download.createReadStream();let content='';for await(const chunk of stream)content+=chunk;
 const data=JSON.parse(content);const adapted=adaptTrace(data,{participant:'BrowserFixture',split:'test',episodes:[]});expect(adapted.summary.tasksEventRecall).toBeNull();expect(data.schema).toBe('occulert.parked-detection-trace');expect(data.samples.length).toBeGreaterThan(40);expect(data.session.tasksEventMetricsAvailable).toBe(false);
 expect(data.samples.every(row=>row.eyeBlinkLeft===null&&row.tasksUsable===false)).toBe(true);
 for(const field of ['rawLandmarks','coordinates','email','token','route','location','media'])expect(content).not.toContain('"'+field+'"');
});

test.describe('owned optional runtime',()=>{
 test.use({serviceWorkers:'allow'});
 test('blank-canvas CPU/GPU desktop software probe, offline inference and corrupt cached-model rejection',async({page},testInfo)=>{
  test.setTimeout(180000);const root=resolve('.'),config=JSON.parse(readFileSync('vercel.json','utf8'));let offline=false;
  const server=createServer((request,response)=>{if(offline){response.destroy();return}const path=new URL(request.url,'http://localhost').pathname;
   for(const rule of config.headers)if(new RegExp('^'+rule.source+'$').test(path))for(const {key,value}of rule.headers)response.setHeader(key,value);
   const file=resolve(root,path==='/'?'index.html':path.slice(1));if(!file.startsWith(root+'/')||!existsSync(file)){response.statusCode=404;response.end();return}
   response.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.json':'application/json'})[extname(file)]||'application/octet-stream');response.end(readFileSync(file));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,outside=[];
  page.on('request',request=>{if(request.url().startsWith('http')&&!request.url().startsWith(origin))outside.push(request.url().split('?')[0])});
  const infer=delegate=>page.evaluate(async delegate=>{
   const before=performance.now(),collector=OcculertDetectionExperiments.createTasks({delegate});await collector.ready;const startupMs=performance.now()-before,status=collector.status();
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,640,480);
   const values=[],usable=[];for(let i=0;i<23;i++){const result=collector.sample(canvas,performance.now());if(result){if(i>=3)values.push(result.inferenceMs);usable.push(OcculertDetectionExperiments.parseTasksResult(result.result).tasksUsable)}}
   const finalStatus=collector.status();collector.stop();values.sort((a,b)=>a-b);return {requestedDelegate:delegate,usableDelegate:status==='ready'&&finalStatus==='ready'?delegate:null,startupMs,status,finalStatus,samples:values.length,
    medianMs:values.length?values[Math.floor(values.length/2)]:null,p95Ms:values.length?values[Math.ceil(values.length*.95)-1]:null,usableFaceFrames:usable.filter(Boolean).length,fallback:false,workload:'desktop blank 640x480 canvas; 3 warmups + 20 measured inference calls; no camera or accuracy claim'};
  },delegate);
  try{await prepareDetectorPage(page);await page.goto(origin+'/app.html');await ready(page);await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
   await page.goto(origin+'/app.html?detector=tasks');await ready(page);const probes=[];for(const delegate of ['CPU','GPU']){const result=await infer(delegate);probes.push(result);expect(result.usableFaceFrames).toBe(0);if(result.usableDelegate)expect(result.samples).toBe(20)}
   await testInfo.attach('blank-canvas-desktop-software-probe',{body:JSON.stringify({browser:testInfo.project.name,userAgent:await page.evaluate(()=>navigator.userAgent),probes},null,2),contentType:'application/json'});
   expect(probes.some(probe=>probe.usableDelegate)).toBe(true);expect(await page.evaluate(()=>detectorCspViolations)).toEqual([]);
   offline=true;const offlineResult=await infer(probes.find(probe=>probe.usableDelegate).requestedDelegate);expect(offlineResult.usableDelegate).not.toBeNull();expect(offlineResult.usableFaceFrames).toBe(0);
   await page.evaluate(async()=>{for(const name of await caches.keys()){const cache=await caches.open(name);for(const request of await cache.keys())if(request.url.endsWith('/face_landmarker.task'))await cache.put(request,new Response('corrupt model'))}});
   const corrupt=await infer('CPU');expect(corrupt.status).toBe('unavailable');expect(corrupt.samples).toBe(0);expect(outside).toEqual([]);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 });
});
