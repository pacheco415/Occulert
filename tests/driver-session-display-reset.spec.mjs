import { test, expect } from '@playwright/test';

// Released lifecycle with only hardware/model adapters replaced. No real
// camera, cloud session or location is opened.
async function openDriver(page) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    const devices = new EventTarget();
    devices.enumerateDevices = async () => [];
    devices.getUserMedia = async () => { throw Error('Unexpected hardware access'); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied' } });
  });
  await page.goto('/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.evaluate(() => {
    initModel = async () => {};
    verifyFirstInference = async () => {};
    video.play = async () => {};
    gpsConsent.checked = false;
    cloudConsent.checked = false;
    openSelectedCamera = async () => new MediaStream();
  });
}

// Synthetic open-eye landmarks: EAR 0.300, centered face, closed mouth.
async function feedOpenFace(page, frames) {
  await page.evaluate(async count => {
    const points = Array.from({ length: 468 }, () => ({ x: .5, y: .5, z: 0 }));
    const eye = ([c1, t1, t2, c2, b1, b2], cx) => {
      points[c1] = { x: cx - .04, y: .4, z: 0 }; points[c2] = { x: cx + .04, y: .4, z: 0 };
      points[t1] = { x: cx - .015, y: .388, z: 0 }; points[t2] = { x: cx + .015, y: .388, z: 0 };
      points[b2] = { x: cx - .015, y: .412, z: 0 }; points[b1] = { x: cx + .015, y: .412, z: 0 };
    };
    eye(LEFT, .6); eye(RIGHT, .4);
    points[234] = { x: .3, y: .5, z: 0 }; points[454] = { x: .7, y: .5, z: 0 };
    points[13] = { x: .5, y: .6, z: 0 }; points[14] = { x: .5, y: .61, z: 0 };
    points[61] = { x: .45, y: .6, z: 0 }; points[291] = { x: .55, y: .6, z: 0 };
    for (let i = 0; i < count; i++) {
      onResults({ multiFaceLandmarks: [points] });
      await new Promise(resolve => setTimeout(resolve, 140));
    }
  }, frames);
}

test('a stopped session keeps its last real EAR and clears the live face reading', async ({ page }) => {
  await openDriver(page);
  await page.evaluate(() => start());
  await feedOpenFace(page, 30);
  await expect(page.locator('#calibration')).toHaveText('DONE');
  await expect(page.locator('#faceState')).toHaveText('OK');
  await expect(page.locator('#ear')).toHaveText('0.300');

  await page.evaluate(() => stop());
  // The stop render previously used a fake 0.001 EAR to bypass its throttle.
  await expect(page.locator('#ear')).toHaveText('0.300');
  // Face presence is live; a calibrated session previously left "OK" showing.
  await expect(page.locator('#faceState')).toHaveText('--');
  await expect(page.locator('#calibration')).toHaveText('DONE');
});

test('a new session starts with an empty chart and no previous live readings', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T12:00:00Z') });
  await openDriver(page);
  await page.evaluate(async () => { await start(); fatigue = 90; });
  await page.clock.runFor(5_000);
  await page.evaluate(() => stop());
  expect(await page.evaluate(() => _chartData.map(point => point.v))).toEqual([90]);
  await page.evaluate(() => { document.getElementById('ear').textContent = '0.310'; document.getElementById('marEl').textContent = '0.12'; });

  await page.evaluate(async () => { await start(); fatigue = 5; });
  expect(await page.evaluate(() => _chartData.length)).toBe(0);
  await expect(page.locator('#ear')).toHaveText('--');
  await expect(page.locator('#marEl')).toHaveText('--');
  await page.clock.runFor(5_000);
  // The previous session's 90 no longer leads the new session's chart.
  expect(await page.evaluate(() => _chartData.map(point => point.v))).toEqual([5]);
  await page.evaluate(() => stop());
});

test('clearing on-screen diagnostics resets every session reading it shows', async ({ page }) => {
  await openDriver(page);
  await page.evaluate(() => start());
  await feedOpenFace(page, 30);
  await page.evaluate(() => {
    yawnCount = 2; document.getElementById('yawnCountEl').textContent = '2';
    document.getElementById('marEl').textContent = '0.12';
    updateChart(40); updateChart(60);
  });
  await page.evaluate(() => stop());
  await expect(page.locator('#confidence')).not.toHaveText('0%');

  page.once('dialog', dialog => dialog.accept());
  // Clear immediately after stop: the render throttle must not keep old values.
  await page.locator('#resetBtn').evaluate(button => button.click());
  await expect(page.locator('#yawnCountEl')).toHaveText('0');
  await expect(page.locator('#marEl')).toHaveText('--');
  await expect(page.locator('#ear')).toHaveText('--');
  await expect(page.locator('#faceState')).toHaveText('--');
  await expect(page.locator('#calibration')).toHaveText('NOT STARTED');
  await expect(page.locator('#confidence')).toHaveText('0%');
  await expect(page.locator('#fatigue')).toHaveText('0');
  expect(await page.evaluate(() => ({ chart: _chartData.length, yawns: yawnCount, calibrated }))).toEqual({ chart: 0, yawns: 0, calibrated: false });
});

test('the eye overlay canvas follows a same-width video height change', async ({ page }) => {
  await openDriver(page);
  const sizes = await page.evaluate(async () => {
    let width = 640, height = 480;
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => width });
    Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => height });
    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 });
    // A ready detector whose frames return no landmarks; only sizing matters.
    faceMesh = { send: async () => {}, close: () => {} };
    sendFaceMeshFrame = async () => {};
    await start();
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settle = async () => { for (let i = 0; i < 20; i++) await frame(); };
    await settle();
    const first = [canvas.width, canvas.height];
    height = 360;
    await settle();
    const second = [canvas.width, canvas.height];
    await stop();
    return { first, second };
  });
  expect(sizes.first).toEqual([640, 480]);
  expect(sizes.second).toEqual([640, 360]);
});
