import { assetByStem, cacheName } from '../scripts/lib/current-assets.mjs';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
const currentCache = cacheName();
const driverPath = `/${assetByStem('driver-app.js')}`;

test('the service worker installs its offline shell', async ({ page, context, browserName }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return Boolean(await cache.match('/app.html'));
  }, currentCache)).toBe(true);
  const refreshedScript = await page.evaluate(async ({ name, path }) => {
    const cache = await caches.open(name);
    await cache.put(path, new Response('stale-driver-script'));
    return fetch(path).then(response => response.text());
  }, { name: currentCache, path: driverPath });
  expect(refreshedScript).toContain("FACE_MESH_VERSION='0.4.1633559619'");
  expect(refreshedScript).not.toContain('stale-driver-script');
  await expect.poll(() => page.evaluate(async ({ name, path }) => {
    const cache = await caches.open(name);
    const response = await cache.match(path);
    return response ? response.text() : '';
  }, { name: currentCache, path: driverPath })).toContain("FACE_MESH_VERSION='0.4.1633559619'");

  // Playwright's WebKit offline emulation fails requests before its service
  // worker can handle them. WebKit still verifies registration and cache
  // population above; Chromium exercises the actual offline fetch below.
  if (browserName !== 'chromium') return;
  await context.setOffline(true);
  try {
    const offlineShell = await page.evaluate(async (path) => {
      const [response, driverScript] = await Promise.all([fetch('/app.html'), fetch(path)]);
      return { ok: response.ok, text: await response.text(), driverText: await driverScript.text() };
    }, driverPath);
    expect(offlineShell.ok).toBe(true);
    expect(offlineShell.text).toContain('id="alertTitle"');
    expect(offlineShell.driverText).toContain("FACE_MESH_VERSION='0.4.1633559619'");
  } finally {
    await context.setOffline(false);
  }
});
