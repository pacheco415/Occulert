import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Resolve the currently served immutable driver when Playwright loads this file.
const versions = JSON.parse(readFileSync(new URL('../asset-versions.json', import.meta.url), 'utf8'));

async function installStorageFailure(page, mode) {
  await page.addInitScript(mode => {
    const storage = window.localStorage;
    const originalSet = Storage.prototype.setItem;
    storage.clear();
    originalSet.call(storage, 'occulert-driver-id', 'local-preference-browser-fixture');
    window.__preferenceProbe = { cameraCalls: 0, cloudCalls: [], getterFailures: 0, writeFailures: 0, writeKeys: [] };
    if (mode === 'getter') {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() {
        window.__preferenceProbe.getterFailures++;
        throw new DOMException('Injected blocked storage property', 'SecurityError');
      } });
    } else {
      Storage.prototype.setItem = function(key, value) {
        if (this === storage) {
          window.__preferenceProbe.writeFailures++;
          window.__preferenceProbe.writeKeys.push(String(key));
          throw new DOMException('Injected preference write failure', 'QuotaExceededError');
        }
        return originalSet.call(this, key, value);
      };
    }
    const devices = new EventTarget();
    devices.enumerateDevices = async () => [];
    devices.getUserMedia = async () => {
      window.__preferenceProbe.cameraCalls++;
      throw Error('This software test must not access a camera');
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
        window.__preferenceProbe.cloudCalls.push(url.pathname);
      }
      return originalFetch(input, options);
    };
  }, mode);
}

async function setupSyntheticCalibration(page) {
  return page.evaluate(() => {
    // Exercise the actual compiled results/calibration path without camera,
    // model inference, permission prompts, or a detection-accuracy claim.
    const startedAt = Date.now();
    window.__preferenceTime = 0;
    Date.now = () => startedAt + window.__preferenceTime;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 360 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    canvas.width = 360;
    canvas.height = 480;
    running = true;
    sessionStart = startedAt;
    localSessionId = 'preference-storage-synthetic-session';
    confidence = 100;
    fatigue = 0;
    alerts = 0;
    lastAlert = 0;
    lastEscalation = 0;
    calibrating = true;
    calibrated = false;
    calibrationUntil = startedAt + CALIBRATION_MS;
    calibrationSamples = [];
    earHistory = [];
    noseYHistory = [];
    perclosWindow = [];
    eyesClosedSince = 0;
    turnedSince = 0;
    totalDistractionMs = 0;
    noFaceSince = 0;
    lastFaceSeen = 0;
    microsleeps = 0;
    lastMicro = 0;
    window.__preferenceFrame = (elapsed, ear = .30) => {
      window.__preferenceTime = elapsed;
      const landmarks = Array.from({ length: 468 }, () => ({ x: .5, y: .5, z: 0 }));
      for (const [indices, center] of [[LEFT, .62], [RIGHT, .38]]) {
        const height = ear * .1 / 2;
        const points = [[center-.05,.5], [center-.02,.5-height], [center+.02,.5-height],
          [center+.05,.5], [center+.02,.5+height], [center-.02,.5+height]];
        indices.forEach((index, i) => { landmarks[index] = { x: points[i][0], y: points[i][1], z: 0 }; });
      }
      landmarks[4] = { x: .5, y: .55, z: 0 };
      landmarks[234] = { x: .25, y: .6, z: 0 };
      landmarks[454] = { x: .75, y: .6, z: 0 };
      onResults({ multiFaceLandmarks: [landmarks] });
    };
    for (let elapsed = 0; elapsed <= 3240; elapsed += 135) window.__preferenceFrame(elapsed);
    return { calibrating, calibrated, baselineEAR, sensitivityLevel,
      closedOffset: eyeClosedThreshold - baseClosedThreshold, watchOffset: eyeWatchThreshold - baseWatchThreshold };
  });
}

for (const mode of ['getter', 'setItem']) {
  test(`${mode} storage failures preserve startup, session preferences, calibration and accepted alerts`, async ({ page }) => {
    await installStorageFailure(page, mode);
    const driverRequests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/' + versions['driver-app.js']) driverRequests.push(request.url());
    });
    await page.goto('/app.html');
    await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
    await expect(page.locator('#startBtn')).toBeEnabled();
    await expect(page.locator('#driverControls')).not.toHaveAttribute('disabled', /.*/);
    expect(driverRequests).toHaveLength(1);
    await expect(page.locator('#preferenceStorageNotice')).toHaveCount(1);
    await expect(page.locator('#preferenceStorageNotice')).toHaveText("Settings won't be saved on this device.");
    await expect(page.locator('html')).toHaveAttribute('data-intensity', 'standard');
    await expect(page.locator('#sensitivityMedium')).toHaveClass(/active/);
    await expect(page.locator('#voiceToggleBtn')).toHaveText(/Voice OFF/);
    expect(await page.evaluate(() => ({ sensitivity: sensitivityLevel, voice: _voiceEnabled,
      camera: window.__preferenceProbe.cameraCalls, cloud: window.__preferenceProbe.cloudCalls })))
      .toEqual({ sensitivity: 'medium', voice: false, camera: 0, cloud: [] });
    if (mode === 'setItem') {
      expect(await page.evaluate(() => driverId)).toBe('local-preference-browser-fixture');
    }

    await page.locator('#presetBright').click();
    await expect(page.locator('html')).toHaveAttribute('data-intensity', 'bright');
    await page.locator('#voiceToggleBtn').click();
    await expect(page.locator('#voiceToggleBtn')).toHaveText(/Voice ON/);
    expect(await page.evaluate(() => _voiceEnabled)).toBe(true);
    await page.locator('#voiceToggleBtn').click();
    await expect(page.locator('#voiceToggleBtn')).toHaveText(/Voice OFF/);
    await page.locator('#sensitivityHigh').click();
    await expect(page.locator('#sensitivityHigh')).toHaveClass(/active/);
    expect(await page.evaluate(() => sensitivityLevel)).toBe('high');

    const first = await setupSyntheticCalibration(page);
    expect(first.calibrating).toBe(false);
    expect(first.calibrated).toBe(true);
    expect(first.baselineEAR).toBeCloseTo(.30, 6);
    expect(first.sensitivityLevel).toBe('high');
    expect(first.closedOffset).toBeCloseTo(.03, 6);
    expect(first.watchOffset).toBeCloseTo(.03, 6);
    await expect(page.locator('#calibration')).toHaveText('DONE');

    const second = await page.evaluate(() => {
      // A second software calibration epoch exercises the live result path.
      // This page has no user-facing Recalibrate button; the optional handler
      // is covered separately by the Node driver harness.
      const began = window.__preferenceTime;
      calibrating = true;
      calibrated = false;
      calibrationSamples = [];
      calibrationUntil = Date.now() + CALIBRATION_MS;
      earHistory = [];
      for (let elapsed = 135; elapsed <= 3240; elapsed += 135) window.__preferenceFrame(began + elapsed);
      return { calibrating, calibrated, sensitivityLevel,
        closedOffset: eyeClosedThreshold - baseClosedThreshold, watchOffset: eyeWatchThreshold - baseWatchThreshold };
    });
    expect(second.calibrating).toBe(false);
    expect(second.calibrated).toBe(true);
    expect(second.sensitivityLevel).toBe('high');
    expect(second.closedOffset).toBeCloseTo(.03, 6);
    expect(second.watchOffset).toBeCloseTo(.03, 6);
    await expect(page.locator('#calibration')).toHaveText('DONE');
    await expect(page.locator('#sensitivityHigh')).toHaveClass(/active/);

    const accepted = await page.evaluate(() => {
      const began = window.__preferenceTime;
      for (let elapsed = 135; elapsed <= 4050; elapsed += 135) window.__preferenceFrame(began + elapsed, .08);
      const result = { alerts, calibrating, calibrated, sensitivityLevel,
        alertEvents: _sessionLog.filter(event => event.type === 'alert').length,
        probe: window.__preferenceProbe };
      running = false;
      return result;
    });
    expect(accepted.alerts).toBeGreaterThan(0);
    expect(accepted.alertEvents).toBeGreaterThan(0);
    await expect(page.locator('#log')).toContainText('Fatigue alert triggered');
    expect(accepted.calibrating).toBe(false);
    expect(accepted.calibrated).toBe(true);
    expect(accepted.sensitivityLevel).toBe('high');
    expect(accepted.probe.cameraCalls).toBe(0);
    expect(accepted.probe.cloudCalls).toEqual([]);
    expect(mode === 'getter' ? accepted.probe.getterFailures : accepted.probe.writeFailures).toBeGreaterThan(0);
    if (mode === 'setItem') {
      for (const key of ['occulert-intensity', 'occulert-voice', 'occulert-sensitivity']) {
        expect(accepted.probe.writeKeys).toContain(key);
      }
    }
    await expect(page.locator('#preferenceStorageNotice')).toHaveCount(1);
  });
}
