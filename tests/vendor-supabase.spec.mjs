import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK = '/vendor/supabase-2.112.3.js';
const sdkBytes = readFileSync(new URL('../vendor/supabase-2.112.3.js', import.meta.url), 'utf8');

async function blockExternal(page, baseURL) {
  const requested = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) {
      requested.push(url.href);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await page.route('**/api/config', route => route.fulfill({ json: { ok: true, supabase: { configured: false } } }));
  return requested;
}

test('owned SDK initializes both account pages under their CSP without a CDN', async ({ page, baseURL }) => {
  const external = await blockExternal(page, baseURL);
  for (const path of ['/login.html', '/account.html']) {
    const response = await page.goto(path);
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
    await expect.poll(() => page.evaluate(() => window.OcculertSupabaseLoader?.state().ready)).toBe(true);
    const capabilities = await page.evaluate(async () => {
      const script = document.querySelector('script[data-occulert-supabase-sdk]');
      const client = window.supabase.createClient('https://fixture.supabase.co', 'fixture-public-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, experimental: { passkey: true } },
      });
      await client.auth.initialize();
      return { source: new URL(script.src).pathname, integrity: script.integrity,
        auth: typeof client.auth.signInWithPasskey, register: typeof client.auth.registerPasskey,
        remove: typeof client.auth.passkey.delete };
    });
    expect(capabilities).toEqual({ source: SDK,
      integrity: 'sha384-qafw21c/iciq0VXsi9FzkfoQv5I/V0iqE4lSNcKXPnW9/UTJLnv5CcN4FHxVLnKg',
      auth: 'function', register: 'function', remove: 'function' });
  }
  expect(external.filter(url => url.includes('jsdelivr') || url.includes('unpkg') || url.includes('fixture.supabase.co'))).toEqual([]);
});

test('tampered owned SDK bytes are rejected by browser SRI and sign-in fields stay enabled', async ({ page, baseURL }) => {
  const external = await blockExternal(page, baseURL);
  await page.route('**' + SDK, route => route.fulfill({ contentType: 'text/javascript',
    body: 'window.__tamperedSDKExecuted = true;\n' + sdkBytes }));
  await page.goto('/login.html');
  await expect.poll(() => page.evaluate(() => window.OcculertSupabaseLoader?.state().error)).toBe('sdk_load_failed');
  expect(await page.evaluate(() => Boolean(window.__tamperedSDKExecuted || window.supabase))).toBe(false);
  await expect(page.locator('#email')).toBeEnabled();
  await expect(page.locator('#password')).toBeEnabled();
  expect(external.filter(url => url.includes('jsdelivr') || url.includes('unpkg'))).toEqual([]);
});

test('owned SDK delivery failure retries only its pinned source', async ({ page, baseURL }) => {
  const external = await blockExternal(page, baseURL);
  let attempts = 0;
  await page.route('**' + SDK, route => ++attempts === 1 ? route.abort('failed') : route.continue());
  await page.goto('/login.html');
  await expect.poll(() => page.evaluate(() => window.OcculertSupabaseLoader?.state().error)).toBe('sdk_load_failed');
  await page.evaluate(() => window.OcculertSupabaseLoader.retry());
  expect(await page.evaluate(() => window.OcculertSupabaseLoader.state())).toEqual({ ready: true, loading: false, error: null });
  expect(attempts).toBe(2);
  expect(external.filter(url => url.includes('jsdelivr') || url.includes('unpkg'))).toEqual([]);
});

test('offline driver startup works while the owned SDK never falls back to a cached copy', async ({ browser }) => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  const state = { offline: false };
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
  const server = createServer((request, response) => {
    if (state.offline) { response.destroy(); return; }
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'index.html' : path.slice(1));
    if (!file.startsWith(root + '/') || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    for (const rule of config.headers) {
      if (new RegExp(`^${rule.source}$`).test(path)) {
        for (const { key, value } of rule.headers) response.setHeader(key, value);
      }
    }
    // Bypass HTTP cache: offline success must come from the real service worker.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await blockExternal(page, baseURL);
    await page.addInitScript(() => {
      window.__cameraCalls = 0;
      if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        window.__cameraCalls++; throw Error('No physical camera access in offline startup test');
      } });
    });
    await page.goto('/app.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.evaluate(async source => {
      const cache = await caches.open('cached-sdk-fixture');
      await cache.put(source, new Response('window.__cachedSDKExecuted = true;', { headers: { 'Content-Type': 'text/javascript' } }));
    }, SDK);
    // WebKit's offline emulation rejects requests before its worker can handle
    // them. Cut the origin connection instead, for the same behavior in both engines.
    state.offline = true;
    await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
    const unavailable = await page.evaluate(async source => {
      try { await fetch(source); return false; } catch { return true; }
    }, SDK);
    expect(unavailable).toBe(true);
    expect(await page.evaluate(() => window.__cameraCalls)).toBe(0);
    expect(await page.evaluate(() => Boolean(window.__cachedSDKExecuted))).toBe(false);
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
