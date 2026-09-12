import { test, expect } from '@playwright/test';

test('account deletion confirms, preserves data on failure, and clears it on success', async ({ page }) => {
  await page.addInitScript(() => {
    if (location.pathname !== '/account.html') return;
    localStorage.setItem('occulert-auth', JSON.stringify({
      access_token: 'fixture-token', refresh_token: 'fixture-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'fixture-user', email: 'fixture@example.invalid' },
    }));
    localStorage.setItem('occulert-sessions', 'fixture-history');
  });
  await page.route('**/api/public-config', route => route.fulfill({ json: { ok: true, supabase: { configured: false } } }));
  await page.route('**/api/fleets', route => route.fulfill({ json: { ok: true, fleet: null } }));
  let count = 0;
  await page.route('**/api/account', async route => {
    count++;
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().headers().authorization).toBe('Bearer fixture-token');
    expect(route.request().postDataJSON()).toEqual({ confirm: 'DELETE' });
    await route.fulfill({ status: count === 1 ? 502 : 200,
      json: count === 1 ? { ok: false, error: 'account_deletion_failed' } : { ok: true, deleted: true } });
  });
  await page.goto('/account.html');
  await page.locator('#deleteConfirmation').fill('DELETE');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#deleteAccountBtn').click();
  expect(count).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#deleteAccountBtn').click();
  await expect(page.locator('#deleteStatus')).toContainText('not confirmed');
  expect(await page.evaluate(() => localStorage.getItem('occulert-sessions'))).toBe('fixture-history');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#deleteAccountBtn').click();
  await expect(page).toHaveURL(/\/login.html$/);
  expect(await page.evaluate(() => localStorage.getItem('occulert-auth'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('occulert-sessions'))).toBeNull();
  expect(count).toBe(2);
});
