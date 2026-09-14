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
    const cache = await caches.open('occulert-v44');
    return Boolean(await cache.match('/app.html'));
  })).toBe(true);

  // Playwright's WebKit offline emulation fails requests before its service
  // worker can handle them. WebKit still verifies registration and cache
  // population above; Chromium exercises the actual offline fetch below.
  if (browserName !== 'chromium') return;
  await context.setOffline(true);
  try {
    const offlineShell = await page.evaluate(async () => {
      const response = await fetch('/app.html');
      return { ok: response.ok, text: await response.text() };
    });
    expect(offlineShell.ok).toBe(true);
    expect(offlineShell.text).toContain('id="alertTitle"');
  } finally {
    await context.setOffline(false);
  }
});
