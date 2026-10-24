import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';
import { test, expect } from '@playwright/test';

// A Supabase-shaped access token for fixture-user, signed in `ago` seconds earlier.
function accessToken(ago, method = 'password') {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [encode({ alg: 'ES256' }), encode({ sub: 'fixture-user', role: 'authenticated', session_id: '11111111-1111-4111-8111-111111111111',
    amr: [{ method, timestamp: now - ago }] }), 'fixture-signature'].join('.');
}

async function openAccount(page, token) {
  await page.addInitScript(stored => {
    if (location.pathname !== '/account.html') return;
    localStorage.setItem('occulert-auth', JSON.stringify({ access_token: stored, refresh_token: 'fixture-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'fixture-user', email: 'fixture@example.invalid' } }));
  }, token);
  await page.route('**/api/public-config', route => route.fulfill({ json: { ok: true, supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-fixture' } } }));
  await page.route('**/api/fleets', route => route.fulfill({ json: { ok: true, fleet: null } }));
  const updates = [];
  await page.route('**/auth/v1/user', async route => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: { id: 'fixture-user', email: 'fixture@example.invalid' } });
    updates.push({ authorization: route.request().headers().authorization, body: route.request().postDataJSON() });
    await route.fulfill({ json: { id: 'fixture-user', email: 'fixture@example.invalid' } });
  });
  await page.goto('/account.html');
  await expect(page.locator('#securityForms')).toBeVisible();
  return updates;
}

test('an old sign-in must sign in again before the password changes', async ({ page }) => {
  const updates = await openAccount(page, accessToken(3600));
  const fresh = accessToken(0);
  await page.route('**/auth/v1/token?grant_type=password', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'fixture@example.invalid', password: 'old-password' });
    await route.fulfill({ json: { access_token: fresh, refresh_token: 'fresh-refresh', expires_in: 3600, user: { id: 'fixture-user', email: 'fixture@example.invalid' } } });
  });
  await page.locator('#newPassword').fill('new-password-1');
  await page.locator('#passwordBtn').click();
  await expect(page.locator('#securityReauthSection')).toBeVisible();
  await expect(page.locator('#status')).toContainText('Nothing has changed yet');
  expect(updates).toEqual([]);
  await page.locator('#securityReauthPassword').fill('old-password');
  await page.locator('#securityReauthPasswordBtn').click();
  await expect(page.locator('#status')).toContainText('Password updated');
  await expect(page.locator('#securityReauthSection')).toBeHidden();
  expect(updates).toEqual([{ authorization: `Bearer ${fresh}`, body: { password: 'new-password-1', current_password: 'old-password' } }]);
});

test('a recent sign-in changes the password directly and 7 characters are refused', async ({ page }) => {
  const token = accessToken(60);
  const updates = await openAccount(page, token);
  await page.locator('#newPassword').fill('seven77');
  await page.locator('#passwordBtn').click();
  expect(await page.locator('#newPassword').evaluate(input => input.validity.tooShort)).toBe(true);
  expect(updates).toEqual([]);
  await page.locator('#newPassword').fill('long-enough');
  await page.locator('#passwordBtn').click();
  await expect(page.locator('#status')).toContainText('Password updated');
  await expect(page.locator('#securityReauthSection')).toBeHidden();
  expect(updates).toEqual([{ authorization: `Bearer ${token}`, body: { password: 'long-enough' } }]);
});
