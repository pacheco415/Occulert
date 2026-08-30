// ── Display Intensity System ──────────────────────────────────────
const INTENSITIES = ['dim','standard','bright'];
const INTENSITY_ICONS  = { dim:'🔅', standard:'🔆', bright:'☀️' };
const INTENSITY_LABELS = { dim:'Dim', standard:'Standard', bright:'Bright' };

function applyIntensity(val) {
  val = INTENSITIES.includes(val) ? val : 'standard';
  document.documentElement.setAttribute('data-intensity', val);
  const btn = document.getElementById('intensityToggle');
  const icon  = document.getElementById('intensityIcon');
  const label = document.getElementById('intensityLabel');
  if (btn)   btn.title = 'Display: ' + INTENSITY_LABELS[val] + ' — click to cycle';
  if (icon)  icon.textContent = INTENSITY_ICONS[val];
  if (label) label.textContent = INTENSITY_LABELS[val];
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.intensity === val);
  });
  localStorage.setItem('occulert-intensity', val);
  // Update meta theme-color so mobile chrome matches
  const mc = { dim:'#020508', standard:'#050a0f', bright:'#0d1f30' };
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = mc[val];
}

// Cycle on nav button click
document.getElementById('intensityToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-intensity') || 'standard';
  const next = INTENSITIES[(INTENSITIES.indexOf(cur) + 1) % INTENSITIES.length];
  applyIntensity(next);
});

// Direct preset buttons in panel
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => applyIntensity(btn.dataset.intensity));
});

// On load: restore from localStorage
(function(){
  const saved = localStorage.getItem('occulert-intensity');
  applyIntensity(saved || 'standard');
})();
// ─────────────────────────────────────────────────────────────────

const $=id=>document.getElementById(id),video=$('video'),canvas=$('canvas'),ctx=canvas.getContext('2d'),statusEl=$('status'),startBtn=$('startBtn'),demoBtn=$('demoBtn'),overlay=$('overlay'),overlayTitle=$('overlayTitle'),overlayText=$('overlayText'),overlayHint=$('overlayHint'),stateCard=$('stateCard'),driveStateEl=$('driveState'),driveHintEl=$('driveHint'),fatigueEl=$('fatigue'),confidenceEl=$('confidence'),calibrationEl=$('calibration'),calibrationFill=$('calibrationFill'),faceStateEl=$('faceState'),earEl=$('ear'),alertsEl=$('alerts'),riskEl=$('risk'),riskDetailEl=$('riskDetail'),fatigueFill=$('fatigueFill'),confidenceFill=$('confidenceFill'),alertScreen=$('alertScreen'),alertTitle=$('alertTitle'),alertSub=$('alertSub'),logEl=$('log'),reportEl=$('report'),nodsEl=$('nods'),syncEl=$('sync'),gpsEl=$('gps'),locationEl=$('location'),perclosEl=$('perclos'),microsleepsEl=$('microsleeps'),distractionEl=$('distraction'),escalationEl=$('escalation'),gpsConsent=$('gpsConsent'),cloudConsent=$('cloudConsent'),sessionTimerEl=$('sessionTimer'),nightOpacity=$('nightOpacity'),nightVal=$('nightVal'),phoneGuide=$('phoneGuide'),calHint=$('calHint');

// Night mode opacity control
nightOpacity.addEventListener('input',()=>{
  const v=nightOpacity.value;
  nightVal.textContent=v+'%';
  alertScreen.style.background='rgba(255,51,68,'+v/100+')';
});
alertScreen.style.background='rgba(255,51,68,'+nightOpacity.value/100+')';

// Session timer
let timerInterval=null;
function startTimer(){
  if(timerInterval)clearInterval(timerInterval);
  timerInterval=setInterval(()=>{
    if(!sessionStart){sessionTimerEl.textContent='00:00';return}
    const elapsed=Math.floor((Date.now()-sessionStart)/1000);
    const m=Math.floor(elapsed/60).toString().padStart(2,'0');
    const s=(elapsed%60).toString().padStart(2,'0');
    sessionTimerEl.textContent=m+':'+s;
  },1000);
}
function stopTimer(){if(timerInterval)clearInterval(timerInterval);timerInterval=null;sessionTimerEl.textContent='00:00';}

let wakeLock=null,running=false,starting=false,stream=null,faceMesh=null,faceMeshScriptPromise=null,processingFrame=false,raf=null,lastFrame=0,lastAlert=0,lastRender=0,alerts=0,fatigue=0,confidence=0,earHistory=[],sessionStart=0,maxFatigue=0,fatigueSamples=[],noseYHistory=[],headNods=0,lastNod=0,lastFleetPush=0,cloudReady=false,backendSessionId=null,backendSessionPromise=null,backendEventQueue=Promise.resolve(),driverId=localStorage.getItem('occulert-driver-id')||('D-'+Math.floor(Math.random()*900+100)),gpsWatch=null,lastPosition=null,routePoints=[],distanceMeters=0,perclosWindow=[],eyesClosedSince=0,microsleeps=0,lastMicro=0,turnedSince=0,totalDistractionMs=0,escalationLevel=0,lastEscalation=0,calibrating=false,calibrated=false,calibrationUntil=0,calibrationSamples=[],baselineEAR=.28,baseClosedThreshold=.18,baseWatchThreshold=.22,eyeClosedThreshold=.18,eyeWatchThreshold=.22,noFaceSince=0,lastFaceSeen=0,hiddenAt=0,performanceSamples=[],processedFrames=0,busyFrameSkips=0,performanceSessionStart=0;localStorage.setItem('occulert-driver-id',driverId);const LEFT=[362,385,387,263,373,380],RIGHT=[33,160,158,133,153,144],PROCESS_INTERVAL=135,RENDER_INTERVAL=180,FLEET_PUSH_INTERVAL=5000,CALIBRATION_MS=3200,PERFORMANCE_WINDOW_SIZE=120,FACE_MESH_SCRIPT_URL='https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
function recordFramePerformance(durationMs){processedFrames++;if(Number.isFinite(durationMs)&&durationMs>=0)performanceSamples.push(durationMs);if(performanceSamples.length>PERFORMANCE_WINDOW_SIZE)performanceSamples.shift()}
function resetFramePerformance(){performanceSamples=[];processedFrames=0;busyFrameSkips=0;performanceSessionStart=sessionStart}
function framePerformanceSnapshot(){let sorted=[...performanceSamples].sort((a,b)=>a-b),average=performanceSamples.length?performanceSamples.reduce((sum,value)=>sum+value,0)/performanceSamples.length:0,p95=sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]:0;return{processedFrames,busyFrameSkips,averageInferenceMs:Math.round(average*10)/10,p95InferenceMs:Math.round(p95*10)/10}}
window.OcculertPerformance=Object.freeze({snapshot:framePerformanceSnapshot});
function loadFaceMeshScript(){if(typeof FaceMesh!=='undefined')return Promise.resolve();if(faceMeshScriptPromise)return faceMeshScriptPromise;faceMeshScriptPromise=new Promise((resolve,reject)=>{const existing=document.querySelector('script[data-occulert-face-mesh]'),script=existing||document.createElement('script'),failed=()=>{faceMeshScriptPromise=null;script.remove();reject(new Error('AI model failed to load. Check internet connection and refresh.'))},loaded=()=>typeof FaceMesh!=='undefined'?resolve():failed();script.addEventListener('load',loaded,{once:true});script.addEventListener('error',failed,{once:true});if(!existing){script.src=FACE_MESH_SCRIPT_URL;script.async=true;script.dataset.occulertFaceMesh='true';document.head.appendChild(script)}});return faceMeshScriptPromise}
const initializeLoadedFaceMesh=initModel;
initModel=async function(){await loadFaceMeshScript();return initializeLoadedFaceMesh()};
loop=async function(ts){if(!running)return;raf=requestAnimationFrame(loop);if(document.hidden){render();return}if(ts-lastFrame<PROCESS_INTERVAL)return;lastFrame=ts;if(video.readyState>=2&&faceMesh){if(processingFrame){busyFrameSkips++;return}if(performanceSessionStart!==sessionStart)resetFramePerformance();if(canvas.width!==video.videoWidth){canvas.width=video.videoWidth;canvas.height=video.videoHeight}processingFrame=true;const inferenceStartedAt=Date.now();try{await faceMesh.send({image:video})}catch(e){log('AI frame skipped')}finally{processingFrame=false;recordFramePerformance(Date.now()-inferenceStartedAt)}}};
function log(msg){const d=document.createElement('div');d.className='event';d.textContent=new Date().toLocaleTimeString()+': '+msg;logEl.prepend(d);while(logEl.children.length>14)logEl.lastChild.remove()}function setOverlay(title,text,hint,showGuide){overlayTitle.textContent=title;overlayText.innerHTML=text;overlayHint.innerHTML=hint||'';if(phoneGuide)phoneGuide.style.display=showGuide===false?'none':'flex';overlay.classList.remove('hide')}
function cameraRecoveryGuidance(error,nav=navigator){
  const name=error&&error.name||'';
  const userAgent=String(nav&&nav.userAgent||'').toLowerCase();
  const platform=String(nav&&nav.platform||'').toLowerCase();
  const touchPoints=Number(nav&&nav.maxTouchPoints)||0;
  const isIOS=/iphone|ipad|ipod/.test(userAgent)||(platform==='macintel'&&touchPoints>1);
  const isAndroid=/android/.test(userAgent);
  const cameraText='Occulert needs the front camera to detect eye closure and fatigue.';
  if(name==='NotAllowedError'||name==='SecurityError'){
    if(isIOS)return{title:'Camera Access Blocked',text:cameraText,hint:'<strong>On iPhone or iPad:</strong> open Safari\'s Page Menu, choose More, then Website Settings → Camera → Allow, and reload this page.'};
    if(isAndroid)return{title:'Camera Access Blocked',text:cameraText,hint:'<strong>On Android Chrome:</strong> open the site information menu, choose Permissions → Camera → Allow, and reload this page.'};
    return{title:'Camera Access Blocked',text:cameraText,hint:'<strong>Fix:</strong> open this site\'s browser permissions, allow camera access, and reload this page.'};
  }
  if(name==='NotReadableError'||name==='AbortError')return{title:'Camera Is Busy',text:'Occulert could not open the front camera.',hint:'<strong>Try:</strong> close any other app or browser tab using the camera, then reload this page.'};
  if(name==='NotFoundError'||name==='DevicesNotFoundError')return{title:'Front Camera Not Found',text:cameraText,hint:'<strong>Try:</strong> confirm the camera is enabled and available, then reload this page.'};
  return{title:'Camera Could Not Start',text:cameraText,hint:'<strong>Try:</strong> use Safari or Chrome over HTTPS, confirm camera access, then reload this page.'};
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}function calcEAR(lm,idx){let p1=lm[idx[0]],p2=lm[idx[1]],p3=lm[idx[2]],p4=lm[idx[3]],p5=lm[idx[4]],p6=lm[idx[5]],h=dist(p1,p4);return h<.001?.28:(dist(p2,p6)+dist(p3,p5))/(2*h)}function smooth(v){earHistory.push(v);if(earHistory.length>6)earHistory.shift();return earHistory.reduce((a,b)=>a+b,0)/earHistory.length}function headTurn(lm){let n=lm[4],l=lm[234],r=lm[454],w=Math.abs(r.x-l.x);return w<.05?true:Math.abs((n.x-(l.x+r.x)/2)/w)>.34}function detectHeadNod(lm){let y=lm[4].y;noseYHistory.push({y,t:Date.now()});if(noseYHistory.length>10)noseYHistory.shift();if(noseYHistory.length<6)return false;let now=Date.now();if(noseYHistory.length<8)return false;let midPt=noseYHistory[Math.floor(noseYHistory.length/2)],earliest=noseYHistory[0],latest=noseYHistory[noseYHistory.length-1],dip=midPt.y-earliest.y,recover=midPt.y-latest.y;if(dip>.04&&recover>.018&&now-lastNod>1800){lastNod=now;headNods++;nodsEl.textContent=headNods;log('Head nod detected');queueBackendEvent('head_nod');return true}return false}
function miles(m){return(m/1609.344).toFixed(2)}function hav(a,b){let R=6371000,toRad=x=>x*Math.PI/180,dLat=toRad(b.lat-a.lat),dLon=toRad(b.lng-a.lng),s=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s))}function startGPS(){if(!gpsConsent.checked){gpsEl.textContent='OFF';locationEl.textContent='--';return}if(!navigator.geolocation){gpsEl.textContent='NO';gpsEl.className='value gps warn';return}gpsEl.textContent='ASK';gpsEl.className='value gps warn';gpsWatch=navigator.geolocation.watchPosition(pos=>{let p={lat:+pos.coords.latitude.toFixed(6),lng:+pos.coords.longitude.toFixed(6),accuracy:Math.round(pos.coords.accuracy||0),speed:pos.coords.speed?Math.round(pos.coords.speed*2.23694):0,ts:new Date().toISOString()};if(lastPosition){let d=hav(lastPosition,p);if(d>2&&d<1000)distanceMeters+=d}lastPosition=p;routePoints.push(p);routePoints=routePoints.slice(-80);gpsEl.textContent='ON';gpsEl.className='value gps on';locationEl.textContent=p.lat.toFixed(2)+','+p.lng.toFixed(2)},err=>{gpsEl.textContent='OFF';gpsEl.className='value gps warn';log('GPS unavailable: '+err.message)},{enableHighAccuracy:true,maximumAge:5000,timeout:12000})}function stopGPS(){if(gpsWatch!==null)navigator.geolocation.clearWatch(gpsWatch);gpsWatch=null;gpsEl.textContent=lastPosition?'SAVED':'OFF';gpsEl.className='value gps '+(lastPosition?'on':'warn')}
function finishCalibration(){if(!calibrationSamples.length){calibrating=false;calibrated=false;calibrationEl.textContent='DEFAULT';calibrationFill.style.width='100%';if(typeof applySensitivity==='function')applySensitivity(localStorage.getItem('occulert-sensitivity')||'medium');if(calHint)calHint.textContent='Using default thresholds.';log('Calibration used default thresholds');const rb2=document.getElementById('recalBtn');if(rb2)rb2.style.display='block';return}calibrationSamples.sort((a,b)=>a-b);let mid=calibrationSamples.slice(Math.floor(calibrationSamples.length*.2),Math.ceil(calibrationSamples.length*.8));baselineEAR=mid.reduce((a,b)=>a+b,0)/mid.length;baseClosedThreshold=Math.max(.12,Math.min(.22,baselineEAR*.66));baseWatchThreshold=Math.max(baseClosedThreshold+.025,Math.min(.28,baselineEAR*.82));if(typeof applySensitivity==='function')applySensitivity(localStorage.getItem('occulert-sensitivity')||'medium');calibrated=true;calibrating=false;calibrationEl.textContent='DONE';calibrationFill.style.width='100%';if(calHint)calHint.textContent='Personalized to your eyes. EAR baseline: '+baselineEAR.toFixed(3);log('Calibration complete');const rb=document.getElementById('recalBtn');if(rb)rb.style.display='block'}function updateCalibration(ear){if(!calibrating)return;if(ear>.16&&ear<.45)calibrationSamples.push(ear);let left=Math.max(0,calibrationUntil-Date.now()),pct=Math.min(100,Math.round((1-left/CALIBRATION_MS)*100));calibrationEl.textContent=pct+'%';calibrationFill.style.width=pct+'%';if(calHint)calHint.textContent='Keep eyes open and face centered… '+pct+'%';if(left<=0)finishCalibration()}
function updateEyeMetrics(ear,turned){let now=Date.now(),closed=ear<eyeClosedThreshold;perclosWindow.push({t:now,closed});perclosWindow=perclosWindow.filter(x=>now-x.t<60000);let perclos=perclosWindow.length?Math.round(perclosWindow.filter(x=>x.closed).length/perclosWindow.length*100):0;perclosEl.textContent=perclos+'%';if(closed&&!eyesClosedSince)eyesClosedSince=now;if(!closed)eyesClosedSince=0;if(eyesClosedSince&&now-eyesClosedSince>1500&&now-lastMicro>3000&&confidence>45){microsleeps++;lastMicro=now;microsleepsEl.textContent=microsleeps;log('Microsleep pattern detected')}if(turned&&!turnedSince)turnedSince=now;if(!turned&&turnedSince){totalDistractionMs+=now-turnedSince;turnedSince=0}let live=turnedSince?Date.now()-turnedSince:0;distractionEl.textContent=Math.round((totalDistractionMs+live)/1000)+'s';return perclos}function updateScore(ear,turned,nod,hasFace){let now=Date.now();if(!hasFace){if(!noFaceSince)noFaceSince=now;faceStateEl.textContent='NO';confidence=Math.max(0,confidence-10);if(noFaceSince&&now-noFaceSince>3500)fatigue=Math.max(0,fatigue-2);return}noFaceSince=0;lastFaceSeen=now;faceStateEl.textContent='OK';if(calibrating){updateCalibration(ear);confidence=Math.min(100,confidence+2);fatigue=Math.max(0,fatigue-2);return}confidence=Math.min(100,confidence+(calibrated?5:3));let perclos=updateEyeMetrics(ear,turned);if(turned){confidence=Math.max(35,confidence-5);if(turnedSince&&now-turnedSince>3000)fatigue+=2;else fatigue=Math.max(0,fatigue-1)}else{if(nod)fatigue+=18;if(ear<eyeClosedThreshold*.82)fatigue+=9;else if(ear<eyeClosedThreshold)fatigue+=6;else if(ear<eyeWatchThreshold)fatigue+=2;else fatigue-=3;if(perclos>45)fatigue+=8;else if(perclos>30)fatigue+=5;else if(perclos>18)fatigue+=2;if(lastMicro&&now-lastMicro<30000)fatigue+=1;if(confidence<45)fatigue+=1}fatigue=Math.max(0,Math.min(100,fatigue));maxFatigue=Math.max(maxFatigue,fatigue);fatigueSamples.push(fatigue)}function riskText(){if(running&&noFaceSince&&Date.now()-noFaceSince>2500)return['NO FACE','noface'];if(calibrating)return['CALIBRATING','watch'];if(fatigue>=80&&confidence>=45)return['ALERT','danger'];if(fatigue>=60)return['HIGH','danger'];if(fatigue>=35)return['WATCH','warn'];return['SAFE','safe']}
function fleetPayload(){let avg=fatigueSamples.length?Math.round(fatigueSamples.reduce((a,b)=>a+b,0)/fatigueSamples.length):0,score=Math.max(0,100-Math.round(maxFatigue*.65)-alerts*8-headNods*3-microsleeps*5-Math.round(totalDistractionMs/20000)),r=riskText()[0],perclos=Number(perclosEl.textContent.replace('%',''))||0;return{driverId,name:'Local Driver',status:r,fatigue:Math.round(fatigue),confidence:Math.round(confidence),alerts,headNods,microsleeps,perclos,distractionSeconds:Math.round((totalDistractionMs+(turnedSince?Date.now()-turnedSince:0))/1000),escalationLevel,maxFatigue:Math.round(maxFatigue),avgFatigue:avg,safetyScore:score,lastUpdate:new Date().toISOString(),location:gpsConsent.checked?lastPosition:null,route:gpsConsent.checked?routePoints:[],distanceMiles:gpsConsent.checked?Number(miles(distanceMeters)):0,speedMph:lastPosition&&gpsConsent.checked?lastPosition.speed:0,gpsEnabled:gpsConsent.checked&&!!lastPosition,cloudConsent:cloudConsent.checked}}
function beginBackendSession(){backendSessionId=null;backendEventQueue=Promise.resolve();if(!cloudConsent.checked||!cloudReady||!window.OcculertBackend)return Promise.resolve(null);backendSessionPromise=window.OcculertBackend.startSession().then(result=>{if(!cloudConsent.checked)return null;if(result.ok&&result.body.session){backendSessionId=result.body.session.id;log('Protected cloud session started');return backendSessionId}cloudReady=false;syncEl.textContent='LOCAL';log(result.status===403?'Cloud profile is not ready - saved locally':'Cloud session unavailable - saved locally');return null}).catch(()=>{cloudReady=false;syncEl.textContent='LOCAL';log('Cloud session unavailable - saved locally');return null});return backendSessionPromise}
function queueBackendEvent(type){if(!cloudConsent.checked||!cloudReady||!window.OcculertBackend)return;const location=gpsConsent.checked&&lastPosition?{latitude:lastPosition.lat,longitude:lastPosition.lng}:{};backendEventQueue=backendEventQueue.then(()=>backendSessionPromise||backendSessionId).then(id=>id&&cloudConsent.checked?window.OcculertBackend.logEvent(id,type,Object.assign({fatigue_score:Math.round(fatigue),confidence:Math.round(confidence)},location)):null).catch(()=>null)}
async function finishBackendSession(payload){if(!backendSessionPromise&&!backendSessionId)return;if(!cloudConsent.checked){backendSessionId=null;backendSessionPromise=null;return}try{const id=backendSessionId||await backendSessionPromise;await backendEventQueue;if(id&&cloudConsent.checked){const result=await window.OcculertBackend.endSession(id,{average_fatigue:payload.avgFatigue,max_fatigue:payload.maxFatigue,safety_score:payload.safetyScore,alert_count:payload.alerts,head_nod_count:payload.headNods});log(result.ok?'Protected cloud session saved':'Cloud summary unavailable - local copy kept')}}catch(e){log('Cloud summary unavailable - local copy kept')}finally{backendSessionId=null;backendSessionPromise=null}}
async function pushFleet(force=false){let now=Date.now();if(!force&&now-lastFleetPush<FLEET_PUSH_INTERVAL)return;lastFleetPush=now;let p=fleetPayload();try{localStorage.setItem('occulert-live-session',JSON.stringify(p));if(cloudConsent.checked&&cloudReady&&window.OcculertSync)await window.OcculertSync.saveLiveSession(p)}catch(e){localStorage.setItem('occulert-live-session',JSON.stringify(p))}}function render(ear){let now=Date.now();if(!ear&&now-lastRender<RENDER_INTERVAL)return;lastRender=now;fatigueEl.textContent=Math.round(fatigue);fatigueFill.style.width=fatigue+'%';confidenceEl.textContent=Math.round(confidence)+'%';confidenceFill.style.width=confidence+'%';if(ear)earEl.textContent=ear.toFixed(3);if(!running&&!calibrated){calibrationEl.textContent='READY';calibrationFill.style.width='0%';faceStateEl.textContent='--'}let r=riskText();riskEl.textContent=r[0];riskDetailEl.textContent=r[0];stateCard.className='card state-card '+r[1];driveHintEl.textContent=r[0]==='NO FACE'?'Center your face in the camera. This is not counted as drowsy.':r[0]==='CALIBRATING'?'Keep eyes open and face centered for a few seconds.':r[0]==='ALERT'?'Pull over safely and rest. Do not keep driving tired.':r[0]==='WATCH'?'Fatigue signs are building. Stay alert and prepare to stop if needed.':'Camera and fatigue score look normal.';driveStateEl.textContent=r[0];statusEl.className='status '+(r[0]==='ALERT'?'alert':running?'on':'off');statusEl.textContent=running?r[0]:'OFFLINE';syncEl.textContent=cloudConsent.checked?(cloudReady?'ON':'LOCAL'):'LOCAL';escalationEl.textContent=escalationLevel;pushFleet()}function drawEyes(lm,color){ctx.clearRect(0,0,canvas.width,canvas.height);[LEFT,RIGHT].forEach(idx=>{ctx.beginPath();idx.forEach((i,k)=>{let p=lm[i],x=p.x*canvas.width,y=p.y*canvas.height;k?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke()})}
let _ac=null;function getAC(){if(!_ac||_ac.state==='closed'){try{_ac=new(window.AudioContext||window.webkitAudioContext)()}catch(e){_ac=null}}return _ac}function tone(freq,dur,gain){try{const ac=getAC();if(!ac)return;if(ac.state==='suspended')ac.resume();const o=ac.createOscillator(),g=ac.createGain();o.connect(g);g.connect(ac.destination);o.frequency.value=freq;g.gain.value=gain;o.start();setTimeout(()=>{try{o.stop()}catch(e){}},dur)}catch(e){}}function trigger(reason){let now=Date.now();if(now-lastAlert<12000||calibrating||confidence<45)return;lastAlert=now;alerts++;alertsEl.textContent=alerts;if(now-lastEscalation>90000)escalationLevel=0;escalationLevel=Math.min(4,escalationLevel+1);lastEscalation=now;let titles=['DROWSY ALERT','LOUD ALERT','FLEET WARNING','EMERGENCY CHECK'];alertTitle.textContent=titles[Math.max(0,escalationLevel-1)]||'DROWSY ALERT';alertSub.textContent=escalationLevel>=3?'Driver should pull over and confirm safety':'Pull over safely';alertScreen.style.background='rgba(255,51,68,'+nightOpacity.value/100+')';alertScreen.classList.add('show');setTimeout(()=>alertScreen.classList.remove('show'),1300);if(navigator.vibrate)navigator.vibrate(escalationLevel>=3?[700,150,700,150,700,150,700]:[500,150,500,150,300]);try{const _hac=getAC();if(_hac){if(_hac.state==='suspended')_hac.resume();const _pulses=escalationLevel>=3?3:2;for(let _pi=0;_pi<_pulses;_pi++){setTimeout(()=>{try{const _ho=_hac.createOscillator(),_hg=_hac.createGain();_ho.connect(_hg);_hg.connect(_hac.destination);_ho.type='sine';_ho.frequency.value=55;_hg.gain.setValueAtTime(0,_hac.currentTime);_hg.gain.linearRampToValueAtTime(0.6,_hac.currentTime+0.015);_hg.gain.linearRampToValueAtTime(0,_hac.currentTime+0.2);_ho.start();setTimeout(()=>{try{_ho.stop()}catch(e){}},250)}catch(e){}},_pi*300)}}}catch(e){}if(typeof Notification!=='undefined'&&Notification.permission==='granted'){try{const _ntitle='Occulert ⚠️ Drowsiness Alert';const _nbody=escalationLevel>=3?'Pull over safely — confirm safety now':'Stay alert! Drowsiness detected.';const _nopts={body:_nbody,icon:'/occulert-logo-main.png',badge:'/occulert-logo-main.png',tag:'occulert-alert-'+Date.now(),silent:false,vibrate:escalationLevel>=3?[700,150,700,150,700]:[500,150,500],requireInteraction:escalationLevel>=3};if('serviceWorker'in navigator&&navigator.serviceWorker.controller){navigator.serviceWorker.ready.then(reg=>reg.showNotification(_ntitle,_nopts)).catch(()=>{try{new Notification(_ntitle,_nopts)}catch(e){}})}else{try{new Notification(_ntitle,_nopts)}catch(e){}}}catch(e){}}tone(escalationLevel>=3?1100:880,escalationLevel>=3?900:450,escalationLevel>=3?.35:.2);log((reason||'Drowsy')+' alert triggered - escalation '+escalationLevel);pushFleet(true)}function demoAlert(){sessionStart=sessionStart||Date.now();calibrating=false;calibrated=true;calibrationEl.textContent='DONE';calibrationFill.style.width='100%';faceStateEl.textContent='OK';fatigue=92;confidence=Math.max(confidence,88);headNods++;microsleeps++;nodsEl.textContent=headNods;microsleepsEl.textContent=microsleeps;perclosEl.textContent='55%';maxFatigue=Math.max(maxFatigue,fatigue);fatigueSamples.push(fatigue);if(gpsConsent.checked&&!lastPosition)lastPosition={lat:37.7749,lng:-122.4194,accuracy:25,speed:0,ts:new Date().toISOString()};if(lastPosition)routePoints.push(lastPosition);log('Test drowsy event added');lastAlert=0;render(.12);trigger('Test');overlay.classList.add('hide')}
function onResults(res){if(!running)return;let has=!!(res.multiFaceLandmarks&&res.multiFaceLandmarks.length);if(!has){ctx.clearRect(0,0,canvas.width,canvas.height);updateScore(0,false,false,false);if(typeof updateTrackingState==='function')updateTrackingState(false,false);;render();return}let lm=res.multiFaceLandmarks[0],raw=(calcEAR(lm,LEFT)+calcEAR(lm,RIGHT))/2,ear=smooth(raw),turned=headTurn(lm),nod=calibrating?false:detectHeadNod(lm);updateScore(ear,turned,nod,true);
// ── New: MAR/Yawn, Light, Tracking ──
if(typeof detectYawn==='function')detectYawn(lm);
if(typeof calcMAR==='function'){const mar=calcMAR(lm);const marEl=document.getElementById('marEl');if(marEl)marEl.textContent=mar.toFixed(2);}
const videoEl=document.getElementById('video')||document.querySelector('video');
if(typeof checkLightLevel==='function'&&videoEl)checkLightLevel(videoEl);
if(typeof updateTrackingState==='function'){const earOk=ear>.05&&ear<.65;updateTrackingState(true,earOk);}
drawEyes(lm,fatigue>=60?'#ff3344':fatigue>=35?'#ffaa00':'#00ff88');render(ear);if(!calibrating&&confidence>=45&&fatigue>=80)trigger('Fatigue');else if(!calibrating&&confidence>=45&&turnedSince&&Date.now()-turnedSince>6500)trigger('Distraction')}async function initModel(){if(faceMesh)return;if(typeof FaceMesh==='undefined')throw new Error('AI model failed to load. Check internet connection and refresh.');faceMesh=new FaceMesh({locateFile:f=>'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/'+f});faceMesh.setOptions({maxNumFaces:1,refineLandmarks:false,minDetectionConfidence:.62,minTrackingConfidence:.58});faceMesh.onResults(onResults);log('AI model ready')}async function initCloud(){if(!cloudConsent.checked){cloudReady=false;syncEl.textContent='LOCAL';return}try{const configured=window.OcculertBackend&&await window.OcculertBackend.isConfigured();const user=configured&&window.OcculertBackend.currentUser();cloudReady=!!user;syncEl.textContent=cloudReady?'ON':'LOCAL';log(cloudReady?'Protected cloud sync ready':configured?'Sign in before enabling cloud sync':'Cloud sync is not configured - using local mode')}catch(e){cloudReady=false;syncEl.textContent='LOCAL';log('Cloud sync unavailable - using local mode')}}
async function loop(ts){if(!running)return;raf=requestAnimationFrame(loop);if(document.hidden){render();return}if(ts-lastFrame<PROCESS_INTERVAL)return;lastFrame=ts;if(video.readyState>=2&&faceMesh){if(canvas.width!==video.videoWidth){canvas.width=video.videoWidth;canvas.height=video.videoHeight}try{await faceMesh.send({image:video})}catch(e){log('AI frame skipped')}}}async function start(){if(starting)return;starting=true;startBtn.disabled=true;startBtn.textContent='STARTING...';setOverlay('Opening Camera','Please allow camera access when your browser asks.','GPS and cloud sync are optional. Enable them above before starting if needed.',false);try{if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Camera is not supported in this browser. Try Safari or Chrome on HTTPS.');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:480},height:{ideal:360},frameRate:{ideal:12,max:16}},audio:false});video.srcObject=stream;await video.play();await initModel();await initCloud();running=true;sessionStart=Date.now();startTimer();try{if('wakeLock'in navigator){wakeLock=await navigator.wakeLock.request('screen');log('Screen wake lock active')}}catch(e){log('Wake lock unavailable - keep screen unlocked')}fatigue=0;confidence=0;alerts=0;headNods=0;microsleeps=0;maxFatigue=0;fatigueSamples=[];noseYHistory=[];earHistory=[];perclosWindow=[];eyesClosedSince=0;turnedSince=0;totalDistractionMs=0;escalationLevel=0;distanceMeters=0;routePoints=[];lastPosition=null;noFaceSince=0;lastFaceSeen=0;lastRender=0;calibrating=true;calibrated=false;calibrationSamples=[];calibrationUntil=Date.now()+CALIBRATION_MS;baselineEAR=.28;eyeClosedThreshold=.18;eyeWatchThreshold=.22;alertsEl.textContent='0';nodsEl.textContent='0';microsleepsEl.textContent='0';perclosEl.textContent='0%';distractionEl.textContent='0s';escalationEl.textContent='0';locationEl.textContent='--';faceStateEl.textContent='--';calibrationEl.textContent='0%';calibrationFill.style.width='0%';reportEl.style.display='none';overlay.classList.add('hide');startBtn.disabled=false;startBtn.textContent='STOP MONITORING';startBtn.className='btn stop';if(typeof Notification!=='undefined'&&Notification.permission==='default'){Notification.requestPermission().then(p=>{if(p==='granted')log('Notifications enabled. Watch delivery depends on iPhone notification mirroring or the verified native companion setup.')}).catch(()=>{})}log('Monitoring started - calibrating');startGPS();raf=requestAnimationFrame(loop)}catch(e){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}const recovery=cameraRecoveryGuidance(e);setOverlay(recovery.title,recovery.text,recovery.hint,false);log('Camera error: '+(e.message||e.name||e));startBtn.textContent='START MONITORING';startBtn.className='btn primary'}finally{starting=false;startBtn.disabled=false;render()}}
async function stop(){running=false;calibrating=false;stopTimer();const rb3=document.getElementById('recalBtn');if(rb3)rb3.style.display='none';if(wakeLock){try{await wakeLock.release()}catch(e){}wakeLock=null}if(raf)cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;stopGPS();ctx.clearRect(0,0,canvas.width,canvas.height);setOverlay('AI Fatigue Monitoring','Supplemental prototype only. Keep your attention on the road, never rely on alerts alone, and never drive tired.<br>Press Start Monitoring only when safely parked.','<strong>Foreground required:</strong> monitoring stops if this tab is hidden or the screen locks. Pull over safely before restarting.',true);startBtn.textContent='START MONITORING';startBtn.className='btn primary';let p=fleetPayload(),mins=sessionStart?((Date.now()-sessionStart)/60000).toFixed(1):'0.0';render(.001);pushFleet(true);reportEl.style.display='block';reportEl.textContent='OCCULERT SESSION REPORT\n\nStatus: '+p.status+'\nDuration: '+mins+' min\nSafety Score: '+p.safetyScore+'/100\n\nCalibration: '+(calibrated?'Personalized':'Default')+'\nOpen-eye EAR: '+baselineEAR.toFixed(3)+'\nClosed-eye threshold: '+eyeClosedThreshold.toFixed(3)+'\n\nAlerts Triggered: '+alerts+'\nEscalation Level: '+escalationLevel+'\nHead Nods Detected: '+headNods+'\nMicrosleeps Detected: '+microsleeps+'\nPERCLOS: '+p.perclos+'%\nDistraction Time: '+p.distractionSeconds+'s\nAverage Fatigue: '+p.avgFatigue+'/100\nMax Fatigue: '+p.maxFatigue+'/100\n\nGPS Enabled: '+(p.gpsEnabled?'Yes':'No')+'\nDistance: '+p.distanceMiles+' mi\nLast Location: '+(p.location?p.location.lat+', '+p.location.lng:'Not available')+'\n\nSync Mode: '+(cloudConsent.checked&&cloudReady?'Cloud + Local':'Local only')+'\nSaved: '+new Date().toLocaleString()+'\n\nSafety and liability: Occulert is a supplemental prototype only. It may miss drowsiness, may trigger false alerts, and is not a certified safety, medical, emergency, legal, employment, fleet compliance, or transportation compliance device. Do not interact with the app while driving. If tired or unsafe, pull over and rest.';try{if(cloudConsent.checked&&cloudReady&&window.OcculertSync)await window.OcculertSync.saveSessionHistory(p)}catch(e){}log('Session ended')}
const startLocalSession=start;
start=async function(){await startLocalSession();if(running)backendSessionPromise=beginBackendSession()};
const stopLocalSession=stop;
stop=async function(){const payload=fleetPayload();await stopLocalSession();await finishBackendSession(payload)};
startBtn.onclick=()=>running?stop():start();
document.addEventListener('keydown',(e)=>{if(e.code==='Space'&&e.target===document.body){e.preventDefault();running?stop():start()}});
const recalBtn=document.getElementById('recalBtn');
if(recalBtn){recalBtn.onclick=()=>{if(!running)return;calibrating=true;calibrated=false;calibrationSamples=[];calibrationUntil=Date.now()+CALIBRATION_MS;calibrationEl.textContent='0%';calibrationFill.style.width='0%';earHistory=[];log('Recalibration started');recalBtn.style.display='none'};};demoBtn.onclick=demoAlert;
const resetBtn=document.getElementById('resetBtn');
if(resetBtn){resetBtn.onclick=()=>{if(!confirm('Reset all session data?'))return;fatigue=0;confidence=0;alerts=0;headNods=0;microsleeps=0;maxFatigue=0;fatigueSamples=[];perclosWindow=[];eyesClosedSince=0;turnedSince=0;totalDistractionMs=0;escalationLevel=0;earHistory=[];noseYHistory=[];alertsEl.textContent='0';nodsEl.textContent='0';microsleepsEl.textContent='0';perclosEl.textContent='0%';distractionEl.textContent='0s';escalationEl.textContent='0';reportEl.style.display='none';logEl.innerHTML='';log('Session data reset');render()}}async function handleVisibilityChange(hidden=document.visibilityState==='hidden'){if(!running||!hidden)return false;hiddenAt=Date.now();log('Monitoring stopped because Occulert left the foreground');await stop();return true}document.addEventListener('visibilitychange',()=>{void handleVisibilityChange()});cloudConsent.addEventListener('change',initCloud);

// ═══════════════════════════════════════════════════════════════════
// OCCULERT v1.2 UPGRADE — Feature Pack (injected into main scope)
// Features: MAR/Yawn, Low-Light, Tracking Quality, Voice Alerts,
//           Break Recommendations, Snooze, CSV Export, Chart,
//           PWA Install Prompt, Battery Awareness
// ═══════════════════════════════════════════════════════════════════

// ── MAR (Mouth Aspect Ratio) / Yawn Detection ─────────────────────
let yawnCount=0,lastYawn=0,_marHist=[],_mouthOpenSince=0;
const MAR_YAWN_THRESH=0.58, YAWN_HOLD_MS=1200, YAWN_COOLDOWN_MS=8000;

function calcMAR(lm){
  try{
    const top=lm[13],bot=lm[14],left=lm[61],right=lm[291];
    if(!top||!bot||!left||!right)return 0;
    const vert=Math.sqrt((bot.x-top.x)**2+(bot.y-top.y)**2+(bot.z-top.z)**2);
    const horiz=Math.sqrt((right.x-left.x)**2+(right.y-left.y)**2+(right.z-left.z)**2);
    return horiz<0.001?0:vert/horiz;
  }catch(e){return 0;}
}
function smoothMAR(v){_marHist.push(v);if(_marHist.length>5)_marHist.shift();return _marHist.reduce((a,b)=>a+b,0)/_marHist.length;}
function detectYawn(lm){
  const mar=smoothMAR(calcMAR(lm));
  const now=Date.now();
  if(mar>MAR_YAWN_THRESH){
    if(!_mouthOpenSince)_mouthOpenSince=now;
    if(now-_mouthOpenSince>YAWN_HOLD_MS&&now-lastYawn>YAWN_COOLDOWN_MS){
      yawnCount++;lastYawn=now;
      const yEl=document.getElementById('yawnCountEl');if(yEl)yEl.textContent=yawnCount;
      log('Yawn detected (MAR='+mar.toFixed(2)+')');
      queueBackendEvent('yawn');
      triggerBreakCheck();
      fatigue=Math.min(100,fatigue+8);
    }
  }else{_mouthOpenSince=0;}
  const mEl=document.getElementById('marEl');if(mEl)mEl.textContent=mar.toFixed(2);
}

// ── Low-Light Detection ───────────────────────────────────────────
let _lastLightCheck=0;
function checkLightLevel(videoEl){
  const now=Date.now();
  if(now-_lastLightCheck<5000)return;
  _lastLightCheck=now;
  try{
    const tc=document.createElement('canvas');tc.width=64;tc.height=48;
    const tx=tc.getContext('2d');tx.drawImage(videoEl,0,0,64,48);
    const d=tx.getImageData(0,0,64,48).data;
    let lum=0;
    for(let i=0;i<d.length;i+=16)lum+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    lum/=(d.length/16);
    const b=document.getElementById('lightBadge');
    if(b){
      if(lum<18){b.textContent='🌑 Too Dark to Track';b.style.color='#ff4444';b.style.display='inline-flex';}
      else if(lum<28){b.textContent='⚠️ Low Light';b.style.color='#ffaa00';b.style.display='inline-flex';}
      else{b.style.display='none';}
    }
  }catch(e){}
}

// ── Tracking Quality Badge ────────────────────────────────────────
let _trackLostSince=0;
function updateTrackingState(hasFace,hasGoodEAR){
  const b=document.getElementById('trackingBadge');if(!b)return;
  const now=Date.now();
  if(!hasFace||!hasGoodEAR){
    if(!_trackLostSince)_trackLostSince=now;
    if(now-_trackLostSince>3000){b.textContent='⚠️ Tracking Lost';b.style.color='#ffaa00';b.style.display='inline-flex';}
  }else{_trackLostSince=0;b.textContent='✓ Tracking Good';b.style.color='#00ff88';b.style.display='inline-flex';}
}

// ── Voice Alerts (SpeechSynthesis) ───────────────────────────────
let _voiceEnabled=localStorage.getItem('occulert-voice')==='true';
const VOICE_MSGS=['Pull over safely','Take a break, you are tired','Drowsiness detected, rest now','Danger! Pull over immediately'];
function speak(msg){
  if(!_voiceEnabled||!window.speechSynthesis)return;
  try{if(window.speechSynthesis.paused)window.speechSynthesis.resume();window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(msg);u.rate=0.9;u.pitch=1.0;u.volume=1.0;window.speechSynthesis.speak(u);}catch(e){}
}
function toggleVoice(){
  _voiceEnabled=!_voiceEnabled;localStorage.setItem('occulert-voice',_voiceEnabled);
  const b=document.getElementById('voiceToggleBtn');if(b)b.textContent=_voiceEnabled?'🔊 Voice ON':'🔇 Voice OFF';
}

// ── Break Recommendations ─────────────────────────────────────────
let _alertsSinceBreak=0,_lastBreakPrompt=0;
function triggerBreakCheck(){
  _alertsSinceBreak++;
  const sessionMs=sessionStart?Date.now()-sessionStart:0;
  if((_alertsSinceBreak>=3||sessionMs>40*60*1000)&&Date.now()-_lastBreakPrompt>15*60*1000){
    _lastBreakPrompt=Date.now();
    const el=document.getElementById('breakBanner');
    if(el){
      const mins=Math.round(sessionMs/60000);
      el.innerHTML='🛑 Rest Stop Recommended — '+mins+' min driving, '+_alertsSinceBreak+' alerts. <button onclick="dismissBreak()" style="background:none;border:1px solid #00ff88;color:#00ff88;padding:4px 10px;border-radius:6px;cursor:pointer;margin-left:10px">Dismiss</button>';
      el.style.display='block';
    }
    speak('Rest stop recommended. Please pull over safely and take a break.');
  }
}
function dismissBreak(){
  const el=document.getElementById('breakBanner');if(el)el.style.display='none';
  _alertsSinceBreak=0;
}

// ── CSV Export ───────────────────────────────────────────────────
let _sessionLog=[];
function logEvent(type,value,extra){_sessionLog.push({ts:Date.now(),type,value,extra:extra||''});}
function exportCSV(){
  if(!_sessionLog.length){
    // Generate from current session state
    _sessionLog.push({ts:Date.now(),type:'snapshot',value:fatigue,extra:'alerts='+alerts+',microsleeps='+microsleeps+',nods='+headNods});
  }
  const rows=_sessionLog.map(e=>[new Date(e.ts).toISOString(),e.type,e.value,e.extra].map(v=>'"'+OcculertSecurity.csvCell(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['Timestamp,Type,Value,Extra\n'+rows],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='occulert-session-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log('CSV exported: '+_sessionLog.length+' events');
}

// ── Alertness Mini Chart ─────────────────────────────────────────
let _chartData=[],_chartCtx=null;
function initChart(){
  const cv=document.getElementById('alertnessChart');if(!cv)return;
  cv.width=cv.offsetWidth||300;cv.height=cv.offsetHeight||60;
  _chartCtx=cv.getContext('2d');
}
function updateChart(val){
  if(!_chartCtx)return;
  _chartData.push({t:Date.now(),v:isNaN(val)?0:Math.min(100,Math.max(0,val))});
  if(_chartData.length>120)_chartData.shift();
  const cv=document.getElementById('alertnessChart');
  if(!cv)return;
  if(cv.offsetWidth>0&&cv.width!==cv.offsetWidth){cv.width=cv.offsetWidth;_chartCtx=cv.getContext('2d');}
  const w=cv.width,h=cv.height;
  _chartCtx.clearRect(0,0,w,h);
  if(_chartData.length<2)return;
  _chartCtx.strokeStyle='rgba(255,255,255,0.06)';_chartCtx.lineWidth=1;
  [25,50,75].forEach(y=>{const py=h-(y/100)*h;_chartCtx.beginPath();_chartCtx.moveTo(0,py);_chartCtx.lineTo(w,py);_chartCtx.stroke();});
  for(let i=1;i<_chartData.length;i++){
    const x0=((i-1)/(_chartData.length-1))*w,x1=(i/(_chartData.length-1))*w;
    const y0=h-(_chartData[i-1].v/100)*h,y1=h-(_chartData[i].v/100)*h;
    _chartCtx.strokeStyle=_chartData[i].v>70?'#ff3344':_chartData[i].v>40?'#ffaa00':'#00ff88';
    _chartCtx.lineWidth=2;_chartCtx.beginPath();_chartCtx.moveTo(x0,y0);_chartCtx.lineTo(x1,y1);_chartCtx.stroke();
  }
}

// ── PWA Install Prompt ────────────────────────────────────────────
const _isIOS=(/iphone|ipad|ipod/i).test(navigator.userAgent)&&!window.navigator.standalone;
const _isAndroid=/android/i.test(navigator.userAgent);
const _isStandalone=window.navigator.standalone===true||window.matchMedia('(display-mode:standalone)').matches;

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();window._pwaPrompt=e;
  const b=document.getElementById('pwaInstallBtn');if(b)b.style.display='inline-flex';
});

// Show install button on iOS Safari (no beforeinstallprompt on iOS)
if(_isIOS&&!_isStandalone){
  document.addEventListener('DOMContentLoaded',()=>{
    const b=document.getElementById('pwaInstallBtn');if(b)b.style.display='inline-flex';
  },{once:true});
  if(document.readyState!=='loading'){
    const b=document.getElementById('pwaInstallBtn');if(b)b.style.display='inline-flex';
  }
}

function triggerPWAInstall(){
  if(_isIOS&&!_isStandalone){
    // Show iOS instructions modal
    const m=document.getElementById('iosInstallModal');
    if(m){m.style.display='flex';return;}
  }
  if(!window._pwaPrompt)return;
  window._pwaPrompt.prompt();
  window._pwaPrompt.userChoice.then(r=>{
    if(r.outcome==='accepted')log('PWA installed');
    window._pwaPrompt=null;
    const b=document.getElementById('pwaInstallBtn');if(b)b.style.display='none';
  });
}
function closeIOSInstallModal(){
  const m=document.getElementById('iosInstallModal');if(m)m.style.display='none';
}

// ── Battery Awareness ─────────────────────────────────────────────
if('getBattery' in navigator){
  navigator.getBattery().then(b=>{
    function checkBatt(){
      const badge=document.getElementById('batteryBadge');if(!badge)return;
      if(!b.charging&&b.level<0.2){badge.textContent='🔋 Low Battery — check performance';badge.style.display='inline-flex';}
      else{badge.style.display='none';}
    }
    b.addEventListener('levelchange',checkBatt);b.addEventListener('chargingchange',checkBatt);checkBatt();
  }).catch(()=>{});
}

// ── Patch trigger() to add voice + break check ───────────────────
(function(){
  if(typeof trigger!=='function'||trigger._patched)return;
  const _orig=trigger;
  const _patched=function(reason){
    const previousAlerts=alerts;
    _orig.call(this,reason);
    if(alerts===previousAlerts)return;
    speak(VOICE_MSGS[Math.max(0,Math.min(escalationLevel-1,VOICE_MSGS.length-1))]);
    triggerBreakCheck();
    logEvent('alert',reason||'Fatigue','esc='+escalationLevel);
    queueBackendEvent(reason==='Distraction'?'distracted':'drowsy');
    updateChart(fatigue);
  };
  _patched._patched=true;
  trigger=_patched;
})();

// ── Patch onResults to add yawn/light/tracking ───────────────────
// These are called inside the existing onResults via the injected code above

// ── Periodic updates ────────────────────────────────────────────
setInterval(()=>{
  if(!running)return;
  updateChart(fatigue);
  if(_sessionLog.length>1000)_sessionLog.splice(0,100);logEvent('fatigue',fatigue,'');
},5000);

// Init chart on load
if(document.readyState==='complete'){initChart();}
else{window.addEventListener('load',initChart);}

// Expose globally for inline HTML onclick handlers
window.toggleVoice=toggleVoice;
window.exportCSV=exportCSV;
window.triggerPWAInstall=triggerPWAInstall;
window.dismissBreak=dismissBreak;

render();initCloud();


// ── Sensitivity presets ──────────────────────────────────────────────────
// Presets adjust both default and personalized calibration thresholds.
// Low requires more sustained closure; High triggers earlier.
const SENSITIVITY_PRESETS = {
  low:    { offset: -0.03 },
  medium: { offset: 0 },
  high:   { offset: 0.03 }
};

function applySensitivity(level) {
  level = Object.prototype.hasOwnProperty.call(SENSITIVITY_PRESETS,level) ? level : 'medium';
  const preset = SENSITIVITY_PRESETS[level];
  eyeClosedThreshold = Math.max(.10,Math.min(.25,baseClosedThreshold+preset.offset));
  eyeWatchThreshold  = Math.max(eyeClosedThreshold+.025,Math.min(.31,baseWatchThreshold+preset.offset));
  localStorage.setItem('occulert-sensitivity', level);
  document.querySelectorAll('[data-sensitivity]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sensitivity === level);
  });
}

// Load saved sensitivity on startup
(function initSensitivity() {
  const saved = localStorage.getItem('occulert-sensitivity') || 'medium';
  applySensitivity(saved);
  document.querySelectorAll('[data-sensitivity]').forEach(btn => {
    btn.addEventListener('click', () => applySensitivity(btn.dataset.sensitivity));
  });
})();


// ── Screen-lock / background detection ──────────────────────────────────
(function initVisibilityGuard() {
  const banner = document.getElementById('screenWarning');
  let hiddenWarningShown = false;

  function showWarning() {
    if (banner) banner.style.display = 'block';
    hiddenWarningShown = true;
  }
  function hideWarning() {
    if (banner) banner.style.display = 'none';
    hiddenWarningShown = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Page hidden - record time
      hiddenAt = Date.now();
    } else {
      // Page visible again
      if (hiddenAt && (Date.now() - hiddenAt) > 3000) {
        showWarning();
      } else {
        hideWarning();
      }
      hiddenAt = 0;
    }
  });

  window.addEventListener('focus', hideWarning);
  window.addEventListener('blur', () => { /* no-op, visibilitychange handles it */ });
})();

// Initialize UI state from localStorage
(function(){
  const v=localStorage.getItem('occulert-voice')==='true';
  const btn=document.getElementById('voiceToggleBtn');
  if(btn)btn.textContent=v?'🔊 Voice ON':'🔇 Voice OFF';
  // Initialize chart when DOM ready
  if(document.readyState==='complete'){typeof initChart==='function'&&initChart();}
  else window.addEventListener('load',()=>{typeof initChart==='function'&&initChart();});
})();
