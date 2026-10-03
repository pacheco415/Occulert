(function(root){
  'use strict';
  const PINS=[{"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/vision_bundle.js", "integrity": "sha256-pCfCa2tALe6263Th9sdo0m7AzBWWlYyenj1RibfL9ao="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_internal.js", "integrity": "sha256-4XDuZ91OFsGm/NiECiBmh+WlmyLCDkqQK8RFsJVFTXM="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_internal.wasm", "integrity": "sha256-jaJ3pzOSbqzQR0uHBLNnQtbsMjHFeoYMW4id/48d+IY="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_nosimd_internal.js", "integrity": "sha256-6B1xWj1CzDNzYC6y96/3ldFkk022gOMklrZdq1N/llg="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm/vision_wasm_nosimd_internal.wasm", "integrity": "sha256-ooSDzULnToVb9evba0DZtmpbSeNelQILyXZp5oIqMZI="}, {"url": "/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/face_landmarker.task", "integrity": "sha256-ZBhOIpsmMQe8K4BMZiXbE0H/K7cxh0sLzC/mVE4Lyf8="}];
  const enabled=(()=>{try{return new URLSearchParams(root.location.search).get('detector')==='tasks'}catch{return false}})();
  let libraryPromise=null;
  function loadLibrary(){
    return libraryPromise??=new Promise((resolve,reject)=>{
      const script=document.createElement('script'),pin=PINS.find(p=>p.url.endsWith('/vision_bundle.js'));
      script.src=pin.url;script.integrity=pin.integrity;script.crossOrigin='anonymous';
      const timer=setTimeout(()=>{script.remove();reject(Error('Tasks library timed out'))},15000);
      script.onload=()=>{clearTimeout(timer);root.Vision?.FaceLandmarker?resolve(root.Vision):reject(Error('Tasks library unavailable'))};
      script.onerror=()=>{clearTimeout(timer);reject(Error('Tasks library integrity or load failure'))};document.head.appendChild(script);
    });
  }
  function verifyWorker(){
    return new Promise((resolve,reject)=>{
      const worker=navigator.serviceWorker?.controller;if(!worker){reject(Error('Reload after offline setup finishes to enable Tasks comparison'));return}
      const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('Current integrity-verifying worker required'))},1500);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.type==='occulert.tasks.runtime'&&JSON.stringify(event.data.pins)===JSON.stringify(PINS)?resolve():reject(Error('Worker runtime pins do not match'))};
      worker.postMessage({type:'occulert.tasks.runtime'},[channel.port2]);
    });
  }
  function parseResult(result){
    const categories=result?.faceBlendshapes?.[0]?.categories;
    if(!Array.isArray(categories)||!result?.faceLandmarks?.length)return null;
    const fields={};for(const name of ['eyeBlinkLeft','eyeBlinkRight','jawOpen']){
      const matches=categories.filter(category=>category.categoryName===name),value=matches[0]?.score;
      if(matches.length!==1||typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)return null;
      fields[name]=value;
    }
    return {...fields,closureScore:Math.round((fields.eyeBlinkLeft+fields.eyeBlinkRight)*50)};
  }
  function create({onStatus=()=>{}}={}){
    let active=true,detector=null,status='loading',lastStamp=-Infinity,lastVideoTime=-1,total=0,valid=0,sum=0,max=0,records=[];
    const state=value=>{status=value;if(active)onStatus(value)};
    const ready=(async()=>{
      await verifyWorker();const Vision=await loadLibrary();if(!active)return;
      const modelPin=PINS.find(p=>p.url.endsWith('.task')),controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),15000);let model;
      try{const response=await fetch(modelPin.url,{integrity:modelPin.integrity,signal:controller.signal});if(!response.ok)throw Error('Tasks model unavailable');model=new Uint8Array(await response.arrayBuffer())}finally{clearTimeout(timer)}
      if(!active)return;
      const files=await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/tasks-vision-1.0.1-occulert.1/wasm');
      const creation=Vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:model,delegate:'GPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true});
      let accept=true,creationTimer;
      const value=await new Promise((resolve,reject)=>{
        creationTimer=setTimeout(()=>{accept=false;reject(Error('Tasks initialization timed out'))},15000);
        creation.then(value=>{clearTimeout(creationTimer);if(accept)resolve(value);else value.close()},error=>{clearTimeout(creationTimer);reject(error)});
      });
      if(!active){value.close();return}detector=value;state('ready');
    })().catch(()=>{if(active)state('unavailable')});
    return Object.freeze({ready,
      sample(video,ear,atMs){
        if(!active||!detector||typeof atMs!=='number'||!Number.isFinite(atMs)||atMs<0)return null;
        const stamp=performance.now();if(stamp-lastStamp<500||video.currentTime===lastVideoTime)return null;
        lastStamp=stamp;lastVideoTime=video.currentTime;
        let result;try{result=parseResult(detector.detectForVideo(video,stamp))}catch{state('unavailable');detector.close();detector=null;return null}
        total++;if(result){valid++;sum+=result.closureScore;max=Math.max(max,result.closureScore)}
        if(records.length===1200)records.shift();records.push({atMs,ear:typeof ear==='number'&&Number.isFinite(ear)?ear:null,...(result||{eyeBlinkLeft:null,eyeBlinkRight:null,jawOpen:null,closureScore:null})});return result;
      },
      snapshot(){return {version:1,pipeline:'tasks_blendshape_comparison',runtimeVersion:'1.0.1-occulert.1',alertsChanged:false,status,totalSamples:total,validSamples:valid,meanClosureScore:valid?sum/valid:null,maxClosureScore:valid?max:null,retainedSamples:records.length,retention:'last_1200_samples_at_most_2_hz',samples:records.map(row=>({...row}))}},
      stop(){active=false;if(detector){detector.close();detector=null}},
    });
  }
  root.OcculertTasksComparison=Object.freeze({enabled,create,parseResult});
})(window);
