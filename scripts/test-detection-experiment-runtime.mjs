import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createAppHarness} from './lib/app-page-harness.mjs';
const versions=JSON.parse(fs.readFileSync('asset-versions.json','utf8'));
const helper=fs.readFileSync(versions['detection-experiments.js'],'utf8');
const old=fs.readFileSync('driver-app.v80.js','utf8');
const vendor=JSON.parse(fs.readFileSync('vendor/mediapipe/tasks-vision-1.0.1-occulert.1/runtime-manifest.json','utf8'));
const pins=vendor.files.map(({url,integrity})=>({url,integrity}));
function harness(query,extra={}){return createAppHarness({preloadSources:[helper],sandboxOverrides:{location:{search:query},URLSearchParams,...extra}})}
function begin(h){h.startSession();h.run('experimentController?.begin()');}
function calibrated(h){begin(h);h.feed({ear:.3},3400);return h;}

test('empty query executes exactly the released default pipeline across calibration, eyes, nods, turns, loss and recovery',()=>{
 const before=createAppHarness({sourceOverride:old}),after=harness('');before.startSession();after.startSession();
 assert.equal(after.get('experimentController'),null);assert.equal(after.get('experimentFlags.any'),false);
 const script=[...Array(26).fill({ear:.3}),...Array(40).fill({ear:.08}),...Array(14).fill({ear:.3,noseX:.7}),...Array(40).fill({face:false}),...Array(55).fill({ear:.3}),...Array.from({length:25},(_,i)=>({ear:.15,noseY:i%10<5?.6:.53}))];
 for(const spec of script){before.frame(spec);after.frame(spec);assert.equal(JSON.stringify(after.state()),JSON.stringify(before.state()));
  for(const field of ['avgFatigue','maxFatigue','alerts','headNods','microsleeps','perclos','distractionSeconds','safetyScore'])assert.equal(after.run('fleetPayload().'+field),before.run('fleetPayload().'+field),field);
  for(const field of ['totalDistractionMs','maxFatigue','lastMicro','lastNod','baseClosedThreshold','baseWatchThreshold'])assert.equal(after.get(field),before.get(field),field);
 }
});

test('all exact selected modes disable every cloud route while preserving another ordinary pending outbox',async()=>{
 for(const query of ['?fatigue-timing=elapsed','?ear-units=pixels','?detector=tasks','?noface-escalation=1','?perclos=time','?pitch-gate=1','?detector=tasks&ear-units=pixels&perclos=time&pitch-gate=1&noface-escalation=1&fatigue-timing=elapsed']){
  const calls=[];const api=new Proxy({}, {get:(_,name)=>()=>{calls.push(name);return Promise.resolve({})}});
  const h=createAppHarness({initialStorage:{'occulert-cloud-outbox':'ordinary-pending-value'},preloadSources:[helper],sandboxOverrides:{location:{search:query},URLSearchParams,OcculertBackend:api,OcculertSync:api}});
  assert.equal(h.el('cloudConsent').checked,false);assert.equal(h.el('cloudConsent').disabled,true);
  calibrated(h);h.run('cloudConsent.checked=true;cloudReady=true');
  await h.run('beginBackendSession()');h.run("queueBackendEvent('drowsy')");await h.run('retryCloudSummaries()');await h.run('initCloud()');
  await h.run('finishBackendSession(fleetPayload(),{id:"x",scope:{ownerId:"ordinary"},consented:true,eventQueue:Promise.resolve()})');
  await h.run('pushFleet(true)');assert.equal(h.get('getCloudSummaryOutbox()'),null);assert.equal(h.get('cloudSummaryScope()'),null);
  assert.equal(calls.length,0,query);assert.equal(h.run("localStorage.getItem('occulert-cloud-outbox')"),'ordinary-pending-value');
  h.run('experimentController.stop()');
 }
});

test('actual no-face trigger retains cooldown and snooze while authorizing only a private qualified loss with low confidence',()=>{
 const h=calibrated(harness('?noface-escalation=1'));
 h.run('fatigue=40;confidence=100');h.frame({ear:.3});h.run('confidence=0');h.frame({face:false});
 assert.equal(h.state().alerts,1);assert.equal(h.state().confidence,0);assert.equal(h.state().fatigue,37);
 h.feed({face:false},5000);assert.equal(h.state().alerts,1);assert.equal(h.state().fatigue,37);
 h.frame({ear:.3});h.frame({face:false});assert.equal(h.state().alerts,1,'12-second cooldown retained');
 h.run('lastAlert=Date.now()+120000');h.frame({ear:.3});h.frame({face:false});assert.equal(h.state().alerts,1,'future snooze timestamp retained');
 h.run("trigger('Face lost after fatigue',{qualified:true})");assert.equal(h.state().alerts,1,'external guessed eligibility denied');
});

test('optional owned runtime matches all pinned bytes and stays outside default static/offline installation',()=>{
 const sw=fs.readFileSync('sw.js','utf8');
 for(const item of vendor.files){const bytes=fs.readFileSync('.'+item.url);assert.equal(bytes.length,item.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256);assert.ok(helper.includes(item.integrity));assert.ok(sw.includes(item.integrity));if(item.file.endsWith('.js'))assert.doesNotMatch(bytes.toString(),/new Function\(|\beval\s*\(/)}
 for(const name of ['LICENSE','EMSCRIPTEN-LICENSE','NOTICE.txt'])assert.ok(fs.readFileSync('vendor/mediapipe/tasks-vision-1.0.1-occulert.1/'+name).length);
 for(const name of ['STATIC_ASSETS','CRITICAL_OFFLINE_ASSETS'])assert.doesNotMatch(sw.match(new RegExp('const '+name+' = \\[([\\s\\S]*?)\\];'))[1],/TASKS_RUNTIME_ASSETS|OPTIONAL_ASSETS|detection-experiments/);
 assert.match(sw,/crypto\.subtle\.digest\('SHA-256',bytes\)/);assert.match(sw,/new Request\(request,\{integrity:pin\}\)/);
});

function tasksHarness({pending=false,pinsMatch=true,throws=false}={}){
 let closeCount=0,stamp=0,resolveCreation,appended=0,modelRequests=0,options=null,samples=[];
 const result={faceLandmarks:[[{}]],faceBlendshapes:[{categories:[{categoryName:'eyeBlinkLeft',score:.8},{categoryName:'eyeBlinkRight',score:.6}]}]};
 const detector={close(){closeCount++},detectForVideo(image,at){samples.push({image,at});if(throws)throw Error('Inference failed');stamp+=7;return result}};
 const root={};const context={URLSearchParams,setTimeout,clearTimeout,AbortController,Uint8Array,performance:{now:()=>stamp},
 navigator:{serviceWorker:{controller:{postMessage(message,[port]){queueMicrotask(()=>port.peer.onmessage({data:{type:'occulert.tasks.runtime',pins:pinsMatch?pins:[]}}))}}}},
 MessageChannel:class{constructor(){this.port1={close(){}};this.port2={peer:this.port1}}},fetch:async()=>{modelRequests++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}},
 document:{createElement(){return {remove(){}}},head:{appendChild(script){appended++;assert.equal(script.integrity,vendor.files[0].integrity);context.Vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:(_files,value)=>{options=value;return pending?new Promise(resolve=>{resolveCreation=resolve}):Promise.resolve(detector)}}};queueMicrotask(()=>script.onload())}}}};
 vm.runInNewContext(helper,context);
 return {api:context.OcculertDetectionExperiments,result,resolve:()=>resolveCreation(detector),stats:()=>({closeCount,appended,modelRequests,options,samples})};
}

test('Tasks requests explicit CPU/GPU and matrix outputs, sampling each distinct captured frame without a 500ms throttle',async()=>{
 for(const delegate of ['CPU','GPU']){const h=tasksHarness(),c=h.api.createTasks({delegate});await c.ready;assert.equal(c.status(),'ready');
  assert.equal(h.stats().options.baseOptions.delegate,delegate);assert.equal(h.stats().options.outputFacialTransformationMatrixes,true);
  const image={captured:true};for(const at of [100,235,370]){const result=c.sample(image,at);assert.equal(result.inferenceMs,7)}
  assert.equal(c.sample(image,370),null);assert.equal(h.stats().samples.length,3);assert.ok(h.stats().samples.every(sample=>sample.image===image));c.stop();assert.equal(h.stats().closeCount,1);
 }
});

test('wrong worker pins and inference failures are unavailable; cancelled creation closes its late detector',async()=>{
 const wrong=tasksHarness({pinsMatch:false}),a=wrong.api.createTasks();await a.ready;assert.equal(a.status(),'unavailable');assert.equal(wrong.stats().modelRequests,0);
 const fail=tasksHarness({throws:true}),b=fail.api.createTasks();await b.ready;assert.equal(b.sample({},100),null);assert.equal(b.status(),'unavailable');assert.equal(fail.stats().closeCount,1);
 const late=tasksHarness({pending:true}),statuses=[],c=late.api.createTasks({onStatus:x=>statuses.push(x)});
 while(!late.stats().options)await new Promise(resolve=>setImmediate(resolve));c.stop();late.resolve();await c.ready;assert.equal(late.stats().closeCount,1);assert.deepEqual(statuses,[]);assert.equal(c.sample({},100),null);
});

test('late legacy callbacks from an experimental model cannot enter a new monitor generation',async()=>{
 const callbacks=[];class FaceMesh{setOptions(){}onResults(cb){callbacks.push(cb)}close(){return Promise.resolve()}}
 const h=harness('?perclos=time',{FaceMesh});h.run('verifyDetectionRuntime=async()=>{};loadFaceMeshScript=async()=>{}');
 h.run('experimentGeneration++');await h.run('initModel()');begin(h);h.run('calibrating=false;fatigue=0;confidence=100');
 const data={multiFaceLandmarks:[h.landmarks({ear:.08})]};callbacks[0](data);assert.ok(h.state().fatigue>0);
 h.run('experimentGeneration++');await h.run('discardFaceMesh()');await h.run('initModel()');h.run('fatigue=0');
 callbacks[0](data);assert.equal(h.state().fatigue,0);callbacks[1](data);assert.ok(h.state().fatigue>0);
});

test('mostly closed calibration cannot replace defaults, and unsupported time PERCLOS stays null in actual saved records',async()=>{
 const pixels=harness('?ear-units=pixels');pixels.el('video').videoWidth=360;pixels.el('video').videoHeight=480;begin(pixels);
 pixels.feed({ear:.17},3500);assert.equal(pixels.get('calibrated'),false);assert.equal(pixels.get('eyeClosedThreshold'),.18*4/3);
 assert.equal(pixels.run('experimentController.summary().calibration.samples'),0);
 const time=harness('?perclos=time');begin(time);time.feed({face:false},3500);await time.run('stop()');
 const row=time.run('browserHistoryStore().load()[0]');assert.equal(row.perclos,null);assert.equal(row.experiment.timePerclos.perclos,null);assert.equal(row.experiment.timePerclos.observedMs,0);assert.match(time.el('report').textContent,/PERCLOS: Unavailable/);
 const calibrating=harness('?perclos=time');begin(calibrating);calibrating.el('perclos').textContent='0%';calibrating.feed({ear:.3},1000);assert.equal(calibrating.el('perclos').textContent,'0%');await calibrating.run('stop()');
 const unknown=calibrating.run('browserHistoryStore().load()[0]');assert.equal(unknown.perclos,null);assert.equal(unknown.experiment.timePerclos.observedMs,0);assert.match(calibrating.el('report').textContent,/PERCLOS: Unavailable/);
 const measured=calibrated(harness('?perclos=time'));measured.feed({ear:.3},1000);await measured.run('stop()');
 const zero=measured.run('browserHistoryStore().load()[0]');assert.equal(zero.perclos,0);assert.ok(zero.experiment.timePerclos.observedMs>0);assert.match(measured.el('report').textContent,/PERCLOS: 0%/);
});

test('experimental Stop tears down the old camera immediately and denies restart until its bounded old-model close settles',async()=>{
 let resolveOld,oldStopped=0,newStopped=0;
 const oldStream={getTracks:()=>[{stop(){oldStopped++}}]},newStream={getTracks:()=>[{stop(){newStopped++}}]};
 const closePromise=new Promise(resolve=>resolveOld=resolve);
 const h=harness('?perclos=time',{navigator:{userAgent:'fixture',mediaDevices:{getUserMedia:async()=>newStream}},__oldStream:oldStream,__newStream:newStream,__oldModel:{close:()=>closePromise}});
 begin(h);h.run('stream=__oldStream;faceMesh=__oldModel;video.srcObject=stream;initModel=async()=>{faceMesh={close:async()=>{}}};openSelectedCamera=async()=>__newStream;verifyFirstInference=async()=>{}');
 const oldId=h.get('localSessionId'),stopping=h.run('stop()');assert.equal(oldStopped,1);assert.equal(h.get('stream'),null);assert.equal(h.get('running'),false);
 await h.run('startBtn.onclick()');assert.equal(h.get('running'),false);assert.equal(newStopped,0);assert.equal(h.get('localSessionId'),oldId);
 resolveOld();await stopping;h.clock.advance(1000);await h.run('startBtn.onclick()');assert.equal(h.get('running'),true);assert.equal(h.get('stream===__newStream'),true);assert.equal(newStopped,0);
 const saved=h.run('browserHistoryStore().load()');assert.equal(saved.length,1);assert.equal(saved[0].id,oldId);assert.notEqual(h.get('localSessionId'),oldId);
});

test('late rejection and finally from an old experimental inference cannot stop or clear a newer session',async()=>{
 let rejectOld;const send=new Promise((_,reject)=>rejectOld=reject);
 const h=harness('?perclos=time',{__oldModel:{send:()=>send}});begin(h);h.el('video').readyState=2;
 h.run('faceMesh=__oldModel;lastFrame=0;lastDetectionResultAt=0');const pending=h.run('loop(135)');
 assert.equal(h.get('processingFrame'),true);h.run('experimentGeneration++');h.clock.advance(1000);begin(h);h.run('processingFrame=true');
 const priorFailures=h.get('consecutiveInferenceFailures');const error=new Error('Old inference failed');error.name='DetectionRuntimeError';rejectOld(error);await pending;
 assert.equal(h.get('running'),true);assert.equal(h.get('processingFrame'),true);assert.equal(h.get('consecutiveInferenceFailures'),priorFailures);
});

test('equal preprocessed closed-eye timelines at 3, 7 and 15 fps reach the actual alert within 150ms',()=>{
 const times=[];for(const fps of [3,7,15]){
  const h=harness('?fatigue-timing=elapsed&perclos=time');begin(h);h.run('calibrating=false;calibrated=true;confidence=100');
  const start=h.clock.now;for(let i=0;i<100;i++){h.clock.set(start+i*1000/fps);h.run("updateScore(.08,false,false,true);if(fatigue>=80&&confidence>=45)trigger('Fatigue')");if(h.state().alerts){times.push(h.clock.now-start);break}}
 }assert.equal(times.length,3);assert.ok(Math.max(...times)-Math.min(...times)<=150,JSON.stringify(times));
});

function actualFrame(h,{ear=.3,ratio=.375,noseY=.55,dt=135}={}){
 const lm=h.landmarks({ear,noseY});lm[1]={x:.5,y:.5+ratio*.4};lm[152]={x:.5,y:.9};h.clock.advance(dt);
 h.run('onResults('+JSON.stringify({multiFaceLandmarks:[lm]})+')');
}
test('actual onResults resets smoothing before down/unknown→neutral classification and never grants stale closed support',()=>{
 const h=harness('?pitch-gate=1&perclos=time');begin(h);for(let i=0;i<25;i++)actualFrame(h);assert.equal(h.get('calibrated'),true);
 for(let i=0;i<10;i++)actualFrame(h,{ear:.08,ratio:.6});assert.equal(h.get('eyesClosedSince'),0);
 actualFrame(h,{ear:.3});assert.equal(h.get('fatigue'),0);assert.equal(h.get('eyesClosedSince'),0);
 actualFrame(h,{ear:.3});assert.equal(h.run('experimentController.summary().timePerclos.closedMs'),0);
 const invalid=h.landmarks({ear:.08});invalid[152]={x:.5,y:.5};h.clock.advance(135);h.run('onResults('+JSON.stringify({multiFaceLandmarks:[invalid]})+')');
 actualFrame(h,{ear:.3});assert.equal(h.get('fatigue'),0);assert.equal(h.get('eyesClosedSince'),0);
});
test('actual onResults clears the nod trajectory before a recovery frame after an unknown gap',()=>{
 const h=calibrated(harness('?perclos=time'));h.run('noseYHistory=[];earHistory=[];headNods=0;fatigue=0');
 for(const y of [.5,.5,.5,.56,.56,.56,.56])actualFrame(h,{noseY:y});assert.equal(h.get('headNods'),0);
 actualFrame(h,{noseY:.5,dt:2000});assert.equal(h.get('headNods'),0);assert.equal(h.get('fatigue'),0);
});
