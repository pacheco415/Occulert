import assert from 'node:assert/strict';
import test from 'node:test';
import geometry from '../ear-geometry.v1.js';
import {createAppHarness} from './lib/app-page-harness.mjs';
import {prepare} from '../benchmark/prepare-dataset.mjs';

function face(width,height){
 const points=Array.from({length:468},()=>({x:.5,y:.5}));
 const eye=[[-30,0],[-15,-9],[15,-9],[30,0],[15,9],[-15,9]];
 for(const indices of [geometry.left,geometry.right])indices.forEach((index,i)=>{points[index]={x:.5+eye[i][0]/width,y:.5+eye[i][1]/height};});
 return points;
}
function boot(pixel=true){return createAppHarness({sandboxOverrides:{OcculertEARGeometry:geometry,URLSearchParams,location:{search:pixel?'?ear-units=pixels':''}}});}

test('the actual driver and dataset extractor agree on pixel EAR in portrait and landscape',()=>{
 const h=boot(),values=[];
 for(const [width,height] of [[360,480],[480,360]]){
  h.el('video').videoWidth=width;h.el('video').videoHeight=height;
  const landmarks=face(width,height);
  const ear=h.run(`calcEAR(${JSON.stringify(landmarks)},LEFT)`);
  assert.ok(Math.abs(ear-.30)<1e-12);assert.equal(ear,geometry.eyeEAR(landmarks,geometry.left,width,height));values.push(ear);
  const prepared=prepare([{label:'awake',participant:'synthetic',landmarks:JSON.stringify(landmarks),video_width:String(width),video_height:String(height)}],{earGeometry:{mode:'pixel_landmarks'}});
  assert.equal(prepared.rows.length,1);assert.ok(Math.abs(prepared.rows[0].ear-ear)<1e-12);assert.equal(prepared.manifest.earGeometry.mode,'pixel_landmarks');
 }
 assert.ok(Math.abs(values[0]-values[1])<1e-12);
});

test('the default geometry stays normalized and portrait reference thresholds are equivalent',()=>{
 const legacy=boot(false),pixel=boot();
 legacy.el('video').videoWidth=360;legacy.el('video').videoHeight=480;
 const landmarks=face(360,480);assert.ok(Math.abs(legacy.run(`calcEAR(${JSON.stringify(landmarks)},LEFT)`)-.225)<1e-12);
 assert.equal(legacy.run('eyeClosedThreshold'),.18);
 assert.ok(Math.abs(pixel.run('eyeClosedThreshold')-.18*4/3)<1e-12);
 for(const level of ['low','medium','high']){
  legacy.run(`applySensitivity('${level}')`);pixel.run(`applySensitivity('${level}')`);
  assert.ok(Math.abs(pixel.run('eyeClosedThreshold')-legacy.run('eyeClosedThreshold')*4/3)<1e-12);
  assert.ok(Math.abs(pixel.run('eyeWatchThreshold')-legacy.run('eyeWatchThreshold')*4/3)<1e-12);
 }
});

test('resolution changes and orientation callbacks restart parked calibration and clear old observations',()=>{
 const h=boot();h.startSession();h.el('video').videoWidth=360;h.el('video').videoHeight=480;h.run('observeEARGeometry();calibrating=false;calibrated=true;calibrationSamples=[.3];earHistory=[.3];perclosWindow=[{t:Date.now(),closed:true}];');
 h.clock.advance(100);h.el('video').videoWidth=480;h.el('video').videoHeight=360;h.run('observeEARGeometry()');
 assert.equal(h.run('calibrating'),true);assert.equal(h.run('calibrated'),false);assert.equal(h.run('calibrationSamples.length'),0);assert.equal(h.run('earHistory.length'),0);assert.equal(h.run('perclosWindow.length'),0);
 assert.equal(h.run('calibrationUntil-Date.now()'),3200);
 h.run('calibrating=false;observeEARGeometry(true)');assert.equal(h.run('calibrating'),true);
});

test('invalid geometry cannot fabricate an open eye or a dataset measurement',()=>{
 assert.ok(Number.isNaN(geometry.meanEyes([],360,480)));
 assert.ok(Number.isNaN(geometry.meanEyes(face(360,480),0,480)));
 const prepared=prepare([{label:'awake',participant:'synthetic',landmarks:'not json',video_width:'360',video_height:'480'}],{earGeometry:{mode:'pixel_landmarks'}});
 assert.equal(prepared.rows.length,0);assert.equal(prepared.manifest.exclusions['invalid or missing EAR'],1);
 assert.throws(()=>prepare([],{earGeometry:{mode:'unknown'}}),/pixel_landmarks/);
});

test('pixel sessions declare their local experimental source and do not initialize cloud sync',async()=>{
 const h=boot();h.run('cloudReady=true;cloudConsent.checked=true;');await h.run('initCloud()');
 assert.equal(h.run('cloudReady'),false);assert.equal(h.el('cloudConsent').disabled,true);assert.equal(h.el('cloudConsent').checked,false);
 assert.equal(h.run('fleetPayload().earGeometry'),'pixels-reference-3x4-experiment');assert.equal(h.run('fleetPayload().detectorVersion'),'web-pixel-ear-experiment-1');
});
