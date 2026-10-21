import { test, expect } from '@playwright/test';

const viewports = [
  { width: 313, height: 890 }, { width: 320, height: 568 },
  { width: 390, height: 844 }, { width: 445, height: 626 },
  { width: 568, height: 320 }, { width: 844, height: 390 },
];

async function ready(page, viewport, holdModel = false) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.__compactDeviceRequests = 0;
    window.__compactCameraOpens = 0;
    const media = new EventTarget();
    media.enumerateDevices = async () => [];
    media.getUserMedia = async () => { window.__compactDeviceRequests++; throw Error('Unexpected hardware access'); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied' } });
  });
  await page.goto('/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.evaluate(holdModel => {
    // Exercise the actual lifecycle with a software-only camera/model adapter.
    // This verifies layout/recovery, not camera accuracy or device acceptance.
    const track = new EventTarget();
    track.readyState = 'live';
    track.muted = false;
    track.getSettings = () => ({ deviceId: 'compact-software-fixture' });
    track.stop = () => { track.readyState = 'ended'; };
    window.__compactTrack = track;
    const fixture = new MediaStream();
    fixture.getTracks = () => [track];
    fixture.getVideoTracks = () => [track];
    initModel = holdModel ? () => new Promise(resolve => { window.__releaseCompactModel = resolve; }) : async () => {};
    openSelectedCamera = async () => { window.__compactCameraOpens++; return fixture; };
    verifyFirstInference = async () => {};
    video.play = async () => {};
    gpsConsent.checked = false;
    cloudConsent.checked = false;
  }, holdModel);
}

async function inViewport(locator, viewport) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function stopIsUsable(page, viewport) {
  const button = page.locator('#startBtn');
  await inViewport(button, viewport);
  await expect(button).toBeEnabled();
  const box = await button.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await button.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
}

for (const viewport of viewports) test(`compact ${viewport.width}x${viewport.height} preserves Stop, status and parked recovery`, async ({ page }) => {
  await ready(page, viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.locator('#driverOverview').scrollIntoViewIfNeeded();
  await expect(page.locator('#overviewRefresh')).toBeVisible();
  await page.locator('#startBtn').scrollIntoViewIfNeeded();
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await expect(page.locator('#parkedControls')).toBeHidden();
  await expect(page.locator('#driveState')).toHaveText('CALIBRATING');
  await stopIsUsable(page, viewport);
  await inViewport(page.locator('#driverPanelTitle'), viewport);
  await inViewport(page.locator('#driveState'), viewport);
  const camera = await page.locator('.camera').boundingBox();
  const panel = await page.locator('#driverPanel').boundingBox();
  expect(camera.width).toBeGreaterThan(90);
  expect(camera.height).toBeGreaterThan(80);
  const intersection = Math.max(0, Math.min(camera.x + camera.width, panel.x + panel.width) - Math.max(camera.x, panel.x))
    * Math.max(0, Math.min(camera.y + camera.height, panel.y + panel.height) - Math.max(camera.y, panel.y));
  expect(intersection).toBe(0);
  await page.locator('#driverSecondary').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.locator('#monitoringMessages').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await stopIsUsable(page, viewport);
  await page.locator('#startBtn').click();
  await expect(page.locator('body')).not.toHaveClass(/monitoring-active/);
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await page.locator('#driverOverview').scrollIntoViewIfNeeded();
  await expect(page.locator('#overviewRefresh')).toBeVisible();
  expect(await page.evaluate(() => window.__compactDeviceRequests)).toBe(0);
  expect(await page.evaluate(() => window.__compactCameraOpens)).toBe(1);
});

test('preparation moves focus from hidden setup to status and returns to parked recovery after foreground loss', async ({ page }) => {
  const viewport = { width: 313, height: 626 };
  await ready(page, viewport, true);
  await page.locator('#sensitivityHigh').focus();
  await page.evaluate(() => { void start(); });
  await expect(page.locator('#startBtn')).toHaveText('STARTING...');
  await expect(page.locator('#stateCard')).toBeFocused();
  await expect(page.locator('#driveState')).toHaveText('PREPARING MONITORING');
  await expect(page.locator('#parkedControls')).toBeHidden();
  await expect(page.locator('#startBtn')).toBeDisabled();
  await page.evaluate(async () => {
    await handleVisibilityChange(true);
    window.__releaseCompactModel();
  });
  await expect.poll(() => page.evaluate(() => starting)).toBe(false);
  await expect(page.locator('#startBtn')).toBeEnabled();
  await expect(page.locator('#overlayTitle')).toHaveText('Monitoring Paused');
  await inViewport(page.locator('#overlayTitle'), viewport);
  expect(await page.evaluate(() => window.__compactCameraOpens)).toBe(0);
  expect(await page.evaluate(() => ({ running, requests: window.__compactDeviceRequests })))
    .toEqual({ running: false, requests: 0 });
});

test('large text preserves the stop target and full recovery text without horizontal scrolling', async ({ page }) => {
  const viewport = { width: 320, height: 568 };
  await ready(page, viewport);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await page.evaluate(() => {
    noFaceSince = Date.now();
    render(.001);
  });
  await expect(page.locator('#driveState')).toHaveText('TRACKING UNAVAILABLE');
  await stopIsUsable(page, viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.locator('#driveHint').scrollIntoViewIfNeeded();
  await expect(page.locator('#driveHint')).toContainText('Pull over safely before adjusting the phone');
  await expect(page.locator('#driveHint')).not.toHaveCSS('text-overflow', 'ellipsis');
  await stopIsUsable(page, viewport);
  await page.locator('#startBtn').click();
  await expect(page.locator('#parkedControls')).toBeVisible();
});

test('camera disconnect exposes stopped guidance and never restarts capture', async ({ page }) => {
  const viewport = { width: 568, height: 320 };
  await ready(page, viewport);
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await page.evaluate(() => window.__compactTrack.dispatchEvent(new Event('ended')));
  await expect(page.locator('#driveState')).toHaveText('MONITORING STOPPED');
  await expect(page.locator('#driveHint')).toContainText('Camera monitoring stopped. Pull over safely before restarting.');
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await inViewport(page.locator('#driveHint'), viewport);
  await expect(page.locator('#stateCard')).toBeFocused();
  expect(await page.evaluate(() => window.__compactCameraOpens)).toBe(1);
  expect(await page.evaluate(() => ({ running, requests: window.__compactDeviceRequests })))
    .toEqual({ running: false, requests: 0 });
});

test('large landscape text and the active alert leave Stop unobstructed', async ({ page }) => {
  const viewport = { width: 568, height: 320 };
  await ready(page, viewport);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await page.evaluate(() => { _alertAudioRequested = false; playStrongAlert(3); });
  await expect(page.locator('#alertScreen')).toHaveClass(/show/);
  await page.getByRole('region', { name: 'DROWSY ALERT', exact: true }).focus();
  await expect(page.locator('#alertScreen')).toBeFocused();
  await page.keyboard.press('End');
  await inViewport(page.locator('#alertSub'), viewport);
  await expect(page.locator('#alertSub')).toHaveText('Pull over safely');
  await stopIsUsable(page, viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.locator('#startBtn').click();
  await expect(page.locator('#alertScreen')).not.toHaveClass(/show/);
  expect(await page.evaluate(() => window.__compactCameraOpens)).toBe(1);
});

test('parked camera guidance is keyboard scrollable on a short phone viewport', async ({ page }) => {
  const viewport = { width: 320, height: 568 };
  await ready(page, viewport);
  await page.getByRole('region', { name: 'AI Fatigue Monitoring', exact: true }).focus();
  await expect(page.locator('#overlay')).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => page.locator('#overlay').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await inViewport(page.locator('#overlayHint'), viewport);
  expect(await page.evaluate(() => window.__compactCameraOpens)).toBe(0);
});

test('keyboard users can scroll full status and secondary details while Stop stays visible', async ({ page }) => {
  const viewport = { width: 320, height: 568 };
  await ready(page, viewport);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.locator('#startBtn').click();
  await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
  await page.locator('#startBtn').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Monitoring status and guidance' })).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => page.locator('#monitoringMessages').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await stopIsUsable(page, viewport);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Session details and safety notice' })).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => page.locator('#driverSecondary').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await stopIsUsable(page, viewport);
  await page.locator('#startBtn').click();
  await expect(page.locator('#parkedControls')).toBeVisible();
});
