import { test, expect } from '@playwright/test';

const owner = '11111111-1111-4111-8111-111111111111';
const id = '33333333-3333-4333-8333-333333333333';
async function setup(page, { fail = false, conflict = false, slow = false } = {}) {
  const state = { followup: { session_id: id, status: 'open', version: 0, updated_at: null }, posts: 0 };
  const session = { id, driver_id: 'driver', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), alert_count: 2, safety_score: 65 };
  await page.route('**/occulert-backend.v47.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.fixtureUser = { id: '${owner}' };
    window.OcculertBackend = {
      currentUser: () => window.fixtureUser,
      getSession: async () => ({user: window.fixtureUser,access_token:'fixture-token'}),
      getFleetSummary: async () => ({ok:true,body:{fleet:{id:'fleet',company_name:'Example fleet'},drivers:[{id:'driver',name:'Avery Example',active:true}],sessions:[${JSON.stringify(session)}],events:[]}}),
      signOut: () => {window.fixtureUser=null;}
    };` }));
  await page.route('**/api/fleet-followups', async route => {
    if (slow) await new Promise(resolve => setTimeout(resolve, 200));
    if (route.request().method() === 'POST') {
      state.posts += 1;
      const body = route.request().postDataJSON();
      if (conflict || body.expected_version !== state.followup.version) return route.fulfill({ status: 409, json: { ok: false, error: 'followup_changed' } });
      state.followup = { ...state.followup, status: body.status, version: state.followup.version + 1, updated_at: new Date().toISOString() };
      return route.fulfill({ json: { ok: true, followup: state.followup } });
    }
    if (fail) return route.fulfill({ status: 503, json: { ok: false, error: 'followups_not_enabled' } });
    return route.fulfill({ json: { ok: true, limit: 50, sessions: [{ ...session, driver_name: 'Avery Example <script>', followup: state.followup }] } });
  });
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#fleetFollowups')).toBeVisible();
  await page.getByText('Saved session follow-ups', { exact: true }).click();
  return state;
}

test('saved follow-up survives refresh and page reload; names are plain text', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.followup-item h3')).toHaveText('Avery Example <script>');
  await expect(page.locator('.followup-item script')).toHaveCount(0);
  await page.getByLabel('Follow-up for Avery Example <script>').selectOption('reviewed');
  await page.getByRole('button', { name: 'Save follow-up', exact: true }).click();
  await expect(page.locator('#followupNotice')).toHaveText('Follow-up saved.');
  expect(state.posts).toBe(1);
  await page.reload();
  await expect(page.locator('#fleetFollowups')).toBeVisible();
  await page.getByText('Saved session follow-ups', { exact: true }).click();
  await expect(page.locator('.followup-saved')).toHaveText('Saved status: Reviewed');
});

test('conflicting edits do not claim success or silently overwrite', async ({ page }) => {
  await setup(page, { conflict: true });
  await page.getByLabel('Follow-up for Avery Example <script>').selectOption('reviewed');
  await page.getByRole('button', { name: 'Save follow-up', exact: true }).click();
  await expect(page.locator('#followupNotice')).toContainText('changed elsewhere');
  await expect(page.locator('.followup-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh follow-ups', exact: true }).click();
  await expect(page.locator('.followup-saved')).toContainText('Open');
});

test('migration not enabled leaves the existing dashboard usable', async ({ page }) => {
  await setup(page, { fail: true });
  await expect(page.locator('#followupNotice')).toContainText('not enabled yet');
  await expect(page.locator('#drivers')).toContainText('Avery Example');
  await expect(page.locator('#followupList form')).toHaveCount(0);
});

test('account changes clear protected outcomes and discard in-flight loads', async ({ page }) => {
  await setup(page, { slow: true });
  await page.evaluate(() => {
    window.fixtureUser = null;
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth' }));
  });
  await expect(page.locator('#fleetFollowups')).toBeHidden();
  await page.waitForTimeout(300);
  await expect(page.locator('#followupList')).toBeEmpty();
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
