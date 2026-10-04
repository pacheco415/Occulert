import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {trimmedEyeBaseline,baselinePreset,ParkedEyeBaseline} from '../native-app/lib/eyeBaselineModel.ts';
import {saveCompletedNativeSession} from '../native-app/lib/sessionCompletion.ts';
import {SENSITIVITY_PRESETS} from '../native-app/constants/thresholds.ts';

test('trimmed baseline rejects unreliable input and resists isolated blinks',()=>{
 assert.equal(trimmedEyeBaseline([NaN,Infinity,-1,2,true]),null);
 assert.equal(trimmedEyeBaseline(Array(7).fill(.9)),null);
 assert.equal(trimmedEyeBaseline(Array(10).fill(.3)),null);
 assert.ok(Math.abs(trimmedEyeBaseline([0,.05,.9,.9,.9,.9,.9,.9,1,1])-.9)<1e-12);
});
test('baseline math preserves exact fallback presets and proportionally clamps valid baselines',()=>{
 for(const level of ['low','medium','high']){
  for(const value of [null,NaN,-1,.49,2])assert.equal(baselinePreset(level,value),SENSITIVITY_PRESETS[level]);
  for(const value of [.5,.8,1]){const p=baselinePreset(level,value);assert.ok(p.eyeClosedThreshold>=.1&&p.eyeClosedThreshold<=.22);assert.ok(p.eyeWatchThreshold>p.eyeClosedThreshold&&p.eyeWatchThreshold<=.28)}
 }
 assert.equal(baselinePreset('medium',.8).eyeClosedThreshold,.18*.8);
});
test('parked timelines at 3, 7 and 15 fps finish with valid samples after three seconds',()=>{
 for(const fps of [3,7,15]){const c=new ParkedEyeBaseline();let result;for(let i=0;i<=fps*3;i++)result=c.add(i*1000/fps,.9,.9,true);assert.equal(result.done,true);assert.ok(Math.abs(result.baseline-.9)<1e-12)}
});
test('missing face, invalid eyes, stalled or reversed clocks discard the partial baseline',()=>{
 for(const invalid of [{time:1000,left:.9,right:.9,ready:true},{time:-1,left:.9,right:.9,ready:true},{time:200,left:-1,right:.9,ready:true},{time:200,left:.9,right:.9,ready:false}]){
  const c=new ParkedEyeBaseline();c.add(0,.9,.9,true);c.add(100,.9,.9,true);const r=c.add(invalid.time,invalid.left,invalid.right,invalid.ready);assert.equal(r.progress,0);assert.equal(r.samples,0);assert.equal(r.done,false);
 }
 const c=new ParkedEyeBaseline();let r;for(let i=0;i<=3000;i+=10)r=c.add(i,.9,.9,true);assert.equal(r.samples,64);assert.equal(r.done,true);
});
test('device storage validates saved versions and never stores raw eye samples',async()=>{
 let raw=null;const writes=[];const source=readFileSync(new URL('../native-app/lib/eyeBaselineStorage.ts',import.meta.url),'utf8').replace(/^import[^;]*;\s*/gm,'').replace(/^export /gm,'');const context={AsyncStorage:{getItem:async()=>raw,setItem:async(_key,value)=>{raw=value;writes.push(value)},removeItem:async()=>{raw=null}},validEyeProbability:value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1,EYE_BASELINE_MIN_SAMPLES:8};
 vm.runInNewContext(stripTypeScriptTypes(source)+'\nglobalThis.api={loadDeviceEyeBaseline,saveDeviceEyeBaseline,clearDeviceEyeBaseline};',context);
 assert.equal(await context.api.loadDeviceEyeBaseline(),null);await context.api.saveDeviceEyeBaseline(.8,12);assert.equal(await context.api.loadDeviceEyeBaseline(),.8);assert.deepEqual(Object.keys(JSON.parse(writes[0])),['version','baseline','samples']);await context.api.clearDeviceEyeBaseline();assert.equal(raw,null);
 for(const invalid of ['{',JSON.stringify({version:2,baseline:.8,samples:12}),JSON.stringify({version:1,baseline:.2,samples:12})]){raw=invalid;await assert.rejects(context.api.loadDeviceEyeBaseline());assert.equal(raw,invalid)}
 await assert.rejects(context.api.saveDeviceEyeBaseline(.8,7));
});

test('actual monitor callback discards a late baseline save after preview cancellation',async()=>{
 const monitor=readFileSync(new URL('../native-app/app/monitor.tsx',import.meta.url),'utf8');const start=monitor.indexOf('  const onEyeState = useCallback('),end=monitor.indexOf('\n  const onEyeStateJS',start);assert.ok(start>=0&&end>start);
 let now=0,release;const pending=new Promise(resolve=>{release=resolve});const applied=[],messages=[],busy=[];const generation={current:0};const context={saveCompletedNativeSession,useCallback:fn=>fn,EYE_BASELINE_EXPERIMENT:true,baselineLoaded:true,eyeBaseline:null,baselineCanSaveRef:{current:true},baselineFinishedRef:{current:false},baselineCollectorRef:{current:new ParkedEyeBaseline()},baselineGenerationRef:generation,baselineBusyRef:{current:false},baselineMountedRef:{current:true},setupPreviewActiveRef:{current:true},isRunningRef:{current:false},lastCameraSetupUiAtRef:{current:0},CAMERA_SETUP_UI_INTERVAL_MS:0,assessCameraSetup:()=>({ready:true,state:'ready'}),performance:{now:()=>now},setBaselineMessage:value=>messages.push(value),setBaselineBusy:value=>busy.push(value),setEyeBaseline:value=>applied.push(value),setCameraSetup:()=>{},saveDeviceEyeBaseline:()=>pending,processEyeOpenness:()=>{},processNoFace:()=>{},Date:{now:()=>now}};
 vm.runInNewContext(stripTypeScriptTypes(monitor.slice(start,end))+'\nglobalThis.onSample=onEyeState;',context);
 for(let i=0;i<=21;i++){now=i*3000/21;context.onSample(.9,.9,true,0,0,0,1,1,1,10,10,100,100)}
 assert.equal(context.baselineBusyRef.current,true);generation.current+=1;context.setupPreviewActiveRef.current=false;context.isRunningRef.current=true;release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(applied,[]);assert.equal(context.baselineBusyRef.current,false);assert.deepEqual(busy,[true,false]);
});
test('actual monitor cloud initialization remains disabled in experimental builds',()=>{
 const monitor=readFileSync(new URL('../native-app/app/monitor.tsx',import.meta.url),'utf8');const assignment=monitor.match(/cloudSessionRef\.current = EYE_BASELINE_EXPERIMENT[^;]*;/)?.[0];assert.ok(assignment);
 for(const enabled of [true,false]){let calls=0;const context={cloudSessionRef:{current:null},EYE_BASELINE_EXPERIMENT:enabled,beginCloudSession:()=>{calls++;return Promise.resolve('normal-session')}};vm.runInNewContext(assignment,context);assert.equal(calls,enabled?0:1)}
});

test('actual completed records identify only experimental sessions and their frozen baseline',async()=>{
 const source=readFileSync(new URL('../native-app/app/monitor.tsx',import.meta.url),'utf8'),start=source.indexOf('  const saveSession = useCallback('),end=source.indexOf('  const markSessionSynced',start);assert.ok(start>=0&&end>start);
 for(const enabled of [false,true]){let saved;const context={saveCompletedNativeSession,useCallback:fn=>fn,EYE_BASELINE_EXPERIMENT:enabled,sessionEyeBaselineRef:{current:.9},fatigueSamplesRef:{current:2},fatigueSumRef:{current:20},headNodObservationsRef:{current:0},headphoneHeadNodObservationsRef:{current:0},headphoneMotionSamplesRef:{current:0},headphoneMotionStatusRef:{current:'not-built'},sensorFusionTrackerRef:{current:{snapshot:()=>({})}},sessionSensitivityRef:{current:'medium'},currentAppBuildInfo:()=>({appVersion:'fixture'}),updateSessionHistory:async update=>{saved=update([])[0]}};
 vm.runInNewContext(stripTypeScriptTypes(source.slice(start,end))+'\nglobalThis.save=saveSession;',context);await context.save('local',60,0,{},3000);
 if(enabled)assert.deepEqual(JSON.parse(JSON.stringify(saved.eyeBaselineExperiment)),{version:1,baseline:.9});else assert.equal(Object.hasOwn(saved,'eyeBaselineExperiment'),false);
 }
});
