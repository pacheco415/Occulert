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

test('failed voice restoration cannot enable public voice actions or camera access', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'occulert-voice') throw new DOMException('Fixture voice storage denied', 'SecurityError');
      return read.call(this, key);
    };
    window.__occulertCameraRequests = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__occulertCameraRequests++; throw new Error('Unexpected camera request'); };
  });
  await page.goto('/app.html');
  await page.waitForFunction(() => typeof toggleVoice === 'function');
  const before = await page.locator('#voiceToggleBtn').textContent();
  expect(await page.evaluate(() => {
    const errors = [];
    for (const action of [() => speak('parked fixture'), () => toggleVoice()]) {
      try { action(); errors.push(null); } catch (error) { errors.push(error.name); }
    }
    return { errors, core: typeof window.OcculertDriverCore, cameraRequests: window.__occulertCameraRequests };
  })).toEqual({ errors: ['ReferenceError', 'ReferenceError'], core: 'undefined', cameraRequests: 0 });
  await expect(page.locator('#voiceToggleBtn')).toHaveText(before);
  await expect(page.locator('#startBtn')).toBeDisabled();
});
