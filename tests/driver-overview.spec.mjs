import { test, expect } from '@playwright/test';

const driverId = 'local-overview-driver';
const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const session = (changes = {}) => ({ driverId, startedAt: ago(20), endedAt: ago(10), alerts: 0, ...changes });
async function seed(page, rows) {
  await page.addInitScript(({ driverId, rows }) => {
    localStorage.setItem('occulert-driver-id', driverId);
    localStorage.setItem('occulert-session-history', JSON.stringify(rows));
  }, { driverId, rows });
  await page.goto('/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
}
test('parked overview isolates this local profile and excludes old, future and experiment sessions', async ({ page }) => {
  const rows = [session(), session({ alerts: 2, startedAt: ago(60), endedAt: ago(30) }),
    session({ driverId: 'another-driver', alerts: 999 }), session({ startedAt: ago(8 * 24 * 60), alerts: 99 }),
    session({ startedAt: ago(-10), endedAt: ago(-5), alerts: 88 }), session({ experiment: { any: true }, alerts: 77 })];
  await seed(page, rows);
  await expect(page.locator('#overviewSessions')).toHaveText('2');
  await expect(page.locator('#overviewMinutes')).toHaveText('40');
  await expect(page.locator('#overviewAlerts')).toHaveText('2');
  await expect(page.locator('#overviewNextStep')).toContainText('zero alerts');
  await expect(page.locator('#driverOverview a')).toHaveAttribute('href', '/session-history.html');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-session-history')))).toEqual(rows);
  await page.evaluate(() => setMonitoringUi(true));
  await expect(page.locator('#driverOverview')).toBeHidden();
  await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('occulert-session-history'));
    rows[0].alerts = 3;
    localStorage.setItem('occulert-session-history', JSON.stringify(rows));
    setMonitoringUi(false);
  });
  await expect(page.locator('#overviewAlerts')).toHaveText('5');
  await expect(page.locator('#overviewNextStep')).toContainText('3 alerts');
});
test('missing totals stay unavailable and genuine zero remains visible', async ({ page }) => {
  await seed(page, [session({ alerts: null, endedAt: null }), session()]);
  await expect(page.locator('#overviewSessions')).toHaveText('2');
  await expect(page.locator('#overviewMinutes')).toHaveText('Unavailable');
  await expect(page.locator('#overviewAlerts')).toHaveText('Unavailable');
  await expect(page.locator('#overviewCoverage')).toContainText('not counted as zero');
});
test('the parked alert shortcut opens its feedback and stays unavailable during monitoring', async ({ page }) => {
  await seed(page, []);
  await page.evaluate(() => {
    document.getElementById('demoBtn').onclick = () => { document.getElementById('alertCheckResult').textContent = 'Parked check feedback'; };
  });
  await page.locator('#overviewAlertCheck').click();
  await expect(page.locator('#alertCheckResult')).toBeVisible();
  await expect(page.locator('#alertCheckResult')).toHaveText('Parked check feedback');
  await page.evaluate(() => setMonitoringUi(true));
  await expect(page.locator('#overviewAlertCheck')).toBeHidden();
});
for (const mode of ['corrupt', 'blocked']) test(`${mode} storage does not masquerade as no history or block monitoring startup`, async ({ page }) => {
  const raw = '[{"keep":"original"},null]';
  await page.addInitScript(({ mode, raw }) => {
    localStorage.setItem('occulert-session-history', raw);
    if (mode === 'blocked') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  }, { mode, raw });
  await page.goto('/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await expect(page.locator('#overviewLastSession')).toHaveText('Local history unavailable');
  await expect(page.locator('#overviewSessions')).toHaveText('Unavailable');
  if (mode === 'corrupt') expect(await page.evaluate(() => localStorage.getItem('occulert-session-history'))).toBe(raw);
});
