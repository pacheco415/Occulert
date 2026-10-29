import { test, expect } from '@playwright/test';
import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';

const sessionId = '11111111-1111-4111-8111-111111111111';
const details = { client_event_id: '22222222-2222-4222-8222-222222222222', occurred_at: '2026-10-28T20:00:00.000Z', fatigue_score: 42, confidence: null };

async function fixture(page, capability) {
  const events = [], unexpectedAuth = [];
  await page.addInitScript(() => {
    localStorage.setItem('occulert-auth', JSON.stringify({ access_token: 'fixture-access', refresh_token: 'fixture-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'fixture-owner' } }));
  });
  await page.route('**/api/public-config', route => route.fulfill({ json: { ok: true,
    capabilities: capability ? { event_idempotency_protocol: capability } : {},
    supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-fixture' },
  } }));
  await page.route('**/auth/v1/**', route => { unexpectedAuth.push(route.request().url()); return route.abort(); });
  await page.route('**/api/events', async route => {
    events.push(route.request().postDataJSON());
    const status = [401, 503, 429][events.length - 1] ?? 500;
    await route.fulfill({ status, headers: { 'Retry-After': '7' }, json: { error: 'fixture', replayed: false } });
  });
  await page.goto('/app.html', { waitUntil: 'domcontentloaded' });
  return { events, unexpectedAuth };
}

test('the flag-off driver does not send a keyed event or activate an outbox', async ({ page }) => {
  const f = await fixture(page, null);
  const result = await page.evaluate(async ({ sessionId, details }) => {
    const supported = await window.OcculertBackend.eventOutboxCapability();
    const sent = await window.OcculertBackend.logQueuedEvent(sessionId, 'drowsy', details, () => true);
    return { supported, sent, persisted: localStorage.getItem('occulert.event-outbox.v1') };
  }, { sessionId, details });
  expect(result.supported).toBe(false);
  expect(result.sent.status).toBe(503);
  expect(result.persisted).toBeNull();
  expect(f.events).toEqual([]);
  expect(f.unexpectedAuth).toEqual([]);
});

test('each explicit keyed attempt makes one POST and exposes only bounded retry metadata', async ({ page }) => {
  const f = await fixture(page, 'client_event_uuid_v1');
  const results = await page.evaluate(async ({ sessionId, details }) => {
    const output = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      output.push(await window.OcculertBackend.logQueuedEvent(sessionId, 'drowsy', details, () => true));
    }
    return output;
  }, { sessionId, details });
  expect(results.map(result => result.status)).toEqual([401, 503, 429]);
  expect(results.map(result => result.retryAfterMs ?? null)).toEqual([null, null, 7_000]);
  expect(results.every(result => !Object.hasOwn(result, 'headers'))).toBe(true);
  expect(f.events).toEqual(Array(3).fill({ session_id: sessionId, type: 'drowsy', ...details }));
  expect(f.unexpectedAuth).toEqual([]);
});
