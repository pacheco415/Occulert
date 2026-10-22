import { test, expect } from '@playwright/test';

const MINUTE = 60_000;

async function ready(page) {
  await page.clock.install({ time: new Date('2026-10-21T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-21T12:01:00Z'));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('occulert-voice', 'true');
    window.restProbe = { hardwareRequests: 0, cameraOpens: 0, speech: [] };
    const media = new EventTarget();
    media.enumerateDevices = async () => [];
    media.getUserMedia = async () => { window.restProbe.hardwareRequests++; throw Error('Unexpected physical camera access'); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied' } });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
    window.Audio = class {
      constructor(src) { this.src = src; this.currentTime = 0; this.paused = true; }
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      paused: false, resume() {}, cancel() {}, speak(utterance) { window.restProbe.speech.push(utterance.text); },
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  });
  await page.goto('/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.evaluate(() => {
    // Keep actual session lifecycle, yawn detection and accepted-alert hooks.
    // Only physical camera/model/audio bridges are substituted in this fixture.
    initModel = async () => {};
    openSelectedCamera = async () => {
      window.restProbe.cameraOpens++;
      const track = new EventTarget();
      track.readyState = 'live'; track.muted = false;
      track.getSettings = () => ({ deviceId: 'rest-prompt-software-fixture' });
      track.stop = () => { track.readyState = 'ended'; };
      const stream = new MediaStream();
      stream.getTracks = () => [track]; stream.getVideoTracks = () => [track];
      return stream;
    };
    verifyFirstInference = async () => {};
    video.play = async () => {};
    loop = () => {};
    gpsConsent.checked = false; cloudConsent.checked = false;
    window.restMouthFrame = open => {
      const points = Array.from({ length: 468 }, () => ({ x: .5, y: .5, z: 0 }));
      points[61] = { x: .4, y: .5, z: 0 }; points[291] = { x: .6, y: .5, z: 0 };
      points[13] = { x: .5, y: open ? .4 : .5, z: 0 };
      points[14] = { x: .5, y: open ? .6 : .5, z: 0 };
      return points;
    };
  });
  await start(page);
}

async function start(page) {
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await page.evaluate(() => { calibrating = false; confidence = 70; });
}

async function yawn(page) {
  await page.clock.fastForward(8001);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) detectYawn(window.restMouthFrame(true));
  });
  await page.clock.fastForward(1201);
  await page.evaluate(() => {
    detectYawn(window.restMouthFrame(true));
    for (let i = 0; i < 5; i++) detectYawn(window.restMouthFrame(false));
  });
}

async function alerts(page, count) {
  for (let i = 0; i < count; i++) {
    await page.clock.fastForward(12_001);
    await page.evaluate(() => trigger('Fatigue'));
  }
}

const promptCount = page => page.evaluate(() => window.restProbe.speech.filter(text => text.startsWith('Rest stop recommended.')).length);

test('three real yawns report yawns separately from accepted alerts', async ({ page }) => {
  await ready(page);
  for (let i = 0; i < 3; i++) await yawn(page);
  await expect(page.locator('#breakBanner')).toBeVisible();
  await expect(page.locator('#breakBanner')).toContainText('0 alerts, 3 yawns');
  expect(await page.evaluate(() => ({ alerts, yawns: yawnCount, hardware: window.restProbe.hardwareRequests })))
    .toEqual({ alerts: 0, yawns: 3, hardware: 0 });
  expect(await promptCount(page)).toBe(1);
});

test('mixed accepted alerts and real yawns retain their individual counts', async ({ page }) => {
  await ready(page);
  await alerts(page, 2);
  await expect(page.locator('#breakBanner')).toBeHidden();
  await yawn(page);
  await expect(page.locator('#breakBanner')).toContainText('2 alerts, 1 yawn');
  expect(await page.evaluate(() => ({ alerts, yawns: yawnCount }))).toEqual({ alerts: 2, yawns: 1 });
  expect(await promptCount(page)).toBe(1);
});

test('a second real session resets event counts, banner and reminder cooldown', async ({ page }) => {
  await ready(page);
  await alerts(page, 2); await yawn(page);
  await expect(page.locator('#breakBanner')).toBeVisible();
  await page.clock.fastForward(1301);
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await expect(page.locator('#breakBanner')).toBeHidden();
  await start(page);
  expect(await page.evaluate(() => ({ alerts: _alertsSinceBreak, yawns: _yawnsSinceBreak, lastPrompt: _lastBreakPrompt })))
    .toEqual({ alerts: 0, yawns: 0, lastPrompt: 0 });
  await expect(page.locator('#breakBanner')).toBeHidden();
  await alerts(page, 3);
  await expect(page.locator('#breakBanner')).toContainText('3 alerts, 0 yawns');
  expect(await promptCount(page)).toBe(2);
  expect(await page.evaluate(() => window.restProbe.cameraOpens)).toBe(2);
});

test('a forty-minute drive prompts without alert or yawn events', async ({ page }) => {
  await ready(page);
  // Skip the idle period, then run the final minute's real interval ticks.
  await page.clock.fastForward(39 * MINUTE);
  await page.clock.runFor(MINUTE - 1);
  await expect(page.locator('#breakBanner')).toBeHidden();
  expect(await promptCount(page)).toBe(0);
  await page.clock.runFor(1);
  await expect(page.locator('#breakBanner')).toBeVisible();
  await expect(page.locator('#breakBanner')).toContainText('40 min driving, 0 alerts, 0 yawns');
  expect(await page.evaluate(() => ({ alerts, yawns: yawnCount }))).toEqual({ alerts: 0, yawns: 0 });
  expect(await promptCount(page)).toBe(1);
  await page.clock.fastForward(14 * MINUTE);
  expect(await promptCount(page)).toBe(1);
});

test('Stop cancels future timer prompts and voice delivery', async ({ page }) => {
  await ready(page);
  await page.clock.fastForward(39 * MINUTE);
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await page.clock.fastForward(20 * MINUTE);
  await expect(page.locator('#breakBanner')).toBeHidden();
  expect(await promptCount(page)).toBe(0);
  expect(await page.evaluate(() => timerInterval)).toBeNull();
});

test('Dismiss clears both event counts and preserves the existing reminder cooldown', async ({ page }) => {
  await ready(page);
  await alerts(page, 2); await yawn(page);
  const promptedAt = await page.evaluate(() => _lastBreakPrompt);
  await page.locator('#breakBanner').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('#breakBanner')).toBeHidden();
  expect(await page.evaluate(() => ({ alerts: _alertsSinceBreak, yawns: _yawnsSinceBreak, lastPrompt: _lastBreakPrompt })))
    .toEqual({ alerts: 0, yawns: 0, lastPrompt: promptedAt });
  await alerts(page, 3);
  await expect(page.locator('#breakBanner')).toBeHidden();
  expect(await promptCount(page)).toBe(1);
  const wait = await page.evaluate(() => 15 * 60_000 - (Date.now() - _lastBreakPrompt) + 1);
  await page.clock.fastForward(wait);
  await page.evaluate(() => triggerBreakCheck());
  await expect(page.locator('#breakBanner')).toContainText('3 alerts, 0 yawns');
  expect(await promptCount(page)).toBe(2);
});
