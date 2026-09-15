import { test, expect } from '@playwright/test';

async function setup(page, options = {}) {
  await page.route('**/api/public-config', route => route.fulfill({ json: { supabase: { configured: true, url: 'https://auth.example.test', anonKey: 'public-test-key' } } }));
  await page.route('**/api/fleet', route => route.fulfill({ status: 404, json: { error: 'fleet_not_found' } }));
  await page.route('**/api/profile', route => route.fulfill({ status: options.profileFailure ? 503 : 200, json: { driver: { id: 'server-driver' } } }));
  await page.addInitScript(options => {
    window.testAuthCalls = [];
    const user = { id: 'new-user', email: 'new@example.com', email_confirmed_at: '2026-09-14T00:00:00Z', user_metadata: { name: 'New Driver', role: 'fleet', fleetId: 'forged-fleet' } };
    if (options.unconfirmed) delete user.email_confirmed_at;
    const session = { access_token: 'verified-access', refresh_token: 'verified-refresh', user, expires_at: Math.floor(Date.now() / 1000) + 3600 };
    localStorage.setItem('occulert-profile', JSON.stringify({ uid: 'old-user', name: 'Previous Driver', role: 'fleet', fleetId: 'previous-fleet' }));
    window.supabase = { createClient() { return { auth: {
      async signInWithOtp(request) { window.testAuthCalls.push(['otp', request]); return { error: options.sendFailure ? { status: 429 } : null }; },
      async signInWithPasskey() { return { data: { session, user } }; },
      async setSession(tokens) { window.testAuthCalls.push(['session', tokens, location.hash]); return { data: { session } }; },
      async getUser() { return options.invalid ? { error: new Error('invalid') } : { data: { user } }; },
      async registerPasskey() {
        window.testAuthCalls.push(['register']);
        if (options.cancel && window.testAuthCalls.filter(x => x[0] === 'register').length === 1) throw new DOMException('cancelled', 'NotAllowedError');
        return { data: { id: 'passkey-1' } };
      },
    } }; } };
    if (options.unsupported) Object.defineProperty(window, 'PublicKeyCredential', { value: undefined });
  }, options);
}
const callback = '/login.html?enroll=passkey#type=magiclink&access_token=email-access&refresh_token=email-refresh';

test('signup sends no password and offers email recovery for existing accounts', async ({ page }) => {
  await setup(page);
  await page.goto('/login.html?mode=signup');
  await expect(page.locator('#passwordField')).toBeHidden();
  await page.locator('#name').fill('New Driver');
  await page.locator('#email').fill('new@example.com');
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText('Check your email');
  const calls = await page.evaluate(() => window.testAuthCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual({ email: 'new@example.com', options: { shouldCreateUser: true, emailRedirectTo: 'http://127.0.0.1:4173/login.html?enroll=passkey', data: { name: 'New Driver', company: 'Occulert Pilot Fleet', vehicle: '', account_type: 'driver' } } });
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText('wait one minute');
  expect(await page.evaluate(() => window.testAuthCalls.length)).toBe(1);
});

test('email sign-in does not create an account', async ({ page }) => {
  await setup(page);
  await page.goto('/login.html?mode=email');
  await page.locator('#email').fill('existing@example.com');
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText('Check your email');
  expect(await page.evaluate(() => window.testAuthCalls[0][1].options.shouldCreateUser)).toBe(false);
});

test('verified email creates the correct profile and supports cancelled passkey retry', async ({ page }) => {
  await setup(page, { cancel: true });
  await page.goto(callback);
  await expect(page.locator('#passkeySetup')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-profile')));
  expect(profile.uid).toBe('new-user');
  expect(profile.name).toBe('New Driver');
  expect(profile.role).toBe('driver');
  expect(profile.fleetId).toBe('OCCULERT-DEMO');
  expect(profile.cloudProfile).toBe(true);
  expect(await page.evaluate(() => window.testAuthCalls[0][2])).toBe('');
  await page.locator('#createPasskeyBtn').click();
  await expect(page.locator('#passkeySetupStatus')).toContainText('cancelled');
  await page.locator('#createPasskeyBtn').click();
  await expect(page.locator('#authCard')).toBeHidden();
  await expect(page.locator('#completionStatus')).toContainText('Passkey saved');
  await expect(page.locator('#profileBox')).toContainText('New Driver');
});

for (const options of [{ invalid: true }, { unconfirmed: true }]) {
  test(`unverified email cannot create a profile or enroll: ${JSON.stringify(options)}`, async ({ page }) => {
    await setup(page, options);
    await page.goto(callback);
    await expect(page.locator('#status')).toHaveClass(/bad/);
    await expect(page.locator('#passkeySetup')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('occulert-auth'))).toBeNull();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-profile')).uid)).toBe('old-user');
  });
}

test('unsupported devices can continue after email verification and cloud failure is visible', async ({ page }) => {
  await setup(page, { unsupported: true, profileFailure: true });
  await page.goto(callback);
  await expect(page.locator('#createPasskeyBtn')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('could not sync');
  await page.locator('#skipPasskeyBtn').click();
  await expect(page.locator('#profileBox')).toContainText('New Driver');
});

test('expired links and recovery tokens never enroll', async ({ page }) => {
  await setup(page);
  await page.goto('/login.html?enroll=passkey#error=access_denied');
  await expect(page.locator('#status')).toContainText('invalid or expired');
  await page.goto('/login.html?enroll=passkey#type=recovery&access_token=a&refresh_token=b');
  await expect(page.locator('#status')).toContainText('invalid or expired');
  expect(await page.evaluate(() => window.testAuthCalls.length)).toBe(0);
});


test('passkey sign-in on a different account uses that account display fields without granting fleet access', async ({ page }) => {
  await setup(page);
  await page.goto('/login.html');
  await page.locator('#passkeySignInBtn').click();
  await expect(page.locator('#authCard')).toBeHidden();
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-profile')));
  expect(profile.uid).toBe('new-user');
  expect(profile.name).toBe('New Driver');
  expect(profile.role).toBe('driver');
  expect(profile.fleetId).toBe('OCCULERT-DEMO');
});

test('email request rate limit is visible and cannot start enrollment', async ({ page }) => {
  await setup(page, { sendFailure: true });
  await page.goto('/login.html?mode=signup');
  await page.locator('#email').fill('new@example.com');
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText('Too many email requests');
  await expect(page.locator('#passkeySetup')).toBeHidden();
});

test('failed cloud profile can retry without repeating email verification', async ({ page }) => {
  await setup(page, { profileFailure: true });
  await page.goto(callback);
  await expect(page.locator('#retryProfileBtn')).toBeVisible();
  await page.route('**/api/profile', route => route.fulfill({ json: { driver: { id: 'server-driver' } } }));
  await page.locator('#retryProfileBtn').click();
  await expect(page.locator('#completionStatus')).toContainText('Your profile is synced');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-profile')).cloudProfile)).toBe(true);
});

test('a failed SDK load can be retried without reloading the signup page', async ({ page }) => {
  await setup(page);
  await page.goto('/login.html?mode=signup');
  await page.evaluate(() => { window.OcculertSupabaseLoader.load = () => Promise.reject(new Error('Helper could not load')); });
  await page.locator('#email').fill('new@example.com');
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText('Helper could not load');
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText('Check your email');
});

test('session storage failure cannot create a profile under an old session', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    localStorage.setItem('occulert-auth', JSON.stringify({access_token:'old-access',refresh_token:'old-refresh',expires_at:Date.now()/1000+3600,user:{id:'old-user',email:'old@example.com'}}));
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'occulert-auth') throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.goto(callback);
  await expect(page.locator('#passkeySetup')).toBeHidden();
  await expect(page.locator('#status')).toContainText('session could not be saved');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-profile')).uid)).toBe('old-user');
  expect(await page.evaluate(() => window.testAuthCalls.some(call => call[0] === 'register'))).toBe(false);
});
