import { test, expect } from '@playwright/test';

const day = 86_400_000;
const ago = days => new Date(Date.now() - days * day).toISOString();
async function ownerSession(page) {
  await page.addInitScript(() => localStorage.setItem('occulert-auth', JSON.stringify({
    access_token: 'manager-token', refresh_token: 'manager-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'manager-1', email: 'manager@example.com' },
  })));
}
function protectedSummary(sessions) {
  return {
    ok: true, fleet: { id: 'fleet-1', company_name: 'Pilot Transit', plan: 'trial' },
    drivers: [{ id: 'driver-1', name: 'Private Driver', vehicle_id: 'Private Vehicle', active: true }],
    sessions, events: [], telemetry_trust: 'unverified_client_report',
    privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
  };
}
function session(id, days, score = 80) {
  return { id, driver_id: 'driver-1', started_at: ago(days), ended_at: ago(days), safety_score: score, alert_count: 0 };
}

test('TV windows filter protected records and retain aggregate privacy in large text', async ({ page }) => {
  await ownerSession(page);
  let requests = 0;
  await page.route('**/api/fleet-summary*', route => {
    requests += 1;
    expect(new URL(route.request().url()).searchParams.get('include_events')).toBe('0');
    return route.fulfill({ json: protectedSummary([
      session('recent', 2), session('older', 10), session('future', -1),
      { ...session('invalid', 2), started_at: 'not-a-date' },
    ]) });
  });
  await page.goto('/fleet-display.html');
  await expect(page.locator('#displayContent')).toBeVisible();
  await expect(page.locator('#recentSessions')).toHaveText('2');
  await page.locator('#windowDays').selectOption('7');
  await expect(page.locator('#recentSessions')).toHaveText('1');
  await expect(page.locator('#sessionWindowLabel')).toContainText('7');
  expect(requests).toBe(1);
  await page.locator('#largeTextButton').click();
  await expect(page.locator('#largeTextButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-display-size', 'large');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const content = await page.locator('#displayContent').innerText();
  expect(content).not.toContain('Private Driver');
  expect(content).not.toContain('Private Vehicle');
  await page.evaluate(() => {
    localStorage.removeItem('occulert-auth');
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
  });
  await expect(page.locator('#displayContent')).toBeHidden();
  await expect(page.locator('#emptyTitle')).toHaveText('Fleet owner sign-in required');
});

test('TV labels a full latest-50 response as limited history', async ({ page }) => {
  await ownerSession(page);
  await page.route('**/api/fleet-summary*', route => route.fulfill({
    json: protectedSummary(Array.from({ length: 50 }, (_, i) => session(`session-${i}`, 1))),
  }));
  await page.goto('/fleet-display.html');
  await expect(page.locator('#recentSessions')).toHaveText('50');
  await expect(page.locator('#summaryScope')).toHaveAttribute('data-limited', 'true');
  await expect(page.locator('#summaryScope')).toContainText('50');
});

test('manager print uses protected aggregates and clears on sign-out', async ({ page }) => {
  await ownerSession(page);
  const sessions = [session('recent', 2), session('unscored', 3, null), session('older', 10), session('future', -1)];
  await page.route('**/api/fleet-summary*', route => route.fulfill({ json: protectedSummary(sessions) }));
  await page.route('**/api/fleet-followups*', route => route.fulfill({ json: {
    ok: true, fleet_id: 'fleet-1', sessions: sessions.map((s, i) => ({
      ...s, driver_name: 'Private Driver',
      followup: { status: i === 0 ? 'reviewed' : 'open', version: i === 0 ? 1 : 0 },
    })),
  } }));
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
  await expect(page.locator('#qualityCompleted')).toHaveText('3');
  await expect(page.locator('#valueSessions')).toHaveText('3');
  await expect(page.locator('#qualityUnscored')).toHaveText('1');
  await expect(page.locator('#qualityMissingReview')).toHaveText('2');
  await expect(page.locator('#qualityInterrupted')).not.toHaveText('0');
  await expect(page.locator('#pilotReportPrint')).toBeEnabled();
  await page.locator('#pilotRange').selectOption('7');
  await expect(page.locator('#qualityCompleted')).toHaveText('2');
  await expect(page.locator('#valueSessions')).toHaveText('2');
  await expect(page.locator('#qualityUnscored')).toHaveText('1');
  await expect(page.locator('#qualityMissingReview')).toHaveText('1');
  await page.evaluate(() => { window.print = () => { window.pilotPrintCalls = (window.pilotPrintCalls || 0) + 1; }; });
  await page.locator('#pilotReportPrint').click();
  expect(await page.evaluate(() => window.pilotPrintCalls)).toBe(1);
  await page.locator('#pilotReportPreview > summary').click();
  const report = await page.locator('#pilotPrintableReport').innerText();
  expect(report).toContain('Pilot Transit');
  expect(report).not.toContain('Private Driver');
  expect(report).not.toContain('Private Vehicle');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#pilotPrintableReport')).toBeVisible();
  await expect(page.locator('#drivers')).toHaveCount(1);
  await expect(page.locator('#drivers')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    localStorage.removeItem('occulert-auth');
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', newValue: null }));
  });
  await expect(page.locator('#pilotReportPrint')).toBeDisabled();
  await expect(page.locator('#pilotPrintableReport')).not.toContainText('Pilot Transit');
});

test('signed-out demo data cannot produce a protected manager report', async ({ page }) => {
  await page.goto('/fleet-dashboard.html');
  await page.getByRole('button', { name: 'Load Demo Data' }).click();
  await expect(page.locator('#pilotReportPrint')).toBeDisabled();
  await expect(page.locator('#qualityCompleted')).not.toHaveText('0');
});
