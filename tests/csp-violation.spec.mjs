import { test as base, expect } from '@playwright/test';
import { SUPABASE_HOST, auditCspPolicy } from '../scripts/lib/csp-policy.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const FLEET = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const AUTH_ORIGIN = `https://${SUPABASE_HOST}`;
const fleet = { id: FLEET, company_name: 'CSP Fixture Transit', plan: 'trial' };
const driver = { id: DRIVER, user_id: OWNER, name: 'CSP Fixture Driver', vehicle_id: 'Fixture van', active: true };
const privacy = { includes_location: false, includes_personal_media: false, includes_raw_motion: false };
const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();

function fixtureSession() {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: OWNER, email: 'csp-fixture@example.invalid', aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: ago(60) };
  return {
    // A structurally valid, unsigned fixture token lets the real owned SDK
    // initialize. Every auth request is intercepted; no live account is used.
    access_token: [encode({ alg: 'HS256', typ: 'JWT' }), encode({ sub: OWNER, role: 'authenticated',
      exp: now + 3600, iat: now, session_id: SESSION, amr: [{ method: 'password', timestamp: now }] }),
    encode('fixture-signature')].join('.'),
    refresh_token: 'csp-fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user,
  };
}

function periodReport(days) {
  return {
    version: 1, days, window_start: ago(days * 24 * 60), window_end: ago(0), complete_period: true,
    roster_total: 1, active_drivers: 1, reporting_active_drivers: 1,
    sessions: 1, completed: 1, no_recorded_end: 0, invalid_recorded_end: 0,
    scored: 1, unscored: 0, average_safety_score: 90,
    valid_alert_records: 1, missing_alert_records: 0, alerts: 1, reviewed: 0, without_reviewed_followup: 1,
    detector_pipelines: { web_mediapipe_ear: 1, ios_mlkit_eye_probability: 0, android_mlkit_eye_probability: 0, unknown: 0 },
    interruption_reasons_available: false, unrecorded_sessions_detectable: false,
  };
}

const test = base.extend({
  policyFixture: async ({ page, baseURL }, use, testInfo) => {
    const origin = new URL(baseURL).origin;
    const session = fixtureSession(), calls = [], unexpected = [];
    const recordedSession = { id: SESSION, driver_id: DRIVER, driver_name: driver.name,
      started_at: ago(40), ended_at: ago(10), safety_score: 90, average_fatigue: 10, max_fatigue: 20,
      alert_count: 1, head_nod_count: 0, detector_pipeline: 'web_mediapipe_ear' };

    // Observe from document start, before any owned script executes. Keep the
    // real policy, script bytes and integrity checks: only data APIs are mocked.
    await page.addInitScript(() => {
      window.__occulertCspViolations = [];
      const safeSource = value => {
        if (!value || value === 'inline' || value === 'eval') return value;
        try { const url = new URL(value, location.href); return url.origin + url.pathname; }
        catch { return String(value).split(/[?#]/, 1)[0]; }
      };
      document.addEventListener('securitypolicyviolation', event => {
        window.__occulertCspViolations.push({ directive: event.effectiveDirective,
          blocked: safeSource(event.blockedURI), source: safeSource(event.sourceFile),
          line: event.lineNumber, disposition: event.disposition });
      });
    });

    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const local = url.origin === origin, auth = url.origin === AUTH_ORIGIN;
      const cors = { 'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
        'access-control-allow-methods': 'GET, POST, OPTIONS' };
      const json = body => route.fulfill({ json: body, headers: auth ? cors : {} });
      if (local && !url.pathname.startsWith('/api/')) return route.continue();
      calls.push({ origin: url.origin, path: url.pathname, method, driver: url.searchParams.get('driver_id') });
      if (local && method === 'GET' && url.pathname === '/api/public-config') {
        return json({ ok: true, supabase: { configured: true, url: AUTH_ORIGIN, anonKey: 'public-csp-fixture-key' } });
      }
      if (local && method === 'GET' && url.pathname === '/api/fleets') return json({ ok: true, fleet });
      if (local && method === 'POST' && url.pathname === '/api/profile') return json({ ok: true, driver });
      if (local && method === 'GET' && url.pathname === '/api/fleet-summary') {
        return json({ ok: true, fleet, drivers: [driver], sessions: [recordedSession], events: [],
          monthly_activity: null, telemetry_trust: 'unverified_client_report', privacy });
      }
      if (local && method === 'GET' && url.pathname === '/api/fleet-session-history') {
        return json({ ok: true, fleet, drivers: [driver], sessions: [recordedSession],
          filters: Object.fromEntries(['driver_id', 'from', 'to'].map(key => [key, url.searchParams.get(key)])),
          driver_filter_complete: true, has_more: false, next_cursor: null,
          telemetry_trust: 'unverified_client_report', privacy });
      }
      if (local && method === 'GET' && url.pathname === '/api/fleet-followups') return json({ ok: true, sessions: [] });
      if (local && method === 'GET' && url.pathname === '/api/fleet-period-report') {
        return json({ ok: true, fleet, report: periodReport(Number(url.searchParams.get('days'))),
          telemetry_trust: 'unverified_client_report', privacy });
      }
      if (auth && method === 'OPTIONS' && url.pathname.startsWith('/auth/v1/')) {
        return route.fulfill({ status: 204, headers: cors });
      }
      if (auth && method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        expect(request.postDataJSON()).toEqual({ email: session.user.email, password: 'csp-fixture-password' });
        return json(session);
      }
      if (auth && method === 'GET' && url.pathname === '/auth/v1/user') return json(session.user);
      if (auth && method === 'GET' && url.pathname === '/auth/v1/passkeys') return json([]);
      // No fixture credentials or requests may reach a real service. Unexpected
      // APIs also fail explicitly instead of silently producing an empty view.
      unexpected.push({ origin: url.origin, path: url.pathname, method });
      return route.abort('blockedbyclient');
    });

    await use({ session, calls });

    const violations = await page.evaluate(() => window.__occulertCspViolations);
    if (testInfo.status !== testInfo.expectedStatus || violations?.length || unexpected.length) {
      await testInfo.attach('page-policy-evidence', { contentType: 'application/json',
        body: JSON.stringify({ violations, unexpected, calls }, null, 2) });
    }
    expect(violations, 'Legitimate startup and actions must not violate the page CSP').toEqual([]);
    expect(unexpected, 'All API and external requests must stay inside the synthetic fixture').toEqual([]);
  },
});

async function seedAccount(page, session) {
  await page.addInitScript(auth => {
    localStorage.setItem('occulert-auth', JSON.stringify(auth));
    localStorage.setItem('occulert-profile', JSON.stringify({ uid: auth.user.id, email: auth.user.email,
      name: 'CSP Fixture Driver', role: 'driver', authenticated: true, driverId: 'csp-local-driver' }));
    localStorage.setItem('occulert-cloud-consent', 'false');
    localStorage.setItem('occulert-session-history', '[]');
  }, session);
}

async function openPage(page, path) {
  const response = await page.goto(path);
  expect(response.status()).toBe(200);
  expect(auditCspPolicy(response.headers()['content-security-policy'])).toEqual([]);
}

test('login.html signs in through the configured auth host without CSP violations', async ({ page, policyFixture }) => {
  await openPage(page, '/login.html');
  await expect(page.locator('#profileBox')).toContainText('Not signed in');
  await expect.poll(() => page.evaluate(() => window.OcculertSupabaseLoader?.state().ready)).toBe(true);
  await page.locator('#email').fill(policyFixture.session.user.email);
  await page.locator('#password').fill('csp-fixture-password');
  await page.locator('#submitBtn').click();
  await expect(page.locator('#status')).toContainText('Signed in. Choose where to continue.');
  await expect(page.locator('#profileBox')).toContainText('Verified owner of CSP Fixture Transit');
  await expect(page.locator('#profileActions').getByRole('link', { name: 'Open Fleet Dashboard', exact: true })).toBeVisible();
  expect(policyFixture.calls).toContainEqual({ origin: AUTH_ORIGIN, path: '/auth/v1/token', method: 'POST', driver: null });
  expect(policyFixture.calls.some(call => call.path === '/api/profile' && call.method === 'POST')).toBe(true);
});

test('account.html loads the signed-in account and saves its local profile without CSP violations', async ({ page, policyFixture }) => {
  await seedAccount(page, policyFixture.session);
  await openPage(page, '/account.html');
  await expect(page.locator('#securityForms')).toBeVisible();
  await expect(page.locator('#profileBox')).toContainText('Verified owner of CSP Fixture Transit');
  await expect.poll(() => page.evaluate(() => window.OcculertSupabaseLoader?.state().ready)).toBe(true);
  if (await page.evaluate(() => window.OcculertPasskeys.isSupported())) {
    await expect(page.locator('#passkeyList')).toContainText('No passkeys added yet');
    expect(policyFixture.calls.some(call => call.path === '/auth/v1/passkeys')).toBe(true);
  } else {
    await expect(page.locator('#passkeyList')).toContainText('Passkeys require a supported browser');
  }
  await page.getByLabel('Name', { exact: true }).fill('Updated CSP Fixture');
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Profile saved successfully.');
  await expect(page.locator('#profileBox')).toContainText('Updated CSP Fixture');
});

test('fleet-dashboard.html loads protected data and opens driver sessions without CSP violations', async ({ page, policyFixture }) => {
  await seedAccount(page, policyFixture.session);
  await openPage(page, '/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active');
  await expect(page.locator('#drivers')).toContainText(driver.name);
  await expect(page.locator('#pilotReportPrint')).toBeEnabled();
  await page.locator('[data-driver-detail]').click();
  await expect(page.locator('#driverDetailTitle')).toHaveText(`Recent sessions: ${driver.name}`);
  await expect(page.locator('#driverDetailList li')).toHaveCount(1);
  await expect(page.locator('#driverDetailSummary')).toContainText('1 completed. Average score 90/100');
  expect(policyFixture.calls.some(call => call.path === '/api/fleet-session-history' && call.driver === DRIVER)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#driverDetail')).toBeHidden();
  await expect(page.locator('[data-driver-detail]')).toBeFocused();
});

test('fleet-history.html loads and filters protected records without CSP violations', async ({ page, policyFixture }) => {
  await seedAccount(page, policyFixture.session);
  await openPage(page, '/fleet-history.html');
  await expect(page.locator('#historyFilters')).toBeEnabled();
  await expect(page.locator('#historyList [role="listitem"]')).toHaveCount(1);
  await expect(page.locator('#historyList')).toContainText(driver.name);
  await page.locator('#historyDriver').selectOption(DRIVER);
  await expect.poll(() => policyFixture.calls.some(call => call.path === '/api/fleet-session-history' && call.driver === DRIVER)).toBe(true);
  await expect(page.locator('#historyFilters')).toBeEnabled();
  await expect(page.locator('#historyMatches')).toContainText('1 of 1 loaded server-matched sessions shown');
  await expect(page.locator('#historyExport')).toBeEnabled();
});

test('app.html starts its real driver runtime and responds to parked controls without CSP violations', async ({ page, policyFixture }) => {
  await seedAccount(page, policyFixture.session);
  await openPage(page, '/app.html');
  await expect(page.locator('#startBtn')).toBeEnabled();
  expect(await page.evaluate(() => window.OcculertStartup.isReady())).toBe(true);
  await expect(page.locator('#cloudConsent')).not.toBeChecked();
  await page.locator('#presetBright').click();
  await expect(page.locator('#intensityLabel')).toHaveText('Bright');
  await page.locator('#driverLanguage').selectOption('es');
  await expect(page.locator('#driverPanel')).toHaveAttribute('lang', 'es');
  await page.locator('#driverLanguage').selectOption('en');
  await expect(page.locator('#startBtn')).toHaveText('START MONITORING');
  await expect(page.locator('#driveState')).toHaveText('NOT MONITORING');
});
