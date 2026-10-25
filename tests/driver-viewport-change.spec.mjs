import { test, expect } from '@playwright/test';

const notice = 'Screen changed size. If you unfolded your phone, recalibrate when parked.';

async function ready(page, features = 'present') {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.addInitScript(features => {
    window.__viewportCameraOpens = 0;
    window.__viewportTrackStops = 0;
    window.__viewportSettingsReads = 0;
    const media = new EventTarget();
    media.enumerateDevices = async () => [];
    media.getUserMedia = async () => { throw Error('Unexpected hardware access'); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied' } });
    const orientation = new EventTarget();
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: orientation });
    if (features === 'present') {
      Object.defineProperty(navigator, 'devicePosture', { configurable: true, value: { type: 'folded' } });
      window.viewport = { segments: [{ x: 0, y: 0, width: 400, height: 800 }, { x: 410, y: 0, width: 390, height: 800 }] };
    } else if (features === 'throwing') {
      Object.defineProperty(navigator, 'devicePosture', { configurable: true, get() { throw Error('Unavailable'); } });
      Object.defineProperty(window, 'viewport', { configurable: true, get() { throw Error('Unavailable'); } });
    } else {
      Object.defineProperty(navigator, 'devicePosture', { configurable: true, value: undefined });
      Object.defineProperty(window, 'viewport', { configurable: true, value: undefined });
    }
  }, features);
  await page.goto('/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.evaluate(() => {
    initModel = async () => {};
    verifyFirstInference = async () => {};
    video.play = async () => {};
    gpsConsent.checked = false;
    cloudConsent.checked = false;
    openSelectedCamera = async () => {
      window.__viewportCameraOpens++;
      const track = new EventTarget();
      track.readyState = 'live';
      track.muted = false;
      track.getSettings = () => {
        window.__viewportSettingsReads++;
        return { width: 480, height: 360, frameRate: 12, facingMode: 'user', deviceId: 'private-device-id', groupId: 'private-group' };
      };
      track.stop = () => { window.__viewportTrackStops++; track.readyState = 'ended'; };
      window.__viewportTrack = track;
      const fixture = new MediaStream();
      fixture.getTracks = () => [track];
      fixture.getVideoTracks = () => [track];
      window.__viewportStream = fixture;
      return fixture;
    };
  });
}

async function start(page) {
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
}

test('large resize keeps the current camera and thresholds while marking the next parked calibration stale', async ({ page }) => {
  await ready(page);
  await start(page);
  await page.evaluate(() => {
    calibrating = false;
    calibrated = true;
    baselineEAR = .3;
    eyeClosedThreshold = .2;
    eyeWatchThreshold = .24;
  });
  await page.setViewportSize({ width: 1200, height: 850 });
  await expect(page.locator('#viewportWarning')).toHaveText(notice);
  await expect(page.locator('#viewportWarning')).toBeVisible();
  expect(await page.evaluate(() => ({ running, calibrated, calibrating, baselineEAR, eyeClosedThreshold, eyeWatchThreshold,
    retainedStream: stream === window.__viewportStream && video.srcObject === window.__viewportStream,
    retainedTrack: guardedCameraTrack === window.__viewportTrack, opens: window.__viewportCameraOpens, stops: window.__viewportTrackStops })))
    .toEqual({ running: true, calibrated: true, calibrating: false, baselineEAR: .3, eyeClosedThreshold: .2, eyeWatchThreshold: .24,
      retainedStream: true, retainedTrack: true, opens: 1, stops: 0 });
  const snapshot = await page.evaluate(() => window.OcculertViewport.snapshot());
  expect(snapshot.calibrationStaleForNextStart).toBe(true);
  expect(snapshot.events).toHaveLength(2);
  expect(snapshot.events[1]).toEqual({ source: 'resize', viewport: { width: 1200, height: 850 },
    capture: { width: 480, height: 360, frameRate: 12, facingMode: 'user' }, posture: 'folded',
    segments: [{ x: 0, y: 0, width: 400, height: 800 }, { x: 410, y: 0, width: 390, height: 800 }] });
  await expect(page.locator('#log')).toContainText('Calibration is stale for the next parked start');
  expect(await page.evaluate(() => window.__viewportSettingsReads)).toBe(2);
  // These diagnostics are separate from the cloud/session payload and export.
  expect(await page.evaluate(() => JSON.stringify(fleetPayload()))).not.toMatch(/viewport|posture|segments|private-device|private-group/);
  await page.evaluate(() => {
    const result = window.OcculertViewport.snapshot();
    result.events[0].viewport.width = 1;
    result.events[0].segments[0].width = 1;
    result.events.length = 0;
  });
  expect((await page.evaluate(() => window.OcculertViewport.snapshot())).events[0].viewport.width).toBe(800);
});

test('strict 25 percent threshold accumulates gradual resizing and deduplicates orientation events', async ({ page }) => {
  await ready(page, 'missing');
  await start(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.evaluate(() => window.screen.orientation.dispatchEvent(new Event('change')));
  expect((await page.evaluate(() => window.OcculertViewport.snapshot())).events).toHaveLength(1);
  await expect(page.locator('#viewportWarning')).toBeHidden();
  await page.setViewportSize({ width: 1001, height: 800 });
  await expect(page.locator('#viewportWarning')).toHaveText(notice);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.screen.orientation.dispatchEvent(new Event('change'));
  });
  expect((await page.evaluate(() => window.OcculertViewport.snapshot())).events).toHaveLength(2);
  // Exercise the orientation listener with actual changed window geometry.
  await page.evaluate(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1100 });
    window.screen.orientation.dispatchEvent(new Event('change'));
  });
  const snapshot = await page.evaluate(() => window.OcculertViewport.snapshot());
  expect(snapshot.events).toHaveLength(3);
  expect(snapshot.events[2].source).toBe('orientation');
  expect(snapshot.events[2].viewport).toEqual({ width: 1001, height: 1100 });
  expect(snapshot.events[2].posture).toBeNull();
  expect(snapshot.events[2].segments).toEqual([]);
});

test('stopping retains the stale note, ignores parked resizes and starts a fresh calibration next time', async ({ page }) => {
  await ready(page);
  await start(page);
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('#viewportWarning')).toHaveText(notice);
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await page.setViewportSize({ width: 700, height: 700 });
  expect((await page.evaluate(() => window.OcculertViewport.snapshot())).events).toHaveLength(2);
  expect((await page.evaluate(() => window.OcculertViewport.snapshot())).calibrationStaleForNextStart).toBe(true);
  await expect(page.locator('#viewportWarning')).toHaveText(notice);
  await start(page);
  await expect(page.locator('#viewportWarning')).toBeHidden();
  expect(await page.evaluate(() => ({ running, calibrating, calibrated, samples: calibrationSamples.length, baselineEAR,
    snapshot: window.OcculertViewport.snapshot(), opens: window.__viewportCameraOpens })))
    .toEqual({ running: true, calibrating: true, calibrated: false, samples: 0, baselineEAR: .28,
      snapshot: { calibrationStaleForNextStart: false, events: [{ source: 'start', viewport: { width: 700, height: 700 },
        capture: { width: 480, height: 360, frameRate: 12, facingMode: 'user' }, posture: 'folded',
        segments: [{ x: 0, y: 0, width: 400, height: 800 }, { x: 410, y: 0, width: 390, height: 800 }] }] }, opens: 2 });
  await expect(page.locator('#log')).toContainText('Starting fresh parked calibration after the screen changed size');
});

test('failed optional geometry/settings getters never stop capture or bypass an ended-track stop', async ({ page }) => {
  await ready(page, 'throwing');
  await start(page);
  await page.evaluate(() => { window.__viewportTrack.getSettings = () => { throw Error('Settings unavailable'); }; });
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('#viewportWarning')).toHaveText(notice);
  expect(await page.evaluate(() => running)).toBe(true);
  const snapshot = await page.evaluate(() => window.OcculertViewport.snapshot());
  expect(snapshot.events[1].capture).toEqual({});
  expect(snapshot.events[1].posture).toBeNull();
  expect(snapshot.events[1].segments).toEqual([]);
  await page.evaluate(() => window.__viewportTrack.dispatchEvent(new Event('ended')));
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await expect(page.locator('#overlayTitle')).toHaveText('Camera Disconnected');
  expect(await page.evaluate(() => running)).toBe(false);
});

test('a resize leaves the pending mute timer intact and diagnostics stay bounded', async ({ page }) => {
  await ready(page);
  await start(page);
  await page.evaluate(() => {
    window.__viewportTrack.muted = true;
    window.__viewportTrack.dispatchEvent(new Event('mute'));
    window.__muteTimerBeforeResize = cameraMuteTimer;
    for (let index = 0; index < 30; index++) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: index % 2 ? 800 : 1200 });
      window.dispatchEvent(new Event('resize'));
    }
  });
  expect(await page.evaluate(() => ({ running, timerUnchanged: cameraMuteTimer === window.__muteTimerBeforeResize,
    events: window.OcculertViewport.snapshot().events.length, opens: window.__viewportCameraOpens, stops: window.__viewportTrackStops })))
    .toEqual({ running: true, timerUnchanged: true, events: 20, opens: 1, stops: 0 });
  await expect(page.locator('#overlayTitle')).toHaveText('Camera Paused', { timeout: 7000 });
  expect(await page.evaluate(() => running)).toBe(false);
});
