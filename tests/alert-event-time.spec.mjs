import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';
import { test, expect } from '@playwright/test';

async function openSignedInDriver(page, eventResponse, onSessionStart) {
  const events = [];
  await page.addInitScript(() => {
    localStorage.setItem('occulert-auth', JSON.stringify({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user-1', email: 'driver@example.com' },
    }));
  });
  await page.route('**/api/public-config', route => route.fulfill({ json: {
    ok: true, supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-test-key' },
  } }));
  await page.route('**/api/sessions', async route => {
    if (onSessionStart) await onSessionStart();
    await route.fulfill({ json: { ok: true, session: { id: 'session-1' } } });
  });
  await page.route('**/api/events', async route => {
    const body = route.request().postDataJSON();
    events.push(body);
    const [status, json] = eventResponse(body, events.length);
    await route.fulfill({ status, json });
  });
  await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#cloudConsent').check();
  await page.evaluate(() => initCloud());
  await expect(page.locator('#sync')).toHaveText('ON');
  return events;
}

test('an event retains detection time while the actual session-start response waits five seconds', async ({ page }) => {
  let releaseSession, sessionStarted;
  const pendingSession = new Promise(resolve => { releaseSession = resolve; });
  const sessionRequest = new Promise(resolve => { sessionStarted = resolve; });
  const events = await openSignedInDriver(page, () => [200, { ok: true }], async () => {
    sessionStarted();
    await pendingSession;
  });
  const detectedAt = await page.evaluate(() => {
    void beginBackendSession();
    const detected = Date.now();
    queueBackendEvent('drowsy');
    return detected;
  });
  await sessionRequest;
  expect(events).toHaveLength(0);
  await new Promise(resolve => setTimeout(resolve, 5_000));
  releaseSession();
  await page.evaluate(() => backendEventQueue);
  expect(events).toHaveLength(1);
  expect(events[0].session_id).toBe('session-1');
  expect(events[0].type).toBe('drowsy');
  expect(typeof events[0].occurred_at).toBe('string');
  const occurredAt = Date.parse(events[0].occurred_at);
  expect(new Date(occurredAt).toISOString()).toBe(events[0].occurred_at);
  expect(Math.abs(occurredAt - detectedAt)).toBeLessThanOrEqual(250);
  const sentBy = await page.evaluate(() => Date.now());
  expect(sentBy - occurredAt).toBeGreaterThanOrEqual(5_000);
});

for (const fallbackStatus of [200, 400]) {
  test(`a skewed device timestamp has exactly one untimed fallback ending in ${fallbackStatus}`, async ({ page }) => {
    const events = await openSignedInDriver(page, (_body, attempt) => [
      attempt === 1 ? 400 : fallbackStatus, { ok: attempt > 1 && fallbackStatus === 200, error: 'invalid_occurred_at' },
    ]);
    const skewedTime = new Date(Date.now() + 10 * 60_000);
    await page.clock.setFixedTime(skewedTime);
    await page.evaluate(async () => {
      await beginBackendSession();
      queueBackendEvent('yawn');
      await backendEventQueue;
    });
    expect(events).toHaveLength(2);
    expect(events[0].occurred_at).toBe(skewedTime.toISOString());
    const { occurred_at, ...untimed } = events[0];
    expect(events[1]).toEqual(untimed);
    expect(Object.hasOwn(events[1], 'occurred_at')).toBe(false);
  });
}

for (const [status, error] of [[400, 'invalid_event'], [409, 'invalid_occurred_at'], [503, 'invalid_occurred_at']]) {
  test(`an event failure ${status} ${error} is not resent`, async ({ page }) => {
    const events = await openSignedInDriver(page, () => [status, { ok: false, error }]);
    await page.evaluate(async () => {
      await beginBackendSession();
      queueBackendEvent('drowsy');
      await backendEventQueue;
    });
    expect(events).toHaveLength(1);
  });
}
