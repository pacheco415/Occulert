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
  assert.equal(Object.keys(locales.en).length,88);assert.equal(Object.keys(english).length,299);
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
