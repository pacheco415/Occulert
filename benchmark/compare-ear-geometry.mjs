// Synthetic geometry comparison; no media or licensed dataset is required.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import geometry from '../ear-geometry.v1.js';
import {assetByStem} from '../scripts/lib/current-assets.mjs';
import {createAppHarness} from '../scripts/lib/app-page-harness.mjs';
const active=assetByStem('driver-app.js');
function fixture(width,height){
 const landmarks=Array.from({length:468},()=>({x:.5,y:.5}));
 const eye=[[-30,0],[-15,-9],[15,-9],[30,0],[15,9],[-15,9]];
 for(const indices of [geometry.left,geometry.right])indices.forEach((index,i)=>{landmarks[index]={x:.5+eye[i][0]/width,y:.5+eye[i][1]/height};});
 return landmarks;
}
const results=[];
for(const [width,height] of [[360,480],[480,360]]){
 const landmarks=fixture(width,height),row={width,height};
 for(const [name,search] of [['legacy',''],['pixels','?ear-units=pixels']]){
  const h=createAppHarness({sandboxOverrides:{OcculertEARGeometry:geometry,URLSearchParams,location:{search}}});
  h.el('video').videoWidth=width;h.el('video').videoHeight=height;
  row[name]={ear:h.run(`calcEAR(${JSON.stringify(landmarks)},LEFT)`),default_closed:h.run('eyeClosedThreshold'),default_watch:h.run('eyeWatchThreshold')};
 }
 row.dataset_ear=geometry.meanEyes(landmarks,width,height);results.push(row);
}
const receipt={schema:1,fixture:'synthetic eye width 60px and opposing vertical distances 18px',source:active,source_sha256:createHash('sha256').update(readFileSync(active)).digest('hex'),geometry_source:'ear-geometry.v1.js',geometry_sha256:createHash('sha256').update(readFileSync('ear-geometry.v1.js')).digest('hex'),threshold_reference:{width:360,height:480,conversion:4/3,reason:'chosen reference fixture; not an observed most-common device'},results,scope:'synthetic measurement equivalence, not detection accuracy or real-camera validation',default_pipeline_changed:false};
const text=JSON.stringify(receipt,null,2)+'\n';if(process.argv[2])writeFileSync(process.argv[2],text);else process.stdout.write(text);
