import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';
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

test('recent sign-in is requested before a confirmed deletion and preserves data until retry succeeds', async ({ page }) => {
  await page.addInitScript(() => {
    if (location.pathname !== '/account.html') return;
    localStorage.setItem('occulert-auth', JSON.stringify({ access_token: 'old-token', refresh_token: 'old-refresh', expires_at: Math.floor(Date.now()/1000)+3600, user: { id: 'fixture-user', email: 'fixture@example.invalid' } }));
    localStorage.setItem('occulert-sessions', 'saved-local-history');
  });
  await page.route('**/api/public-config', route => route.fulfill({ json: { ok: true, supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-fixture' } } }));
  await page.route('**/api/fleets', route => route.fulfill({ json: { ok: true, fleet: null } }));
  await page.route('**/auth/v1/token?grant_type=password', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'fixture@example.invalid', password: 'fixture-password' });
    await route.fulfill({ json: { access_token: 'recent-token', refresh_token: 'recent-refresh', expires_in: 3600, user: { id: 'fixture-user', email: 'fixture@example.invalid' } } });
  });
  let attempts = 0;
  await page.route('**/api/account', async route => {
    attempts++;
    const recent = route.request().headers().authorization === 'Bearer recent-token';
    await route.fulfill({ status: recent ? 200 : 401, json: recent ? { ok: true, deleted: true } : { ok: false, error: 'reauth_required' } });
  });
  await page.goto('/account.html');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#deleteConfirmation').fill('DELETE');
  await page.locator('#deleteAccountBtn').click();
  await expect(page.locator('#deleteReauthSection')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('occulert-sessions'))).toBe('saved-local-history');
  await page.locator('#deleteReauthPassword').fill('fixture-password');
  await page.locator('#deleteReauthPasswordBtn').click();
  await expect(page).toHaveURL(/\/login.html$/);
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('occulert-sessions'))).toBeNull();
});

test('switching accounts during password confirmation leaves the replacement account usable', async ({ page }) => {
  await page.addInitScript(() => {
    if (location.pathname !== '/account.html') return;
    localStorage.setItem('occulert-auth', JSON.stringify({ access_token: 'access-A', refresh_token: 'refresh-A', expires_at: Math.floor(Date.now()/1000)+3600, user: { id: 'A', email: 'A@example.invalid' } }));
    localStorage.setItem('occulert-sessions', 'saved-local-history');
  });
  await page.route('**/api/public-config', route => route.fulfill({ json: { ok: true, supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-fixture' } } }));
  await page.route('**/api/fleets', route => route.fulfill({ json: { ok: true, fleet: null } }));
  let releaseOld;
  const oldResponse = new Promise(resolve => { releaseOld = resolve; });
  await page.route('**/auth/v1/token?grant_type=password', async route => {
    const body = route.request().postDataJSON();
    const owner = body.email.startsWith('A@') ? 'A' : 'B';
    expect(body.password).toBe(owner + '-password');
    if (owner === 'A') await oldResponse;
    await route.fulfill({ json: { access_token: 'recent-' + owner, refresh_token: 'recent-refresh-' + owner, expires_in: 3600, user: { id: owner, email: owner + '@example.invalid' } } });
  });
  const deletions = [];
  await page.route('**/api/account', async route => {
    const token = route.request().headers().authorization;
    deletions.push(token);
    const recent = token === 'Bearer recent-B';
    await route.fulfill({ status: recent ? 200 : 401, json: recent ? { ok: true, deleted: true } : { ok: false, error: 'reauth_required' } });
  });
  await page.goto('/account.html');
  page.on('dialog', dialog => dialog.accept());
  // Keep the actual event-handler promise available so the delayed response can
  // settle deterministically before the next account uses the same controls.
  await page.evaluate(() => {
    const original = reauthenticateForDeletion;
    reauthenticateForDeletion = (...args) => (window.fixtureReauth = original(...args));
  });
  await page.locator('#deleteConfirmation').fill('DELETE');
  await page.locator('#deleteAccountBtn').click();
  await page.locator('#deleteReauthPassword').fill('A-password');
  await page.locator('#deleteReauthPasswordBtn').click();
  await expect(page.locator('#deleteReauthPasswordBtn')).toBeDisabled();
  await page.evaluate(() => {
    const oldValue = localStorage.getItem('occulert-auth');
    const newValue = JSON.stringify({ access_token: 'access-B', refresh_token: 'refresh-B', expires_at: Math.floor(Date.now()/1000)+3600, user: { id: 'B', email: 'B@example.invalid' } });
    localStorage.setItem('occulert-auth', newValue);
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth', oldValue, newValue }));
  });
  await expect(page.locator('#securityIntro')).toContainText('B@example.invalid');
  releaseOld();
  await page.evaluate(() => window.fixtureReauth);
  expect(await page.evaluate(() => OcculertBackend.currentUser().id)).toBe('B');
  await page.locator('#deleteConfirmation').fill('DELETE');
  await page.locator('#deleteAccountBtn').click();
  await expect(page.locator('#deleteReauthSection')).toBeVisible();
  await expect(page.locator('#deleteReauthPasswordBtn')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('occulert-sessions'))).toBe('saved-local-history');
  await page.locator('#deleteReauthPassword').fill('B-password');
  await page.locator('#deleteReauthPasswordBtn').click();
  await expect(page).toHaveURL(/\/login.html$/);
  expect(deletions).toEqual(['Bearer access-A', 'Bearer access-B', 'Bearer recent-B']);
  expect(await page.evaluate(() => localStorage.getItem('occulert-sessions'))).toBeNull();
});
