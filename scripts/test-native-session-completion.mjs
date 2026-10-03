import assert from 'node:assert/strict';
import test from 'node:test';
import {saveCompletedNativeSession,markCompletedNativeSessionSynced,finalizeCompletedNativeSession,completeNativeSessionStop} from '../native-app/lib/sessionCompletion.ts';
const snapshot={sessionId:'local',durationSec:60,alerts:2,fatigueSum:91,fatigueSamples:3,headNodObservations:4,headphoneHeadNodObservations:1,headphoneMotionSamples:12,headphoneMotionStatus:'ready',monitorPerformance:{bounded:true},sensorFusion:{observationOnly:true},sensitivity:'medium',extra:{appVersion:'1.0.0'}};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}

test('completed records preserve fields, replace only their identity and retain the history cap',async()=>{
 let rows=Array.from({length:50},(_,i)=>({sessionId:i===2?'local':'old-'+i,unknown:i}));
 assert.equal(await saveCompletedNativeSession(snapshot,async update=>{rows=update(rows)}),'local');
 assert.equal(rows.length,50);assert.equal(rows.filter(row=>row.sessionId==='local').length,1);
 assert.equal(rows[0].avgFatigue,30);assert.equal(rows[0].alertCount,2);assert.equal(rows[0].cameraHeadNodObservations,4);
 assert.deepEqual(rows[0].sensorFusion,snapshot.sensorFusion);assert.deepEqual(rows[0].monitorPerformance,snapshot.monitorPerformance);
 assert.equal(rows[0].appVersion,'1.0.0');assert.equal(rows[1].unknown,0);assert.ok(Number.isFinite(Date.parse(rows[0].savedAt)));
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
