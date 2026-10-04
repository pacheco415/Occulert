import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from 'parse5';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const assets = JSON.parse(readFileSync(resolve(root, 'asset-versions.json'), 'utf8'));
const driverSource = readFileSync(resolve(root, assets['driver-app.js']), 'utf8');
const driverPattern = /\/driver-app\.v\d+\.js(?:\?.*)?$/;

async function installPrivacyProbe(page, storageFailure = null) {
  await page.addInitScript(storageFailure => {
    const documentId = Number(sessionStorage.getItem('startup-test-document') || '0') + 1;
    sessionStorage.setItem('startup-test-document', String(documentId));
    window.__startupProbe = { documentId, cameraCalls: 0, modelCalls: 0, cloudCalls: [], partialExecutions: 0,
      storageFailures: 0, handlerBoundAtStorageFailure: null };
    if (storageFailure) {
      const getItem = Storage.prototype.getItem;
      let matchingReads = 0;
      Storage.prototype.getItem = function(key) {
        // Only the selected local preference fails; the document counter and
        // all other storage remain usable so the failure has a precise stage.
        if (this === localStorage && key === storageFailure.key && ++matchingReads === storageFailure.occurrence) {
          window.__startupProbe.storageFailures++;
          window.__startupProbe.handlerBoundAtStorageFailure = typeof document.getElementById('startBtn')?.onclick === 'function';
          throw new DOMException('Injected local preference read failure', 'SecurityError');
        }
        return getItem.call(this, key);
      };
    }
    const devices = new EventTarget();
    devices.enumerateDevices = async () => [];
    devices.getUserMedia = async () => {
      window.__startupProbe.cameraCalls++;
      throw new Error('Camera access must not occur during app startup');
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) window.__startupProbe.cloudCalls.push(url.pathname);
      return fetch(input, options);
    };
  }, storageFailure);
}

async function driverRoute(page, initialMode) {
  let mode = initialMode, count = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(driverPattern, async route => {
    count++;
    const requestedMode = mode;
    if (requestedMode === 'held') await held;
    if (requestedMode === 'failed') { await route.abort('failed'); return; }
    let body = driverSource;
    if (requestedMode === 'malformed') body = 'function malformedDriverStartup( {';
    if (requestedMode === 'partial') {
      const cutoff = driverSource.indexOf('const recalBtn=');
      expect(cutoff).toBeGreaterThan(0);
      // Keep the real Start/Space handlers but omit the later initialization
      // and explicit end-of-file handshake. Function presence alone is unsafe.
      body = 'window.__startupProbe.partialExecutions++;\n' + driverSource.slice(0, cutoff)
        + '\ninitModel=async function(){window.__startupProbe.modelCalls++;};\n';
    }
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  return { get count() { return count; }, setMode(value) { mode = value; }, release };
}

async function expectNoPermissionedWork(page) {
  expect(await page.evaluate(() => ({ camera: window.__startupProbe.cameraCalls, model: window.__startupProbe.modelCalls,
    cloud: window.__startupProbe.cloudCalls }))).toEqual({ camera: 0, model: 0, cloud: [] });
}

async function expectFailure(page) {
  await expect(page.getByRole('heading', { name: 'App could not load', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert')).toContainText('App could not load');
  await expect(page.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible();
  await expect(page.locator('#startBtn')).toBeDisabled();
  await expect(page.locator('#driverControls')).toHaveAttribute('disabled', /.*/);
  for (const id of ['driveState', 'calibration', 'risk', 'riskDetail', 'status']) {
    await expect(page.locator('#' + id)).not.toHaveText(/\b(?:SAFE|READY)\b/i);
  }
  await page.locator('body').press('Space');
  await page.locator('#startBtn').click({ force: true });
  // A synthetic click bypasses disabled controls and a hidden camera row,
  // exercising the handler's own guard rather than the fieldset alone.
  await page.locator('#cameraRefreshBtn').dispatchEvent('click');
  await expectNoPermissionedWork(page);
}

async function expectCoreGuards(page) {
  expect(await page.evaluate(async () => {
    initModel = async () => { window.__startupProbe.modelCalls++; };
    const errors = [];
    for (const invoke of [() => start(), () => findCameraChoices()]) {
      try { await invoke(); } catch (error) { errors.push(error.name + ': ' + error.message); }
    }
    return errors;
  })).toEqual([], 'partially initialized functions must return safely before model or camera work');
  await expectNoPermissionedWork(page);
  await expect(page.locator('#startBtn')).toBeDisabled();
}

for (const mode of ['failed', 'malformed', 'partial']) {
  test(`${mode} driver JavaScript cannot offer monitoring or permissioned work`, async ({ page }) => {
    await installPrivacyProbe(page);
    const route = await driverRoute(page, mode);
    await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
    await expectFailure(page);
    expect(route.count).toBe(1, 'the failed document must not reexecute or automatically retry the core script');
    if (mode === 'partial') {
      expect(await page.evaluate(() => window.__startupProbe.partialExecutions)).toBe(1);
      expect(await page.evaluate(() => ({ model: typeof initModel, start: typeof start,
        handler: typeof document.getElementById('startBtn').onclick })))
        .toEqual({ model: 'function', start: 'function', handler: 'function' });
      await expectCoreGuards(page);
      const previousDocument = await page.evaluate(() => window.__startupProbe.documentId);
      route.setMode('full');
      await Promise.all([
        page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
        page.getByRole('button', { name: 'Reload app', exact: true }).click(),
      ]);
      await expect(page.locator('#startBtn')).toBeEnabled();
      expect(await page.evaluate(() => window.__startupProbe.documentId)).toBe(previousDocument + 1);
      expect(await page.evaluate(() => window.__startupProbe.partialExecutions)).toBe(0);
      expect(route.count).toBe(2, 'Reload must create one fresh document and one fresh core-script request');
      await expectNoPermissionedWork(page);
    }
  });
}

for (const failure of [
  { label: 'before Start binding', key: 'occulert-intensity', occurrence: 1, handlerBound: false },
  { label: 'after Start binding', key: 'occulert-voice', occurrence: 2, handlerBound: true },
]) {
  test(`an eager local preference failure ${failure.label} prevents incomplete startup`, async ({ page }) => {
    await installPrivacyProbe(page, failure);
    const route = await driverRoute(page, 'full');
    await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
    await expectFailure(page);
    expect(await page.evaluate(() => ({ failures: window.__startupProbe.storageFailures,
      handlerBound: window.__startupProbe.handlerBoundAtStorageFailure })))
      .toEqual({ failures: 1, handlerBound: failure.handlerBound });
    await expectCoreGuards(page);
    expect(route.count).toBe(1, 'a runtime failure must not retry the script in the failed document');
  });
}

test('a hung core script times out and late completion cannot revive the failed document', async ({ page }) => {
  test.setTimeout(30_000);
  await installPrivacyProbe(page);
  const route = await driverRoute(page, 'held');
  try {
    await page.goto('/app.html', { waitUntil: 'commit' });
    await expect.poll(() => route.count).toBe(1);
    await expect(page.locator('#startBtn')).toBeDisabled();
    await expect(page.locator('#startBtn')).toHaveText(/Loading app/i);
    await expectFailure(page);
    route.release();
    await page.waitForLoadState('domcontentloaded');
    await expectFailure(page);
    await expectCoreGuards(page);
    expect(route.count).toBe(1);
  } finally { route.release(); }
});

test('an unavailable optional account script still permits complete local startup', async ({ page }) => {
  await installPrivacyProbe(page);
  let accountRequests = 0;
  await page.route(/\/occulert-backend\.v\d+\.js(?:\?.*)?$/, async route => {
    accountRequests++;
    await route.abort('failed');
  });
  const route = await driverRoute(page, 'full');
  await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#startBtn')).toBeEnabled();
  await expect(page.locator('#startBtn')).toHaveText(/START MONITORING/i);
  await expect(page.getByRole('heading', { name: 'App could not load', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Reload app', exact: true })).toBeHidden();
  await expect(page.locator('#sync')).toHaveText('LOCAL');
  expect(await page.evaluate(() => ({ backend: typeof window.OcculertBackend, model: typeof initModel,
    start: typeof start, handler: typeof document.getElementById('startBtn').onclick })))
    .toEqual({ backend: 'undefined', model: 'function', start: 'function', handler: 'function' });
  expect(accountRequests).toBe(1);
  expect(route.count).toBe(1);
  await expectNoPermissionedWork(page);
});

test('Start becomes available only after the complete driver initializes', async ({ page }) => {
  await installPrivacyProbe(page);
  const route = await driverRoute(page, 'held');
  try {
    await page.goto('/app.html', { waitUntil: 'commit' });
    await expect.poll(() => route.count).toBe(1);
    await expect(page.locator('#startBtn')).toBeDisabled();
    await expect(page.locator('#startBtn')).toHaveText(/Loading app/i);
    expect(await page.evaluate(() => typeof initModel)).toBe('undefined');
    await expectNoPermissionedWork(page);
    route.release();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#startBtn')).toBeEnabled();
    await expect(page.locator('#startBtn')).toHaveText(/START MONITORING/i);
    expect(await page.evaluate(() => ({ model: typeof initModel, start: typeof start, stop: typeof stop,
      handler: typeof document.getElementById('startBtn').onclick })))
      .toEqual({ model: 'function', start: 'function', stop: 'function', handler: 'function' });
    await expect(page.getByRole('button', { name: 'Reload app', exact: true })).toBeHidden();
    await expectNoPermissionedWork(page);
  } finally { route.release(); }
});

test('a complete driver cannot activate if its early startup guard is absent', async ({ page }) => {
  await installPrivacyProbe(page);
  await page.route(/\/app\.html(?:\?.*)?$/, async route => {
    const html = readFileSync(resolve(root, 'app.html'), 'utf8');
    const document = parse(html);
    let removed = 0;
    function removeGuard(node) {
      if (!node.childNodes) return;
      node.childNodes = node.childNodes.filter(child => {
        if (child.tagName === 'script' && child.attrs.some(attr => attr.name === 'id' && attr.value === 'driver-startup-guard')) {
          removed++;
          return false;
        }
        removeGuard(child);
        return true;
      });
    }
    removeGuard(document);
    expect(removed).toBe(1);
    await route.fulfill({ status: 200, contentType: 'text/html', body: serialize(document) });
  });
  const route = await driverRoute(page, 'full');
  await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => ({ guard: typeof window.OcculertStartup, model: typeof initModel,
    handler: typeof document.getElementById('startBtn').onclick })))
    .toEqual({ guard: 'undefined', model: 'function', handler: 'function' });
  await expect(page.locator('#startBtn')).toBeDisabled();
  await expect(page.locator('#driverControls')).toHaveAttribute('disabled', /.*/);
  await expect(page.locator('#startBtn')).toHaveText(/Loading app/i);
  await page.locator('body').press('Space');
  await page.locator('#startBtn').click({ force: true });
  await page.locator('#cameraRefreshBtn').dispatchEvent('click');
  await expectCoreGuards(page);
  expect(route.count).toBe(1);
});

const guardPattern = /\/driver-startup-guard\.v\d+\.js(?:\?.*)?$/;
const guardSource = readFileSync(resolve(root, assets['driver-startup-guard.js']), 'utf8');

for (const order of ['guard-first', 'guard-delayed']) {
  test(`external startup handshake tolerates ${order} without permissioned work`, async ({ page }) => {
    await installPrivacyProbe(page);
    let release;
    const held = new Promise(resolve => { release = resolve; });
    if (order === 'guard-delayed') await page.route(guardPattern, async route => {
      await held; await route.fulfill({ status: 200, contentType: 'text/javascript', body: guardSource });
    });
    const driver = await driverRoute(page, order === 'guard-first' ? 'held' : 'full');
    try {
      if (order === 'guard-first') {
        await page.goto('/app.html', { waitUntil: 'commit' });
        await expect.poll(() => page.evaluate(() => typeof window.OcculertStartup)).toBe('object');
        expect(await page.evaluate(() => window.OcculertStartup.isReady())).toBe(false);
        driver.release(); await page.waitForLoadState('domcontentloaded');
      } else {
        await page.goto('/app.html', { waitUntil: 'commit' });
        await expect(page.locator('#startupRetryLink')).toBeVisible();
        expect(await page.evaluate(() => ({ core: typeof window.OcculertDriverCore, guard: typeof window.OcculertStartup }))).toEqual({ core: 'undefined', guard: 'undefined' });
        await expect(page.locator('#startBtn')).toBeDisabled();
        await expect(page.locator('#startupRetryLink')).toBeVisible();
        release();
      }
      await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
      await expect(page.locator('#startBtn')).toBeEnabled();
      await expectNoPermissionedWork(page);
    } finally { release?.(); driver.release(); }
  });
}
for (const failure of ['missing', 'tampered']) {
  test(`a ${failure} external guard leaves complete core disabled with plain recovery`, async ({ page }) => {
    await installPrivacyProbe(page);
    await page.route(guardPattern, route => failure === 'missing' ? route.abort('failed') : route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__tamperedGuardExecuted=true;' }));
    const driver = await driverRoute(page, 'full');
    try {
      await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
      expect(await page.evaluate(() => ({ core: Object.isFrozen(window.OcculertDriverCore), guard: typeof window.OcculertStartup, tampered: window.__tamperedGuardExecuted }))).toEqual({ core: true, guard: 'undefined', tampered: undefined });
      await expect(page.locator('#startupRetryLink')).toBeVisible();
      await expectCoreGuards(page);
    } finally { driver.release(); }
  });
}
test('a hung guard cannot activate a complete driver when released after the deadline', async ({ page }) => {
  await installPrivacyProbe(page);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(guardPattern, async route => { await held; await route.fulfill({ status: 200, contentType: 'text/javascript', body: guardSource }); });
  const driver = await driverRoute(page, 'full');
  try {
    await page.goto('/app.html', { waitUntil: 'commit' });
    await expect(page.locator('#startBtn')).toBeDisabled();
    await expect(page.locator('#startupRetryLink')).toBeVisible();
    expect(await page.evaluate(() => typeof window.OcculertDriverCore)).toBe('undefined');
    await expectNoPermissionedWork(page);
    await page.waitForTimeout(8100);
    release();
    await page.waitForLoadState('domcontentloaded');
    await expectFailure(page);
    await expectCoreGuards(page);
    expect(await page.evaluate(() => window.OcculertStartup.isReady())).toBe(false);
  } finally { release(); driver.release(); }
});

for (const resource of ['backend', 'stylesheet']) {
 test(`a stalled ${resource}${resource==='stylesheet'?' and incomplete core':''} keeps controls disabled and late completion cannot activate monitoring`, async ({page}) => {
  await installPrivacyProbe(page);
  let release;const held=new Promise(resolve=>{release=resolve});
  const logical=resource==='backend'?'occulert-backend.js':'driver-app.css';
  const filename=assets[logical];
  const delayedCore=resource==='stylesheet'?await driverRoute(page,'held'):null;
  await page.route('**/'+filename,async route=>{await held;await route.fulfill({status:200,contentType:resource==='backend'?'text/javascript':'text/css',body:readFileSync(resolve(root,filename),'utf8')})});
  try {
   await page.goto('/app.html',{waitUntil:'commit'});
   // Styles may delay first paint independently of script execution. Hold
   // the core too, then prove that neither resource's late completion can
   // enable an incomplete or expired initialization.
   await expect(page.locator('#startupRetryLink')).toHaveAttribute('href','/app.html');
   if(resource==='backend') await expect(page.locator('#startupRetryLink')).toBeVisible();
   await expect(page.locator('#startBtn')).toBeDisabled();
   await expectNoPermissionedWork(page);
   if(resource==='backend') await expectFailure(page);
   else await page.waitForTimeout(8100);
   release();delayedCore?.release();await page.waitForLoadState('domcontentloaded');
   await expectFailure(page);await expectCoreGuards(page);
   expect(await page.evaluate(()=>window.OcculertStartup.isReady())).toBe(false);
  } finally {release();delayedCore?.release()}
 });
}

test('busy core initialization cannot bypass the startup deadline before the timer runs', async ({page}) => {
 await installPrivacyProbe(page);
 const marker='// Final synchronous statement: partial scripts and hoisted functions cannot signal readiness.';
 expect(driverSource).toContain(marker);
 const blocked=driverSource.replace(marker,'const busyUntil=performance.now()+8100;while(performance.now()<busyUntil){};\n'+marker);
 await page.route(driverPattern,route=>route.fulfill({status:200,contentType:'text/javascript',body:blocked}));
 await page.goto('/app.html',{waitUntil:'domcontentloaded'});
 await expectFailure(page);await expectCoreGuards(page);
 expect(await page.evaluate(()=>window.OcculertStartup.isReady())).toBe(false);
});

test.describe('cached complete driver startup', () => {
  test.use({ serviceWorkers: 'allow' });
  test('the verified offline shell still initializes without camera or cloud access', async ({ page }) => {
    test.setTimeout(45_000);
    await installPrivacyProbe(page);
    const state = { offline: false, guardTampered: false };
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
    const server = createServer((request, response) => {
      if (state.offline) { response.destroy(); return; }
      const path = new URL(request.url, 'http://localhost').pathname;
      const file = resolve(root, path === '/' ? 'index.html' : path.slice(1));
      if (!file.startsWith(root + '/') || !existsSync(file)) { response.writeHead(404); response.end(); return; }
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      response.end(state.guardTampered && path === '/'+assets['driver-startup-guard.js'] ? 'window.__tamperedNetworkGuardExecuted=true;' : readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      await page.goto(origin + '/app.html');
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active && navigator.serviceWorker.controller === registration.active);
      })).toBe(true);
      state.guardTampered = true;
      await page.goto(origin + '/app.html', {waitUntil:'domcontentloaded'});
      await expect(page.locator('#startBtn')).toBeEnabled();
      expect(await page.evaluate(()=>window.__tamperedNetworkGuardExecuted)).toBeUndefined();
      expect(await page.evaluate(async path=>(await caches.match(path)).text(),'/'+assets['driver-startup-guard.js'])).toBe(guardSource);
      state.offline = true;
      await page.goto(origin + '/app.html', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#startBtn')).toBeEnabled();
      await expect(page.locator('#startBtn')).toHaveText(/START MONITORING/i);
      expect(await page.evaluate(() => typeof initModel)).toBe('function');
      await expectNoPermissionedWork(page);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  test('a corrupted offline guard cannot enable the cached complete driver', async ({ page }) => {
    test.setTimeout(45_000);
    await installPrivacyProbe(page);
    const state = { offline: false };
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
    const server = createServer((request, response) => {
      if (state.offline) { response.destroy(); return; }
      const path = new URL(request.url, 'http://localhost').pathname;
      const file = resolve(root, path === '/' ? 'index.html' : path.slice(1));
      if (!file.startsWith(root + '/') || !existsSync(file)) { response.writeHead(404); response.end(); return; }
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      response.end(readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      await page.goto(origin + '/app.html');
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active && navigator.serviceWorker.controller === registration.active);
      })).toBe(true);
      await page.evaluate(async guardPath=>{
        const cacheName=(await caches.keys()).find(name=>name.startsWith('occulert-v'));
        const cache=await caches.open(cacheName);
        await cache.put(guardPath,new Response('window.__corruptedGuardExecuted=true;',{headers:{'Content-Type':'text/javascript'}}));
      },'/'+assets['driver-startup-guard.js']);
      state.offline = true;
      await page.goto(origin + '/app.html', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#startupRetryLink')).toBeVisible();
      await expectCoreGuards(page);
      expect(await page.evaluate(()=>({guard:typeof window.OcculertStartup,corrupted:window.__corruptedGuardExecuted,core:Object.isFrozen(window.OcculertDriverCore)}))).toEqual({guard:'undefined',corrupted:undefined,core:true});
      await expectNoPermissionedWork(page);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
