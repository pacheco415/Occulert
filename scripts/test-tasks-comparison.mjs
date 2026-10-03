import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
const manifest=JSON.parse(fs.readFileSync('vendor/mediapipe/tasks-vision-1.0.1-occulert.1/runtime-manifest.json','utf8'));
const helper=fs.readFileSync('tasks-comparison.v1.js','utf8'),sw=fs.readFileSync('sw.js','utf8');
function api(){const window={location:{search:''}};vm.runInNewContext(helper,{window,URLSearchParams});return window.OcculertTasksComparison}
test('all optional runtime bytes match pins and are excluded from normal offline installation',()=>{
 for(const item of manifest.files){const bytes=fs.readFileSync('.'+item.url),hash=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(hash,item.sha256);assert.equal(bytes.length,item.bytes);assert.equal('sha256-'+Buffer.from(hash,'hex').toString('base64'),item.integrity);assert.ok(helper.includes(item.integrity));assert.ok(sw.includes(item.integrity));if(item.file.endsWith('.js'))assert.doesNotMatch(bytes.toString(),/new Function\(|\beval\s*\(/)}
 const staticBlock=sw.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1];assert.doesNotMatch(staticBlock,/tasks-vision-1\.0\.1/);
 for(const name of ['LICENSE','EMSCRIPTEN-LICENSE','NOTICE.txt'])assert.ok(fs.readFileSync('vendor/mediapipe/tasks-vision-1.0.1-occulert.1/'+name).length);
 const config=JSON.parse(fs.readFileSync('vercel.json'));assert.ok(config.headers.filter(rule=>rule.headers.some(h=>h.key==='Content-Security-Policy')).every(rule=>!JSON.stringify(rule).includes("'unsafe-eval'")));
});
test('blendshape parsing requires tracked faces and valid bilateral eyes plus jaw data',()=>{
 const parser=api().parseResult;const result={faceLandmarks:[[]],faceBlendshapes:[{categories:[{categoryName:'eyeBlinkLeft',score:.8},{categoryName:'eyeBlinkRight',score:.6},{categoryName:'jawOpen',score:.2}]}]};
 assert.equal(parser(result).closureScore,70);assert.equal(parser({faceLandmarks:[],faceBlendshapes:result.faceBlendshapes}),null);
 for(const value of [null,NaN,Infinity,-1,2,'0.8']){const changed=structuredClone(result);changed.faceBlendshapes[0].categories[0].score=value;assert.equal(parser(changed),null)}
 const duplicate=structuredClone(result);duplicate.faceBlendshapes[0].categories.push(duplicate.faceBlendshapes[0].categories[0]);assert.equal(parser(duplicate),null);
 assert.equal(api().enabled,false);
});

function harness({pending=false,pinsMatch=true}={}){
 let closeCount=0,stamp=0,resolveCreation,appended=0,modelRequests=0;
 const result={faceLandmarks:[[]],faceBlendshapes:[{categories:[{categoryName:'eyeBlinkLeft',score:.8},{categoryName:'eyeBlinkRight',score:.6},{categoryName:'jawOpen',score:.2}]}]};
 const detector={close(){closeCount++},detectForVideo(){return result}};
 const pins=manifest.files.map(({url,integrity})=>({url,integrity}));
 const window={location:{search:'?detector=tasks'},Vision:{FaceLandmarker:{}}};
 const context={window,URLSearchParams,setTimeout,clearTimeout,AbortController,Uint8Array,performance:{now:()=>stamp},
  navigator:{serviceWorker:{controller:{postMessage(message,[port]){queueMicrotask(()=>port.peer.onmessage({data:{type:'occulert.tasks.runtime',pins:pinsMatch?pins:[]}}))}}}},
  MessageChannel:class{constructor(){this.port1={close(){}};this.port2={peer:this.port1}}},
  fetch:async()=>{modelRequests++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}},
  document:{createElement(){return {remove(){}}},head:{appendChild(script){appended++;assert.equal(script.integrity,manifest.files[0].integrity);window.Vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:()=>pending?new Promise(resolve=>{resolveCreation=resolve}):Promise.resolve(detector)}};queueMicrotask(()=>script.onload())}}}};
 vm.runInNewContext(helper,context);
 return {api:window.OcculertTasksComparison,result,advance:()=>{stamp+=500},resolve:()=>resolveCreation(detector),stats:()=>({closeCount,appended,modelRequests})};
}
test('creation uses the pinned script even if an unrelated global already exists',async()=>{
 const h=harness(),c=h.api.create();await c.ready;assert.equal(c.snapshot().status,'ready');assert.equal(h.stats().appended,1);c.stop();assert.equal(h.stats().closeCount,1);
});
test('an outdated worker prevents loading the model and runtime',async()=>{
 const h=harness({pinsMatch:false}),c=h.api.create();await c.ready;assert.equal(c.snapshot().status,'unavailable');assert.equal(h.stats().appended,0);assert.equal(h.stats().modelRequests,0);c.stop();
});
test('cancelled initialization closes its late detector without publishing readiness',async()=>{
 const h=harness({pending:true}),statuses=[],c=h.api.create({onStatus:value=>statuses.push(value)});
 while(!h.stats().modelRequests)await new Promise(resolve=>setImmediate(resolve));
 c.stop();h.resolve();await c.ready;assert.equal(h.stats().closeCount,1);assert.deepEqual(statuses,[]);assert.equal(c.sample({currentTime:1},.3,0),null);
});
test('local comparison history is bounded, copied, and unknown faces do not count as open eyes',async()=>{
 const h=harness(),c=h.api.create();await c.ready;
 for(let i=0;i<1205;i++){h.advance();c.sample({currentTime:i},.3,i*500)}
 const s=c.snapshot();assert.equal(s.totalSamples,1205);assert.equal(s.retainedSamples,1200);assert.equal(s.samples[0].atMs,2500);s.samples[0].closureScore=0;assert.equal(c.snapshot().samples[0].closureScore,70);
 h.result.faceLandmarks=[];h.advance();assert.equal(c.sample({currentTime:1300},null,650000),null);assert.equal(c.snapshot().validSamples,1205);assert.equal(c.snapshot().samples.at(-1).closureScore,null);c.stop();
});
test('repeated video frames and sub-500-ms intervals never add comparison samples',async()=>{
 const h=harness(),c=h.api.create();await c.ready;c.sample({currentTime:1},.3,0);assert.equal(c.sample({currentTime:2},.3,1),null);h.advance();assert.equal(c.sample({currentTime:1},.3,500),null);assert.equal(c.snapshot().totalSamples,1);c.stop();
});
