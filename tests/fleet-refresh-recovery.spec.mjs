import { test, expect } from '@playwright/test';

const summary = name => ({
  ok: true, fleet: { id: 'fleet-1', company_name: name, plan: 'trial' },
  drivers: [{ id: 'driver-1', name: 'Private driver', active: true }],
  sessions: [{ id: 'session-1', driver_id: 'driver-1', started_at: new Date(Date.now() - 60_000).toISOString(), ended_at: new Date(Date.now() - 30_000).toISOString(), safety_score: 80, alert_count: 0 }],
  events: [], telemetry_trust: 'unverified_client_report',
  privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
});

for (const surface of ['dashboard', 'display']) {
  for (const lateStatus of [200, 401]) {
    test(`${surface} recovers a hung summary and ignores its late ${lateStatus} response`, async ({ page }) => {
      await page.clock.install();
      await page.clock.pauseAt(new Date());
      await page.addInitScript(() => localStorage.setItem('occulert-auth', JSON.stringify({
        access_token: 'owner-access', refresh_token: 'owner-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'owner-1' },
      })));
      let requests = 0, releaseLate;
      const late = new Promise(resolve => { releaseLate = resolve; });
      await page.route('**/api/fleet-summary*', async route => {
        requests += 1;
        if (requests === 2) {
          await late;
          return route.fulfill({ status: lateStatus, json: lateStatus === 200 ? summary('Discarded late fleet') : { error: 'unauthorized' } });
        }
        return route.fulfill({ json: summary(requests === 1 ? 'Initial fleet' : 'Recovered fleet') });
      });
      await page.route('**/api/fleet-followups*', route => route.fulfill({ json: { ok: true, sessions: [] } }));
      const button = page.locator(surface === 'dashboard' ? '#refreshNow' : '#refreshButton');
      const status = page.locator(surface === 'dashboard' ? '#cloudStatus' : '#connectionStatus');
      try {
        await page.goto(`/fleet-${surface}.html`);
        if (surface === 'dashboard') await page.clock.runFor(101);
        await expect(status).toContainText('Protected connection active');
        await button.click();
        await expect.poll(() => requests).toBe(2);
        await expect(button).toBeDisabled();
        await page.clock.fastForward(8001);
        await expect(button).toBeEnabled();
        await expect(status).toContainText(surface === 'dashboard' ? 'timed out' : 'Connection interrupted');
        if (surface === 'dashboard') {
          await expect(page.locator('#drivers')).toContainText('Private driver');
          await expect(page.locator('#pilotReportPrint')).toBeDisabled();
        } else {
          await expect(page.locator('#recentSessions')).toHaveText('1');
          await expect(page.locator('#connectionDetails')).toContainText('last protected summary');
        }
        await button.click();
        await expect(status).toContainText('Protected connection active');
        await expect.poll(() => requests).toBe(3);
        const delivered = page.waitForResponse(response => response.url().includes('/api/fleet-summary') && response.status() === lateStatus);
        releaseLate();
        await delivered;
        // The late transport has completed after a successful replacement
        // request; it cannot overwrite the view or sign out that owner.
        await expect(status).toContainText('Protected connection active');
        if (surface === 'dashboard') await expect(status).toContainText('Recovered fleet');
        else await expect(page.locator('#displayTitle')).toHaveText('Recovered fleet');
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('occulert-auth')).user.id)).toBe('owner-1');
      } finally {
        releaseLate();
      }
    });
  }
}
