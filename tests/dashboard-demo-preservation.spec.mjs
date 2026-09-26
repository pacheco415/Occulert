import { test, expect } from '@playwright/test';

async function prepare(page, malformed = false) {
  const now = Date.now();
  const row = { id: 'real-session', sessionId: 'real-session', driverId: 'real-driver',
    name: 'Saved local driver', safetyScore: 82, fatigue: 18, status: 'SAFE',
    startedAt: new Date(now - 60_000).toISOString(), endedAt: new Date(now).toISOString(),
    lastUpdate: new Date(now).toISOString() };
  const history = malformed ? '{}' : JSON.stringify([row]);
  const live = JSON.stringify(row);
  await page.addInitScript(({ history, live, malformed }) => {
    localStorage.setItem('occulert-session-history', history);
    localStorage.setItem('occulert-live-session', live);
    localStorage.setItem('occulert-drivers', malformed ? '{}' : '[]');
    localStorage.removeItem('occulert-auth');
  }, { history, live, malformed });
  await page.route('**/api/public-config', route => route.fulfill({ json: { supabase: { configured: false } } }));
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText('Not signed in');
  await page.locator('.dashboard-tools > summary').click();
  return { history, live };
}

test('dashboard demo load and clear keep saved local sessions and restore their rendered view', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const original = await prepare(page);
  await expect(page.locator('#drivers')).toContainText('Saved local driver');
  await page.locator('.history-details > summary').click();
  await expect(page.locator('#sessionHistory')).toContainText('Saved local driver');
  await page.locator('.hero-actions').getByRole('button', { name: 'Load Demo Data', exact: true }).click();
  await expect(page.locator('#drivers')).toContainText('Mina S.');
  await expect(page.locator('#sessionHistory')).toContainText('Mina S.');
  expect(await page.evaluate(() => ({ history: localStorage.getItem('occulert-session-history'), live: localStorage.getItem('occulert-live-session') }))).toEqual(original);
  await page.getByRole('button', { name: 'Clear Demo', exact: true }).click();
  await expect(page.locator('#drivers')).toContainText('Saved local driver');
  await expect(page.locator('#sessionHistory')).toContainText('Saved local driver');
  expect(await page.evaluate(() => ({ history: localStorage.getItem('occulert-session-history'), live: localStorage.getItem('occulert-live-session') }))).toEqual(original);
  expect(errors).toEqual([]);
});

test('malformed local list records remain intact while dashboard and demo controls remain usable', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const original = await prepare(page, true);
  await page.locator('.hero-actions').getByRole('button', { name: 'Load Demo Data', exact: true }).click();
  await expect(page.locator('#drivers')).toContainText('Mina S.');
  await page.getByRole('button', { name: 'Clear Demo', exact: true }).click();
  await expect(page.locator('#drivers')).toContainText('Saved local driver');
  expect(await page.evaluate(() => ({ history: localStorage.getItem('occulert-session-history'), live: localStorage.getItem('occulert-live-session') }))).toEqual(original);
  expect(await page.evaluate(() => localStorage.getItem('occulert-drivers'))).toBe('{}');
  expect(errors).toEqual([]);
});
