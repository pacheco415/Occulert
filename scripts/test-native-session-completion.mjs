import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {elapsedSessionSeconds} from '../native-app/lib/monitorPerformance.ts';
import {createCaptureTransitionGuard} from '../native-app/lib/captureLoadPolicy.ts';
import {createUnansweredAlertTracker} from '../native-app/lib/unansweredAlertPolicy.ts';
import {saveCompletedNativeSession,markCompletedNativeSessionSynced,finalizeCompletedNativeSession,completeNativeSessionStop} from '../native-app/lib/sessionCompletion.ts';
const snapshot={sessionId:'local',durationSec:60,alerts:2,fatigueSum:91,fatigueSamples:3,headNodObservations:4,headphoneHeadNodObservations:1,headphoneMotionSamples:12,headphoneMotionStatus:'ready',monitorPerformance:{bounded:true},sensorFusion:{observationOnly:true},sensitivity:'medium',extra:{appVersion:'1.0.0'}};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}

const unansweredSnapshot=()=>({version:1,mode:'observation-only',evidence:'software-output-accepted',candidates:1,
 byMotion:{unknown:1,unavailable:0,denied:0,stale:0,'not-moving':0,'reported-activity':0}});

test('completed records preserve fields, replace only their identity and retain the history cap',async()=>{
 let rows=Array.from({length:50},(_,i)=>({sessionId:i===2?'local':'old-'+i,unknown:i}));
 assert.equal(await saveCompletedNativeSession(snapshot,async update=>{rows=update(rows)}),'local');
 assert.equal(rows.length,50);assert.equal(rows.filter(row=>row.sessionId==='local').length,1);
 assert.equal(rows[0].avgFatigue,30);assert.equal(rows[0].alertCount,2);assert.equal(rows[0].cameraHeadNodObservations,4);
 assert.deepEqual(rows[0].sensorFusion,snapshot.sensorFusion);assert.deepEqual(rows[0].monitorPerformance,snapshot.monitorPerformance);
 assert.equal(rows[0].appVersion,'1.0.0');assert.equal(rows[1].unknown,0);assert.ok(Number.isFinite(Date.parse(rows[0].savedAt)));
});

test('completion saves only a deep copy of optional observation counts and old records remain absent',async()=>{
 const unansweredAlerts=unansweredSnapshot();let rows=[];
 await saveCompletedNativeSession({...snapshot,unansweredAlerts},async update=>{rows=update(rows)});
 assert.deepEqual(rows[0].unansweredAlerts,unansweredAlerts);assert.notEqual(rows[0].unansweredAlerts.byMotion,unansweredAlerts.byMotion);
 unansweredAlerts.byMotion.unknown=9;assert.equal(rows[0].unansweredAlerts.byMotion.unknown,1);
 await saveCompletedNativeSession(snapshot,async update=>{rows=update(rows)});
 assert.equal(Object.hasOwn(rows[0],'unansweredAlerts'),false);
 let writes=0;await assert.rejects(saveCompletedNativeSession({...snapshot,unansweredAlerts:{...unansweredSnapshot(),rawMotion:[]}},async()=>{writes++}),/Invalid unanswered-alert/);
 assert.equal(writes,0);
});

test('cloud completion excludes local unanswered-alert diagnostics even on an extended input',async()=>{
 let sent;
 await finalizeCompletedNativeSession({cloudSession:Promise.resolve('cloud'),pendingEvents:Promise.resolve(),averageFatigue:0,maxFatigue:0,alerts:0,endedAt:'2026-11-01T12:00:00.000Z',unansweredAlerts:unansweredSnapshot()},'local',{
  finish:async(...args)=>{sent=args;return false},markSynced:async()=>assert.fail('no badge for unconfirmed completion'),
 });
 assert.deepEqual(sent,['cloud',{averageFatigue:0,maxFatigue:0,safetyScore:100,alertCount:0},'2026-11-01T12:00:00.000Z','local']);
 assert.doesNotMatch(JSON.stringify(sent),/unansweredAlerts|byMotion|software-output-accepted/);
});

test('unobserved local averages stay unknown while a sampled zero remains zero',async()=>{
 for (const [sum,count,expected] of [[0,0,null],[0,2,0],[50,-1,null],[Infinity,2,null],[50,1.5,null],[201,2,null]]) {
  let rows=[];await saveCompletedNativeSession({...snapshot,fatigueSum:sum,fatigueSamples:count},async update=>{rows=update(rows)});
  assert.equal(rows[0].avgFatigue,expected);assert.equal(rows[0].alertCount,2);
 }
});

test('unobserved cloud scores stay unknown while valid zero fatigue can score 100',async()=>{
 for (const [maximum,expected] of [[null,null],[0,100],[NaN,null],[101,null]]) {
  let sent;await finalizeCompletedNativeSession({cloudSession:Promise.resolve('cloud'),pendingEvents:Promise.resolve(),averageFatigue:maximum,maxFatigue:maximum,alerts:0,endedAt:'2026-10-03T12:00:00.000Z'},'local',{finish:async(id,stats)=>{sent=stats;return false},markSynced:async()=>assert.fail('uncertain response')});
  assert.equal(sent.safetyScore,expected);assert.equal(sent.alertCount,0);
 }
});

test('zero-duration completion does not write and a failed save remains a failure',async()=>{
 assert.equal(await saveCompletedNativeSession({...snapshot,durationSec:0},async()=>{throw Error('unexpected')}),null);
 await assert.rejects(saveCompletedNativeSession(snapshot,async()=>{throw Error('disk unavailable')}),/disk unavailable/);
});

test('cloud completion waits for events and confirms a badge only after successful finalization',async()=>{
 const events=deferred(),calls=[];const model={cloudSession:Promise.resolve('cloud'),pendingEvents:events.promise,averageFatigue:30,maxFatigue:40,alerts:2,endedAt:'2026-10-03T12:00:00.000Z'};
 const pending=finalizeCompletedNativeSession(model,'local',{finish:async(...args)=>{calls.push(args);return true},markSynced:async(...args)=>calls.push(args)});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[]);events.resolve();await pending;
 assert.deepEqual(calls,[['cloud',{averageFatigue:30,maxFatigue:40,safetyScore:58,alertCount:2},model.endedAt,'local'],['local','cloud']]);
});

test('missing cloud IDs, failed events and uncertain finalization preserve existing behavior',async()=>{
 let finishes=0,badges=0;
 const services={finish:async()=>{finishes++;return false},markSynced:async()=>{badges++}};
 const model={cloudSession:null,pendingEvents:Promise.resolve(),averageFatigue:0,maxFatigue:0,alerts:0,endedAt:'original'};
 await finalizeCompletedNativeSession(model,'local',services);assert.equal(finishes,0);
 await finalizeCompletedNativeSession({...model,cloudSession:Promise.reject(Error('offline'))},'local',services);assert.equal(finishes,0);
 await finalizeCompletedNativeSession({...model,cloudSession:Promise.resolve('cloud'),pendingEvents:Promise.reject(Error('event failed'))},'local',services);
 assert.equal(finishes,1);assert.equal(badges,0);
});

test('stop saves before clearing its checkpoint and finalizing; an idle stop does nothing',async()=>{
 const order=[];const services={save:async id=>{order.push('save:'+id);return id},clearCheckpoint:async id=>{order.push('clear:'+id)},releaseIdentity:id=>order.push('release:'+id),finalize:async id=>{order.push('finish:'+id)}};
 await completeNativeSessionStop({wasRunning:false,activeSessionId:'local',deferCloudFinalization:false},services);assert.deepEqual(order,[]);
 await completeNativeSessionStop({wasRunning:true,activeSessionId:'local',deferCloudFinalization:false},services);
 assert.deepEqual(order,['save:local','clear:local','release:local','finish:local']);
});

test('save failure retains the recovery checkpoint and never starts cloud completion',async()=>{
 await assert.rejects(completeNativeSessionStop({wasRunning:true,activeSessionId:'local',deferCloudFinalization:false},{save:async()=>{throw Error('disk denied')},clearCheckpoint:async()=>{assert.fail('must preserve checkpoint')},releaseIdentity:()=>assert.fail('must preserve identity'),finalize:async()=>assert.fail('no completion')}),/disk denied/);
});

test('safe-stop completion does not wait for cloud work and handles its later rejection',async()=>{
 const cloud=deferred(),order=[];
 await completeNativeSessionStop({wasRunning:true,activeSessionId:'local',deferCloudFinalization:true},{save:async()=>{order.push('saved');return 'local'},clearCheckpoint:async()=>{throw Error('checkpoint unavailable')},releaseIdentity:()=>order.push('released'),finalize:async()=>{order.push('cloud started');await cloud.promise}});
 assert.deepEqual(order,['saved','released','cloud started']);cloud.reject(Error('offline'));await new Promise(resolve=>setImmediate(resolve));
});

test('badge writes preserve unrelated records and storage failure is best effort',async()=>{
 let rows=[{sessionId:'local',unknown:42},{sessionId:'other',cloudSynced:false}];
 await markCompletedNativeSessionSynced(async update=>{rows=update(rows)},'local','cloud');
 assert.deepEqual(rows,[{sessionId:'local',unknown:42,cloudSynced:true,cloudSessionId:'cloud'},{sessionId:'other',cloudSynced:false}]);
 await markCompletedNativeSessionSynced(async()=>{throw Error('disk denied')},'local','cloud');
});


test('the actual monitor preserves unobserved metrics, disarms before saving and ignores a concurrent stop',async()=>{
 for (const observationEnabled of [false,true]) for (const sampleCount of [0,2]) {
 const source=readFileSync(new URL('../native-app/app/monitor.tsx',import.meta.url),'utf8');
 const start=source.indexOf('  const handleStop = useCallback('),end=source.indexOf('  // App-state and hardware-back',start);assert.ok(start>=0&&end>start);
 const pendingSave=deferred(),order=[],savedArgs=[];
 const observer=createUnansweredAlertTracker();let observerStops=0,observerSnapshots=0;
 observer.begin(1);observer.sample({generation:1,at:0,state:'closed'});
 observer.criticalOutput({generation:1,at:0,decisionAt:0,decisionId:1});
 for(let at=500;at<=6000;at+=500)observer.sample({generation:1,at,state:'closed'});
 assert.equal(observer.snapshot().candidates,1);
 const captureTransition=createCaptureTransitionGuard();
 captureTransition.observe({key:'30',at:10000,lastSampleAt:10000,hasSample:true,stallTimeoutMs:5000});
 captureTransition.observe({key:'15',at:11000,lastSampleAt:10000,hasSample:true,stallTimeoutMs:5000});
 class FixedDate extends Date {static now(){return 12000}}
 const ref=current=>({current});
 const context={Date:FixedDate,useCallback:fn=>fn,__DEV__:false,elapsedSessionSeconds,completeNativeSessionStop,finalizeCompletedNativeSession,captureTransitionRef:ref(captureTransition),
  cameraInterruptionGenerationRef:ref(0),cameraCallbackOwnerRef:ref(0),
  unansweredObservationRef:ref(observationEnabled?{
   stop:()=>{observerStops++;order.push('observer-stop');observer.stop()},
   snapshot:()=>{observerSnapshots++;order.push('observer-snapshot');return observer.snapshot()},
  }:null),
  startAttemptRef:ref(0),stoppingRef:ref(false),isRunningRef:ref(true),sessionStartedAtRef:ref(1000),alertCountRef:ref(2),activeSessionIdRef:ref('local'),fatigueSamplesRef:ref(sampleCount),fatigueSumRef:ref(sampleCount?40:0),maxFatigueRef:ref(40),cloudSessionRef:ref(Promise.resolve('cloud')),cloudEventQueueRef:ref(Promise.resolve()),performanceTrackerRef:ref({snapshot:()=>({bounded:true})}),monitoringActiveRef:ref(true),cameraRecoveringRef:ref(false),
  setIsStopping:value=>order.push('stopping:'+value),setSessionEndedAt:()=>{},setIsRunning:()=>{},setCameraRecovering:()=>{},reset:()=>order.push('reset'),stopHeadphoneMotion:()=>Promise.resolve(),
  stopNativeCloudEvents:session=>{assert.equal(session,context.cloudSessionRef.current);order.push('retry-stop')},
  saveSession:async(...args)=>{const[id,duration,alerts]=args;savedArgs.push(args);assert.equal(context.monitoringActiveRef.current,false);assert.equal(context.isRunningRef.current,false);assert.equal(context.cloudSessionRef.current,null);assert.equal(duration,11);assert.equal(alerts,2);assert.equal(args.length,observationEnabled?6:5);if(observationEnabled){assert.equal(observerStops,1);assert.equal(observerSnapshots,1);assert.equal(args[5].candidates,1)}order.push('save:'+id);await pendingSave.promise;return id},
  clearActiveSessionCheckpoint:async()=>order.push('cleared'),finishCloudSession:async(id,stats)=>{assert.equal(stats.averageFatigue,sampleCount?20:null);assert.equal(stats.maxFatigue,sampleCount?40:null);assert.equal(stats.safetyScore,sampleCount?58:null);assert.deepEqual(Object.keys(stats).sort(),['alertCount','averageFatigue','maxFatigue','safetyScore']);order.push('cloud');return true},markSessionSynced:async()=>order.push('badge'),
 };
 vm.runInNewContext(stripTypeScriptTypes(source.slice(start,end))+'\nglobalThis.stop=handleStop;',context);
 const first=context.stop();
 const synchronousOrder=['stopping:true',...(observationEnabled?['observer-stop','observer-snapshot']:[]),'retry-stop','reset','save:local'];
 assert.deepEqual(order,synchronousOrder,'observation stop and snapshot run synchronously before the first asynchronous save wait');
 if(observationEnabled){
  const saved=savedArgs[0][5];assert.deepEqual(saved,unansweredSnapshot());
  observer.begin(2);assert.equal(observer.snapshot().candidates,0);
  assert.equal(saved.candidates,1);assert.equal(saved.byMotion.unknown,1,'a new observer generation cannot change the frozen old-session counts');
 }
 await new Promise(resolve=>setImmediate(resolve));await context.stop();
 assert.ok(context.cameraInterruptionGenerationRef.current>0&&context.cameraCallbackOwnerRef.current>0,'stopping invalidates pending interruption checks and old camera callbacks');
 assert.equal(captureTransition.shouldDefer(12000,10000),false,'stopping clears the previous capture-transition grace before persistence');
 assert.equal(order.filter(item=>item==='save:local').length,1);assert.equal(order.includes('cloud'),false);
 assert.equal(observerStops,observationEnabled?1:0);assert.equal(observerSnapshots,observationEnabled?1:0,'a concurrent Stop cannot recapture or stop a newer observer generation');
 assert.equal(savedArgs.length,1);assert.equal(savedArgs[0].length,observationEnabled?6:5);
 pendingSave.resolve();await first;
 assert.deepEqual(order,[...synchronousOrder,'cleared','cloud','badge','stopping:false']);
 if(observationEnabled){assert.equal(savedArgs[0][5].candidates,1);assert.equal(observer.snapshot().candidates,0)}
 assert.equal(context.activeSessionIdRef.current,null);assert.equal(context.stoppingRef.current,false);
 }
});
