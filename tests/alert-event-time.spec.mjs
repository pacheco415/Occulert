import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';
import { test, expect } from '@playwright/test';

async function openSignedInDriver(page, eventResponse, sessionDelayMs = 0) {
  const events = [];
  await page.addInitScript(() => {
    localStorage.setItem('occulert-auth', JSON.stringify({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'user-1', email: 'driver@example.com' },
    }));
  });
  await page.route('**/api/public-config', route => route.fulfill({ json: { ok: true, supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-test-key' } } }));
  await page.route('**/api/sessions', async route => {
    await new Promise(resolve => setTimeout(resolve, sessionDelayMs));
    await route.fulfill({ json: { ok: true, session: { id: 'session-1' } } });
  });
  await page.route('**/api/events', async route => {
    const body = route.request().postDataJSON();
    events.push(body);
    const [status, json] = eventResponse(body);
    await route.fulfill({ status, json });
  });
  await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#cloudConsent').check();
  await page.evaluate(() => initCloud());
  await expect(page.locator('#sync')).toHaveText('ON');
  return events;
}

test('an alert carries the time it was detected, even when the session starts later', async ({ page }) => {
  const events = await openSignedInDriver(page, () => [200, { ok: true, event: { id: 'event-1' } }], 300);
  const times = await page.evaluate(async () => {
    beginBackendSession();
    const detected = Date.now();
    queueBackendEvent('drowsy');
    await backendSessionPromise;
    const started = Date.now();
    await backendEventQueue;
    return { detected, started };
  });
  expect(times.started - times.detected).toBeGreaterThanOrEqual(250);
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('drowsy');
  const occurred = Date.parse(events[0].occurred_at);
  expect(new Date(occurred).toISOString()).toBe(events[0].occurred_at);
  expect(occurred).toBeGreaterThanOrEqual(times.detected);
  expect(occurred).toBeLessThan(times.started);
});

test('a detection time the server rejects is resent once without it', async ({ page }) => {
  const events = await openSignedInDriver(page, body => body.occurred_at
    ? [400, { ok: false, error: 'invalid_occurred_at' }]
    : [200, { ok: true, event: { id: 'event-1' } }]);
  await page.evaluate(async () => {
    beginBackendSession();
    queueBackendEvent('yawn');
    await backendEventQueue;
  });
  expect(events.map(body => [body.type, typeof body.occurred_at])).toEqual([['yawn', 'string'], ['yawn', 'undefined']]);
});

test('other event failures are not resent', async ({ page }) => {
  const events = await openSignedInDriver(page, () => [409, { ok: false, error: 'session_ended' }]);
  await page.evaluate(async () => {
    beginBackendSession();
    queueBackendEvent('drowsy');
    await backendEventQueue;
  });
  expect(events).toHaveLength(1);
});
