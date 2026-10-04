import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const sandbox={module:{exports:{}},URLSearchParams};
vm.runInNewContext(readFileSync(new URL('../'+JSON.parse(readFileSync(new URL('../asset-versions.json',import.meta.url),'utf8'))['detection-experiments.js'],import.meta.url),'utf8'),sandbox);
const models=sandbox.module.exports;
function fixture(query) {
  let time=0, wall=1700000000000, dims={width:360,height:480};
  const state={running:true,localSessionId:'local-fixture',calibrating:false,calibrated:true,calibrationUntil:0,calibrationSamples:[],
    baselineEAR:.28,baseClosedThreshold:.18,baseWatchThreshold:.22,eyeClosedThreshold:.18,eyeWatchThreshold:.22,
    fatigue:0,maxFatigue:0,confidence:100,fatigueSampleSum:0,fatigueSampleCount:0,noFaceSince:0,lastFaceSeen:0,
    perclosWindow:[],eyesClosedSince:0,lastMicro:0,microsleeps:0,turnedSince:0,totalDistractionMs:0};
  const requests=[], percents=[], statuses=[];
  const b={read:()=>({...state}),write:s=>Object.assign(state,s),now:()=>time,wallNow:()=>wall,calibrationMs:3200,
    dimensions:()=>dims,applySensitivity:()=>{state.eyeClosedThreshold=state.baseClosedThreshold;state.eyeWatchThreshold=state.baseWatchThreshold},
    resetContinuous:()=>{state.eyesClosedSince=state.turnedSince=0;state.perclosWindow=[]},log:()=>{},
    ui:{calibration:()=>{},face:()=>{},perclos:x=>percents.push(x),microsleeps:()=>{},distraction:()=>{},tasks:x=>statuses.push(x)},
    defaultCalibration:()=>{},defaultEyeMetrics:()=>0,alert:(reason,context)=>requests.push({reason,context}),
    detectorVersion:()=> 'legacy-fixture',provenance:()=>({}),render:()=>{},resetMouth:()=>{},clearEyes:()=>{},tracking:()=>{},
    captureCanvas:()=>({captured:true}),createTasks:()=>({sample:()=>null,stop:()=>{},status:()=> 'unavailable'})};
  const flags=models.parseFlags(query),c=models.createController(b,flags);c.begin();
  return {c,state,requests,percents,statuses,b,at:(t)=>{time=t;wall=1700000000000+t},dims:d=>dims=d};
}
function scoreAt(h,t,{ear=.3,turned=false,nod=false,face=true,ratio=.375,nose=.55,missing=true}={}){
  h.at(t);h.c.score(ear,turned,nod,face,ratio,nose,missing);
}
function calibrate(h,ear=.3){for(let t=0;t<=3240;t+=135)scoreAt(h,t,{ear});assert.equal(h.state.calibrating,false);}

test('qualified no-face loss bypass is private, once per episode, timely and freezes decay without faking confidence',()=>{
  for(const mode of ['closed','watch','down']){
    const h=fixture('?noface-escalation=1');
    if(mode==='closed')scoreAt(h,0,{ear:.08});
    if(mode==='watch'){h.state.fatigue=40;scoreAt(h,0);}
    if(mode==='down'){scoreAt(h,0);scoreAt(h,135,{nose:.60});}
    h.state.confidence=0;const before=h.state.fatigue;
    scoreAt(h,2000,{face:false});assert.equal(h.requests.length,1,mode);
    assert.equal(h.requests[0].reason,'Face lost after fatigue');assert.equal(h.c.qualifiedLoss(h.requests[0].context),true);
    assert.equal(h.c.qualifiedLoss({...h.requests[0].context}),false);
    scoreAt(h,7000,{face:false});assert.equal(h.requests.length,1);assert.equal(h.state.fatigue,before);assert.equal(h.state.confidence,0);
    scoreAt(h,7135);assert.equal(h.c.qualifiedLoss(h.requests[0].context),false);
    h.c.stop();assert.equal(h.c.qualifiedLoss(h.requests[0].context),false);
  }
});

test('no-face experiment rejects stale, unqualified, calibration and malformed tracked-face cases',()=>{
  for(const kind of ['stale','empty','calibration','malformed']){
    const h=fixture('?noface-escalation=1');
    if(kind==='empty')scoreAt(h,0);
    else scoreAt(h,0,{ear:.08});
    if(kind==='calibration')h.state.calibrating=true;
    scoreAt(h,kind==='stale'?3001:100,{face:false,missing:kind!=='malformed'});
    assert.equal(h.requests.length,0,kind);
  }
});

test('pixel baseline resets on invalid, turned and sparse evidence; fallback clears prior personal thresholds',()=>{
  const h=fixture('?ear-units=pixels');calibrate(h,.4);
  assert.equal(h.state.calibrated,true);assert.ok(Math.abs(h.state.baselineEAR-.4)<1e-12);
  h.dims({width:480,height:360});h.c.observeGeometry();assert.equal(h.state.calibrating,true);
  assert.ok(Math.abs(h.state.baselineEAR-.28*4/3)<1e-12);
  const deadline=h.state.calibrationUntil-1700000000000;
  scoreAt(h,deadline-3100,{ear:.4});scoreAt(h,deadline,{ear:.4});
  assert.equal(h.state.calibrated,false);assert.ok(Math.abs(h.state.baseClosedThreshold-.18*4/3)<1e-12);
  h.c.observeGeometry(true);let start=h.state.calibrationUntil-1700000000000-3200;
  for(let t=start;t<start+3000;t+=135)scoreAt(h,t,{ear:.4});
  scoreAt(h,start+3100,{ear:.4,turned:true});scoreAt(h,start+3240,{ear:.4});
  assert.equal(h.state.calibrated,false);
});

test('pitch down and unusable geometry pause closure/PERCLOS; frontal true closure resumes and unknown time adds no distraction',()=>{
  const h=fixture('?pitch-gate=1&perclos=time');calibrate(h);
  const base=3240;scoreAt(h,base+135,{ear:.08,ratio:.6});
  for(let t=base+270;t<base+2500;t+=135)scoreAt(h,t,{ear:.08,ratio:.6});
  assert.equal(h.state.microsleeps,0);assert.equal(h.state.eyesClosedSince,0);assert.equal(h.c.summary().timePerclos.observedMs,0);
  assert.ok(h.state.totalDistractionMs>1800);const before=h.state.totalDistractionMs;
  scoreAt(h,base+5000,{ear:.08,ratio:.6});assert.equal(h.state.totalDistractionMs,before);
  scoreAt(h,base+5135,{ear:.08,ratio:null});assert.equal(h.state.eyesClosedSince,0);assert.equal(h.c.summary().timePerclos.observedMs,0);
  scoreAt(h,base+5270,{ear:.08,ratio:.375});
  for(let t=base+5405;t<base+7300;t+=135)scoreAt(h,t,{ear:.08,ratio:.375});
  assert.equal(h.state.microsleeps,1);assert.equal(h.c.summary().timePerclos.perclos,100);
});

test('pitch without sufficient parked baseline falls back to current thresholds and reports unavailability',()=>{
  const h=fixture('?pitch-gate=1');scoreAt(h,0,{ear:.3});scoreAt(h,10000,{ear:.3});
  assert.equal(h.state.calibrated,false);assert.equal(h.c.summary().calibration.pitchAvailable,false);
  assert.equal(h.state.eyeClosedThreshold,.18);scoreAt(h,10135,{ear:.08,ratio:.7});assert.ok(h.state.fatigue>0);
});

test('elapsed rates preserve the 135ms accumulation; time PERCLOS uses supported time and resets gaps',()=>{
  const h=fixture('?fatigue-timing=elapsed&perclos=time');scoreAt(h,0,{ear:.08});assert.equal(h.state.fatigue,0);
  scoreAt(h,135,{ear:.08});assert.equal(h.state.fatigue,17);
  assert.equal(h.c.summary().timePerclos.perclos,100);assert.equal(h.c.summary().timePerclos.observedMs,135);
  scoreAt(h,1500,{ear:.08});assert.equal(h.state.fatigue,17);assert.equal(h.c.summary().timePerclos.observedMs,135);
  scoreAt(h,1635,{ear:.08});assert.equal(h.state.fatigue,34);assert.equal(h.c.summary().timePerclos.observedMs,270);
});

test('captured Tasks measurements use exactly one image, actual inference intervals and stop-only bounded local export',()=>{
  const h=fixture('?detector=tasks');let input=null,stamp=null;
  h.b.createTasks=()=>({sample:(image,at)=>{input=image;stamp=at;h.at(117);return {inferenceMs:7,result:{faceLandmarks:[[]]}}},stop:()=>{},status:()=> 'ready'});
  h.c.begin();h.at(100);const frame=h.c.capture({currentTime:.2});h.at(110);h.c.legacyResult();h.at(112);h.c.recordResults({},.3,.3,false);
  assert.equal(input,frame.image);assert.equal(stamp,100);assert.equal(h.c.capture({currentTime:.2}).skip,true);
  assert.throws(()=>h.c.exportData(),/Stop monitoring/);h.state.running=false;h.c.stop();
  const exported=h.c.exportData();assert.equal(exported.samples.length,1);assert.equal(exported.samples[0].legacyInferenceMs,10);
  assert.equal(exported.samples[0].tasksInferenceMs,7);assert.equal(exported.samples[0].combinedFrameMs,17);
  assert.equal(exported.samples[0].eyeBlinkLeft,null);assert.equal(exported.samples[0].tasksUsable,false);
  assert.equal(exported.session.skippedRepeatedFrames,1);assert.equal(exported.session.tasksEventMetricsAvailable,false);
});

test('exported legacy support rejects pitch-unknown frames at the same boundary used by the score',()=>{
 const h=fixture('?pitch-gate=1&perclos=time&detector=tasks');calibrate(h);h.at(3375);
 const frame=h.c.capture({currentTime:3.375});h.c.legacyResult();h.c.score(.08,false,false,true,null,.55);
 const lm=Array.from({length:468},()=>({x:.5,y:.5}));lm[33]={x:.3,y:.35};lm[263]={x:.7,y:.35};lm[1]={x:.5,y:.5};lm[152]={x:.5,y:.35};
 h.c.recordResults({multiFaceLandmarks:[lm]},.08,.08,false);h.state.running=false;h.c.stop();const row=h.c.exportData().samples[0];
 assert.equal(frame.paired,true);assert.equal(row.rawEar,.08);assert.equal(row.legacyUsable,false);assert.equal(h.state.eyesClosedSince,0);assert.equal(h.state.fatigue,0);
});

test('the last calibration frame remains unsupported in the exported pipeline even when it finishes calibration',()=>{
 const h=fixture('?detector=tasks');h.state.calibrating=true;h.at(100);h.c.capture({currentTime:.1});h.c.legacyResult();h.state.calibrating=false;
 h.c.recordResults({},.3,.3,false);h.state.running=false;h.c.stop();const row=h.c.exportData().samples[0];assert.equal(row.calibrating,true);assert.equal(row.legacyUsable,false);assert.equal(row.tasksUsable,false);
});
