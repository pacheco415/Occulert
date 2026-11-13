import { test, expect } from '@playwright/test';
import { assetByStem } from '../scripts/lib/current-assets.mjs';

const DRIVER = '22222222-2222-4222-8222-222222222222';
const summary = {
  fleet: { id: 'fixture-fleet', company_name: 'Fixture' },
  drivers: [{ id: DRIVER, name: 'Dana Driver', active: true, vehicle_id: 'Van 1' }],
  sessions: [], events: [], monthly_activity: null,
};
const history = {
  ok: true, has_more: false,
  sessions: [
    { id: '44444444-4444-4444-8444-000000000002', driver_id: DRIVER, started_at: '2026-11-02T10:00:00+00:00',
      ended_at: '2026-11-02T10:45:00+00:00', safety_score: 90, alert_count: 1, detector_pipeline: 'web_mediapipe_ear' },
    { id: '44444444-4444-4444-8444-000000000001', driver_id: DRIVER, started_at: '2026-11-01T10:00:00+00:00',
      ended_at: null, safety_score: null, alert_count: null, detector_pipeline: null },
  ],
};

test('Sessions shows one driver\'s recent protected sessions and Escape returns to the roster', async ({ page }) => {
  const requests = [];
  await page.route(`**/${assetByStem('occulert-backend.js')}`, route => route.fulfill({
    contentType: 'application/javascript', body: `const auth={access_token:'fixture-token',refresh_token:'fixture-refresh',user:{id:'fixture-owner'}};
      window.OcculertBackend={currentUser:()=>({id:'fixture-owner'}),getSession:async()=>auth,
        captureAuthContext:()=>({auth}),requireAuthContext(){},isAuthContextCurrent:()=>true,
        fetchWithDeadline:(path,options)=>fetch(path,options),
        getFleetSummary:async()=>({ok:true,status:200,body:${JSON.stringify(summary)}})};`,
  }));
  await page.route('**/api/fleet-session-history**', route => {
    requests.push({ url: new URL(route.request().url()), authorization: route.request().headers().authorization });
    return route.fulfill({ json: history });
  });
  await page.goto('/fleet-dashboard.html');
  const panel = page.locator('#driverDetail'), trigger = page.locator('[data-driver-detail]');
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(page.locator('#driverDetailTitle')).toHaveText('Recent sessions: Dana Driver');
  await expect(page.locator('#driverDetailList li')).toHaveCount(2);
  await expect(page.locator('#driverDetailSummary')).toHaveText(
    '2 sessions loaded. 1 completed. Average score 90/100 across 1 scored. Reported alerts 1 across 1 with a recorded count.');
  await expect(page.locator('#driverDetailList li').nth(1)).toContainText('No recorded end time');
  await expect(page.locator('#driverDetailList li').nth(1)).toContainText('Score not recorded');
  await expect(page.locator('#driverDetailStatus')).toContainText('Client-reported and unverified');
  expect(requests).toHaveLength(1);
  expect(requests[0].url.pathname).toBe('/api/fleet-session-history');
  expect([...requests[0].url.searchParams.entries()]).toEqual([['driver_id', DRIVER]]);
  expect(requests[0].authorization).toBe('Bearer fixture-token');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#driverDetailList li')).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(panel).toBeVisible();
  await page.locator('#driverDetailClose').click();
  await expect(panel).toBeHidden();
});

test('a failed load shows no sessions and signing out discards the panel', async ({ page }) => {
  await page.route(`**/${assetByStem('occulert-backend.js')}`, route => route.fulfill({
    contentType: 'application/javascript', body: `const auth={access_token:'fixture-token',refresh_token:'fixture-refresh',user:{id:'fixture-owner'}};
      window.OcculertBackend={currentUser:()=>({id:'fixture-owner'}),getSession:async()=>auth,
        captureAuthContext:()=>({auth}),requireAuthContext(){},isAuthContextCurrent:()=>true,
        fetchWithDeadline:(path,options)=>fetch(path,options),
        getFleetSummary:async()=>({ok:true,status:200,body:${JSON.stringify(summary)}})};`,
  }));
  await page.route('**/api/fleet-session-history**', route => route.fulfill({ status: 503, json: { ok: false, error: 'fleet_history_unavailable' } }));
  await page.goto('/fleet-dashboard.html');
  await page.locator('[data-driver-detail]').click();
  await expect(page.locator('#driverDetailStatus')).toContainText('could not be loaded');
  await expect(page.locator('#driverDetailList li')).toHaveCount(0);
  await page.evaluate(() => { window.OcculertBackend.currentUser = () => null; window.dispatchEvent(new StorageEvent('storage', { key: 'occulert-auth' })); });
  await expect(page.locator('#driverDetail')).toBeHidden();
});
