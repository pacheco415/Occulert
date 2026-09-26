import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

test.use({ serviceWorkers: 'allow' });

for (const partialBody of [false, true]) {
test(`a network-only account script stalled ${partialBody ? 'mid-body' : 'before headers'} cannot block startup or use a cached account script`, async ({ page }) => {
  test.setTimeout(60_000);
  const root = resolve('.');
  const state = { stall: false, requested: false, aborted: false };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (state.stall && pathname === '/occulert-backend.v58.js') {
      state.requested = true;
      response.on('close', () => { state.aborted = !response.writableEnded; });
      if (partialBody) {
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        response.write('// Account script response has not finished.\n');
      }
      return;
    }
    const file = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(root + '/') || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(origin + '/app.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.evaluate(async () => {
      const cache = await caches.open('occulert-v52');
      await cache.put('/occulert-backend.v58.js', new Response('window.cachedAccountScriptUsed = true;', { headers: { 'Content-Type': 'text/javascript' } }));
    });
    state.stall = true;
    await page.goto(origin + '/app.html', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    expect(state.requested).toBe(true);
    await expect.poll(() => state.aborted).toBe(true);
    expect(await page.evaluate(() => ({ detectorReady: typeof initModel, cachedAccountScriptUsed: window.cachedAccountScriptUsed === true, accountClientLoaded: Boolean(window.OcculertBackend) })))
      .toEqual({ detectorReady: 'function', cachedAccountScriptUsed: false, accountClientLoaded: false });
    await expect(page.locator('#startBtn')).toBeVisible();
    expect(await page.evaluate(async () => (await (await caches.open('occulert-v52')).match('/occulert-backend.v58.js')).text()))
      .toBe('window.cachedAccountScriptUsed = true;');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
}
