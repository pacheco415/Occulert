import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { assetByStem } from './lib/current-assets.mjs';

const require = createRequire(import.meta.url);
const publicConfig = require('../api/public-config.js');
const protocol = 'client_event_uuid_v1';
const sessionId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const original = { client_event_id: eventId, occurred_at: '2026-10-28T20:00:00.000Z', fatigue_score: 42.5, confidence: null };
const source = readFileSync(new URL('../' + assetByStem('occulert-backend.js'), import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function configResponse(overrides = {}) {
  const values = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'public-fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'server-fixture', SESSION_START_RECOVERY_ENABLED: undefined,
    OCCULERT_EVENT_IDEMPOTENCY_ENABLED: undefined, ...overrides };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    const result = { headers: {}, status: null, body: null };
    await publicConfig({ method: 'GET', headers: {} }, {
      set statusCode(value) { result.status = value; },
      setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
      end(value) { result.body = JSON.parse(value); },
    });
    return result;
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test('flag-off public configuration stays byte-equivalent and existing session capabilities compose', async () => {
  const expected = { ok: true, capabilities: {}, supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } };
  for (const flag of [undefined, 'false', '1', 'TRUE', ' true ']) {
    const result = await configResponse({ OCCULERT_EVENT_IDEMPOTENCY_ENABLED: flag });
    assert.equal(JSON.stringify(result.body), JSON.stringify(expected));
    assert.equal(result.status, 200);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  const enabled = await configResponse({ OCCULERT_EVENT_IDEMPOTENCY_ENABLED: 'true', SESSION_START_RECOVERY_ENABLED: 'true' });
  assert.deepEqual(enabled.body.capabilities, { session_start_protocol: 'client_uuid_v1', session_lookup_protocol: 'client_uuid_lookup_v1', event_idempotency_protocol: protocol });
  assert.equal(JSON.stringify(enabled.body).includes('server-fixture'), false);
});

test('event capability requires exact opt-in plus public and server configuration', async () => {
  const enabled = { OCCULERT_EVENT_IDEMPOTENCY_ENABLED: 'true' };
  assert.deepEqual((await configResponse(enabled)).body.capabilities, { event_idempotency_protocol: protocol });
  for (const change of [{ SUPABASE_URL: 'http://fixture.supabase.co' }, { SUPABASE_ANON_KEY: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined }]) {
    assert.deepEqual((await configResponse({ ...enabled, ...change })).body.capabilities, {});
  }
});

function boot({ capability = protocol, configStatus = 200, manualTimers = false, expiresAt } = {}) {
  const clock = { now: Date.parse('2026-10-28T20:00:00.000Z') }, store = new Map(), calls = [], timers = new Map();
  let nextTimer = 0;
  class Clock extends Date { constructor(...args) { args.length ? super(...args) : super(clock.now); } static now() { return clock.now; } }
  const auth = { access_token: 'original-access', refresh_token: 'original-refresh', expires_at: expiresAt ?? clock.now / 1000 + 3600, user: { id: 'owner-a' } };
  store.set('occulert-auth', JSON.stringify(auth));
  const configuration = () => Response.json({ capabilities: capability === undefined ? {} : { event_idempotency_protocol: capability },
    supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } }, { status: configStatus });
  const fixture = { clock, calls, timers, store, config: configuration, event: async () => Response.json({ ok: true, replayed: true }),
    refresh: async () => Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, user: auth.user }) };
  const notifications = [];
  const window = { addEventListener() {}, dispatchEvent: event => { notifications.push(event); } };
  vm.runInNewContext(source, { window, Date: Clock, JSON, Response, Event, AbortController, URLSearchParams, navigator: {},
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    setTimeout: manualTimers ? (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; } : setTimeout,
    clearTimeout: manualTimers ? id => timers.delete(id) : clearTimeout,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (url === '/api/public-config') return fixture.config();
      if (String(url).includes('grant_type=refresh_token')) return fixture.refresh();
      if (url === '/api/events') return fixture.event(options);
      throw Error('Unexpected fixture endpoint');
    },
  });
  fixture.backend = window.OcculertBackend;
  fixture.window = window;
  fixture.notifications = notifications;
  fixture.posts = () => calls.filter(call => call.url === '/api/events');
  fixture.send = (details = original, current = () => true, options) => fixture.backend.logQueuedEvent(sessionId, 'drowsy', details, current, options);
  return fixture;
}

test('capability uses cached configuration without changing the public auth-config shape', async () => {
  const f = boot();
  assert.equal(f.calls.length, 0, 'exporting the prerequisite must not activate it');
  assert.deepEqual(plain(await f.backend.getAuthConfig()), { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' });
  assert.equal(await f.backend.eventOutboxCapability(), true);
  assert.equal(await f.backend.eventOutboxCapability(), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.posts().length, 0);
});

test('legacy event traffic and results remain unchanged with the new protocol absent', async () => {
  const f = boot({ capability: null });
  f.event = async () => Response.json({ error: 'event_rate_limited' }, { status: 429, headers: { 'Retry-After': '10' } });
  const result = await f.backend.logEvent(sessionId, 'drowsy', { fatigue_score: 42 });
  assert.deepEqual(f.calls.map(call => call.url), ['/api/events']);
  assert.deepEqual(JSON.parse(f.posts()[0].options.body), { session_id: sessionId, type: 'drowsy', fatigue_score: 42 });
  assert.deepEqual(plain(result), { status: 429, ok: false, body: { error: 'event_rate_limited' } });
});

for (const capability of [null, true, 'client_event_uuid_v2', 'CLIENT_EVENT_UUID_V1', ' client_event_uuid_v1']) {
  test(`an absent or unsupported protocol blocks keyed POST: ${JSON.stringify(capability)}`, async () => {
    const f = boot({ capability });
    assert.equal(await f.backend.eventOutboxCapability(), false);
    assert.equal((await f.send()).status, 503);
    assert.equal(f.posts().length, 0);
  });
}

test('an unsuccessful config response cannot advertise keyed support', async () => {
  const f = boot({ configStatus: 503 });
  assert.equal(await f.backend.eventOutboxCapability(), false);
  assert.equal((await f.send()).status, 503);
  assert.equal(f.posts().length, 0);
});

test('stale configuration cannot enable capability after an explicit refresh', async () => {
  const f = boot(), old = deferred();
  let first = true;
  f.config = () => { if (first) { first = false; return old.promise; } return Response.json({ capabilities: {}, supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } }); };
  const stale = f.backend.eventOutboxCapability();
  await tick();
  await f.backend.refreshAuthConfig();
  old.resolve(Response.json({ capabilities: { event_idempotency_protocol: protocol }, supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } }));
  assert.equal(await stale, false);
  assert.equal(await f.backend.eventOutboxCapability(), false);
  assert.equal(f.posts().length, 0);
});

test('a configuration refresh while auth waits invalidates the accepted capability before POST', async () => {
  const f = boot({ expiresAt: 1 }), refresh = deferred(), started = deferred();
  f.refresh = () => { started.resolve(); return refresh.promise; };
  const pending = f.send();
  await started.promise;
  f.config = () => Response.json({ capabilities: {}, supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } });
  await f.backend.refreshAuthConfig();
  refresh.resolve(Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, user: { id: 'owner-a' } }));
  assert.equal((await pending).status, 503);
  assert.equal(f.posts().length, 0);
});

for (const status of [200, 400, 401, 503]) {
  test(`one core send preserves its keyed body and makes one POST for status ${status}`, async () => {
    const f = boot(), details = { ...original }, pendingConfig = deferred();
    f.config = () => pendingConfig.promise;
    f.event = async () => Response.json({ error: status === 400 ? 'invalid_occurred_at' : 'fixture', replayed: status === 200 }, { status });
    const pending = f.send(details);
    await tick();
    details.client_event_id = '33333333-3333-4333-8333-333333333333'; details.fatigue_score = 1;
    pendingConfig.resolve(Response.json({ capabilities: { event_idempotency_protocol: protocol }, supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } }));
    const result = await pending;
    assert.equal(result.status, status);
    assert.equal(f.posts().length, 1);
    assert.deepEqual(JSON.parse(f.posts()[0].options.body), { session_id: sessionId, type: 'drowsy', ...original });
    assert.equal(f.calls.some(call => call.url.includes('grant_type=refresh_token')), false);
  });
}

for (const [header, expected] of [['60', 60_000], ['0', 0], ['99999999999999999999', 900_000], ['-1', null], ['1.5', null], ['not a date', null], ['9'.repeat(129), null]]) {
  test(`Retry-After metadata is bounded and never resends for ${header.slice(0, 20)}`, async () => {
    const f = boot();
    f.event = async () => Response.json({ error: 'event_rate_limited' }, { status: 429, headers: { 'Retry-After': header } });
    const result = await f.send();
    assert.equal(result.status, 429);
    assert.equal(result.retryAfterMs ?? null, expected);
    assert.deepEqual(plain(result.body), { error: 'event_rate_limited' });
    assert.equal(f.posts().length, 1);
    assert.equal(Object.hasOwn(result, 'headers'), false);
  });
}

test('HTTP-date retry metadata uses the response clock; other statuses expose no retry header', async () => {
  const f = boot();
  f.event = async () => Response.json({}, { status: 429, headers: { 'Retry-After': new Date(f.clock.now + 20_000).toUTCString() } });
  assert.equal((await f.send()).retryAfterMs, 20_000);
  f.event = async () => Response.json({}, { status: 503, headers: { 'Retry-After': '60' } });
  assert.equal(Object.hasOwn(await f.send(), 'retryAfterMs'), false);
  f.event = async () => ({ status: 429, ok: false, text: async () => '{}', headers: { get() { throw Error('Malformed headers'); } } });
  assert.deepEqual(plain(await f.send()), { status: 429, ok: false, body: {} });
});

for (const stage of ['configuration', 'auth refresh', 'response']) for (const change of ['owner', 'sharing']) {
  test(`late ${change} invalidation during ${stage} cannot authorize or acknowledge a send`, async () => {
    const f = boot({ expiresAt: stage === 'auth refresh' ? 1 : undefined }), pending = deferred(), started = deferred();
    let current = true;
    if (stage === 'configuration') f.config = () => { started.resolve(); return pending.promise; };
    if (stage === 'auth refresh') f.refresh = () => { started.resolve(); return pending.promise; };
    if (stage === 'response') f.event = () => { started.resolve(); return pending.promise; };
    const send = f.send(original, () => current);
    await started.promise;
    if (change === 'sharing') current = false;
    else f.backend.adoptSession({ access_token: 'new-access', refresh_token: 'new-refresh', expires_at: f.clock.now / 1000 + 3600, user: { id: 'owner-b' } });
    pending.resolve(stage === 'configuration'
      ? Response.json({ capabilities: { event_idempotency_protocol: protocol }, supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } })
      : stage === 'auth refresh' ? Response.json({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, user: { id: 'owner-a' } }) : Response.json({ ok: true, replayed: true }));
    assert.equal((await send).status, 409);
    assert.equal(f.posts().length, stage === 'response' ? 1 : 0);
  });
}

test('a routine token refresh precedes one keyed POST without a hidden 401 replay or lifecycle notification', async () => {
  const f = boot({ expiresAt: 1 });
  f.event = async () => Response.json({ error: 'unauthorized' }, { status: 401 });
  assert.equal((await f.send()).status, 401);
  assert.equal(f.posts().length, 1);
  assert.equal(f.calls.filter(call => call.url.includes('grant_type=refresh_token')).length, 1);
  assert.equal(f.posts()[0].options.headers.Authorization, 'Bearer rotated-access');
  assert.equal(f.notifications.length, 0);
});

test('auth attempts, login adoption and sign-out emit no-detail lifecycle signals after safe local state changes', () => {
  const f = boot(), seen = [];
  f.window.dispatchEvent = event => {
    seen.push({ type: event.type, detail: 'detail' in event, user: f.backend.currentUser()?.id ?? null });
    throw Error('Consumer failure must not stop auth');
  };
  assert.doesNotThrow(() => f.backend.beginAuthAttempt());
  assert.doesNotThrow(() => f.backend.adoptSession({ access_token: 'new-access', refresh_token: 'new-refresh', expires_at: f.clock.now / 1000 + 3600, user: { id: 'owner-b' } }));
  assert.equal(f.backend.currentUser().id, 'owner-b');
  assert.equal(f.backend.signOut(), undefined);
  assert.equal(f.backend.currentUser(), null);
  assert.deepEqual(seen, [
    { type: 'occulert:auth-lifecycle', detail: false, user: 'owner-a' },
    { type: 'occulert:auth-lifecycle', detail: false, user: 'owner-b' },
    { type: 'occulert:auth-lifecycle', detail: false, user: null },
  ]);
});

test('a rejected shared refresh clears Auth and emits one lifecycle signal', async () => {
  const f = boot({ expiresAt: 1 });
  f.refresh = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
  assert.deepEqual(await Promise.all([f.backend.getSession(), f.backend.getSession()]), [null, null]);
  assert.equal(f.backend.currentUser(), null);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].type, 'occulert:auth-lifecycle');
  assert.equal('detail' in f.notifications[0], false);
});

test('an abort during configuration prevents a late POST and abort after dispatch stays uncertain', async () => {
  const f = boot(), pending = deferred(), controller = new AbortController();
  f.config = () => pending.promise;
  const send = f.send(original, () => true, { signal: controller.signal });
  await tick(); controller.abort();
  pending.resolve(Response.json({ capabilities: { event_idempotency_protocol: protocol }, supabase: { configured: true, url: 'https://fixture.supabase.co', anonKey: 'public-fixture' } }));
  assert.equal((await send).status, 503);
  assert.equal(f.posts().length, 0);
  const after = boot(), late = deferred(), started = deferred(), abort = new AbortController();
  after.event = () => { started.resolve(); return late.promise; };
  const uncertain = after.send(original, () => true, { signal: abort.signal });
  await started.promise; abort.abort();
  assert.equal((await uncertain).status, 503);
  assert.equal(after.posts()[0].options.signal.aborted, true);
  late.resolve(Response.json({ ok: true, replayed: true })); await tick();
  assert.equal(after.posts().length, 1);
});

test('missing identity, arbitrary payloads or an asynchronous scope predicate never dispatch', async () => {
  const f = boot();
  for (const details of [{}, { ...original, client_event_id: undefined }, Object.create(original), { ...original, latitude: 1 }, { ...original, fatigue_score: {} }, { ...original, occurred_at: 'invalid' }]) {
    assert.equal((await f.send(details)).status, 400);
  }
  assert.equal((await f.backend.logQueuedEvent(sessionId, 'drowsy', original)).status, 409);
  assert.equal((await f.send(original, async () => true)).status, 409);
  assert.equal(f.calls.length, 0);
});

test('the event response deadline covers body completion without a second POST', async () => {
  const f = boot({ manualTimers: true }), body = deferred(), started = deferred();
  f.event = async () => ({ status: 200, ok: true, text: () => { started.resolve(); return body.promise; } });
  const pending = f.send();
  await started.promise;
  assert.equal(f.timers.size, 1);
  const [id, deadline] = [...f.timers][0];
  assert.equal(deadline.delay, 8_000); f.timers.delete(id); deadline.callback();
  assert.equal((await pending).status, 503);
  assert.equal(f.posts()[0].options.signal.aborted, true);
  body.resolve(JSON.stringify({ ok: true, replayed: true })); await tick();
  assert.equal(f.posts().length, 1);
});
