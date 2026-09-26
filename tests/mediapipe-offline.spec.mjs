import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { prepareDetectorPage, detectBlankFrame } from './helpers/detector-runtime.mjs';
import { observePageLoads } from './helpers/page-load-diagnostics.mjs';

test.use({ serviceWorkers: 'allow' });
const root = resolve('.');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const runtimeRoot = '/vendor/mediapipe/face-mesh-0.4.1633559619-occulert.1/';
const manifest = JSON.parse(readFileSync('.' + runtimeRoot + 'runtime-manifest.json', 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };

for (const scalar of [false, true]) {
for (const upgrade of [false, true]) {
  test(`${upgrade ? 'failed upgrade preserves v48' : 'failed fresh install stays inactive'} until the selected ${scalar ? "scalar" : "SIMD"} runtime is verified`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const diagnostics = await observePageLoads(page);
    let failed = false;
    const requested = [];
    const state = { old: upgrade, failure: upgrade ? null : 'missing', offline: false };
    const server = createServer((request, response) => {
      if (state.offline) { response.destroy(); return; }
      const path = new URL(request.url, 'http://localhost').pathname;
      if(!state.old)requested.push(path);
      for (const rule of config.headers) {
        if (new RegExp(`^${rule.source}$`).test(path)) {
          for (const { key, value } of rule.headers) response.setHeader(key, value);
        }
      }
      // Disable HTTP cache so successful offline inference has to use the SW cache.
      response.setHeader('Cache-Control', 'no-store');
      const brokenAsset = runtimeRoot + (scalar ? 'face_mesh_solution_wasm_bin.wasm' : 'face_mesh_solution_simd_wasm_bin.wasm');
      if (state.failure && path === brokenAsset) {
        response.statusCode = state.failure === 'missing' ? 503 : 200;
        response.end('invalid runtime bytes');
        return;
      }
      const file = state.old && path === '/sw.js' ? resolve('tests/fixtures/sw-v48.js')
        : state.old && path === '/app.html' ? resolve('tests/fixtures/app-v48.html')
        : resolve(root, path === '/' ? 'index.html' : path.slice(1));
      if (!file.startsWith(root + '/') || !existsSync(file)) { response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      const bytes = readFileSync(file);
      response.end(scalar && path === '/sw.js' && !state.old ? Buffer.from('WebAssembly.validate = () => false;\n' + bytes) : bytes);
    });
    diagnostics.observeServer(server, () => ({ ...state }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const register = async (update = false) => page.evaluate(async update => {
      let registration;
      let discovered;
      if (update) {
        registration = await navigator.serviceWorker.getRegistration();
        const found = new Promise(resolve => registration.addEventListener('updatefound', () => resolve(registration.installing), { once: true }));
        await registration.update();
        discovered = registration.installing || await found;
      } else {
        registration = await navigator.serviceWorker.register('/sw.js');
        discovered = registration.installing || registration.waiting || registration.active;
      }
      window.__occulertPageLoadRecord?.('worker-discovered', { worker: { script: new URL(discovered.scriptURL).pathname, state: discovered.state } });
      if (['activated', 'redundant'].includes(discovered.state)) return discovered.state;
      return new Promise(resolve => discovered.addEventListener('statechange', () => {
        window.__occulertPageLoadRecord?.('worker-state', { worker: { script: new URL(discovered.scriptURL).pathname, state: discovered.state } });
        if (['activated', 'redundant'].includes(discovered.state)) resolve(discovered.state);
      }));
    }, update);
    try {
      await prepareDetectorPage(page, scalar);
      // app.html does not auto-register a SW, so failure observation has no race
      // with the homepage's automatic registration.
      await page.goto(origin + '/app.html', { waitUntil: 'domcontentloaded' });
      if (upgrade) {
        expect(await register()).toBe('activated');
        await expect.poll(() => page.evaluate(() => caches.has('occulert-v48'))).toBe(true);
        state.old = false;
        state.failure = 'corrupt';
      }
      expect(await register(upgrade)).toBe('redundant');
      const keys = await page.evaluate(() => caches.keys());
      expect(keys).not.toContain('occulert-v54');
      if (upgrade) {
        expect(keys).toContain('occulert-v48');
        expect(await page.evaluate(async () => (await (await caches.open('occulert-v48')).match('/app.html')).text())).toContain('/driver-app.v48.js');
      } else {
        expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
      }
      state.failure = null;
      // A failed first registration may have no active registration remaining.
      expect(await register(upgrade)).toBe('activated');
      await expect.poll(() => page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return navigator.serviceWorker.controller === registration?.active && registration?.active?.state === 'activated';
      })).toBe(true);
      const cached = await page.evaluate(async () => (await (await caches.open('occulert-v54')).keys()).map(request => new URL(request.url).pathname));
      for (const file of Object.keys(manifest.files)) {
        const excluded = scalar ? file.includes('solution_simd_wasm_bin.') : file.includes('solution_wasm_bin.');
        if (excluded) { expect(cached).not.toContain(runtimeRoot + file); expect(requested).not.toContain(runtimeRoot + file); }
        else expect(cached).toContain(runtimeRoot + file);
      }
      expect(await page.evaluate(() => caches.has('occulert-v48'))).toBe(false);
      diagnostics.record('offline-cut-ready', await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return { controllerIsActive: navigator.serviceWorker.controller === registration.active,
          controllerState: navigator.serviceWorker.controller?.state, activeState: registration.active?.state,
          cacheNames: await caches.keys(), initModelType: typeof window.initModel };
      }));
      state.offline = true;
      diagnostics.record('origin-offline');
      // Cut the actual origin connection. Unlike Playwright's WebKit offline
      // emulation, this lets WebKit's service worker handle the network failure.
      await page.goto(origin + '/app.html', { waitUntil: 'domcontentloaded' });
      const result = await detectBlankFrame(page);
      expect(result.generation).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.detectorCspViolations)).toEqual([]);
    } catch (error) {
      failed = true;
      diagnostics.record('test-failed', { message: error.message.slice(0, 500).replace(/https?:\/\/[^\s]+/g, value => value.split(/[?#]/, 1)[0]) });
      throw error;
    } finally {
      try {
        diagnostics.record('server-cleanup-start', { listening: server.listening });
        if (failed) await diagnostics.attach(testInfo);
        server.closeAllConnections();
        diagnostics.record('server-connections-closed');
        await new Promise(resolve => server.close(resolve));
        if (failed) await diagnostics.attach(testInfo, 'page-load-cleanup');
      } finally { diagnostics.stop(); }
    }
  });
}
}
