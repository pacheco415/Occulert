import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { SUPABASE_HOST } from '../scripts/lib/csp-policy.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const login = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
const KEY = 'occulert.event-outbox.v1', META = 'occulert.event-outbox.lifecycle.v1';
let preview;
if (process.env.OCCULERT_SOURCE_PREVIEW === '1') {
  const { buildDriverArtifact } = await import('../scripts/lib/driver-build.mjs');
  preview = (await buildDriverArtifact({ sourceRoot: fileURLToPath(new URL('../src', import.meta.url)), contractPath: fileURLToPath(new URL('../source-driver-contract.json', import.meta.url)) })).code;
}
const backendPreview = process.env.OCCULERT_BACKEND_PREVIEW ? readFileSync(process.env.OCCULERT_BACKEND_PREVIEW, 'utf8') : null;

async function setup(page, options = {}) {
  const events = [];
  await page.addInitScript(({ owner, login }) => {
    if (!localStorage.getItem('occulert-auth')) localStorage.setItem('occulert-auth', JSON.stringify({
      access_token: `unused.${btoa(JSON.stringify({ sub: owner, session_id: login }))}.unused`,
      refresh_token: 'fixture-refresh-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: owner, email: 'driver@example.com' },
    }));
    window.eventRetryTouches = [];
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      const previous = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        if (args[0]?.startsWith('occulert.event-outbox.')) window.eventRetryTouches.push([method, args[0]]);
        return previous.apply(this, args);
      };
    }
    const listen = window.addEventListener;
    window.addEventListener = function (name, ...rest) { if (name === 'occulert:auth-lifecycle') window.eventRetryTouches.push(['listen', name]); return listen.call(this, name, ...rest); };
  }, { owner, login });
  if (preview) await page.route(/\/driver-app\.v\d+\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: preview }));
  if (backendPreview) await page.route(/\/occulert-backend\.v\d+\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: backendPreview }));
  await page.route('**/api/public-config', async route => {
    if (options.configWait) await options.configWait;
    await route.fulfill({ json: { ok: true,
    supabase: { configured: true, url: `https://${SUPABASE_HOST}`, anonKey: 'public-test-key' },
    capabilities: options.capability === false ? {} : { event_idempotency_protocol: 'client_event_uuid_v1' },
    } });
  });
  await page.route('**/api/sessions', async route => {
    if (options.sessionWait) await options.sessionWait;
    await route.fulfill({ json: { ok: true, session: { id: session } } });
  });
  await page.route('**/api/events', async route => {
    const body = route.request().postDataJSON(); events.push(body);
    if (options.response) return options.response(route, body, events.length);
    await route.fulfill({ json: { ok: true, event: { id: body.client_event_id || session, session_id: body.session_id }, client_event_id: body.client_event_id, replayed: false } });
  });
  await page.goto(options.flag === false ? '/app.html' : '/app.html?event-outbox=1', { waitUntil: 'domcontentloaded' });
  if (options.clock) await page.clock.install({ time: new Date() });
  if (options.consent !== false) {
    await page.locator('#cloudConsent').check(); await page.evaluate(() => initCloud());
    await expect(page.locator('#sync')).toHaveText('ON');
  }
  return events;
}
async function emit(page, type = 'drowsy') {
  await page.evaluate(async type => { await beginBackendSession(); queueBackendEvent(type); await backendEventQueue; }, type);
}
async function rows(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key))?.rows || [], KEY); }

test('default-off preserves one legacy send and touches no event retry storage or listener', async ({ page }) => {
  const events = await setup(page, { flag: false }); await emit(page);
  expect(events).toHaveLength(1); expect(events[0].type).toBe('drowsy'); expect(events[0]).not.toHaveProperty('client_event_id');
  expect(await page.evaluate(() => window.eventRetryTouches)).toEqual([]);
  await expect(page.locator('#cloudEventStatus')).toBeHidden();
});
test('a restored checked checkbox is reset before a new retry-capable document can adopt consent', async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('readystatechange', () => {
    if (document.readyState === 'interactive') document.getElementById('cloudConsent').checked = true;
  }));
  await setup(page, { consent: false });
  await expect(page.locator('#cloudConsent')).not.toBeChecked();
  expect(await page.evaluate(() => window.eventRetryTouches)).toEqual([]);
});
test('recovery from an unavailable ownership property still starts a fresh consent period', async ({ page }) => {
  const events = await setup(page, { response: (route, body, attempt) => route.fulfill(attempt === 1
    ? { status: 429, headers: { 'Retry-After': '60' }, json: { ok: false, error: 'event_rate_limited' } }
    : { json: { ok: true, event: { session_id: body.session_id }, client_event_id: body.client_event_id, replayed: false } }) });
  await emit(page); const oldId = (await rows(page))[0].event.event_id;
  await page.evaluate(() => {
    webEventDelivery.dispose(); webEventDelivery = null;
    window.restoredRetryLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', { configurable: true, get() { throw Error('temporarily unavailable'); } });
    cloudConsent.checked = false; cloudConsent.dispatchEvent(new Event('change'));
    cloudConsent.checked = true; cloudConsent.dispatchEvent(new Event('change'));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: window.restoredRetryLocks });
  });
  await page.evaluate(() => initCloud()); await emit(page, 'head_nod');
  expect(events).toHaveLength(2); expect(events[1].client_event_id).not.toBe(oldId); expect(await rows(page)).toHaveLength(0);
});
test('rapid consent changes during configuration cannot let a stale grant release the current tab lease', async ({ page, context }) => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  await setup(page, { consent: false, configWait: waiting });
  await page.evaluate(() => {
    for (const checked of [true, false, true]) { cloudConsent.checked = checked; cloudConsent.dispatchEvent(new Event('change')); }
  });
  release(); await page.evaluate(() => initCloud());
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.ownerId, META)).toBe(owner);
  const other = await context.newPage(), events = await setup(other); await emit(other);
  expect(events).toHaveLength(1); expect(events[0]).not.toHaveProperty('client_event_id'); await other.close();
});
test('missing server capability preserves the legacy path without persisting work', async ({ page }) => {
  const events = await setup(page, { capability: false }); await emit(page, 'yawn');
  expect(events).toHaveLength(1); expect(events[0]).not.toHaveProperty('client_event_id');
  expect(await page.evaluate(() => window.eventRetryTouches)).toEqual([]); expect(await rows(page)).toHaveLength(0);
});
test('a browser without Web Locks keeps the best-effort sender and never opens the queue', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
  const events = await setup(page); await emit(page);
  expect(events).toHaveLength(1); expect(events[0]).not.toHaveProperty('client_event_id'); expect(await page.evaluate(() => window.eventRetryTouches)).toEqual([]);
});
test('keyed browser events retain type, detection metrics and time and omit GPS', async ({ page }) => {
  const events = await setup(page); await page.evaluate(() => { fatigue = 37; confidence = 83; gpsConsent.checked = true; lastPosition = { lat: 12, lng: 34 }; });
  for (const type of ['drowsy', 'distracted', 'yawn', 'head_nod']) await emit(page, type);
  expect(events.map(event => event.type)).toEqual(['drowsy', 'distracted', 'yawn', 'head_nod']);
  expect(new Set(events.map(event => event.client_event_id)).size).toBe(4);
  expect(events[0]).toMatchObject({ session_id: session, fatigue_score: 37, confidence: 83 });
  expect(events[0]).not.toHaveProperty('latitude'); expect(events[0]).not.toHaveProperty('longitude');
  expect(new Date(events[0].occurred_at).toISOString()).toBe(events[0].occurred_at);
  await expect(page.locator('#cloudEventStatus')).toHaveText('Cloud alerts pending: 0.');
});
test('429 respects Retry-After then acknowledges a replay with the same UUID and immutable detection', async ({ page }) => {
  const events = await setup(page, { clock: true, response: (route, body, attempt) => route.fulfill(attempt === 1
    ? { status: 429, headers: { 'Retry-After': '30' }, json: { ok: false, error: 'event_rate_limited' } }
    : { json: { ok: true, event: { id: body.client_event_id, session_id: body.session_id }, client_event_id: body.client_event_id, replayed: true } }) });
  await emit(page); expect(events).toHaveLength(1); expect(await rows(page)).toHaveLength(1);
  await page.clock.fastForward(29_000); expect(events).toHaveLength(1);
  await page.clock.fastForward(1_100); await expect.poll(() => events.length).toBe(2);
  expect(events[1]).toEqual(events[0]); await expect.poll(async () => (await rows(page)).length).toBe(0);
});
test('five uncertain sends exhaust one alert without changing its identity', async ({ page }) => {
  const events = await setup(page, { clock: true, response: route => route.fulfill({ status: 503, json: { ok: false } }) });
  await emit(page);
  for (const [index, delay] of [1_000, 2_000, 4_000, 8_000].entries()) {
    await page.clock.fastForward(delay + 25); await expect.poll(() => events.length).toBe(index + 2);
  }
  await expect.poll(async () => (await rows(page)).length).toBe(0);
  await page.clock.fastForward(60_000); expect(events).toHaveLength(5); expect(new Set(events.map(event => event.client_event_id)).size).toBe(1);
  await expect(page.locator('#cloudEventStatus')).toContainText('1 removed without confirmed delivery.');
});
test('an actual offline browser retains a keyed alert until online and keeps the original timestamp', async ({ page, context }) => {
  const events = await setup(page, { clock: true }); await page.evaluate(() => beginBackendSession());
  await context.setOffline(true);
  await page.evaluate(async () => { queueBackendEvent('distracted'); await backendEventQueue; });
  const saved = (await rows(page))[0]; expect(saved.event.type).toBe('distracted'); expect(events).toHaveLength(0);
  await context.setOffline(false); await page.clock.fastForward(1_100);
  await expect.poll(() => events.length).toBe(1); expect(events[0].client_event_id).toBe(saved.event.event_id); expect(events[0].occurred_at).toBe(saved.event.detected_at);
  await expect.poll(async () => (await rows(page)).length).toBe(0);
});
test('lost untimed fallback survives a controller restart with its UUID and persisted wire mode', async ({ page }) => {
  const events = await setup(page, { clock: true, response: (route, body, attempt) => attempt === 1
    ? route.fulfill({ status: 400, json: { ok: false, error: 'invalid_occurred_at' } })
    : attempt === 2 ? route.abort('failed')
    : route.fulfill({ json: { ok: true, event: { id: body.client_event_id, session_id: body.session_id }, client_event_id: body.client_event_id, replayed: true } }) });
  await emit(page); expect(events).toHaveLength(2); expect(events[0]).toHaveProperty('occurred_at'); expect(events[1]).not.toHaveProperty('occurred_at');
  const saved = (await rows(page))[0]; expect(saved.timestampMode).toBe('server');
  await page.evaluate(async () => { webEventDelivery.dispose(); webEventDelivery = null; await beginBackendSession(); queueBackendEvent('head_nod'); await backendEventQueue; });
  await page.clock.fastForward(2_100);
  await expect.poll(() => events.filter(event => event.client_event_id === saved.event.event_id).length).toBe(3);
  const replay = events.filter(event => event.client_event_id === saved.event.event_id).at(-1);
  expect(replay).toEqual(events[1]); expect(replay).not.toHaveProperty('occurred_at'); await expect.poll(async () => (await rows(page)).length).toBe(0);
});
test('Stop deletes pending work and does not replay it after connectivity returns', async ({ page }) => {
  const events = await setup(page, { clock: true, response: route => route.fulfill({ status: 503, json: { ok: false } }) });
  await emit(page); expect(await rows(page)).toHaveLength(1);
  await page.evaluate(() => detachBackendSession()); await expect.poll(async () => (await rows(page)).length).toBe(0);
  await page.clock.fastForward(60_000); await page.evaluate(() => window.dispatchEvent(new Event('online'))); expect(events).toHaveLength(1);
  await expect(page.locator('#cloudEventStatus')).toContainText('1 removed without confirmed delivery.');
});
test('a late session response after consent revocation never sends an alert', async ({ page }) => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const events = await setup(page, { sessionWait: waiting });
  await page.evaluate(() => { void beginBackendSession(); queueBackendEvent('head_nod'); });
  await page.locator('#cloudConsent').uncheck(); release(); await page.evaluate(() => backendEventQueue);
  expect(events).toHaveLength(0); expect(await rows(page)).toHaveLength(0);
});
test('a local accepted alert appears immediately while cloud session creation remains unresolved', async ({ page }) => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const events = await setup(page, { sessionWait: waiting });
  const local = await page.evaluate(() => {
    void beginBackendSession(); calibrating = false; confidence = 88; fatigue = 91;
    trigger('Fatigue');
    return { count: alerts, visible: alertScreen.classList.contains('show'), title: alertTitle.textContent };
  });
  expect(local).toEqual({ count: 1, visible: true, title: 'DROWSY ALERT' }); expect(events).toHaveLength(0);
  await page.locator('#cloudConsent').uncheck(); release(); await page.evaluate(() => backendEventQueue); expect(events).toHaveLength(0);
});
for (const transition of ['another-account', 'same-owner-new-login']) test(`${transition} removes pending events before a new login can dispatch them`, async ({ page }) => {
  const events = await setup(page, { clock: true, response: route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { ok: false, error: 'event_rate_limited' } }) });
  await emit(page); expect(await rows(page)).toHaveLength(1);
  await page.evaluate(({ owner, transition }) => {
    const id = transition === 'another-account' ? '66666666-6666-4666-8666-666666666666' : owner;
    window.OcculertBackend.adoptSession({ access_token: `unused.${btoa(JSON.stringify({ sub: id, session_id: '77777777-7777-4777-8777-777777777777' }))}.unused`,
      refresh_token: 'new-fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id } });
    queueBackendEvent('head_nod');
  }, { owner, transition });
  await expect.poll(async () => (await rows(page)).length).toBe(0); await page.clock.fastForward(60_000); expect(events).toHaveLength(1);
});
test('logout in a second tab removes pending work without adopting the next login', async ({ page, context }) => {
  const events = await setup(page, { response: route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { ok: false, error: 'event_rate_limited' } }) });
  await emit(page); expect(await rows(page)).toHaveLength(1);
  const other = await context.newPage(); await other.goto('/privacy.html');
  await other.evaluate(() => localStorage.removeItem('occulert-auth'));
  await expect.poll(async () => (await rows(page)).length).toBe(0); expect(events).toHaveLength(1);
  const metadata = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), META); expect(metadata.ownerId).toBeNull();
  await other.close();
});
test('an unchecked tab cannot erase the live owner queue, and page reload never silently resumes consent', async ({ page, context }) => {
  const events = await setup(page, { response: route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { ok: false, error: 'event_rate_limited' } }) });
  await emit(page); const saved = await rows(page); expect(saved).toHaveLength(1);
  const other = await context.newPage(); await setup(other, { consent: false });
  await expect(other.locator('#cloudConsent')).not.toBeChecked(); expect(await rows(other)).toEqual(saved);
  await other.close(); await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#cloudConsent')).not.toBeChecked(); expect(events).toHaveLength(1); expect(await rows(page)).toEqual(saved);
  await page.locator('#cloudConsent').check(); await expect.poll(async () => (await rows(page)).length).toBe(0); expect(events).toHaveLength(1);
});
test('two opted-in tabs use a single persistent owner and never concurrently send the same queue', async ({ page, context }, testInfo) => {
  const events = await setup(page, { response: route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { ok: false, error: 'event_rate_limited' } }) });
  await emit(page); const saved = await rows(page);
  const other = await context.newPage(), otherEvents = await setup(other); await emit(other, 'yawn');
  expect(otherEvents).toHaveLength(1); expect(otherEvents[0]).not.toHaveProperty('client_event_id'); expect(await rows(other)).toEqual(saved);
  expect(events).toHaveLength(1);
  const handoff = [];
  const observeLease = async phase => {
    const observation = await other.evaluate(async phase => {
      const name = 'occulert.event-outbox.live-tab.v1';
      const snapshot = await navigator.locks.query();
      let available = false;
      await navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, lock => { available = lock !== null; });
      return { phase, at: performance.now(), available,
        held: snapshot.held.filter(lock => lock.name === name).map(({ name, mode }) => ({ name, mode })),
        pending: snapshot.pending.filter(lock => lock.name === name).map(({ name, mode }) => ({ name, mode })) };
    }, phase);
    handoff.push(observation);
    return observation.available;
  };
  try {
    expect(await observeLease('owner-live')).toBe(false);
    expect(handoff.at(-1).held).toHaveLength(1);
    await page.close(); await other.bringToFront();
    // Closing a page can finish before WebKit releases its document's lease.
    // Assert takeover only after a real nonblocking acquisition succeeds.
    await expect.poll(() => observeLease('owner-closed')).toBe(true);
    await emit(other, 'head_nod');
    expect(otherEvents).toHaveLength(2); expect(otherEvents[1]).toHaveProperty('client_event_id'); expect(otherEvents[1].client_event_id).not.toBe(saved[0].event.event_id);
    expect(await rows(other)).toHaveLength(0);
  } finally {
    await testInfo.attach('live-tab-lock-handoff', { body: Buffer.from(JSON.stringify(handoff, null, 2)), contentType: 'application/json' });
    await other.close();
  }
});
