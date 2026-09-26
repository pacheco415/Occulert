import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    const guard = /<script id="driver-startup-guard">[\s\S]*?<\/script>/;
    expect(html).toMatch(guard);
    await route.fulfill({ status: 200, contentType: 'text/html', body: html.replace(guard, '') });
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

test.describe('cached complete driver startup', () => {
  test.use({ serviceWorkers: 'allow' });
  test('the verified offline shell still initializes without camera or cloud access', async ({ page }) => {
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
      state.offline = true;
      await page.goto(origin + '/app.html', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#startBtn')).toBeEnabled();
      await expect(page.locator('#startBtn')).toHaveText(/START MONITORING/i);
      expect(await page.evaluate(() => typeof initModel)).toBe('function');
      await expectNoPermissionedWork(page);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
