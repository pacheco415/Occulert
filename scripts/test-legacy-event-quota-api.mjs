import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const userId = '11111111-1111-4111-8111-111111111111';
const driverId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';
const otherId = '55555555-5555-4555-8555-555555555555';
const key = '66666666-6666-4666-8666-666666666666';
const plain = value => JSON.parse(JSON.stringify(value));
const session = { id: sessionId, driver_id: driverId, fleet_id: null,
  started_at: new Date(Date.now() - 3600000).toISOString(), ended_at: null };
const event = { id: eventId, session_id: sessionId, type: 'drowsy' };

function harness(route, { fetcher, user = { id: userId }, env = {} } = {}) {
  const file = new URL(`../api/${route}.js`, import.meta.url);
  const require = createRequire(file);
  const calls = [];
  const context = { module: { exports: {} }, process: { env: {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture', ...env,
  } }, require: name => name === './_lib/supabase' ? {
    bearerToken: () => 'fixture', verifyAccessToken: async () => user,
    pgFetch: async (table, options = {}) => {
      calls.push({ table, options: plain(options) });
      if (fetcher) return fetcher(table, options);
      if (table === 'drivers') return [{ id: driverId, fleet_id: null }];
      if (table === 'sessions' && !options.method) return route === 'events' ? [session] : [];
      if (table === 'rpc/record_idempotent_event') return { event, client_event_id: null, replayed: false };
      if (table === 'rpc/start_rate_limited_session') return { session, replayed: false };
      assert.fail(`Unexpected provider operation: ${table}`);
    },
  } : require(name) };
  vm.runInNewContext(readFileSync(file, 'utf8'), context, { filename: file.pathname });
  return { calls, post: async body => {
    const headers = {};
    const response = { setHeader: (name, value) => { headers[name.toLowerCase()] = String(value); },
      end: value => { response.body = JSON.parse(value); } };
    await context.module.exports({ method: 'POST', body,
      headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' } }, response);
    return { status: response.statusCode, body: response.body, headers };
  } };
}

const defaultEventBody = { session_id: sessionId, type: 'drowsy' };
const rpcCalls = state => state.calls.filter(call => call.table.startsWith('rpc/'));

test('default legacy event path shares the atomic quota without enabling keyed delivery', async () => {
  const state = harness('events');
  const result = await state.post({ ...defaultEventBody, user_id: otherId, driver_id: otherId,
    fleet_id: otherId, fatigue_score: 150, confidence: -1, latitude: 100, longitude: '0' });
  assert.equal(result.status, 200);
  assert.deepEqual(rpcCalls(state), [{ table: 'rpc/record_idempotent_event', options: {
    method: 'POST', body: { p_user_id: userId, p_session_id: sessionId, p_client_event_id: null,
      p_type: 'drowsy', p_fatigue_score: 100, p_confidence: 0,
      p_latitude: null, p_longitude: 0, p_occurred_at: null },
  } }]);
  assert.equal(state.calls[0].options.params.user_id, `eq.${userId}`);
  assert.equal(state.calls[1].options.params.driver_id, `eq.${driverId}`);
  assert.deepEqual(Object.keys(result.body).sort(), ['event', 'message', 'ok', 'telemetry_trust']);
  assert.equal(result.body.telemetry_trust, 'unverified_client_report');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(state.calls.some(call => call.table === 'events'), false);
});

test('legacy occurrence precision remains intact and omitted time is a server intent', async () => {
  const state = harness('events');
  const occurred_at = new Date(Date.now() - 60000).toISOString().replace('Z', '+00:00');
  assert.equal((await state.post({ ...defaultEventBody, occurred_at })).status, 200);
  assert.equal(rpcCalls(state)[0].options.body.p_occurred_at, occurred_at);
  assert.equal((await state.post(defaultEventBody)).status, 200);
  assert.equal(rpcCalls(state)[1].options.body.p_occurred_at, null);
  const before = rpcCalls(state).length;
  for (const occurred_at of [null, '', '2099-01-01T00:00:00Z', '2000-01-01T00:00:00Z']) {
    assert.equal((await state.post({ ...defaultEventBody, occurred_at })).status, 400);
  }
  assert.equal(rpcCalls(state).length, before);
});

test('a keyed event still fails closed when its existing flag is off', async () => {
  const state = harness('events');
  assert.deepEqual((await state.post({ ...defaultEventBody, client_event_id: key })).body,
    { ok: false, error: 'event_idempotency_not_enabled' });
  assert.equal(state.calls.length, 0);
});

test('both legacy quota rejections expose bounded Retry-After without provider details', async () => {
  for (const [error, retry_after, expected] of [
    ['event_rate_limited', 17, '17'], ['event_rate_limited', 999, '60'],
    ['event_rate_limited', -5, '1'], ['event_rate_limited', 2.2, '3'],
    ['event_rate_limited', 'untrusted', '60'], ['event_rate_limited', Infinity, '60'],
    ['session_event_limit', 999, '60'],
  ]) {
    const state = harness('events', { fetcher: (table) => {
      if (table === 'drivers') return [{ id: driverId }];
      if (table === 'sessions') return [session];
      assert.equal(table, 'rpc/record_idempotent_event');
      return { error, retry_after, provider_detail: 'private' };
    } });
    const result = await state.post(defaultEventBody);
    assert.equal(result.status, 429);
    assert.equal(result.headers['retry-after'], expected);
    assert.deepEqual(result.body, { ok: false, error });
    assert.equal(rpcCalls(state).length, 1);
  }
});

test('legacy ownership prechecks and atomic ownership errors remain opaque', async () => {
  for (const [profile, owned, atomicError, status, error] of [
    [false, false, null, 403, 'driver_profile_not_found'],
    [true, false, null, 404, 'session_not_found'],
    [true, true, 'session_not_found', 404, 'session_not_found'],
    [true, true, 'session_ended', 409, 'session_ended'],
  ]) {
    const state = harness('events', { fetcher: table => table === 'drivers' ? profile ? [{ id: driverId }] : []
      : table === 'sessions' ? owned ? [session] : [] : { error: atomicError } });
    const result = await state.post(defaultEventBody);
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { ok: false, error });
    assert.equal(rpcCalls(state).length, atomicError ? 1 : 0);
  }
});

test('malformed legacy RPC replies fail without an unbounded insert fallback', async () => {
  for (const result of [null, [], {}, { event },
    { event: { ...event, id: 'bad' }, client_event_id: null, replayed: false },
    { event: { ...event, session_id: otherId }, client_event_id: null, replayed: false },
    { event: { ...event, session_id: 42 }, client_event_id: null, replayed: false },
    { event, client_event_id: key, replayed: false }, { event, client_event_id: null, replayed: true },
    { event, client_event_id: null, replayed: false, error: 'unknown_provider_error' },
  ]) {
    const state = harness('events', { fetcher: table => table === 'drivers' ? [{ id: driverId }]
      : table === 'sessions' ? [session] : result });
    const response = await state.post(defaultEventBody);
    assert.equal(response.status, 502);
    assert.deepEqual(response.body, { ok: false, error: 'event_not_saved' });
    assert.equal(rpcCalls(state).length, 1);
    assert.equal(state.calls.some(call => call.table === 'events'), false);
  }
});

test('session starts send only verified identity and bounded metadata to the atomic RPC', async () => {
  const state = harness('sessions');
  const result = await state.post({ driver_id: otherId, fleet_id: otherId, user_id: otherId,
    started_at: '2000-01-01T00:00:00Z', device: 'd'.repeat(130), browser: 'b'.repeat(250),
    detector_pipeline: 'ios_mlkit_eye_probability', detector_version: '  detector-1  ', app_version: '<script>' });
  assert.equal(result.status, 200);
  assert.deepEqual(rpcCalls(state), [{ table: 'rpc/start_rate_limited_session', options: {
    method: 'POST', body: { p_user_id: userId, p_session_id: null, p_device: 'd'.repeat(120),
      p_browser: 'b'.repeat(240), p_detector_pipeline: 'ios_mlkit_eye_probability',
      p_detector_version: 'detector-1', p_app_version: null },
  } }]);
  assert.equal(state.calls.some(call => call.table === 'sessions' && call.options.method), false);
  assert.deepEqual(Object.keys(result.body).sort(), ['ok', 'session', 'session_start_protocol']);
  assert.equal(result.body.session_start_protocol, 'client_uuid_v1');
});

test('session-start quota errors map to 429 and bounded integral Retry-After', async () => {
  for (const [retry_after, expected] of [[30, '30'], [9999, '3600'], [-5, '1'], [2.2, '3'],
    [undefined, '3600'], ['bad', '3600'], [Infinity, '3600']]) {
    const state = harness('sessions', { fetcher: table => table === 'drivers' ? [{ id: driverId }]
      : { error: 'session_start_rate_limited', retry_after, session: { secret: 'not returned' } } });
    const result = await state.post({});
    assert.equal(result.status, 429);
    assert.equal(result.headers['retry-after'], expected);
    assert.deepEqual(result.body, { ok: false, error: 'session_start_rate_limited' });
    assert.equal(rpcCalls(state).length, 1);
  }
});

test('owned session replays stay free and retain completed historical records', async () => {
  const stored = { ...session, fleet_id: otherId, ended_at: new Date().toISOString(),
    safety_score: 77, alert_count: 2, device: 'Original' };
  const early = harness('sessions', { fetcher: table => {
    if (table === 'drivers') return [{ id: driverId, fleet_id: null }];
    assert.equal(table, 'sessions');
    return [stored];
  } });
  const result = await early.post({ session_id: sessionId, device: 'Changed', fleet_id: null });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.session, stored);
  assert.equal(rpcCalls(early).length, 0);
  const raced = harness('sessions', { fetcher: table => table === 'drivers' ? [{ id: driverId }]
    : table === 'sessions' ? [] : { session: stored, replayed: true } });
  assert.deepEqual((await raced.post({ session_id: sessionId })).body.session, stored);
  assert.equal(rpcCalls(raced).length, 1);
});

test('atomic start errors are whitelisted without disclosure or mutation retries', async () => {
  for (const [error, expected] of [['invalid_session', 400], ['driver_profile_not_found', 403],
    ['session_id_conflict', 409], ['membership_changed', 409]]) {
    const state = harness('sessions', { fetcher: table => table === 'drivers' ? [{ id: driverId }]
      : table === 'sessions' ? [] : { error, provider_detail: 'private' } });
    const result = await state.post({ session_id: sessionId });
    assert.equal(result.status, expected);
    assert.deepEqual(result.body, { ok: false, error });
    assert.equal(rpcCalls(state).length, 1);
  }
});

test('malformed start results cannot substitute another owner or requested UUID', async () => {
  for (const result of [null, [], {}, { session }, { session, replayed: 'false' },
    { session: { ...session, id: 'bad' }, replayed: false },
    { session: { ...session, id: otherId }, replayed: false },
    { session: { ...session, driver_id: otherId }, replayed: false },
    { session, replayed: false, error: 'unknown_provider_error' },
  ]) {
    const state = harness('sessions', { fetcher: table => table === 'drivers' ? [{ id: driverId }]
      : table === 'sessions' ? [] : result });
    const response = await state.post({ session_id: sessionId });
    assert.equal(response.status, 502);
    assert.deepEqual(response.body, { ok: false, error: 'session_not_saved' });
    assert.equal(rpcCalls(state).length, 1);
  }
  const unkeyedReplay = harness('sessions', { fetcher: table => table === 'drivers' ? [{ id: driverId }]
    : { session, replayed: true } });
  assert.deepEqual((await unkeyedReplay.post({})).body, { ok: false, error: 'session_not_saved' });
});

test('provider failures and missing prerequisites never fall back or retry writes', async () => {
  for (const route of ['events', 'sessions']) for (const [error, expected] of [
    [{ provider: 'supabase', status: 503 }, 503], [{ status: 504 }, 504],
    [{ status: 404, details: { code: 'PGRST202' } }, 502],
  ]) {
    const state = harness(route, { fetcher: table => {
      if (table === 'drivers') return [{ id: driverId }];
      if (table === 'sessions') return route === 'events' ? [session] : [];
      assert.ok(table.startsWith('rpc/'));
      throw error;
    } });
    const result = await state.post(route === 'events' ? defaultEventBody : { session_id: sessionId });
    assert.equal(result.status, expected);
    assert.deepEqual(result.body, { ok: false, error: 'supabase_error' });
    assert.equal(rpcCalls(state).length, 1);
    assert.equal(state.calls.some(call => ['events', 'sessions'].includes(call.table) && call.options.method), false);
  }
});
