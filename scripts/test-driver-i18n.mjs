import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {parse} from 'acorn';
const read = name => readFileSync(new URL('../'+name,import.meta.url),'utf8');
const context = {module:{exports:{}}};vm.runInNewContext(read('src/driver-i18n.js'),context);
const {english,locales,text} = context.module.exports;
const slots = value => [...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]);
test('eight ordinary locale catalogs have exact key and placeholder parity with English',()=>{
  assert.deepEqual(Object.keys(locales),['en','es','fr','pt','de','ar','zh','ja']);
  assert.equal(Object.keys(locales.en).length,94);assert.equal(Object.keys(english).length,305);
  for(const values of Object.values(locales)) {
    assert.deepEqual(Object.keys(values),Object.keys(locales.en));
    for(const [key,value] of Object.entries(values)) {
      assert.equal(typeof value,'string');assert.ok(value.trim());assert.deepEqual(slots(value),slots(locales.en[key]));
      assert.equal(/<[^>]*>/.test(value),false,'ordinary translations are plain text');
    }
  }
  for(const [key,value] of Object.entries(locales.en))assert.equal(english[key],value);
});
test('protected English source never resolves from ordinary translations',()=>{
  assert.equal(Object.keys(english).filter(key=>!Object.hasOwn(locales.en,key)).length,211);
  for(const locale of Object.keys(locales))for(const [key,value]of Object.entries(english)) {
    if(Object.hasOwn(locales.en,key))continue;
    const params=Object.fromEntries(slots(value).map(key=>[key,key]));
    assert.equal(text(locale,key,params),value.replace(/\{(\w+)\}/g,(_,key)=>key));
  }
  assert.equal(english['driver.language.englishNotice'],'Safety guidance and voice cues remain in English.');
});
test('unsupported locales, keys, bad values and parameters retain safe source fallbacks',()=>{
  assert.equal(text('xx','start.start'),'START MONITORING');
  assert.equal(text('es','unknown',{},'Unchanged fallback'),'Unchanged fallback');
  for(const key of [undefined,null,42,{},Symbol('unsupported')])assert.equal(text('es',key,{},'English fallback'),'English fallback');
  assert.equal(text('ar','camera.numberedFallback',{number:12}),'الكاميرا 12');
  assert.equal(text('es','camera.numberedFallback',{},'Camera unknown'),'Camera unknown');
  assert.equal(text('es','camera.numberedFallback',{number:NaN},'Camera unknown'),'Camera unknown');
  assert.equal(text('es','start.start',null,'START MONITORING'),'START MONITORING');
  // Simulate malformed downloaded data before its immutable maps are frozen.
  for(const replacement of ['null','42','""','"Wrong {changed}"']) {
    const broken={module:{exports:{}}};
    const source=read('src/driver-i18n.js').replace('"driver.camera.numberedFallback": "Cámara {number}"','"driver.camera.numberedFallback": '+replacement);
    assert.notEqual(source,read('src/driver-i18n.js'));
    vm.runInNewContext(source,broken);
    assert.equal(broken.module.exports.text('es','camera.numberedFallback',{number:2}),'Camera 2');
  }
});
test('chart scheduling retains both initializations and distinct pending listeners',()=>{
  const source=read('src/driver-app.js'), ast=parse(source,{ecmaVersion:2022,sourceType:'module'});
  const declaration=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='chartUi');
  const calls=ast.body.filter(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression'&&node.expression.callee.name==='chartUi');
  assert.equal(calls.length,2);
  for(const readyState of ['loading','complete']) {
    let count=0;const callbacks=[];
    const sandbox={document:{readyState},window:{addEventListener:(name,fn)=>{assert.equal(name,'load');callbacks.push(fn);}},initChart:()=>count++};
    vm.runInNewContext(source.slice(declaration.start,declaration.end)+';chartUi();chartUi();',sandbox);
    if(readyState==='loading'){assert.equal(count,0);assert.equal(callbacks.length,2);assert.notEqual(callbacks[0],callbacks[1]);callbacks.forEach(fn=>fn());}
    assert.equal(count,2);
  }
});
test('raw telemetry, device identifiers and safety decisions remain outside catalog bindings',()=>{
  const source=read('src/driver-i18n.js');
  assert.match(read('src/metrics.js'),/Number\(perclosEl.textContent.replace\('%', ''\)\)/);
  assert.equal(source.includes("['#perclos','"),false);
  assert.equal(source.includes('Intl.NumberFormat'),false);
  assert.equal(read('src/alerts.js').includes("u.lang = 'en-US'"),true);
  assert.match(read('src/detector.js'),/uiText\(startBtn, 'start.start', 'START MONITORING'\)/);
  assert.match(read('src/camera.js'),/if \(!String\(device.label \|\| ''\).trim\(\)\) uiText/);
});

test('core keyed reads tolerate absent, malformed and throwing optional APIs',()=>{
  const source=read('src/ui.js'),ast=parse(source,{ecmaVersion:2022,sourceType:'module'});
  const node=ast.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.id?.name==='uiText').declaration;
  for(const api of [undefined,{}, {get:42}, {get:()=>42},{get:()=>({})},{get:()=>''},{get:()=>{throw Error('Unavailable');}},{get:()=> 'Iniciar'}]) {
    const element={textContent:'',dataset:{}},window={OcculertDriverI18n:api};
    vm.runInNewContext(source.slice(node.start,node.end)+';uiText(element,"start.start","START MONITORING");',{window,element});
    assert.equal(element.textContent,api?.get?.toString?.().includes('Iniciar')?'Iniciar':'START MONITORING');
    assert.deepEqual(JSON.parse(element.dataset.driverText),['start.start',null]);
  }
});

function sourceFunctions(path, names) {
  const source=read(path),ast=parse(source,{ecmaVersion:2022,sourceType:'module'});
  return names.map(name=>{
    const node=ast.body.map(node=>node.declaration||node).find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);
    assert.ok(node,`${path}: actual ${name} declaration`);
    return source.slice(node.start,node.end);
  }).join('\n');
}

test('all eight catalogs expose distinct eye visibility labels without translating the driving-safety hint',()=>{
  const labels={
    'badge.eyesDetected':'✓ Eyes detected',
    'badge.eyesNotVisible':"⚠️ Can't see your eyes",
    'badge.noFace':'⚠️ No face in view',
    'state.eyesDetected':'EYES DETECTED',
    'state.eyesNotVisible':'EYES NOT VISIBLE',
    'state.noFace':'NO FACE',
  };
  for(const [key,value] of Object.entries(labels))assert.equal(text('en',key),value);
  for(const locale of Object.keys(locales)) {
    for(const [key,value] of Object.entries(labels)) {
      assert.equal(text(locale,key),locales[locale]['driver.'+key]);
      if(locale!=='en')assert.notEqual(text(locale,key),value,`${locale}: translated ${key}`);
    }
    assert.equal(new Set(Object.keys(labels).filter(key=>key.startsWith('state.')).map(key=>text(locale,key))).size,3);
    assert.equal(text(locale,'hint.active'),'Camera tracking is active. Stay alert; this does not mean it is safe to drive.');
  }
});

test('actual onResults distinguishes absent face and invalid EAR without changing the strict EAR bounds',()=>{
  const calls=[],context={signalDetectionResult(){},running:true,experimentController:null,experimentFlags:{},ctx:{clearRect(){}},canvas:{width:10,height:10},updateScore(){},updateTrackingState:(...args)=>calls.push(args),render(){},LEFT:[],RIGHT:[],calcEAR:()=>context.ear,smooth:value=>value,headTurn:()=>false,detectHeadNod:()=>false,calibrating:false,detectYawn(){},document:{getElementById:()=>null,querySelector:()=>null},drawEyes(){},fatigue:0,confidence:0,turnedSince:0,scoringAlertCandidate:()=>null};
  vm.runInNewContext(sourceFunctions('src/metrics.js',['onResults']),context);
  context.onResults({multiFaceLandmarks:[]});
  assert.deepEqual(calls.pop(),[false,false,'no-face']);
  for(const ear of [NaN,Infinity,-Infinity,.05,.65,0,.7,.0501,.28,.6499]) {
    context.ear=ear;context.onResults({multiFaceLandmarks:[[{},{},{},{},{y:.5}]]});
    const valid=Number.isFinite(ear)&&ear>.05&&ear<.65;
    assert.deepEqual(calls.pop(),[true,valid,valid?null:'eyes-not-visible']);
  }
  context.running=false;context.onResults({multiFaceLandmarks:[]});assert.equal(calls.length,0);
});

test('actual tracking badge retains its three-second loss delay, exact colors and immediate recovery in every locale',()=>{
  for(const locale of Object.keys(locales)) {
    const badge={textContent:'',dataset:{},style:{}},context={now:10000,_trackLostSince:0,eyeLoss:null,document:{getElementById:()=>badge},Date:{now:()=>context.now},window:{OcculertDriverI18n:{get:key=>text(locale,key)}},set_eyeLoss:value=>context.eyeLoss=value,set__trackLostSince:value=>context._trackLostSince=value,warnTrackingLoss(){}};
    vm.runInNewContext(sourceFunctions('src/ui.js',['uiText'])+'\n'+sourceFunctions('src/metrics.js',['updateTrackingState']),context);
    context.updateTrackingState(true,true,null);
    assert.equal(badge.textContent,text(locale,'badge.eyesDetected'));assert.equal(badge.style.color,'#00ff88');
    context.now=11000;context.updateTrackingState(true,false,'eyes-not-visible');
    assert.equal(context.eyeLoss,'eyes-not-visible');assert.equal(badge.textContent,text(locale,'badge.eyesDetected'));
    context.now=14000;context.updateTrackingState(true,false,'eyes-not-visible');
    assert.equal(badge.textContent,text(locale,'badge.eyesDetected'),'exactly three seconds is still delayed');
    context.now=14001;context.updateTrackingState(true,false,'eyes-not-visible');
    assert.equal(badge.textContent,text(locale,'badge.eyesNotVisible'));assert.equal(badge.style.color,'#ffaa00');assert.equal(badge.style.display,'inline-flex');
    context.now=14002;context.updateTrackingState(false,false,'no-face');
    assert.equal(badge.textContent,text(locale,'badge.noFace'));assert.equal(context._trackLostSince,11000,'a changed loss reason does not restart the delay');
    context.updateTrackingState(true,true,null);
    assert.equal(context.eyeLoss,null);assert.equal(context._trackLostSince,0);assert.equal(badge.textContent,text(locale,'badge.eyesDetected'));assert.equal(badge.style.color,'#00ff88');
    context.now=15000;context.updateTrackingState(false,false);
    context.now=18001;context.updateTrackingState(false,false);
    assert.equal(badge.textContent,text(locale,'badge.noFace'),'two-argument experimental bridge stays compatible');
    context.document.getElementById=()=>null;context.updateTrackingState(true,false,'eyes-not-visible');
    assert.equal(context.eyeLoss,'eyes-not-visible','display state is recorded even without a badge element');
  }
});

test('actual state rendering preserves fatigue, calibration and observer priorities and clears stale translated bindings',()=>{
  const element=()=>({textContent:'',dataset:{},style:{},lang:'',dir:''});
  const context={startupAllowsMonitoring:()=>true,Date:{now:()=>10000},lastRender:0,RENDER_INTERVAL:0,fatigue:0,confidence:80,calibrated:true,calibrating:false,running:true,noFaceSince:0,eyeLoss:null,cloudConsent:{checked:false},cloudReady:false,escalationLevel:0,experimentFlags:{observer:false},window:{OcculertDriverI18n:{get:key=>text('es',key)}},pushFleet(){}};
  for(const name of ['fatigueEl','fatigueFill','confidenceEl','confidenceFill','earEl','calibrationEl','calibrationFill','faceStateEl','riskEl','riskDetailEl','syncEl','escalationEl','driveStateEl','driveHintEl','statusEl','stateCard'])context[name]=element();
  vm.runInNewContext(sourceFunctions('src/ui.js',['uiText','uiState','render'])+'\n'+sourceFunctions('src/metrics.js',['riskText']),context);
  context.render(.28);assert.equal(context.driveStateEl.textContent,text('es','state.eyesDetected'));assert.equal(context.statusEl.textContent,text('es','state.eyesDetected'));assert.match(context.driveHintEl.textContent,/does not mean it is safe to drive/);
  for(const [fatigue,label] of [[40,'WATCH'],[65,'HIGH'],[85,'ALERT']]) {
    context.fatigue=fatigue;context.render(.28);assert.equal(context.driveStateEl.textContent,label);assert.equal(context.driveStateEl.dataset.driverText,undefined);assert.equal(context.driveStateEl.lang,'en');
  }
  context.fatigue=0;context.calibrating=true;context.render(.28);assert.equal(context.driveStateEl.textContent,'CALIBRATING');
  context.calibrating=false;context.experimentFlags.observer=true;context.render(.28);assert.equal(context.driveStateEl.textContent,'PARKED OBSERVER SESSION');
  context.experimentFlags.observer=false;context.eyeLoss='eyes-not-visible';context.render(.001);assert.equal(context.driveStateEl.textContent,text('es','state.eyesNotVisible'));assert.match(context.driveHintEl.textContent,/Alerts may be missed/);
  context.noFaceSince=9000;context.eyeLoss='no-face';context.render(.001);assert.equal(context.driveStateEl.textContent,text('es','state.noFace'));
  context.running=false;context.render(.001);assert.equal(context.driveStateEl.textContent,'NOT MONITORING');assert.equal(context.statusEl.dataset.driverText,undefined);assert.equal(context.statusEl.lang,'en');
});
