import { assetByStem } from '../scripts/lib/current-assets.mjs';
import { test, expect } from '@playwright/test';

const owner = '11111111-1111-4111-8111-111111111111';
const id = '33333333-3333-4333-8333-333333333333';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function openFollowups(page, { fail = false } = {}) {
  // Visibility comes before bootstrap's final render, which can reset the panel.
  await expect(page.locator('#cloudStatus')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active for Example fleet.');
  const panel = page.locator('#fleetFollowups');
  await expect(panel).toBeVisible();
  if (!await panel.evaluate(element => element.open)) {
    await page.getByText('Saved session follow-ups', { exact: true }).click();
  }
  await expect(panel).toHaveJSProperty('open', true);
  await expect(page.locator('#followupList')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#followupNotice')).toContainText(fail ? 'not enabled yet' : 'sessions loaded (up to 50)');
}

async function setup(page, { fail = false, conflict = false, sessions = null } = {}) {
  const state = { followup: { session_id: id, status: 'open', version: 0, updated_at: null }, posts: 0, nextLoad: null };
  const session = { id, driver_id: 'driver', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), alert_count: 2, safety_score: 65 };
  const records = sessions || [session];
  await page.route(`**/${assetByStem('occulert-backend.js')}`, route => route.fulfill({ contentType: 'application/javascript', body: `
    window.fixtureUser = { id: '${owner}' };
    window.fixtureFollowupBodiesSettled = 0;
    window.addEventListener('message', event => {
      if (event.source === window && event.origin === location.origin && event.data === 'fixture-followup-body-consumed') {
        window.fixtureFollowupBodiesSettled += 1;
      }
    });
    window.OcculertBackend = {
      currentUser: () => window.fixtureUser,
      getSession: async () => ({user: window.fixtureUser,access_token:'fixture-token',refresh_token:'fixture-refresh'}),
      captureAuthContext: () => ({auth: window.fixtureUser ? {
        user: window.fixtureUser, access_token:'fixture-token', refresh_token:'fixture-refresh'
      } : null}),
      isAuthContextCurrent: captured => !!window.fixtureUser &&
        captured?.auth?.user?.id === window.fixtureUser.id,
      requireAuthContext: captured => {
        if (!window.fixtureUser || captured?.auth?.user?.id !== window.fixtureUser.id) throw Error('auth_session_changed');
        return captured;
      },
      fetchWithDeadline: async (url, options) => {
        const response = await fetch(url, url === '/api/fleet-followups' && window.fixtureIgnoreFollowupAbort ? { ...options, signal: undefined } : options);
        if (url === '/api/fleet-followups') {
          const readJson = response.json.bind(response);
          response.json = async () => {
            const data = await readJson();
            // The posted task runs after request/load promise continuations settle.
            window.postMessage('fixture-followup-body-consumed', location.origin);
            return data;
          };
        }
        return response;
      },
      getFleetSummary: async () => ({ok:true,body:{fleet:{id:'fleet',company_name:'Example fleet'},drivers:[{id:'driver',name:'Avery Example',active:true}],sessions:${JSON.stringify(records)},events:[]}}),
      signOut: () => {window.fixtureUser=null;}
    };` }));
  await page.route('**/api/fleet-followups', async route => {
    if (route.request().method() === 'POST') {
      state.posts += 1;
      const body = route.request().postDataJSON();
      if (conflict || body.expected_version !== state.followup.version) return route.fulfill({ status: 409, json: { ok: false, error: 'followup_changed' } });
      state.followup = { ...state.followup, status: body.status, version: state.followup.version + 1, updated_at: new Date().toISOString() };
      return route.fulfill({ json: { ok: true, followup: state.followup } });
    }
    if (state.nextLoad) {
      const pending = state.nextLoad;
      state.nextLoad = null;
      pending.started.resolve();
      await pending.release.promise;
    }
    if (fail) return route.fulfill({ status: 503, json: { ok: false, error: 'followups_not_enabled' } });
    return route.fulfill({ json: { ok: true, limit: 50, sessions: records.map(record => ({ ...record,
      driver_name: record.driver_name || 'Avery Example <script>', followup: { ...state.followup, session_id: record.id },
    })) } });
  });
  await page.goto('/fleet-dashboard.html');
  await openFollowups(page, { fail });
  return state;
}

test('saved follow-up survives refresh and page reload; names are plain text', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.followup-item h3')).toHaveText('Avery Example <script>');
  await expect(page.locator('.followup-item script')).toHaveCount(0);
  await page.getByLabel('Follow-up for Avery Example <script>').selectOption('reviewed');
  await page.getByRole('button', { name: 'Save follow-up', exact: true }).click();
  await expect(page.locator('#followupNotice')).toContainText('Follow-up saved for Avery Example');
  expect(state.posts).toBe(1);
  await page.reload();
  await openFollowups(page);
  await expect(page.locator('.followup-saved')).toHaveText('Saved status: Reviewed');
});

test('conflicting edits do not claim success or silently overwrite', async ({ page }) => {
  await setup(page, { conflict: true });
  await page.getByLabel('Follow-up for Avery Example <script>').selectOption('reviewed');
  await page.getByRole('button', { name: 'Save follow-up', exact: true }).click();
  await expect(page.locator('#followupNotice')).toContainText('changed elsewhere');
  await expect(page.locator('.followup-item')).toHaveCount(1);
  await expect(page.locator('.followup-issue')).toContainText('Refresh is required');
  await expect(page.getByRole('button', { name: 'Save follow-up', exact: true })).toBeDisabled();
  await Promise.all([
    page.waitForEvent('dialog').then(async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Refreshing will discard 1 unsaved follow-up choices.');
      await dialog.accept();
    }),
    page.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click(),
  ]);
  await expect(page.locator('#followupNotice')).toContainText('sessions loaded (up to 50)');
  await expect(page.locator('#followupList')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.followup-saved')).toContainText('Open');
});

test('migration not enabled leaves the existing dashboard usable', async ({ page }) => {
  await setup(page, { fail: true });
  await expect(page.locator('#followupNotice')).toContainText('not enabled yet');
  await expect(page.locator('#drivers')).toContainText('Avery Example');
  await expect(page.locator('#followupList form')).toHaveCount(0);
});

test('account changes clear protected outcomes and discard in-flight loads', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.followup-item')).toHaveCount(1);
  await page.waitForFunction(() => window.fixtureFollowupBodiesSettled === 1);
  await page.evaluate(() => { window.fixtureIgnoreFollowupAbort = true; });
  const pending = { started: deferred(), release: deferred() };
  state.nextLoad = pending;
  const responseComplete = page.waitForResponse(response => response.url().endsWith('/api/fleet-followups') && response.request().method() === 'GET');
  // Preserve the primary assertion failure if teardown closes the response wait.
  responseComplete.catch(() => {});
  try {
    await page.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
    await pending.started.promise;
    await expect(page.locator('#followupList')).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => {
      window.fixtureUser = null;
      window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth' }));
    });
    await expect(page.locator('#fleetFollowups')).toBeHidden();
    await expect(page.locator('#followupList')).toBeEmpty();
  } finally {
    pending.release.resolve();
  }
  const response = await responseComplete;
  expect(await response.finished()).toBeNull();
  await page.waitForFunction(() => window.fixtureFollowupBodiesSettled === 2);
  await expect(page.locator('#fleetFollowups')).toBeHidden();
  await expect(page.locator('#followupList')).toBeEmpty();
  expect(state.posts).toBe(0);
});

test('session descriptions distinguish recorded completion and measured zero from missing or invalid telemetry', async ({ page }) => {
  const now = Date.now(), iso = offset => new Date(now + offset).toISOString();
  const base = { driver_id: 'driver', started_at: iso(-3_600_000), ended_at: iso(-1_800_000), alert_count: 2 };
  const cases = [
    { name: 'Completed record', state: 'Completed session', alert: '2 reported alerts' },
    { name: 'Measured zero', changes: { alert_count: 0 }, state: 'Completed session', alert: '0 reported alerts' },
    { name: 'No recorded end', changes: { ended_at: null, alert_count: null }, state: 'No recorded end time', alert: 'Alert count not recorded' },
    { name: 'Invalid end', changes: { ended_at: 'invalid', alert_count: false }, state: 'Invalid recorded dates', alert: 'Alert count not recorded' },
    { name: 'Future end', changes: { ended_at: iso(86_400_000), alert_count: 'withheld' }, state: 'Invalid recorded dates', alert: 'Alert count not recorded' },
    { name: 'End before start', changes: { ended_at: iso(-7_200_000), alert_count: -1 }, state: 'Invalid recorded dates', alert: 'Alert count not recorded' },
    { name: 'Missing start', changes: { started_at: null, alert_count: 1.5 }, state: 'Invalid recorded dates', alert: 'Alert count not recorded', missingDate: true },
    { name: 'Missing alert field', changes: { alert_count: undefined }, state: 'Completed session', alert: 'Alert count not recorded' },
    { name: 'Blank alert field', changes: { alert_count: '' }, state: 'Completed session', alert: 'Alert count not recorded' },
  ];
  await setup(page, { sessions: cases.map((entry, index) => ({ ...base, ...entry.changes,
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`, driver_name: entry.name })) });
  await expect(page.locator('.followup-item')).toHaveCount(cases.length);
  for (const entry of cases) {
    const item = page.locator('.followup-item').filter({ has: page.getByRole('heading', { name: entry.name, exact: true }) });
    const description = item.locator('p.muted');
    await expect(description).toContainText(entry.state);
    await expect(description).toContainText(entry.alert);
    await expect(description).not.toContainText('Session in progress');
    if (entry.state !== 'Completed session') await expect(description).not.toContainText('Completed session');
    if (entry.alert === 'Alert count not recorded') await expect(description).not.toContainText('0 reported alerts');
    if (entry.missingDate) await expect(description).toContainText('Date unavailable');
    await expect(item.locator('.followup-saved')).toHaveText('Saved status: Open (not yet saved)');
    await expect(item.getByRole('button', { name: 'Save follow-up', exact: true })).toBeDisabled();
  }
});

test('mobile follow-up controls fit and have usable touch targets', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const button = page.getByRole('button', { name: 'Save follow-up', exact: true });
  await expect(button).toBeVisible();
  expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await page.locator('.followup-controls select').boundingBox()).height).toBeGreaterThanOrEqual(44);
  const dimensions = await page.locator('#fleetFollowups').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.locator('#fleetFollowups').screenshot({ path: testInfo.outputPath('followups-mobile.png') });
});
