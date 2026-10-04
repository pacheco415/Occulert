import { test, expect } from '@playwright/test';

for (const unavailable of [true, false]) {
  test(`parked alert decodes and bounds its bundled fallback with WebAudio ${unavailable ? 'unavailable' : 'interrupted'}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') return route.abort('blockedbyclient');
      return route.continue();
    });
    await page.addInitScript(noContext => {
      window.browserAudioDelivery = { elements: 0, plays: [], resumes: 0, policy: { type: 'auto' } };
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: window.browserAudioDelivery.policy });
      const NativeAudio = window.Audio;
      window.Audio = new Proxy(NativeAudio, { construct(target, args) {
        window.browserAudioDelivery.elements++;
        return Reflect.construct(target, args);
      } });
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const record = { muted: this.muted, src: this.src, completed: false };
        window.browserAudioDelivery.plays.push(record);
        return nativePlay.call(this).then(() => { record.completed = true; });
      };
      class InterruptedContext {
        constructor() { this.state = 'interrupted'; }
        resume() { window.browserAudioDelivery.resumes++; return Promise.resolve(); }
        createOscillator() { throw Error('An interrupted context must not schedule an oscillator'); }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: noContext ? undefined : InterruptedContext });
      Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
    }, unavailable);
    await page.goto('/app.html', { waitUntil: 'load' });
    await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
    expect(await page.evaluate(() => window.browserAudioDelivery.elements)).toBe(0);
    await page.getByText('Parked diagnostics', { exact: true }).click();
    await page.locator('#demoBtn').click();
    await expect(page.locator('#alertCheckResult')).toContainText('Test sent to this device');
    await expect.poll(() => page.evaluate(() => window.browserAudioDelivery.plays.some(play => !play.muted && play.completed))).toBe(true);
    const output = await page.evaluate(() => ({
      ...window.browserAudioDelivery, duration: _alertAudio.duration,
      source: new URL(_alertAudio.src).pathname, fatigue, alerts,
      detectionEvents: _sessionLog.filter(entry => entry.type === 'alert').length,
    }));
    expect(output.elements).toBe(1);
    expect(output.policy.type).toBe('playback');
    expect(output.plays.some(play => play.muted)).toBe(true);
    expect(output.duration).toBeCloseTo(.9, 4);
    expect(output.source).toBe('/audio/alert.v1.wav');
    expect(output.alerts).toBe(0);
    expect(output.detectionEvents).toBe(0);
    if (!unavailable) expect(output.resumes).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => _alertAudio.paused && _alertAudio.currentTime === 0)).toBe(true);
    await page.locator('#demoBtn').click();
    expect(await page.evaluate(() => window.browserAudioDelivery.elements)).toBe(1);
    await expect.poll(() => page.evaluate(() => _alertAudioRequested)).toBe(false);
    expect(await page.evaluate(() => window.browserAudioDelivery.policy.type)).toBe('auto');
    const stoppedPlayCount = await page.evaluate(() => window.browserAudioDelivery.plays.length);
    await page.getByText('Parked diagnostics', { exact: true }).click();
    expect(await page.evaluate(() => window.browserAudioDelivery.plays.length)).toBe(stoppedPlayCount);
    expect(errors).toEqual([]);
  });
}
