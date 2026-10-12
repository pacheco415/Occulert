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

test('failed voice restoration preserves safe defaults and explicit voice controls', async ({ page }) => {
  await page.addInitScript(() => {
    window.__occulertNativeStop = window.stop;
    window.__occulertVoiceProbe = { reads: 0, writes: [], spoken: [], cancellations: 0, cameraRequests: 0 };
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    // A denied restore must fall back to OFF even when the saved value is ON.
    write.call(localStorage, 'occulert-voice', 'true');
    Storage.prototype.getItem = function (key) {
      if (this === localStorage && key === 'occulert-voice') {
        window.__occulertVoiceProbe.reads++;
        throw new DOMException('Fixture voice storage denied', 'SecurityError');
      }
      return read.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'occulert-voice') window.__occulertVoiceProbe.writes.push(String(value));
      return write.call(this, key, value);
    };
    // Observe the voice action without emitting real audio on either browser.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      constructor(text) { this.text = text; }
    } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      paused: false,
      resume() {},
      cancel() { window.__occulertVoiceProbe.cancellations++; },
      speak(utterance) { window.__occulertVoiceProbe.spoken.push(utterance.text); },
    } });
    const devices = new EventTarget();
    devices.enumerateDevices = async () => [];
    devices.getUserMedia = async () => {
      window.__occulertVoiceProbe.cameraRequests++;
      throw new Error('Unexpected camera request');
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
  });
  await page.goto('/app.html');
  await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
  await expect(page.locator('#startBtn')).toBeEnabled();
  await expect(page.locator('#voiceToggleBtn')).toHaveText('🔇 Voice OFF');
  await expect(page.locator('#preferenceStorageNotice')).toHaveCount(1);
  expect(await page.evaluate(() => {
    speak('muted fixture');
    return { voice: _voiceEnabled, core: Object.isFrozen(window.OcculertDriverCore),
      sameNative: window.stop === window.__occulertNativeStop,
      separate: window.OcculertDriverCore.stop !== window.stop, probe: window.__occulertVoiceProbe };
  })).toEqual({ voice: false, core: true, sameNative: true, separate: true,
    probe: { reads: 1, writes: [], spoken: [], cancellations: 0, cameraRequests: 0 } });

  await page.locator('#voiceToggleBtn').click();
  await expect(page.locator('#voiceToggleBtn')).toHaveText('🔊 Voice ON');
  expect(await page.evaluate(() => ({ voice: _voiceEnabled, spoken: window.__occulertVoiceProbe.spoken })))
    .toEqual({ voice: true, spoken: [] });
  await page.evaluate(() => speak('parked fixture'));
  await page.locator('#voiceToggleBtn').click();
  await expect(page.locator('#voiceToggleBtn')).toHaveText('🔇 Voice OFF');
  expect(await page.evaluate(() => {
    speak('muted again');
    return { voice: _voiceEnabled, sameNative: window.stop === window.__occulertNativeStop,
      probe: window.__occulertVoiceProbe };
  })).toEqual({ voice: false, sameNative: true,
    probe: { reads: 1, writes: ['true', 'false'], spoken: ['parked fixture'], cancellations: 1, cameraRequests: 0 } });
  await expect(page.locator('#preferenceStorageNotice')).toHaveCount(1);
  await expect(page.locator('#startBtn')).toBeEnabled();
});
