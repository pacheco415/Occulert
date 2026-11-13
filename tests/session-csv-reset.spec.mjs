import { test, expect } from '@playwright/test';

async function exportSession(page) {
  const downloadReady = page.waitForEvent('download');
  await page.evaluate(() => exportCSV());
  const download = await downloadReady;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('each successful session starts a fresh CSV while stopped or failed starts preserve the previous export', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-09T12:01:00Z'));
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
    // Use the released lifecycle and five-second sampling interval, replacing
    // only hardware/model adapters. No cloud session or real camera is opened.
    initModel = async () => {};
    verifyFirstInference = async () => {};
    video.play = async () => {};
    gpsConsent.checked = false;
    cloudConsent.checked = false;
    window.csvCameraUnavailable = false;
    openSelectedCamera = async () => {
      if (window.csvCameraUnavailable) throw new Error('Fixture camera unavailable');
      return new MediaStream();
    };
  });

  await page.evaluate(async () => { await start(); fatigue = 17; });
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await page.clock.runFor(5_000);
  await page.evaluate(() => stop());
  const first = await exportSession(page);
  expect(first.split('\n')).toEqual([
    'Timestamp,Type,Value,Extra',
    '"2026-11-09T12:01:05.000Z","fatigue","17",""',
  ]);

  await page.clock.fastForward(55_000);
  await page.evaluate(async () => { window.csvCameraUnavailable = true; await start(); });
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  expect(await exportSession(page)).toBe(first);

  await page.evaluate(async () => { window.csvCameraUnavailable = false; await start(); fatigue = 33; });
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await page.clock.runFor(5_000);
  await page.evaluate(() => stop());
  const second = await exportSession(page);
  expect(second.split('\n')).toEqual([
    'Timestamp,Type,Value,Extra',
    '"2026-11-09T12:02:05.000Z","fatigue","33",""',
  ]);
  expect(second).not.toContain('2026-11-09T12:01:05.000Z');
});
