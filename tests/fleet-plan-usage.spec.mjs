import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { assetByStem } from '../scripts/lib/current-assets.mjs';

const plans = [{ plan: 'trial', active_drivers: 5 }, { plan: 'starter', active_drivers: 10 }, { plan: 'growth', active_drivers: 30 }];
const monthly = count => ({ version: 1, definition: 'completed_session_v1', timezone: 'America/Los_Angeles',
  month: '2026-11', as_of: '2026-11-07T14:00:00Z', active_drivers: count });
const trial = { version: 1, test_mode: true, enforced: false, plan: 'trial', plan_source: 'no_subscription',
  subscription_status: 'none', limit: { active_drivers: 5 }, usage: { active_drivers: 3, month: '2026-11' },
  within_limit: true, plans };
const over = { ...trial, plan: 'starter', plan_source: 'test_subscription', subscription_status: 'past_due',
  limit: { active_drivers: 10 }, usage: { active_drivers: 12, month: '2026-11' }, within_limit: false };
const UNENFORCED = 'Test mode: these limits are proposals and are not enforced. Nothing is blocked. Driver safety alerts are never limited by a plan.';
const UNAVAILABLE = 'Plan details are unavailable right now. Use Refresh now to retry. Driver safety alerts are never limited by a plan.';

// `responses` are served in order; the last one repeats. An entry without
// `ok` is a successful summary carrying that `entitlements` value, and a
// summary built with `omit` leaves the field out as an older API would.
const summaryBody = (entitlements, { count = entitlements?.usage?.active_drivers ?? null, omit = false } = {}) => ({
  fleet: { id: 'fixture-fleet', company_name: 'Fixture Freight' }, drivers: [], sessions: [], events: [],
  monthly_activity: count === null ? null : monthly(count), ...(omit ? {} : { entitlements }),
});
async function mockBackend(page, responses) {
  await page.route(`**/${assetByStem('occulert-backend.js')}`, route => route.fulfill({
    contentType: 'application/javascript', body: `(()=>{const responses=${JSON.stringify(responses)};let calls=0;
      window.OcculertBackend={currentUser:()=>({id:'fixture-owner'}),getSession:async()=>({user:{id:'fixture-owner'}}),
        getFleetSummary:async()=>{const next=responses[Math.min(calls++,responses.length-1)];
          return next.ok===false?next:{ok:true,status:200,body:next}}};})();`,
  }));
}
async function openDashboard(page, responses) {
  await mockBackend(page, responses);
  await page.goto('/fleet-dashboard.html');
  const panel = page.locator('#planUsage');
  await expect(panel).toBeVisible();
  return panel;
}
const rows = panel => panel.locator('#planUsageSummary .ops-row');
const rowText = async panel => (await rows(panel).allInnerTexts()).map(text => text.replace(/\s*\n\s*/g, ' | '));

test('a trial fleet inside its proposed limit sees its plan, its usage and every proposed limit', async ({ page }) => {
  const panel = await openDashboard(page, [summaryBody(trial)]);
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Plan and usage (test mode)');
  await expect(panel.getByRole('link', { name: 'View proposed plans' })).toHaveAttribute('href', '/fleet-pricing.html');
  await expect(rows(panel)).toHaveCount(3);
  expect(await rowText(panel)).toEqual([
    'Current plan | Free trial · no subscription',
    'Monthly active drivers | 3 of 5 · 2026-11 (Pacific time)',
    'Proposed limits | Free trial 5 · Starter 10 · Growth 30 monthly active drivers',
  ]);
  await expect(panel.locator('.yellow')).toHaveCount(0);
  await expect(page.locator('#planUsageNote')).toHaveText(UNENFORCED);
  // The count shown in the panel is the server's monthly total, not the roster size.
  await expect(page.locator('#monthlyActivity')).toContainText('Monthly active drivers: 3 · 2026-11 (Pacific time)');
  await expect(page.locator('#kpiDrivers')).toHaveText('0');
});

test('a fleet over its proposed limit is told by how much and that nothing is blocked', async ({ page }) => {
  const panel = await openDashboard(page, [summaryBody(over)]);
  await expect(rows(panel)).toHaveCount(4);
  expect(await rowText(panel)).toEqual([
    'Current plan | Starter · test subscription (past due)',
    'Monthly active drivers | 12 of 10 · 2026-11 (Pacific time)',
    'Over the proposed limit | 2 drivers',
    'Proposed limits | Free trial 5 · Starter 10 · Growth 30 monthly active drivers',
  ]);
  await expect(panel.locator('.yellow')).toHaveText(['12 of 10 · 2026-11 (Pacific time)', '2 drivers']);
  await expect(page.locator('#planUsageNote')).toHaveText(UNENFORCED);
  // Being over a proposed limit changes nothing else on the dashboard.
  await expect(page.locator('#cloudStatus')).toContainText('Protected connection active for Fixture Freight.');
  await expect(page.locator('#refreshNow')).toBeEnabled();
});

test('the note stops promising that nothing is blocked once the server reports enforcement', async ({ page }) => {
  await openDashboard(page, [summaryBody({ ...over, enforced: true })]);
  await expect(page.locator('#planUsageNote')).toHaveText(
    'Test mode: the server is checking these proposed limits. Driver safety alerts are never limited by a plan.');
});

for (const [name, body] of [
  ['a summary the server could not build', summaryBody(null, { count: 3 })],
  ['an API that does not send the field yet', summaryBody(null, { count: 3, omit: true })],
  ['a plan this page does not know', summaryBody({ ...trial, plan: 'enterprise' })],
  ['a limit that contradicts the plan list', summaryBody({ ...trial, limit: { active_drivers: 500 } })],
  ['markup in place of a status', summaryBody({ ...trial, subscription_status: '<img src=x onerror="document.title=\'injected\'">' })],
  ['markup in place of a month', summaryBody({ ...trial, usage: { active_drivers: 3, month: '<b>2026-11</b>' } })],
]) {
  test(`plan details are shown as unavailable for ${name}`, async ({ page }) => {
    const panel = await openDashboard(page, [body]);
    await expect(rows(panel)).toHaveCount(1);
    expect(await rowText(panel)).toEqual(['Plan details | Unavailable']);
    await expect(page.locator('#planUsageNote')).toHaveText(UNAVAILABLE);
    await expect(panel.locator('img, b, script')).toHaveCount(0);
    await expect(page).toHaveTitle(/Fleet Dashboard/);
    // The rest of the dashboard is unaffected by an unavailable plan summary.
    await expect(page.locator('#monthlyActivity')).toContainText('Monthly active drivers: 3 · 2026-11 (Pacific time)');
    await expect(page.locator('#cloudStatus')).toContainText('Protected connection active for Fixture Freight.');
  });
}

test('usage the server could not count is shown as unavailable, never as zero or over the limit', async ({ page }) => {
  const panel = await openDashboard(page, [summaryBody({ ...trial, usage: null, within_limit: null })]);
  expect(await rowText(panel)).toEqual([
    'Current plan | Free trial · no subscription',
    'Monthly active drivers | Unavailable · proposed limit 5',
    'Proposed limits | Free trial 5 · Starter 10 · Growth 30 monthly active drivers',
  ]);
  await expect(panel.locator('.yellow')).toHaveCount(0);
});

test('a failed refresh keeps the last loaded plan and says so', async ({ page }) => {
  const panel = await openDashboard(page, [summaryBody(over), { ok: false, status: 503, body: { error: 'unavailable' } }]);
  await expect(rows(panel)).toHaveCount(4);
  await page.locator('#refreshNow').click();
  await expect(page.locator('#planUsageNote')).toHaveText(
    UNENFORCED + ' Refresh unavailable; showing the last loaded plan details.');
  await expect(rows(panel).first()).toContainText('Starter · test subscription (past due)');
});

test('signing out hides the panel and drops the plan it showed', async ({ page }) => {
  const panel = await openDashboard(page, [summaryBody(over)]);
  await expect(panel).toContainText('Starter · test subscription (past due)');
  await page.evaluate(() => {
    window.OcculertBackend.currentUser = () => null;
    window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth' }));
  });
  await expect(panel).toBeHidden();
  await expect(panel).not.toContainText('Starter');
  await expect(panel).not.toContainText('12 of 10');
});

for (const [name, response, status] of [
  ['a signed-in account that owns no fleet', { ok: false, status: 404, body: { error: 'fleet_not_found' } }, 'No owned fleet found.'],
  ['a first load that fails', { ok: false, status: 503, body: { error: 'unavailable' } }, 'Protected fleet data is temporarily unavailable'],
]) {
  test(`${name} gets no plan panel, because there is no plan to report`, async ({ page }) => {
    await mockBackend(page, [response]);
    await page.goto('/fleet-dashboard.html');
    await expect(page.locator('#cloudStatus')).toContainText(status);
    await expect(page.locator('#planUsage')).toBeHidden();
  });
}

test('a plan appears once a fleet loads after a failed first attempt', async ({ page }) => {
  await mockBackend(page, [{ ok: false, status: 503, body: { error: 'unavailable' } }, summaryBody(trial)]);
  await page.goto('/fleet-dashboard.html');
  const panel = page.locator('#planUsage');
  await expect(page.locator('#cloudStatus')).toContainText('Protected fleet data is temporarily unavailable');
  await expect(panel).toBeHidden();
  await page.locator('#refreshNow').click();
  await expect(panel).toBeVisible();
  await expect(rows(panel).first()).toContainText('Free trial · no subscription');
});

test('the signed-out dashboard never shows a plan panel', async ({ page }) => {
  await page.goto('/fleet-dashboard.html');
  await expect(page.locator('#cloudStatus')).toContainText('Not signed in.');
  await expect(page.locator('#planUsage')).toBeHidden();
});

// The dashboard uses a fixed dark theme, so a light preference must still get a readable panel.
for (const preference of ['dark', 'light']) for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`the over-limit panel fits a ${viewport.width}px screen and passes the WCAG baseline (${preference} preference)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(value => localStorage.setItem('occulert-theme', value), preference);
    await page.emulateMedia({ colorScheme: preference });
    const panel = await openDashboard(page, [summaryBody(over)]);
    await expect(rows(panel)).toHaveCount(4);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
      await Promise.allSettled(finite.map(animation => animation.finished));
    });
    // Nothing in the panel may force the page wider than the screen.
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return [...document.querySelectorAll('#planUsage, #planUsage *')].filter(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && (box.left < -0.5 || box.right > width + 0.5);
      }).map(node => node.id || node.className || node.tagName);
    });
    expect(overflow).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).include('#planUsage').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
  });
}
