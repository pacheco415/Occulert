import { test, expect } from '@playwright/test';

test('bare monitoring coordinators work while native Window.stop stays intact', async ({ page }) => {
  await page.addInitScript(() => {
    window.__occulertNativeStop = window.stop;
    window.__occulertCameraRequests = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__occulertCameraRequests++; throw new Error('Unexpected camera request'); };
  });
  await page.goto('/app.html');
  await page.waitForFunction(() => typeof window.OcculertDriverCore?.stop === 'function');
  expect(await page.evaluate(() => ({
    sameNative: window.stop === window.__occulertNativeStop,
    coreStop: stop === window.OcculertDriverCore.stop,
    coreStart: start === window.OcculertDriverCore.start,
    separate: stop !== window.stop,
  }))).toEqual({ sameNative: true, coreStop: true, coreStart: true, separate: true });
  await page.evaluate(async () => { await stop(); await window.OcculertDriverCore.stop(); });
  expect(await page.evaluate(() => window.__occulertCameraRequests)).toBe(0);
  expect(await page.evaluate(() => window.stop === window.__occulertNativeStop)).toBe(true);
});
