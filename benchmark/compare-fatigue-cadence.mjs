// Synthetic scoring comparison using the actual active driver source.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {assetByStem} from '../scripts/lib/current-assets.mjs';
import {createAppHarness} from '../scripts/lib/app-page-harness.mjs';
const active=assetByStem('driver-app.js');
function run(fps,elapsed){
 const h=createAppHarness({sandboxOverrides:{URLSearchParams,location:{search:elapsed?'?fatigue-timing=elapsed':''}}});
 h.startSession();h.run('calibrating=false;calibrated=true;confidence=100;fatigue=0;eyeClosedThreshold=.18;eyeWatchThreshold=.22;lastFatigueFrameAt=null;lastFatigueFrameObserved=false;');
 const start=h.clock.now;
 for(let i=0;i<fps*5;i++){
   h.clock.set(start+i*1000/fps);h.run('updateScore(.08,false,false,true)');
   if(h.run('riskText()[0]')==='ALERT')return{fps,alert_ms:i*1000/fps};
 }
 return{fps,alert_ms:null};
}
const receipt={schema:1,fixture:'sustained closed-eye score input',driver_source:active,driver_sha256:createHash('sha256').update(readFileSync(active)).digest('hex'),legacy:[3,7,15].map(fps=>run(fps,false)),elapsed:[3,7,15].map(fps=>run(fps,true)),scope:'synthetic score accumulation; no camera, end-to-end alert delivery or accuracy acceptance',limitations:['Sampling quantization remains. Arbitrary transitions cannot be promised a universal 150 ms bound at 3 fps.','EAR smoothing, frame-count PERCLOS, calibration and discrete event detection retain their existing algorithms.','Default runtime remains the legacy pipeline; the experiment is local and parked only.']};
const result=JSON.stringify(receipt,null,2)+'\n';
if(process.argv[2])writeFileSync(process.argv[2],result);else process.stdout.write(result);
