import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('the service worker installs its offline shell', async ({ page, context, browserName }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('occulert-v47');
    return Boolean(await cache.match('/app.html'));
  })).toBe(true);
  const refreshedScript = await page.evaluate(async () => {
    const cache = await caches.open('occulert-v47');
    await cache.put('/driver-app.v47.js', new Response('stale-driver-script'));
    return fetch('/driver-app.v47.js').then(response => response.text());
  });
  expect(refreshedScript).toContain("FACE_MESH_VERSION='0.4.1633559619'");
  expect(refreshedScript).not.toContain('stale-driver-script');
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('occulert-v47');
    const response = await cache.match('/driver-app.v47.js');
    return response ? response.text() : '';
  })).toContain("FACE_MESH_VERSION='0.4.1633559619'");

  // Playwright's WebKit offline emulation fails requests before its service
  // worker can handle them. WebKit still verifies registration and cache
  // population above; Chromium exercises the actual offline fetch below.
  if (browserName !== 'chromium') return;
  await context.setOffline(true);
  try {
    const offlineShell = await page.evaluate(async () => {
      const [response, driverScript] = await Promise.all([fetch('/app.html'), fetch('/driver-app.v47.js')]);
      return { ok: response.ok, text: await response.text(), driverText: await driverScript.text() };
    });
    expect(offlineShell.ok).toBe(true);
    expect(offlineShell.text).toContain('id="alertTitle"');
    expect(offlineShell.driverText).toContain("FACE_MESH_VERSION='0.4.1633559619'");
  } finally {
    await context.setOffline(false);
  }
});
