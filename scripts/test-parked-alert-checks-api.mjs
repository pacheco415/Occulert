import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const route = new URL('../api/_lib/routes/parked-alert-checks.js', import.meta.url);
const localRequire = createRequire(route);
const source = readFileSync(route, 'utf8');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const FLEET = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-11-10T08:05:00.000Z');
const CHECK = { completed_at: '2026-11-10T08:00:00.000Z', platform: 'web', confirmed: true };

function harness(options = {}) {
  const calls = [], auth = [];
  class Clock extends Date { static now() { return NOW; } }
  const storage = {
    bearerToken: request => request.headers.authorization?.replace(/^Bearer /, ''),
    verifyAccessToken: async (token, config) => {
      auth.push({ token, config });
      return Object.hasOwn(options, 'user') ? options.user : { id: ACTOR };
    },
    pgFetch: async (path, config) => {
      calls.push({ path, config });
      if (options.failure) throw options.failure;
      if (Object.hasOwn(options, 'result')) return options.result;
      return path === 'rpc/fleet_parked_alert_check_counts'
        ? { fleet_id: FLEET, active_driver_count: 3, confirmed_driver_count: 1 }
        : { check: { completed_at: config.body.p_completed_at,
          platform: config.body.p_platform, confirmed: config.body.p_confirmed } };
    },
  };
  const context = {
    module: { exports: {} }, Date: Clock, URL,
    process: { env: options.configured === false ? {} : {
      SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only',
    } },
    require: name => name === '../supabase' ? storage : localRequire(name),
  };
  vm.runInNewContext(source, context, { filename: route.pathname });
  async function invoke(overrides = {}) {
    const request = { url: '/api/parked-alert-checks', method: 'GET', query: {},
      headers: { authorization: 'Bearer driver-proof', 'content-type': 'application/json' }, ...overrides };
    const headers = {};
    const response = { setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
      end(value) { this.body = JSON.parse(value); } };
    await context.module.exports(request, response);
    return { status: response.statusCode, headers, body: response.body };
  }
  return { invoke, calls, auth };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('parked-check API scopes both operations to the verified token and returns minimal results', async () => {
  const app = harness();
  const counts = await app.invoke();
  assert.equal(counts.status, 200);
  assert.deepEqual(counts.body, { ok: true, fleet_id: FLEET, active_driver_count: 3, confirmed_driver_count: 1,
    telemetry_trust: 'unverified_client_report' });
  assert.deepEqual(plain(app.calls[0]), { path: 'rpc/fleet_parked_alert_check_counts',
    config: { method: 'POST', body: { p_actor_id: ACTOR } } });
  for (const confirmed of [true, false]) {
    const result = await app.invoke({ method: 'POST', body: { ...CHECK, confirmed } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, check: { ...CHECK, confirmed },
      telemetry_trust: 'unverified_client_report' });
    assert.deepEqual(plain(app.calls.at(-1)), { path: 'rpc/record_parked_alert_check', config: {
      method: 'POST', body: { p_actor_id: ACTOR, p_completed_at: CHECK.completed_at,
        p_platform: 'web', p_confirmed: confirmed },
    } });
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers.vary, 'Authorization');
  }
  assert.equal(app.auth[0].config.cachedIdentity, true);
  assert.equal(app.auth[1].config.cachedIdentity, false, 'mutations require the fresh identity path');
  assert.equal(app.auth[1].token, 'driver-proof');
});

test('client authority claims and additional telemetry never reach the database', async () => {
  const app = harness();
  for (const key of ['actor_id', 'owner_user_id', 'driver_id', 'fleet_id', 'user_id',
    'device_id', 'location', 'latitude', 'audio', 'image', 'received_at']) {
    const response = await app.invoke({ method: 'POST', body: { ...CHECK, [key]: FOREIGN } });
    assert.equal(response.status, 400, key);
    assert.equal(response.body.error, 'invalid_parked_alert_check');
  }
  assert.equal(app.calls.length, 0);
  for (const method of ['GET', 'POST']) {
    for (const overrides of [
      { url: '/api/parked-alert-checks?fleet_id=' + FOREIGN },
      { query: { fleet_id: FOREIGN } },
      { url: '/api/parked-alert-checks?endpoint=parked-alert-checks' },
      { query: { endpoint: 'parked-alert-checks' } },
      { query: null }, { query: [] },
    ]) assert.equal((await app.invoke({ method, body: CHECK, ...overrides })).status, 400);
  }
  assert.equal(app.calls.length, 0);
});

test('strict boolean, bounded JSON, timestamp and platform validation preserve false', async () => {
  const app = harness();
  for (const body of [
    {}, { ...CHECK, confirmed: 'true' }, { ...CHECK, confirmed: 0 }, { ...CHECK, confirmed: null },
    { ...CHECK, platform: 'browser version and device ID' }, { ...CHECK, platform: ['web'] },
    { ...CHECK, completed_at: '2026-02-30T08:00:00Z' }, { ...CHECK, completed_at: 'Infinity' },
    { ...CHECK, completed_at: new Date(NOW + 300001).toISOString() },
    { ...CHECK, completed_at: new Date(NOW - 86400001).toISOString() },
  ]) assert.equal((await app.invoke({ method: 'POST', body })).status, 400);
  for (const body of [null, [], true, 'not JSON', { ...CHECK, extra: 'x'.repeat(513) }]) {
    assert.equal((await app.invoke({ method: 'POST', body })).status, 415);
  }
  for (const media of ['text/plain', 'application/jsonp', 'not-application/json']) {
    assert.equal((await app.invoke({ method: 'POST', body: CHECK,
      headers: { authorization: 'Bearer fixture', 'content-type': media } })).status, 415);
  }
  assert.equal(app.calls.length, 0);
  for (const platform of ['web', 'ios', 'android']) {
    assert.equal((await app.invoke({ method: 'POST', body: { ...CHECK, platform, confirmed: false },
      headers: { authorization: 'Bearer fixture', 'content-type': ' Application/JSON ; charset=UTF-8' } })).status, 200);
  }
});

test('unsigned, unconfigured, unowned and inactive requests fail without granting authority', async () => {
  for (const method of ['GET', 'POST']) {
    const unsigned = harness({ user: null });
    assert.equal((await unsigned.invoke({ method, body: CHECK })).status, 401);
    assert.equal(unsigned.calls.length, 0);
    const unconfigured = harness({ configured: false });
    assert.equal((await unconfigured.invoke({ method, body: CHECK })).status, 501);
    assert.equal(unconfigured.calls.length, 0);
  }
  const nonowner = harness({ result: null });
  assert.equal((await nonowner.invoke()).body.error, 'fleet_not_found');
  assert.equal((await nonowner.invoke()).status, 403);
  const inactive = harness({ result: { error: 'driver_not_in_active_fleet' } });
  assert.equal((await inactive.invoke({ method: 'POST', body: CHECK })).status, 403);
  const invalidIdentity = harness({ user: { id: 'not-uuid' } });
  assert.equal((await invalidIdentity.invoke()).status, 502);
  assert.equal(invalidIdentity.calls.length, 0);
  const methods = harness();
  const rejected = await methods.invoke({ method: 'PATCH', body: CHECK });
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.allow, 'GET, POST');
  assert.equal(methods.calls.length, 0);
});

test('stale writes, membership churn, missing schema and malformed provider responses fail closed', async () => {
  for (const error of ['stale_parked_alert_check', 'membership_changed']) {
    const app = harness({ result: { error } });
    const response = await app.invoke({ method: 'POST', body: CHECK });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, error);
    assert.equal(app.calls.length, 1, 'writes are never retried');
  }
  for (const result of [
    { fleet_id: FLEET, active_driver_count: -1, confirmed_driver_count: 0 },
    { fleet_id: FLEET, active_driver_count: 2, confirmed_driver_count: 3 },
    { fleet_id: FLEET, active_driver_count: 2, confirmed_driver_count: '1' },
    { active_driver_count: 2, confirmed_driver_count: 1 },
    { fleet_id: 'invalid', active_driver_count: 2, confirmed_driver_count: 1 }, [], {},
  ]) assert.equal((await harness({ result }).invoke()).status, 502);
  for (const result of [
    { check: { ...CHECK, confirmed: false } }, { check: { ...CHECK, driver_id: FOREIGN } },
    { check: { ...CHECK, completed_at: '2026-11-10T07:59:00.000Z' } }, {},
  ]) assert.equal((await harness({ result }).invoke({ method: 'POST', body: CHECK })).status, 502);
  for (const code of ['42883', 'PGRST202', 'PGRST205']) {
    const app = harness({ failure: { details: { code, message: 'private provider detail' } } });
    const response = await app.invoke();
    assert.equal(response.status, 503);
    assert.equal(response.body.error, 'parked_alert_checks_not_enabled');
    assert.doesNotMatch(JSON.stringify(response.body), /private provider detail/);
  }
  for (const [failure, status] of [[{ status: 504 }, 504], [{ provider: 'supabase', status: 503 }, 503]]) {
    assert.equal((await harness({ failure }).invoke()).status, status);
  }
});

test('aggregate response keeps server-derived fleet correlation but strips participant fields', async () => {
  const app = harness({ result: { fleet_id: FLEET, active_driver_count: 2, confirmed_driver_count: 0,
    driver_id: FOREIGN, checks: [CHECK] } });
  assert.deepEqual((await app.invoke()).body, { ok: true, fleet_id: FLEET, active_driver_count: 2,
    confirmed_driver_count: 0, telemetry_trust: 'unverified_client_report' });
});
