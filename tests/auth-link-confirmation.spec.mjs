import { test, expect } from '@playwright/test';
import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';

const email = 'new@example.com';
const previousProfile = { uid: 'owner-a', driverId: 'owner-a', email: 'owner-a@example.com', name: 'Previous Driver', role: 'driver', fleetId: 'previous-fleet', authenticated: true };
const previousOutbox = JSON.stringify({ privateOwner: 'owner-a', summary: 'keep until the account changes' });

function callback(kind) {
  const path = kind === 'recovery' ? '/account.html?recovery=1' : '/login.html' + (kind === 'signup' ? '?enroll=passkey' : '');
  return path + '#type=' + kind + '&access_token=link-access&refresh_token=link-refresh&expires_in=3600&email=unverified-url@example.com';
}

async function setup(page, { signedIn = true, sameUser = false, expired = false } = {}) {
  const requests = { profile: [], provider: [] };
  await page.route('**/api/public-config', route => route.fulfill({ json: { supabase: { configured: true, url: 'https://' + SUPABASE_HOST, anonKey: 'public-test-key' } } }));
  await page.route('**/api/fleet', route => route.fulfill({ status: 404, json: { error: 'fleet_not_found' } }));
  await page.route('**/api/profile', route => {
    requests.profile.push({ method: route.request().method(), authorization: route.request().headers().authorization });
    return route.fulfill({ json: { driver: { id: 'verified-driver' } } });
  });
  // Every provider request is fulfilled locally; these tests never send credentials.
  await page.route('https://' + SUPABASE_HOST + '/**', route => {
    const request = route.request();
    requests.provider.push({ path: new URL(request.url()).pathname, method: request.method(), authorization: request.headers().authorization });
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/auth/v1/token' && new URL(request.url()).searchParams.get('grant_type') === 'refresh_token') {
      return route.fulfill({ json: { access_token: 'refreshed-owner-a', refresh_token: 'refreshed-owner-a-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'owner-a', email: 'owner-a@example.com' } } });
    }
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/auth/v1/user') {
      return route.fulfill({ json: { id: 'new-user', email, email_confirmed_at: '2026-09-14T00:00:00Z' } });
    }
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/auth/v1/recover') return route.fulfill({ json: {} });
    return route.fulfill({ status: 400, json: { error: 'unexpected_fixture_request' } });
  });
  await page.addInitScript(({ signedIn, sameUser, expired, profile, outbox }) => {
    if (!sessionStorage.getItem('auth-link-fixture-seeded')) {
      if (signedIn) localStorage.setItem('occulert-auth', JSON.stringify({ access_token: 'owner-a-access', refresh_token: 'owner-a-refresh', expires_at: expired ? 1 : Math.floor(Date.now() / 1000) + 3600, user: { id: sameUser ? 'new-user' : 'owner-a', email: sameUser ? 'new@example.com' : 'owner-a@example.com' } }));
      else localStorage.removeItem('occulert-auth');
      localStorage.setItem('occulert-profile', JSON.stringify(profile));
      localStorage.setItem('occulert-cloud-outbox', outbox);
      localStorage.removeItem('occulert-auth-link-requests');
      sessionStorage.setItem('auth-link-fixture-seeded', '1');
    }
    window.authLinkCalls = [];
    const user = { id: 'new-user', email: 'new@example.com', email_confirmed_at: '2026-09-14T00:00:00Z', user_metadata: { name: 'Verified Driver' } };
    const session = { access_token: 'verified-access', refresh_token: 'verified-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user };
    window.supabase = { createClient() { return { auth: {
      async signInWithOtp(request) { window.authLinkCalls.push(['otp', request]); return { error: null }; },
      async setSession(tokens) { window.authLinkCalls.push(['setSession', tokens, location.hash]); return { data: { session }, error: null }; },
      async getUser() { window.authLinkCalls.push(['getUser']); return { data: { user }, error: null }; },
    } }; } };
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: undefined });
  }, { signedIn, sameUser, expired, profile: previousProfile, outbox: previousOutbox });
  return requests;
}

async function storedState(page) {
  return page.evaluate(() => ({ auth: localStorage.getItem('occulert-auth'), profile: localStorage.getItem('occulert-profile'), outbox: localStorage.getItem('occulert-cloud-outbox') }));
}

for (const kind of ['recovery', 'magiclink', 'signup']) test(`${kind} Continue remains usable after refreshing the browser's expired session`, async ({ page }) => {
  const requests = await setup(page, { expired: true });
  await page.goto(callback(kind)); await expectConfirmation(page);
  expect(JSON.parse((await storedState(page)).auth)).toMatchObject({ access_token: 'refreshed-owner-a', user: { id: 'owner-a' } });
  expect(requests.provider.filter(request => request.path === '/auth/v1/token')).toHaveLength(1);
  await page.locator('#linkConfirmBtn').click();
  await expect.poll(async () => JSON.parse((await storedState(page)).auth)?.user.id).toBe('new-user');
  if (kind === 'recovery') await expect(page.locator('#securityIntro')).toContainText('Recovery link verified');
  else if (kind === 'signup') await expect(page.locator('#passkeySetup')).toBeVisible();
  else await expect(page.locator('#profileBox')).toContainText(email);
});

async function expectConfirmation(page) {
  await expect(page.locator('#linkConfirm')).toBeVisible();
  await expect(page.locator('#linkConfirmText')).toContainText('signs this browser in as new@example.com.');
  await expect(page.locator('#linkConfirmText')).not.toContainText('unverified-url@example.com');
  expect(new URL(page.url()).hash).toBe('');
  expect(page.url()).not.toContain('link-access');
  expect(page.url()).not.toContain('link-refresh');
}

async function requestLink(page, kind) {
  await page.goto('/login.html?mode=' + (kind === 'recovery' ? 'reset' : kind === 'signup' ? 'signup' : 'email'));
  if (kind === 'signup') await page.locator('#name').fill('New Driver');
  await page.locator('#email').fill('NEW@example.com');
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText(kind === 'recovery' ? 'password reset link is on the way' : 'Check your email');
  const marker = await page.evaluate(kind => JSON.parse(localStorage.getItem('occulert-auth-link-requests'))[kind === 'recovery' ? 'recovery' : 'signin'], kind);
  expect(marker).toMatchObject({ email });
  expect(typeof marker.created_at).toBe('number');
  expect(JSON.stringify(marker)).not.toMatch(/access_token|refresh_token/);
}

for (const kind of ['recovery', 'magiclink', 'signup']) {
  for (const decision of ['cancel', 'continue']) {
    test(`${kind} cannot replace a signed-in account before ${decision}`, async ({ page }) => {
      const requests = await setup(page);
      await page.goto(callback(kind));
      await expectConfirmation(page);
      const before = await storedState(page);
      expect(JSON.parse(before.auth)).toMatchObject({ access_token: 'owner-a-access', refresh_token: 'owner-a-refresh', user: { id: 'owner-a' } });
      expect(JSON.parse(before.profile)).toEqual(previousProfile);
      expect(before.outbox).toBe(previousOutbox);
      expect(requests.profile).toEqual([]);
      if (kind !== 'recovery') expect(await page.evaluate(() => window.authLinkCalls.find(call => call[0] === 'setSession')[2])).toBe('');

      await page.locator(decision === 'cancel' ? '#linkCancelBtn' : '#linkConfirmBtn').click();
      await expect(page.locator('#linkConfirm')).toBeHidden();
      if (decision === 'cancel') {
        await expect(page.locator(kind === 'recovery' ? '#status' : '#completionStatus')).toContainText('not used');
        expect(await storedState(page)).toEqual(before);
        expect(requests.profile).toEqual([]);
      } else {
        await expect.poll(async () => JSON.parse((await storedState(page)).auth)?.user.id).toBe('new-user');
        expect((await storedState(page)).outbox).toBeNull();
        if (kind === 'recovery') {
          await expect(page.locator('#securityIntro')).toContainText('Recovery link verified for new@example.com');
          expect(requests.provider).toEqual([{ path: '/auth/v1/user', method: 'GET', authorization: 'Bearer link-access' }]);
        } else {
          await expect.poll(async () => JSON.parse((await storedState(page)).profile)?.uid).toBe('new-user');
          expect(requests.profile).toEqual([{ method: 'POST', authorization: 'Bearer verified-access' }]);
          if (kind === 'signup') await expect(page.locator('#passkeySetup')).toBeVisible();
        }
      }
    });
  }

  test(`${kind} automatically continues only after a matching request in this browser`, async ({ page }) => {
    await setup(page, { signedIn: false });
    await requestLink(page, kind);
    await page.goto(callback(kind));
    await expect.poll(async () => JSON.parse((await storedState(page)).auth)?.user.id).toBe('new-user');
    await expect(page.locator('#linkConfirm')).toBeHidden();
    expect(await page.evaluate(kind => JSON.parse(localStorage.getItem('occulert-auth-link-requests') || '{}')[kind === 'recovery' ? 'recovery' : 'signin'], kind)).toBeUndefined();
  });

  test(`${kind} for the current account still asks when this browser did not request it`, async ({ page }) => {
    const requests = await setup(page, { sameUser: true });
    await page.goto(callback(kind));
    await expectConfirmation(page);
    const before = await storedState(page);
    expect(JSON.parse(before.auth)).toMatchObject({ access_token: 'owner-a-access', user: { id: 'new-user' } });
    expect(requests.profile).toEqual([]);
    await page.locator('#linkCancelBtn').click();
    await expect(page.locator('#linkConfirm')).toBeHidden();
    expect(await storedState(page)).toEqual(before);
  });

  test(`${kind} for the current account automatically continues after its matching local request`, async ({ page }) => {
    await setup(page, { sameUser: true });
    await requestLink(page, kind);
    await page.goto(callback(kind));
    await expect.poll(async () => JSON.parse((await storedState(page)).auth)?.access_token).toBe(kind === 'recovery' ? 'link-access' : 'verified-access');
    await expect(page.locator('#linkConfirm')).toBeHidden();
    expect(await page.evaluate(kind => JSON.parse(localStorage.getItem('occulert-auth-link-requests') || '{}')[kind === 'recovery' ? 'recovery' : 'signin'], kind)).toBeUndefined();
  });

  test(`${kind} matching request still asks before replacing another signed-in account`, async ({ page }) => {
    const requests = await setup(page);
    await requestLink(page, kind);
    await page.goto(callback(kind));
    await expectConfirmation(page);
    const before = await storedState(page);
    expect(JSON.parse(before.auth).user.id).toBe('owner-a');
    expect(JSON.parse(before.profile)).toEqual(previousProfile);
    expect(before.outbox).toBe(previousOutbox);
    expect(requests.profile).toEqual([]);
    await page.locator('#linkCancelBtn').click();
    await expect(page.locator(kind === 'recovery' ? '#status' : '#completionStatus')).toContainText('not used');
    expect(await storedState(page)).toEqual(before);
  });

  test(`${kind} asks again when its local request marker has expired`, async ({ page }) => {
    const requests = await setup(page, { signedIn: false });
    await requestLink(page, kind);
    await page.evaluate(kind => {
      const key = 'occulert-auth-link-requests', markers = JSON.parse(localStorage.getItem(key));
      markers[kind === 'recovery' ? 'recovery' : 'signin'].created_at = Date.now() - (kind === 'recovery' ? 3_600_001 : 86_400_001);
      localStorage.setItem(key, JSON.stringify(markers));
    }, kind);
    await page.goto(callback(kind));
    await expectConfirmation(page);
    expect((await storedState(page)).auth).toBeNull();
    expect(requests.profile).toEqual([]);
    await page.locator('#linkCancelBtn').click();
  });

  test(`${kind} opened in another browser asks a signed-out user to continue`, async ({ page }) => {
    await setup(page, { signedIn: false });
    await page.goto(callback(kind));
    await expectConfirmation(page);
    expect((await storedState(page)).auth).toBeNull();
    await page.locator('#linkConfirmBtn').click();
    await expect.poll(async () => JSON.parse((await storedState(page)).auth)?.user.id).toBe('new-user');
  });

  test(`${kind} confirmation closes when another tab changes the signed-in account`, async ({ page, context }) => {
    const requests = await setup(page);
    await page.goto(callback(kind));
    await expectConfirmation(page);
    const other = await context.newPage();
    await other.goto('/privacy.html');
    await other.evaluate(() => {
      localStorage.setItem('occulert-profile', JSON.stringify({ uid: 'owner-c', name: 'Third Driver', authenticated: true }));
      localStorage.setItem('occulert-cloud-outbox', 'third-account-outbox');
      localStorage.setItem('occulert-auth', JSON.stringify({ access_token: 'owner-c-access', refresh_token: 'owner-c-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'owner-c', email: 'owner-c@example.com' } }));
    });
    await expect(page.locator('#linkConfirm')).toBeHidden();
    await expect(page.locator('#profileBox')).toContainText('owner-c@example.com');
    const stored = await storedState(page);
    expect(JSON.parse(stored.auth).user.id).toBe('owner-c');
    expect(JSON.parse(stored.profile).uid).toBe('owner-c');
    expect(stored.outbox).toBe('third-account-outbox');
    expect(requests.profile).toEqual([]);
    await other.close();
  });
}

for (const kind of ['magiclink', 'signup']) test(`${kind} completes the accepted account after returning to the confirmation tab`, async ({ page }) => {
  await setup(page);
  await page.goto(callback(kind));
  await expectConfirmation(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('#linkConfirmBtn').click();
  await expect.poll(async () => JSON.parse((await storedState(page)).auth)?.user.id).toBe('new-user');
  if (kind === 'signup') await expect(page.locator('#passkeySetup')).toBeVisible();
  else await expect(page.locator('#profileBox')).toContainText(email);
});

test('an existing-account magic link from the signup request still automatically continues', async ({ page }) => {
  await setup(page, { signedIn: false });
  await requestLink(page, 'signup');
  await page.goto(callback('magiclink').replace('/login.html#', '/login.html?enroll=passkey#'));
  await expect(page.locator('#passkeySetup')).toBeVisible();
  await expect(page.locator('#linkConfirm')).toBeHidden();
  expect(JSON.parse((await storedState(page)).auth).user.id).toBe('new-user');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-auth-link-requests') || '{}').signin)).toBeUndefined();
});

for (const kind of ['recovery', 'magiclink']) {
  test(`${kind} requires confirmation when only a different link kind was requested`, async ({ page }) => {
    await setup(page, { signedIn: false });
    await requestLink(page, kind === 'recovery' ? 'magiclink' : 'recovery');
    await page.goto(callback(kind));
    await expectConfirmation(page);
    expect((await storedState(page)).auth).toBeNull();
    await page.locator('#linkCancelBtn').click();
  });
}

test('a request for another email cannot authorize the verified link identity', async ({ page }) => {
  const requests = await setup(page, { signedIn: false });
  await requestLink(page, 'magiclink');
  await page.evaluate(() => {
    const key = 'occulert-auth-link-requests', markers = JSON.parse(localStorage.getItem(key));
    markers.signin.email = 'someone-else@example.com';
    localStorage.setItem(key, JSON.stringify(markers));
  });
  await page.goto(callback('magiclink'));
  await expectConfirmation(page);
  expect((await storedState(page)).auth).toBeNull();
  expect(requests.profile).toEqual([]);
  await page.locator('#linkCancelBtn').click();
});
