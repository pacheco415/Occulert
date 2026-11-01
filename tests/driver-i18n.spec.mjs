import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import vm from 'node:vm';
const box={module:{exports:{}}};vm.runInNewContext(readFileSync(new URL('../src/driver-i18n.js',import.meta.url),'utf8'),box);
const values=JSON.parse(JSON.stringify(box.module.exports.locales));
const t=(locale,key)=>values[locale]['driver.'+key];
const manifest=JSON.parse(readFileSync(new URL('../asset-versions.json',import.meta.url),'utf8'));
const catalog='/'+manifest['driver-i18n.js'];
async function ready(page,locale='en',storageDenied=false,url='/app.html') {
  await page.addInitScript(({locale,storageDenied})=>{
    localStorage.setItem('occulert_lang',locale);
    localStorage.setItem('occulert-driver-id','local-i18n');
    localStorage.setItem('occulert-session-history','[]');
    if(storageDenied)Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Denied','SecurityError');}});
  },{locale,storageDenied});
  await page.goto(url);await expect(page.locator('#startBtn')).toBeEnabled();
}
for(const locale of ['es','ar'])test(`${locale} ordinary UI, attributes, dynamic states and repeated switches at mobile width`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await ready(page,locale);
  await expect(page.locator('#driverPanelTitle')).toHaveText(t(locale,'panel.title'));
  await expect(page.locator('#driverPanel')).toHaveAttribute('aria-label',t(locale,'panel.accessible'));
  await expect(page.locator('#driverPanel')).toHaveAttribute('lang',locale);
  await expect(page.locator('#driverControls')).toHaveAttribute('lang',locale);
  await expect(page.locator('#parkedControls > p.small').first()).toHaveAttribute('lang','en');
  await expect(page.locator('.privacy-card')).toHaveAttribute('lang','en');
  await expect(page.locator('#intensityToggle')).toHaveAttribute('aria-label',t(locale,'display.changeAccessible'));
  await expect(page.locator('#overviewLastSession')).toHaveText(t(locale,'overview.empty'));
  await expect(page.locator('#driverLanguage')).toBeVisible();
  for(const selector of ['#driverLanguage','#cameraSourceSelect','#nightOpacity','#feedbackNote','input[name="alertReview"]'])
    for(const control of await page.locator(selector).all())await expect(control).toHaveAttribute('lang',locale);
  await expect(page.locator('title')).toHaveAttribute('lang','en');
  await expect(page).toHaveTitle('Occulert — AI Drowsiness Detection');
  await page.locator('#nightOpacity').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#nightOpacity')).toHaveValue('73');await expect(page.locator('#nightVal')).toHaveText('73%');
  await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');
  await page.locator('#presetBright').click();
  await expect(page.locator('#intensityLabel')).toHaveText(t(locale,'display.bright'));
  await expect(page.locator('#intensityToggle')).toHaveAttribute('title',t(locale,'display.currentTitle').replace('{intensityLabel}',t(locale,'display.bright')));
  await page.locator('#voiceToggleBtn').click();
  await expect(page.locator('#voiceToggleBtn')).toHaveText(t(locale,'voice.on'));
  // Re-created options bind only generated captions. Real hardware names/IDs stay raw.
  await page.evaluate(async()=>{
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{enumerateDevices:async()=>[{kind:'videoinput',deviceId:'raw-1',label:''},{kind:'videoinput',deviceId:'raw-2',label:'Raw Camera العربية'}]}});
    cameraLabelsRevealed=true;await refreshCameraChoices();
  });
  await expect(page.locator('#cameraSourceSelect option[value="raw-1"]')).toHaveText(t(locale,'camera.numberedFallback').replace('{number}','1'));
  await expect(page.locator('#cameraSourceSelect option[value="raw-2"]')).toHaveText('Raw Camera العربية');
  await page.locator('#cameraSourceSelect').selectOption('raw-2');
  expect(await page.evaluate(()=>localStorage.getItem('occulert-camera-device-id'))).toBe('raw-2');
  await page.evaluate(()=>{document.getElementById('feedbackCard').hidden=false;document.getElementById('feedbackForm').dispatchEvent(new Event('submit',{cancelable:true}));});
  await expect(page.locator('#feedbackStatus')).toHaveText(t(locale,'feedback.chooseReview'));
  await page.evaluate(()=>{document.getElementById('feedbackStatus').textContent='Review could not be saved. Your original session has not been changed.';});
  await expect(page.locator('#feedbackStatus')).toHaveText('Review could not be saved. Your original session has not been changed.');
  for(const next of ['en',locale,'fr',locale]) {
    await page.locator('#driverLanguage').selectOption(next);
    await expect(page.locator('#driverPanelTitle')).toHaveText(t(next,'panel.title'));
    await expect(page.locator('#voiceToggleBtn')).toHaveText(t(next,'voice.on'));
    await expect(page.locator('#feedbackStatus')).toHaveText('Review could not be saved. Your original session has not been changed.');
  }
  expect(await page.evaluate(()=>localStorage.getItem('occulert_lang'))).toBe(locale);
  await page.evaluate(()=>{document.getElementById('feedbackStatus').textContent='';});
  await page.locator('#driverLanguage').selectOption('en');
  await page.locator('#driverLanguage').selectOption(locale);
  await expect(page.locator('#feedbackStatus')).toHaveText('');
  await expect(page.locator('#driverSafetyNotice')).toHaveAttribute('lang','en');
  await expect(page.locator('#driverSafetyNotice')).toContainText('supplemental prototype only');
  await expect(page.locator('#overlayText')).toContainText('Keep your eyes on the road');
  await expect(page.locator('#driveState')).toHaveText('NOT MONITORING');
  const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,picker:document.getElementById('driverLanguage').getBoundingClientRect().toJSON()}));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);expect(sizes.picker.height).toBeGreaterThanOrEqual(44);
  await page.reload();await expect(page.locator('#driverPanelTitle')).toHaveText(t(locale,'panel.title'));
  // Exercise the actual local lifecycle; replace only physical model/camera bridges.
  await page.evaluate(()=>{
    initModel=()=>new Promise(resolve=>window.__releaseLocaleModel=resolve);
    openSelectedCamera=async()=>{
      const track=new EventTarget();track.readyState='live';track.muted=false;track.getSettings=()=>({deviceId:'raw-2'});track.stop=()=>{track.readyState='ended';};
      const stream=new MediaStream();stream.getTracks=()=>[track];stream.getVideoTracks=()=>[track];return stream;
    };
    verifyFirstInference=async()=>{};video.play=async()=>{};loop=()=>{};gpsConsent.checked=false;cloudConsent.checked=false;
  });
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText(t(locale,'start.starting'));
  await expect(page.locator('#startBtn')).toBeDisabled();await expect(page.locator('#driverLanguage')).toBeHidden();
  await page.evaluate(()=>window.__releaseLocaleModel());
  await expect(page.locator('#startBtn')).toHaveText(t(locale,'start.stop'));
  await page.locator('#startBtn').click();await expect(page.locator('#startBtn')).toHaveText(t(locale,'start.start'));
  await expect(page.locator('#driverLanguage')).toBeVisible();await expect(page.locator('#report')).toContainText('OCCULERT SESSION REPORT');
  await page.evaluate(async()=>{running=true;await haltForDetectionFailure(new Error('Locale detector recovery fixture'));});
  await expect(page.locator('#startBtn')).toHaveText(t(locale,'start.start'));
  await expect(page.locator('#startBtn')).toBeEnabled();await expect(page.locator('#overlayTitle')).toHaveText('AI Monitoring Unavailable');
  await page.locator('#driverLanguage').selectOption('en');await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await page.locator('#driverLanguage').selectOption(locale);await expect(page.locator('#startBtn')).toHaveText(t(locale,'start.start'));
  await expect(page.locator('#driveHint')).toHaveText('AI monitoring stopped. Pull over safely before restarting.');
});
test('Arabic display retains ASCII telemetry, report and feedback data',async({page})=>{
  await ready(page,'ar');await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  const result=await page.evaluate(()=>{
    perclosEl.textContent='12.5%';confidence=52;fatigue=37;
    document.getElementById('feedbackNote').value='raw user note العربية 12.5%';
    return {payload:fleetPayload(),perclos:perclosEl.textContent,note:document.getElementById('feedbackNote').value,values:[...document.querySelectorAll('[name="alertReview"]')].map(node=>node.value)};
  });
  expect(result.perclos).toBe('12.5%');expect(result.payload.perclos).toBe(12.5);expect(result.payload.fatigue).toBe(37);expect(result.payload.confidence).toBe(52);expect(result.payload.status).toBe('WATCH');
  expect(result.note).toBe('raw user note العربية 12.5%');expect(result.values).toEqual(['useful','unnecessary','missed','late','not_assessed']);
  await page.locator('#driverLanguage').selectOption('es');await page.locator('#driverLanguage').selectOption('ar');
  await expect(page.locator('#perclos')).toHaveText('12.5%');
});
test('English startup makes no optional catalog request even with a non-English browser locale',async({browser})=>{
  const context=await browser.newContext({locale:'es-ES',serviceWorkers:'block'}),page=await context.newPage(),requests=[];
  page.on('request',request=>{if(request.url().includes('driver-i18n.'))requests.push(request.url());});
  try {await ready(page,'en');await expect(page.locator('#driverPanelTitle')).toHaveText('Driver monitoring');expect(requests).toEqual([]);expect(await page.evaluate(()=>window.OcculertDriverI18n)).toBeUndefined();
    for(const unsupported of ['xx','constructor']) {await page.evaluate(value=>OcculertLang.setLang(value),unsupported);await expect(page.locator('html')).toHaveAttribute('lang','en');await expect(page.locator('#driverLanguage')).toHaveValue('en');}
    expect(requests).toEqual([]);}
  finally{await context.close();}
});
for(const mode of ['missing','corrupt','offline'])test(`${mode} optional catalog leaves English monitoring controls usable`,async({page})=>{
  await page.route('**'+catalog,route=>mode==='corrupt'?route.fulfill({contentType:'application/javascript',body:'window.__untrustedCatalogRan=true;'}):route.abort(mode==='offline'?'internetdisconnected':'failed'));
  await ready(page,'ar');await expect(page.locator('#driverPanelTitle')).toHaveText('Driver monitoring');
  await page.locator('#presetDim').click();await expect(page.locator('#intensityLabel')).toHaveText('Dim');
  await page.locator('#voiceToggleBtn').click();await expect(page.locator('#voiceToggleBtn')).toHaveText('🔊 Voice ON');
  await expect(page.locator('#startBtn')).toBeEnabled();expect(await page.evaluate(()=>window.__untrustedCatalogRan)).toBeUndefined();
});
test('late catalog uses the current language and current state, never an old validation',async({page})=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**'+catalog,async route=>{await gate;await route.continue();});
  await page.addInitScript(()=>localStorage.setItem('occulert_lang','es'));
  await page.goto('/app.html',{waitUntil:'domcontentloaded'});await expect(page.locator('#startBtn')).toBeEnabled();
  await page.evaluate(()=>{
    document.getElementById('feedbackForm').dispatchEvent(new Event('submit',{cancelable:true}));
    document.getElementById('feedbackStatus').textContent='Your review has been saved on this device.';
    OcculertLang.setLang('ar');toggleVoice();applyIntensity('dim');
  });release();
  await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  await expect(page.locator('#voiceToggleBtn')).toHaveText(t('ar','voice.on'));
  await expect(page.locator('#intensityLabel')).toHaveText(t('ar','display.dim'));
  await expect(page.locator('#feedbackStatus')).toHaveText('Your review has been saved on this device.');
});
test('denied storage preserves the in-memory picker and English monitoring fallback',async({page})=>{
  await ready(page,'en',true);await page.locator('#driverLanguage').selectOption('es');
  await expect(page.locator('#driverPanelTitle')).toHaveText(t('es','panel.title'));
  await expect(page.locator('#preferenceStorageNotice')).toHaveText(t('es','preferences.notSaved'));
  await page.locator('#driverLanguage').selectOption('ar');await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  await expect(page.locator('#startBtn')).toBeEnabled();
});
test('non-driver language translation keeps its existing page behavior',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('occulert_lang','en'));
  await page.goto('/features.html');
  expect(await page.locator('.lang-switcher').count()).toBeGreaterThan(0);
  await page.evaluate(()=>OcculertLang.setLang('es'));await expect(page.locator('html')).toHaveAttribute('lang','es');
  const nav=page.locator('[data-i18n="nav_features"]').first();
  await expect(nav).toHaveText('Características');
  const translated=await nav.innerText();
  await page.evaluate(()=>OcculertLang.setLang('en'));expect(await nav.innerText()).not.toBe(translated);
});

test('English-only stopped-state ownership survives late catalog arrival and switches',async({page})=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**'+catalog,async route=>{await gate;await route.continue();});
  await page.addInitScript(()=>localStorage.setItem('occulert_lang','ar'));
  await page.goto('/app.html',{waitUntil:'domcontentloaded'});await expect(page.locator('#startBtn')).toBeEnabled();
  await page.evaluate(()=>{document.getElementById('startBtn').textContent='APP UNAVAILABLE';document.getElementById('startBtn').disabled=true;});release();
  await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  await expect(page.locator('#startBtn')).toHaveText('APP UNAVAILABLE');
  await page.locator('#driverLanguage').selectOption('es');await page.locator('#driverLanguage').selectOption('ar');
  await expect(page.locator('#startBtn')).toHaveText('APP UNAVAILABLE');await expect(page.locator('#startBtn')).toBeDisabled();await expect(page.locator('#startBtn')).toHaveAttribute('lang','en');
});
test('dynamic overview states translate without changing dates, counts or saved history',async({page})=>{
  await ready(page,'ar');await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  const raw=await page.evaluate(()=>{
    const rows=[{driverId:'local-i18n',startedAt:new Date(Date.now()-600000).toISOString(),endedAt:null,alerts:null}];
    localStorage.setItem('occulert-session-history',JSON.stringify(rows));document.getElementById('overviewRefresh').click();return JSON.stringify(rows);
  });
  await expect(page.locator('#overviewMinutes')).toHaveText(t('ar','overview.unavailable'));
  await expect(page.locator('#overviewAlerts')).toHaveText(t('ar','overview.unavailable'));
  await expect(page.locator('#overviewSessions')).toHaveText('1');
  const date=await page.evaluate(()=>new Date(JSON.parse(localStorage.getItem('occulert-session-history'))[0].startedAt).toLocaleString());
  await expect(page.locator('#overviewLastSession')).toHaveText(t('ar','overview.latest').replace('{startedAt}',date));
  await page.locator('#driverLanguage').selectOption('es');
  await expect(page.locator('#overviewLastSession')).toHaveText(t('es','overview.latest').replace('{startedAt}',date));
  expect(await page.evaluate(()=>localStorage.getItem('occulert-session-history'))).toBe(raw);
  await page.evaluate(()=>{localStorage.setItem('occulert-session-history','broken');document.getElementById('overviewRefresh').click();});
  await expect(page.locator('#overviewLastSession')).toHaveText(t('es','overview.readUnavailable'));
  await page.locator('#driverLanguage').selectOption('ar');
  await page.evaluate(()=>{localStorage.setItem('occulert-session-history',JSON.stringify([{driverId:'local-i18n',startedAt:new Date(Date.now()-600000).toISOString(),endedAt:new Date().toISOString(),alerts:2}]));document.getElementById('overviewRefresh').click();});
  await expect(page.locator('#overviewMinutes')).toHaveText('10');await expect(page.locator('#overviewAlerts')).toHaveText('2');
  for(const id of ['overviewSessions','overviewMinutes','overviewAlerts']) {
    await expect(page.locator('#'+id)).toHaveAttribute('lang','en');await expect(page.locator('#'+id)).toHaveAttribute('dir','ltr');
  }
});

test('stalled optional catalog starts after base load and cannot delay either chart initialization',async({page})=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**'+catalog,async route=>{await gate;await route.continue();});
  await page.addInitScript(()=>{
    localStorage.setItem('occulert_lang','es');window.__chartInitializations=0;
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(...args){if(this.id==='alertnessChart')window.__chartInitializations++;return original.apply(this,args);};
  });
  try {
    await page.goto('/app.html',{waitUntil:'load'});
    await expect(page.locator('#startBtn')).toBeEnabled();
    const state=await page.evaluate(()=>({readyState:document.readyState,count:window.__chartInitializations,loaded:Boolean(window.OcculertDriverI18n)}));
    expect(state).toEqual({readyState:'complete',count:2,loaded:false});
    await expect(page.locator('#driverPanelTitle')).toHaveText('Driver monitoring');
  } finally {release();}
  await expect(page.locator('#driverPanelTitle')).toHaveText(t('es','panel.title'));
});

test.describe('optional catalog worker integrity',()=>{
  test.use({serviceWorkers:'allow'});
  test('default install excludes catalog; verified cached translations work offline and corrupt cache falls back to English',async({page})=>{
    test.setTimeout(90000);
    const root=resolve('.'),state={offline:false};
    const server=createServer((request,response)=>{
      if(state.offline){response.destroy();return;}
      const path=new URL(request.url,'http://localhost').pathname;
      const file=resolve(root,path==='/'?'index.html':path.slice(1));
      if(!file.startsWith(root+'/')||!existsSync(file)){response.statusCode=404;response.end();return;}
      response.setHeader('Cache-Control','no-store');
      response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'})[extname(file)]||'application/octet-stream');
      response.end(readFileSync(file));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    try {
    await ready(page,'en',false,origin+'/app.html');
    await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
    await page.reload();await expect(page.locator('#startBtn')).toBeEnabled();
    await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
    const cacheName=await page.evaluate(async()=>{const names=await caches.keys();return names.find(name=>/^occulert-v\d+$/.test(name));});
    expect(cacheName).toBeTruthy();
    expect(await page.evaluate(async({cacheName,catalog})=>Boolean(await(await caches.open(cacheName)).match(catalog)),{cacheName,catalog})).toBe(false);
    await page.locator('#driverLanguage').selectOption('ar');await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
    await expect.poll(()=>page.evaluate(async({cacheName,catalog})=>Boolean(await(await caches.open(cacheName)).match(catalog)),{cacheName,catalog})).toBe(true);
    await page.locator('#driverLanguage').selectOption('en');await page.reload();await expect(page.locator('#startBtn')).toBeEnabled();
    state.offline=true;
    try {
      await page.locator('#driverLanguage').selectOption('es');await expect(page.locator('#driverPanelTitle')).toHaveText(t('es','panel.title'));
      await page.locator('#driverLanguage').selectOption('en');await page.reload();await expect(page.locator('#startBtn')).toBeEnabled();
      await page.evaluate(async({cacheName,catalog})=>{await(await caches.open(cacheName)).put(catalog,new Response('window.__corruptCatalogRan=true;',{headers:{'Content-Type':'application/javascript'}}));},{cacheName,catalog});
      await page.locator('#driverLanguage').selectOption('ar');
      await expect.poll(()=>page.evaluate(async({cacheName,catalog})=>Boolean(await(await caches.open(cacheName)).match(catalog)),{cacheName,catalog})).toBe(false);
      await expect(page.locator('#driverPanelTitle')).toHaveText('Driver monitoring');await expect(page.locator('#startBtn')).toBeEnabled();
      expect(await page.evaluate(()=>window.__corruptCatalogRan)).toBeUndefined();
    } finally {state.offline=false;}
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
});

test('Arabic stopped report stays frozen English and real feedback outcomes replace old ordinary validation',async({page})=>{
  await ready(page,'ar');await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  await page.evaluate(async()=>{
    running=true;sessionStart=Date.now()-65000;localSessionId='i18n-stopped-record';perclosEl.textContent='12.5%';
    await localLifecycle.stopLocalSession();
  });
  await expect(page.locator('#report')).toContainText('OCCULERT SESSION REPORT\n\nStatus: SAFE');
  await expect(page.locator('#report')).toContainText('PERCLOS: 12.5%');
  await expect(page.locator('#report')).toContainText('Safety and liability: Occulert is a supplemental prototype only.');
  await expect(page.locator('#overlayText')).toContainText('Keep your attention on the road');
  await page.evaluate(()=>document.getElementById('feedbackForm').dispatchEvent(new Event('submit',{cancelable:true})));
  await expect(page.locator('#feedbackStatus')).toHaveText(t('ar','feedback.chooseReview'));
  await page.locator('[name="alertReview"][value="useful"]').check();
  await page.locator('#feedbackNote').fill('raw note العربية 12.5%');
  await page.locator('#feedbackForm button[type="submit"]').click();
  const success='Review saved in this browser. It is a personal observation, not a measured detection accuracy result.';
  await expect(page.locator('#feedbackStatus')).toHaveText(success);
  const raw=await page.evaluate(()=>JSON.parse(localStorage.getItem('occulert-session-history')).find(row=>row.sessionId==='i18n-stopped-record'||row.id==='i18n-stopped-record'));
  expect(raw.alertReview).toBe('useful');expect(raw.alertReviewNote).toBe('raw note العربية 12.5%');expect(raw.perclos).toBe(12.5);
  await page.locator('#driverLanguage').selectOption('es');await page.locator('#driverLanguage').selectOption('ar');await expect(page.locator('#feedbackStatus')).toHaveText(success);
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='occulert-session-history')throw new DOMException('Denied','SecurityError');return original.call(this,key,value);};});
  await page.locator('#feedbackForm button[type="submit"]').click();
  const failure='Review could not be saved on this device. Try again while parked.';
  await expect(page.locator('#feedbackStatus')).toHaveText(failure);
  await page.locator('#driverLanguage').selectOption('es');await page.locator('#driverLanguage').selectOption('ar');await expect(page.locator('#feedbackStatus')).toHaveText(failure);
});

test('Arabic ordinary controls retain English en-US spoken and rest-stop cues',async({page})=>{
  await page.addInitScript(()=>{
    window.__catalogSpeech=[];
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{paused:false,resume(){},cancel(){},speak(utterance){window.__catalogSpeech.push({text:utterance.text,lang:utterance.lang});}}});
    window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;this.lang=navigator.language;}};
  });
  await ready(page,'ar');await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  await page.locator('#voiceToggleBtn').click();await expect(page.locator('#voiceToggleBtn')).toHaveText(t('ar','voice.on'));
  await page.evaluate(()=>{speak(VOICE_MSGS[0]);running=true;sessionStart=Date.now()-40*60000;_lastBreakPrompt=0;triggerBreakCheck();running=false;});
  await expect(page.locator('#breakBanner')).toContainText('Rest Stop Recommended — 40 min driving, 0 alerts, 0 yawns.');
  await expect(page.locator('#breakBanner button')).toHaveText(t('ar','break.dismiss'));
  expect(await page.evaluate(()=>window.__catalogSpeech)).toEqual([{text:'Pull over safely',lang:'en-US'},{text:'Rest stop recommended. Please pull over safely and take a break.',lang:'en-US'}]);
  await page.locator('#breakBanner button').click();await expect(page.locator('#breakBanner')).toBeHidden();
});

test('English-only detector recovery preserves the exact original restart caption',async({page})=>{
  await ready(page,'en');expect(await page.evaluate(()=>window.OcculertDriverI18n)).toBeUndefined();
  await page.evaluate(async()=>{running=true;await haltForDetectionFailure(new Error('English detector recovery fixture'));});
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');await expect(page.locator('#startBtn')).toBeEnabled();
  await expect(page.locator('#driveHint')).toHaveText('AI monitoring stopped. Pull over safely before restarting.');
});
test('raw frame metrics and logs never trigger a catalog binding sweep',async({page})=>{
  await ready(page,'ar');await expect(page.locator('#driverPanelTitle')).toHaveText(t('ar','panel.title'));
  const counts=await page.evaluate(async()=>{
    const original=document.querySelector;let sweeps=0;
    document.querySelector=function(selector){if(selector==='#driverPanelTitle')sweeps++;return original.call(this,selector);};
    try {
      OcculertDriverI18n.setLang('ar');const positive=sweeps;sweeps=0;
      for(let i=0;i<10;i++){perclosEl.textContent=i+'%';fatigueEl.textContent=String(i);confidenceEl.textContent=i+'%';log('Raw frame '+i);}
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return {positive,raw:sweeps,perclos:perclosEl.textContent};
    } finally {document.querySelector=original;}
  });
  expect(counts.positive).toBeGreaterThan(0);expect(counts.raw).toBe(0);expect(counts.perclos).toBe('9%');
});
