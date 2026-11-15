import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../asset-versions.json', import.meta.url), 'utf8'));

test('local Session Report preserves numeric coverage through late localization and shows unknown for calibration-only sessions', async ({ page }) => {
  let releaseCatalog;
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
  await page.route('**/' + manifest['driver-i18n.js'], async route => { await catalogGate; await route.continue(); });
  await page.addInitScript(() => {
    localStorage.setItem('occulert_lang', 'es');
    localStorage.setItem('occulert-session-history', '[]');
    window.__coverageTime = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => window.__coverageTime });
    const media = new EventTarget();
    media.enumerateDevices = async () => [];
    media.getUserMedia = async () => { throw Error('Unexpected real camera request'); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'denied' } });
  });
  try {
    await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.OcculertStartup?.isReady())).toBe(true);
    await page.evaluate(() => {
      // Keep actual timing, lifecycle, storage, report and catalog code; replace device boundaries only.
      initModel = async () => {}; verifyFirstInference = async () => {};
      openSelectedCamera = async () => new MediaStream(); video.play = async () => {};
      loop = () => {}; requestSessionWakeLock = async () => {};
      gpsConsent.checked = false; cloudConsent.checked = false;
    });
    await page.locator('#startBtn').click();
    await expect(page.locator('#startBtn')).toHaveText('STOP MONITORING');
    await page.evaluate(() => {
      window.__coverageTime = 1000; set_calibrating(false); updateTrackingState(true, true);
      window.__coverageTime = 2000; updateTrackingState(false, false);
      window.__coverageTime = 4000; updateTrackingState(true, true);
      window.__coverageTime = 5000;
    });
    await page.locator('#startBtn').click();
    await expect(page.locator('#report #eyeCoverageSummary')).toHaveText('Eyes detected: 50% of session');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-session-history'))[0]);
    expect(saved.eyeCoverage).toEqual({ detectedMs: 2000, monitoredMs: 4000, percent: 50 });
    expect(await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('occulert-live-session')), 'eyeCoverage'))).toBe(false);
    releaseCatalog();
    await expect(page.locator('#eyeCoverageSummary')).toHaveText('Ojos detectados: 50% de la sesión');
    await expect(page.locator('#eyeCoverageSummary')).toHaveAttribute('lang', 'es');
    await page.locator('#driverLanguage').selectOption('ar');
    await expect(page.locator('#eyeCoverageSummary')).toHaveText('رُصدت العينان: 50% من الجلسة');
    await expect(page.locator('#eyeCoverageSummary')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#report')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#report')).toContainText('Safety and liability: Occulert is a supplemental prototype only.');
    await page.locator('#driverLanguage').selectOption('en');
    await expect(page.locator('#eyeCoverageSummary')).toHaveText('Eyes detected: 50% of session');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-session-history'))[0])).toEqual(saved);
    await page.locator('#startBtn').click();
    await page.evaluate(() => { window.__coverageTime = 10000; });
    await page.locator('#startBtn').click();
    await expect(page.locator('#eyeCoverageSummary')).toHaveText('Eyes detected: Unknown');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-session-history'))[0].eyeCoverage))
      .toEqual({ detectedMs: 0, monitoredMs: 0, percent: null });
  } finally { releaseCatalog(); }
});
