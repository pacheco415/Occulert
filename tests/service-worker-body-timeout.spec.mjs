import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

test.use({ serviceWorkers: 'allow' });

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const workerSource = readFileSync(resolve(root, 'sw.js'), 'utf8');
const cacheName = workerSource.match(/^const CACHE = '([^']+)';/m)[1];
const driverPath = '/driver-app.v59.js';
const redirectedDriverPath = '/body-deadline-final-driver.js';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };

async function localOrigin() {
  const state = { mode: 'normal', target: '', requested: false, aborted: false, pending: [] };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (state.mode === 'redirect' && pathname === driverPath) {
      response.writeHead(302, { Location: redirectedDriverPath, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (state.mode === 'stall' && pathname === state.target) {
      state.requested = true;
      state.pending.push(response);
      response.on('close', () => { state.aborted = !response.writableEnded; });
      response.writeHead(200, { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store' });
      response.write(pathname.endsWith('.js')
        ? '// Partial driver response\nwindow.partialNetworkDriverRan = true;\n'
        : '<!doctype html><html><head><title>Partial network page</title></head><body><div id="partialNetworkPage">');
      return;
    }
    const sourcePath = pathname === redirectedDriverPath ? driverPath : pathname;
    const file = resolve(root, sourcePath === '/' ? 'index.html' : sourcePath.slice(1));
    if (!file.startsWith(root + '/') || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    const source = pathname === '/sw.js' ? workerSource : readFileSync(file);
    if (state.mode === 'gzip' && pathname === state.target) {
      const suffix = pathname.endsWith('.js') ? '\n// completeFreshDriverBody\n' : '\n<!-- completeFreshPageBody -->\n';
      const bytes = gzipSync(Buffer.concat([Buffer.from(source), Buffer.from(suffix)]));
      response.setHeader('Content-Encoding', 'gzip');
      response.setHeader('Content-Length', bytes.length);
      response.setHeader('X-Complete-Body', 'network');
      response.end(bytes);
      return;
    }
    response.end(source);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

async function warmOfflineShell(page, origin) {
  await page.goto(origin + '/app.html');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active && navigator.serviceWorker.controller === registration.active);
  })).toBe(true);
  return page.evaluate(async ({ cacheName, driverPath }) => {
    const cache = await caches.open(cacheName);
    const page = await cache.match('/app.html'), driver = await cache.match(driverPath);
    return { html: await page.text(), driver: await driver.text() };
  }, { cacheName, driverPath });
}

for (const target of [driverPath, '/app.html']) {
  test(`a stalled complete-header ${target} body falls back to the verified offline shell`, async ({ page }) => {
    test.setTimeout(60_000);
    const fixture = await localOrigin();
    try {
      const cached = await warmOfflineShell(page, fixture.origin);
      expect(cached.driver).toContain("FACE_MESH_VERSION='0.4.1633559619'");
      expect(cached.html).toContain('id="alertTitle"');
      fixture.state.target = target;
      fixture.state.mode = 'stall';
      await page.goto(fixture.origin + '/app.html', { waitUntil: 'domcontentloaded', timeout: 6000 });
      expect(fixture.state.requested).toBe(true);
      await expect.poll(() => fixture.state.aborted).toBe(true);
      expect(await page.evaluate(() => ({ driverReady: typeof initModel, partialDriver: window.partialNetworkDriverRan === true,
        partialPage: Boolean(document.getElementById('partialNetworkPage')) })))
        .toEqual({ driverReady: 'function', partialDriver: false, partialPage: false });
      await expect(page.locator('#startBtn')).toBeVisible();
      const cachedText = () => page.evaluate(async ({ cacheName, target }) => {
        const response = await (await caches.open(cacheName)).match(target);
        return response.text();
      }, { cacheName, target });
      const expected = target === driverPath ? cached.driver : cached.html;
      expect(await cachedText()).toBe(expected);
      // A server completing its abandoned response must not replace the cache.
      for (const response of fixture.state.pending) response.end('lateNetworkBodyMustNotReplaceCache');
      await expect.poll(cachedText).toBe(expected);
    } finally { await fixture.close(); }
  });
}

test('complete driver and page responses preserve native metadata, decoded bytes, and cache updates', async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await localOrigin();
  try {
    await warmOfflineShell(page, fixture.origin);
    for (const target of [driverPath, '/app.html']) {
      fixture.state.target = target;
      fixture.state.mode = 'gzip';
      const result = await page.evaluate(async target => {
        const response = await fetch(target);
        return { status: response.status, contentType: response.headers.get('content-type'), encoding: response.headers.get('content-encoding'),
          length: response.headers.get('content-length'), marker: response.headers.get('x-complete-body'),
          url: response.url, redirected: response.redirected, text: await response.text() };
      }, target);
      expect(result.status).toBe(200);
      expect(result.contentType).toBe(target.endsWith('.js') ? 'text/javascript' : 'text/html');
      expect(result.marker).toBe('network');
      expect(result.encoding).toBe('gzip');
      expect(Number(result.length)).toBeGreaterThan(0);
      expect(result.url).toBe(fixture.origin + target);
      expect(result.redirected).toBe(false);
      expect(result.text).toContain(target.endsWith('.js') ? 'completeFreshDriverBody' : 'completeFreshPageBody');
      await expect.poll(() => page.evaluate(async ({ cacheName, target }) => {
        const cached = await (await caches.open(cacheName)).match(target);
        return cached.text();
      }, { cacheName, target })).toBe(result.text);
    }
    fixture.state.mode = 'redirect';
    const redirected = await page.evaluate(async target => {
      const response = await fetch(target);
      return { url: response.url, redirected: response.redirected, text: await response.text() };
    }, driverPath);
    expect(redirected.url).toBe(fixture.origin + redirectedDriverPath);
    expect(redirected.redirected).toBe(true);
    expect(redirected.text).toContain("FACE_MESH_VERSION='0.4.1633559619'");
    await expect.poll(() => page.evaluate(async ({ cacheName, driverPath }) => {
      const cached = await (await caches.open(cacheName)).match(driverPath);
      return cached.text();
    }, { cacheName, driverPath })).toBe(redirected.text);
  } finally { await fixture.close(); }
});
