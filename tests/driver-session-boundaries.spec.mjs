import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.addInitScript(() => {
    const media = new EventTarget();
    media.enumerateDevices = async () => [];
    media.getUserMedia = async () => { throw Error('Unexpected hardware access'); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied' } });
    window.__gpsCallbacks = [];
    window.__clearedGps = [];
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(success, error) { window.__gpsCallbacks.push({ success, error }); return window.__gpsCallbacks.length; },
      clearWatch(id) { window.__clearedGps.push(id); },
    } });
  });
  await page.goto('/app.html');
  await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
  await page.evaluate(() => {
    // Exercise the shipped lifecycle with synthetic device boundaries only.
    // These checks make no claim about real GPS/camera/alert delivery.
    initModel = async () => {};
    verifyFirstInference = async () => {};
    openSelectedCamera = async () => new MediaStream();
    video.play = async () => {};
    loop = () => {};
    initCloud = async () => {};
    requestSessionWakeLock = async () => {};
    cloudConsent.checked = false;
    gpsConsent.checked = true;
  });
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
}

async function sendLocation(page, index, latitude) {
  await page.evaluate(({ index, latitude }) => {
    window.__gpsCallbacks[index].success({ coords: { latitude, longitude: -122.1, accuracy: 5, speed: 0 } });
  }, { index, latitude });
}

test('late GPS callbacks cannot change a stopped or restarted driver session', async ({ page }) => {
  await ready(page);
  await sendLocation(page, 0, 37.1);
  await expect(page.locator('#gps')).toHaveText('ON');
  await page.locator('#startBtn').click();
  await expect(page.locator('#gps')).toHaveText('SAVED');
  const stopped = await page.evaluate(() => JSON.stringify({ lastPosition, routePoints, distanceMeters }));
  await sendLocation(page, 0, 37.2);
  expect(await page.evaluate(() => JSON.stringify({ lastPosition, routePoints, distanceMeters }))).toBe(stopped);

  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await sendLocation(page, 0, 37.3);
  expect(await page.evaluate(() => ({ position: lastPosition, count: routePoints.length }))).toEqual({ position: null, count: 0 });
  await sendLocation(page, 1, 37.4);
  await page.evaluate(() => window.__gpsCallbacks[0].error({ message: 'Superseded location error' }));
  await expect(page.locator('#gps')).toHaveText('ON');
  expect(await page.evaluate(() => ({ latitude: lastPosition.lat, count: routePoints.length, distanceMeters })))
    .toEqual({ latitude: 37.4, count: 1, distanceMeters: 0 });
});

test('a foreground stop displays immediately and late cloud completion preserves the restarted UI', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    cloudConsent.checked = true;
    backendSessionScope = { ownerId: 'synthetic-owner', revision: cloudConsentRevision };
    backendSessionId = 'synthetic-session';
    backendSessionPromise = Promise.resolve('synthetic-session');
    backendEventQueue = new Promise(resolve => { window.__releaseOldEvent = resolve; });
    window.__oldForegroundStop = handleVisibilityChange(true);
  });
  await expect(page.locator('#driveState')).toHaveText('MONITORING STOPPED');
  await page.evaluate(() => { cloudConsent.checked = false; });
  await page.locator('#startBtn').click();
  await expect(page.locator('#driveState')).toHaveText('CALIBRATING');
  await page.evaluate(async () => { window.__releaseOldEvent(); await window.__oldForegroundStop; });
  expect(await page.evaluate(() => running)).toBe(true);
  await expect(page.locator('#driveState')).toHaveText('CALIBRATING');
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
});
