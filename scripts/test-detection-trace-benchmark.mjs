import assert from 'node:assert/strict';
import test from 'node:test';
import {adaptTrace,comparisonSummary,traceContract} from '../benchmark/parked-detection-trace.mjs';
import {prepare} from '../benchmark/prepare-dataset.mjs';
import {parseFile,scoreEvents} from '../benchmark/run-event-benchmark.mjs';
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const models=createRequire(import.meta.url)('../'+JSON.parse(readFileSync('asset-versions.json','utf8'))['detection-experiments.js']);
function fixture(){const trace=models.createTraceStore();
 for(let i=0;i<6;i++)trace.add({frameId:i+1,atMs:i===5?2000:i*135,mediaTime:i/30,rawEar:.3,smoothedEar:.3,
  eyeBlinkLeft:0,eyeBlinkRight:0,jawOpen:null,pitchDeg:null,yawDeg:null,legacyInferenceMs:10,tasksInferenceMs:7,combinedFrameMs:20,
  perclos:0,observedMs:i*135,closedMs:0,fatigue:0,confidence:100,legacyUsable:i!==3,tasksUsable:i!==3,calibrating:false,pitchDown:false,
  rawLandmarks:[{}],token:'never-copy'});
 trace.recordAlert(135,'Fatigue');return {schema:'occulert.parked-detection-trace',version:1,session:{sessionId:'local-test',durationMs:2500,platform:'web',detectorVersion:traceContract.detectorPrefix+'tasks',experimentFlags:['tasks'],geometryUnits:'normalized',runtimeVersion:traceContract.runtimeVersion,runtimePins:models.tasksPins,helperIntegrity:traceContract.helperIntegrity,modelIntegrity:traceContract.modelIntegrity,...trace.summary()},samples:trace.samples(),legacyAlerts:trace.alerts()};
}
const labels=[{session_id:'local-test',start_ms:0,end_ms:270,label:'drowsy'}];
test('adapter grants only retained supported intervals and leaves every Tasks event metric unavailable',()=>{
 const result=adaptTrace(fixture(),{participant:'P001',split:'test',episodes:labels});
 assert.deepEqual(result.tracking,[{session_id:'local-test',start_ms:0,end_ms:270}]);
 assert.equal(result.comparison[0].perclos,0);assert.equal(result.comparison[0].jaw_open,null);
 assert.equal(JSON.stringify(result).includes('never-copy'),false);assert.equal(JSON.stringify(result).includes('rawLandmarks'),false);
 const scored=scoreEvents(result);assert.equal(scored.eventRecall,1);assert.equal(scored.trackedHours,270/3600000);
 const summary=comparisonSummary(result.comparison);assert.equal(summary.pairedUsableFrames,5);assert.equal(summary.timing.tasks_inference_ms.medianMs,7);
 assert.equal(summary.tasksEventRecall,null);assert.equal(summary.tasksFalseAlertsPerTrackedHour,null);assert.equal(summary.tasksAlertDelayMs,null);
});
test('adapter requires external labels and participant split, rejects duplicate frames, malformed signals and bounds',()=>{
 const options={participant:'P001',split:'test',episodes:labels};
 for(const changes of [{participant:null},{participant:'private@example.com'},{split:null},{episodes:undefined}])assert.throws(()=>adaptTrace(fixture(),{...options,...changes}));
 for(const change of [t=>t.samples[1].frameId=1,t=>t.samples[1].mediaTime=0,t=>t.samples[1].atMs=3000,t=>t.samples[1].eyeBlinkLeft=2,t=>t.samples[1].tasksInferenceMs=-1,t=>t.samples[1].legacyUsable='true',t=>t.session.runtimePins=[],t=>t.session.sessionId='private@example.com']){const trace=fixture();change(trace);assert.throws(()=>adaptTrace(trace,options))}
 assert.throws(()=>adaptTrace(fixture(),{...options,episodes:[{session_id:'other',start_ms:0,end_ms:100,label:'drowsy'}]}),/unknown session/);
 assert.throws(()=>adaptTrace(fixture(),{...options,episodes:[{session_id:'local-test',start_ms:0,end_ms:3000,label:'drowsy'}]}),/outside session/);
});
test('adapter rejects unknown exact provenance, detector/flag mismatch and contradictory usable states',()=>{
 const options={participant:'P001',split:'test',episodes:labels};
 for(const change of [
  t=>t.session.runtimePins=t.session.runtimePins.map(pin=>({...pin,integrity:'sha256-'+Buffer.alloc(32).toString('base64')})),
  t=>delete t.session.helperIntegrity,t=>delete t.session.modelIntegrity,
  t=>t.session.helperIntegrity='sha256-'+Buffer.alloc(32).toString('base64'),
  t=>t.session.modelIntegrity='sha256-'+Buffer.alloc(32).toString('base64'),
  t=>t.session.runtimeVersion='future',t=>t.session.detectorVersion='native-mlkit',
  t=>t.session.experimentFlags=['pixels','tasks'],t=>t.session.experimentFlags=['tasks','tasks'],
  t=>t.session.experimentFlags=['tasks','unknown'],t=>t.session.geometryUnits='pixels-reference-3x4',
  t=>t.samples[1].calibrating=true,t=>t.samples[1].pitchDown=true,
  t=>{t.session.experimentFlags=['pitch','tasks'];t.session.detectorVersion=traceContract.detectorPrefix+'pitch+tasks';t.samples[1].pitchDown=true;}
 ]){const trace=fixture();change(trace);assert.throws(()=>adaptTrace(trace,options));}
 const calibration=fixture();calibration.samples[1].calibrating=true;calibration.samples[1].legacyUsable=false;
 assert.deepEqual(adaptTrace(calibration,options).tracking,[],'Tasks measurements during calibration never create legacy tracking');
});
test('real exported JSON adapter and event runner interoperate without synthesizing Tasks alerts or independent labels',()=>{
 const dir=mkdtempSync(join(tmpdir(),'occulert-trace-'));
 try{writeFileSync(join(dir,'trace.json'),JSON.stringify(fixture()));writeFileSync(join(dir,'labels.csv'),'session_id,start_ms,end_ms,label\nlocal-test,0,270,drowsy\n');
  execFileSync(process.execPath,['benchmark/parked-detection-trace.mjs','--trace',join(dir,'trace.json'),'--episodes',join(dir,'labels.csv'),'--participant','P001','--split','test','--out',dir]);
  const args=['benchmark/run-event-benchmark.mjs'];for(const kind of ['sessions','tracking','episodes','alerts'])args.push('--'+kind,join(dir,kind+'.csv'));args.push('--comparison',join(dir,'comparison.csv'),'--split','test');
  const result=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.equal(result.overall.eventRecall,1);assert.equal(result.comparison.overall.tasksEventRecall,null);assert.equal(result.comparison.overall.timing.tasks_inference_ms.p95Ms,7);
  const exported=parseFile(readFileSync(join(dir,'episodes.csv'),'utf8'),'episodes');assert.deepEqual(exported,labels);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
function landmarks(width,height){const lm=Array.from({length:468},()=>({x:180/width,y:180/height}));
 for(const [indices,cx]of [[[362,385,387,263,373,380],210],[[33,160,158,133,153,144],150]]){
  const xy=[[cx-20,180],[cx-8,174],[cx+8,174],[cx+20,180],[cx+8,186],[cx-8,186]];
  indices.forEach((index,i)=>lm[index]={x:xy[i][0]/width,y:xy[i][1]/height});
 }return lm;
}
test('licensed extractor uses the same pixel model for portrait and landscape and fingerprints the geometry mode',()=>{
 const ears=[];for(const [width,height]of [[360,480],[480,360]]){
  const lm=landmarks(width,height),expected=models.eyeEAR(lm,[362,385,387,263,373,380],width,height);assert.ok(Math.abs(expected-.3)<1e-12);
  const result=prepare([{label:'awake',participant:'P001',landmarks:JSON.stringify(lm),video_width:width,video_height:height}],{labelMap:{awake:'awake'},earGeometry:{mode:'pixel_landmarks'}},['label','participant','landmarks','video_width','video_height']);
  ears.push(result.rows[0].ear);assert.equal(result.manifest.earGeometry.mode,'pixel_landmarks');
 }assert.ok(Math.abs(ears[0]-ears[1])<1e-12);
});


import {validateComparisonRows,comparisonByDetector} from '../benchmark/detection-comparison.mjs';
test('comparison validation keeps participant splits and detector versions separate and rejects malformed rows',()=>{
 const result=adaptTrace(fixture(),{participant:'P001',split:'test',episodes:labels});
 validateComparisonRows(result.comparison,result.sessions);
 for(const change of [row=>row.session_id='other',row=>row.frame_id=0,row=>row.tasks_usable=2,row=>row.tasks_inference_ms='oops']){const rows=structuredClone(result.comparison);change(rows[0]);assert.throws(()=>validateComparisonRows(rows,result.sessions))}
 const second={...result.sessions[0],session_id:'other',participant:'P002',detector_version:'different'};
 const rows=[...result.comparison,...result.comparison.map(row=>({...row,session_id:'other'}))];
 const groups=comparisonByDetector(rows,[...result.sessions,second]);assert.equal(groups.overall,null);assert.equal(Object.keys(groups.detectors).length,2);
 assert.equal(comparisonByDetector(rows,result.sessions).overall.retainedFrames,result.comparison.length);
});
