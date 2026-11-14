import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { migrationInventory } from './check-migration-readiness.mjs';
import { statusReport } from './migration-status.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const driverId = '33333333-3333-4333-8333-333333333333';
const fleetId = '44444444-4444-4444-8444-444444444444';
const user = { id: userId, email: 'current@example.com', email_confirmed_at: '2026-11-01' };
const fleet = { id: fleetId, company_name: 'Saved fleet', plan: 'trial', created_at: '2026-11-01T00:00:00Z' };
const plain = value => JSON.parse(JSON.stringify(value));
const success = operation => ({ allowed: true, user_id: userId, operation });
const denial = operation => ({ allowed: false, user_id: userId, operation,
  error: 'account_write_rate_limited', retry_after: 1800 });
const operationFor = route => route === 'profile' ? 'profile' : 'fleet';
const bodyFor = route => route === 'profile' ? { name: 'Driver', vehicle: 'TRK-7' } : { company_name: 'Fleet' };

// Run each real route and its real quota/validation/response/budget helpers.
// Only verified Auth and the provider boundary are substituted in these cases.
function harness(route, options = {}) {
  const file = new URL(`../api/${route}.js`, import.meta.url), require = createRequire(file);
  const calls = [], auth = [];
  const storage = {
    bearerToken: request => request.headers.authorization?.replace(/^Bearer /, ''),
    verifyAccessToken: async (token, config) => {
      auth.push({ token, config: plain(config) });
      return Object.hasOwn(options, 'user') ? options.user : user;
    },
    pgFetch: async (table, query = {}) => {
      calls.push({ table, ...plain(query) });
      if (options.fetcher) return options.fetcher(table, query);
      if (table === 'rpc/reserve_account_write') {
        if (options.failure) throw options.failure;
        return Object.hasOwn(options, 'quota') ? options.quota : success(operationFor(route));
      }
      if (table === 'drivers') return query.method ? [{ id: driverId, ...query.body }]
        : options.existingDriver ? [{ id: driverId, ...options.existingDriver }] : [];
      if (table === 'fleets') return query.method ? [{ ...fleet, ...query.body }]
        : options.existingFleet ? [fleet] : [];
      assert.fail('Unexpected provider query: ' + table);
    },
  };
  const context = { module: { exports: {} }, process: { env: {
    SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture', ...options.env,
  } }, require: name => name === './_lib/supabase' ? storage : require(name) };
  vm.runInNewContext(readFileSync(file, 'utf8'), context, { filename: file.pathname });
  async function invoke(body = bodyFor(route), { method = 'POST', headers: suppliedHeaders = {} } = {}) {
    const headers = {};
    let ends = 0;
    const response = { setHeader(name, value) { headers[name.toLowerCase()] = String(value); },
      end(value) { ends++; this.body = JSON.parse(value); } };
    await context.module.exports({ method, body, query: {}, headers: {
      authorization: 'Bearer fixture-token', 'content-type': 'application/json', ...suppliedHeaders,
    } }, response);
    assert.equal(ends, 1);
    assert.equal(headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(headers['cache-control'], 'no-store');
    return { status: response.statusCode, body: response.body, headers };
  }
  return { invoke, calls, auth };
}
const reservations = h => h.calls.filter(call => call.table === 'rpc/reserve_account_write');
const mutations = h => h.calls.filter(call => ['drivers', 'fleets'].includes(call.table) && call.method);

for (const route of ['profile', 'fleets']) {
  const operation = operationFor(route);
  test(`${route} reserves only verified identity and the fixed server operation before writing`, async () => {
    const h = harness(route);
    const result = await h.invoke({ ...bodyFor(route), user_id: otherId, owner_user_id: otherId,
      driver_id: otherId, fleet_id: otherId, operation: operation === 'profile' ? 'fleet' : 'profile',
      p_user_id: otherId, p_operation: 'attacker', write_limit: 1000000, plan: 'enterprise', role: 'admin' });
    assert.equal(result.status, route === 'profile' ? 200 : 201);
    assert.deepEqual(h.auth, [{ token: 'fixture-token', config: { freshUser: true } }]);
    assert.deepEqual(reservations(h), [{ table: 'rpc/reserve_account_write', method: 'POST',
      body: { p_user_id: userId, p_operation: operation } }]);
    assert.equal(mutations(h).length, 1);
    assert.ok(h.calls.indexOf(reservations(h)[0]) < h.calls.indexOf(mutations(h)[0]));
    if (route === 'profile') {
      assert.equal(mutations(h)[0].body.user_id, userId);
      assert.equal(mutations(h)[0].body.fleet_id, null);
      assert.equal(mutations(h)[0].body.email, user.email);
    } else {
      assert.equal(mutations(h)[0].body.owner_user_id, userId);
      assert.equal(mutations(h)[0].body.plan, 'trial');
    }
    assert.equal(mutations(h)[0].body.role, undefined);
  });

  test(`${route} rejects invalid/auth/config requests before reserving or mutating`, async () => {
    for (const body of [null, false, 0, [], 'text', { oversized: 'x'.repeat(2049) }]) {
      const h = harness(route);
      assert.equal((await h.invoke(body)).status, 415);
      assert.equal(reservations(h).length, 0); assert.equal(mutations(h).length, 0);
    }
    const media = harness(route);
    assert.equal((await media.invoke(bodyFor(route), { headers: { 'content-type': 'application/jsonp' } })).status, 415);
    assert.equal(reservations(media).length, 0);
    for (const [options, request, status] of [
      [{ user: null }, {}, 401], [{ env: { SUPABASE_SERVICE_ROLE_KEY: '' } }, {}, 501],
      [{}, { method: 'PATCH' }, 405],
    ]) {
      const h = harness(route, options);
      assert.equal((await h.invoke(bodyFor(route), request)).status, status);
      assert.equal(h.calls.length, 0);
    }
  });

  test(`${route} returns 429 and the remaining window without a write or private quota details`, async () => {
    for (const retry_after of [1, 17, 3600]) {
      const h = harness(route, { quota: { ...denial(operation), retry_after } });
      const result = await h.invoke();
      assert.equal(result.status, 429); assert.equal(result.headers['retry-after'], String(retry_after));
      assert.deepEqual(result.body, { ok: false, error: 'account_write_rate_limited' });
      assert.equal(reservations(h).length, 1); assert.equal(mutations(h).length, 0);
      assert.equal(h.calls.length, route === 'profile' ? 1 : 2);
    }
  });

  test(`${route} fails closed on missing, contradictory, mismatched or malformed RPC responses`, async () => {
    const valid = success(operation), denied = denial(operation);
    const malformed = [undefined, null, [], [valid], {}, true, 'allowed', { allowed: true },
      { ...valid, allowed: 1 }, { ...valid, allowed: 'true' }, { ...valid, allowed: false },
      { ...valid, user_id: otherId }, { ...valid, user_id: [userId] }, { ...valid, operation: 'attacker' },
      { ...valid, error: null }, { ...valid, error: 'account_write_rate_limited' },
      { ...valid, retry_after: 1 }, { ...valid, unexpected: 'private provider details' },
      { ...denied, allowed: true }, { ...denied, error: 'unknown' }, { ...denied, user_id: otherId },
      ...[undefined, null, '17', false, 0, -1, 3601, 1.5, Infinity, NaN].map(retry_after => ({ ...denied, retry_after })),
    ];
    for (const quota of malformed) {
      const h = harness(route, { quota }), result = await h.invoke();
      assert.equal(result.status, 502, JSON.stringify(quota));
      assert.deepEqual(result.body, { ok: false, error: 'write_quota_unavailable' });
      assert.equal(result.headers['retry-after'], undefined);
      assert.equal(reservations(h).length, 1); assert.equal(mutations(h).length, 0);
    }
  });

  test(`${route} maps a disappeared auth parent to opaque unauthorized without writing`, async () => {
    const h = harness(route, { quota: { allowed: false, user_id: userId, operation, error: 'account_not_found' } });
    const result = await h.invoke();
    assert.equal(result.status, 401); assert.deepEqual(result.body, { ok: false, error: 'unauthorized' });
    assert.equal(mutations(h).length, 0);
  });

  test(`${route} preserves provider failure mapping and never retries a failed reservation`, async () => {
    for (const [failure, expected] of [
      [{ provider: 'supabase', status: 404, details: { code: 'PGRST202' } }, 502],
      [{ provider: 'supabase', status: 503 }, 503], [{ provider: 'supabase', status: 500 }, 503],
      [{ status: 504 }, 504], [{ status: 500 }, 502], [{ details: { code: '23505' } }, 502],
    ]) {
      const h = harness(route, { failure }), result = await h.invoke();
      assert.equal(result.status, expected); assert.deepEqual(result.body, { ok: false, error: 'supabase_error' });
      assert.equal(reservations(h).length, 1); assert.equal(mutations(h).length, 0);
      assert.equal(h.calls.length, route === 'profile' ? 1 : 2);
    }
  });

  test(`${route} never refunds or re-reserves after a downstream write failure`, async () => {
    const h = harness(route, { fetcher: async (table, query) => {
      if (table === 'rpc/reserve_account_write') return success(operation);
      if (!query.method) return [];
      throw { provider: 'supabase', status: 503 };
    } });
    assert.equal((await h.invoke()).status, 503);
    assert.equal(reservations(h).length, 1); assert.equal(mutations(h).length, 1);
    assert.equal(h.calls.some(call => /refund|release/.test(call.table)), false);
  });
}

test('profile refresh retains strict missing-field and explicit-clear behavior under one reservation', async () => {
  const saved = { user_id: userId, name: 'Saved Driver', vehicle_id: 'TRK-7', fleet_id: fleetId, active: false };
  for (const body of [{}, { name: {}, vehicle: ['Coerced'], fleet_id: otherId, active: true }]) {
    const h = harness('profile', { existingDriver: saved });
    assert.equal((await h.invoke(body)).status, 200);
    assert.deepEqual(mutations(h)[0].body, { email: user.email });
    assert.deepEqual(mutations(h)[0].params, { id: `eq.${driverId}`, user_id: `eq.${userId}` });
    assert.equal(reservations(h).length, 1);
  }
  const clear = harness('profile', { existingDriver: saved });
  assert.equal((await clear.invoke({ vehicle: '' })).status, 200);
  assert.deepEqual(mutations(clear)[0].body, { email: user.email, vehicle_id: null });
});

test('profile creation conflict uses its one charged attempt and keeps recovered membership/display fields', async () => {
  let row = { id: driverId, user_id: userId, name: 'Saved Driver', vehicle_id: 'TRK-7', fleet_id: fleetId, active: false };
  const h = harness('profile', { fetcher: async (table, query) => {
    if (table === 'rpc/reserve_account_write') return success('profile');
    assert.equal(table, 'drivers');
    if (!query.method) return [];
    if (query.method === 'POST') throw { details: { code: '23505' } };
    assert.equal(query.method, 'PATCH');
    assert.deepEqual(plain(query.params), { user_id: `eq.${userId}` });
    row = { ...row, ...query.body }; return [row];
  } });
  const result = await h.invoke({ name: {}, vehicle: false, active: true, fleet_id: otherId });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.driver, { ...row, name: 'Saved Driver', vehicle_id: 'TRK-7', fleet_id: fleetId, active: false });
  assert.equal(reservations(h).length, 1);
  assert.deepEqual(mutations(h).map(call => call.method), ['POST', 'PATCH']);
  assert.deepEqual(mutations(h)[1].body, { email: user.email });
});

test('owned fleet GET and POST remain free reads at quota, with original body/email precedence', async () => {
  for (const method of ['GET', 'POST']) {
    const h = harness('fleets', { existingFleet: true, quota: denial('fleet') });
    const result = await h.invoke({ company_name: {} }, { method });
    assert.equal(result.status, 200); assert.deepEqual(result.body.fleet, fleet);
    if (method === 'POST') assert.equal(result.body.created, false);
    assert.equal(reservations(h).length, 0); assert.equal(mutations(h).length, 0);
    assert.equal(h.calls.length, 1);
  }
  const malformed = harness('fleets', { existingFleet: true });
  assert.equal((await malformed.invoke(null)).status, 415); assert.equal(reservations(malformed).length, 0);
  const unverified = harness('fleets', { user: { id: userId, email: user.email }, existingFleet: true });
  assert.equal((await unverified.invoke()).status, 403); assert.equal(unverified.calls.length, 0);
  for (const company_name of [null, false, 1, {}, [], ['Coerced'], '', 'x']) {
    const h = harness('fleets');
    assert.equal((await h.invoke({ company_name })).status, 400);
    assert.equal(reservations(h).length, 0); assert.equal(mutations(h).length, 0);
  }
});

test('fleet creation conflict remains a read-only replay after its one charged attempt', async () => {
  let reads = 0;
  const h = harness('fleets', { fetcher: async (table, query) => {
    if (table === 'rpc/reserve_account_write') return success('fleet');
    assert.equal(table, 'fleets');
    if (!query.method) return ++reads === 1 ? [] : [fleet];
    throw { details: { code: '23505' } };
  } });
  const result = await h.invoke();
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true, created: false, fleet });
  assert.equal(reservations(h).length, 1); assert.equal(mutations(h).length, 1); assert.equal(reads, 2);
});

// Execute the real transport and budget with deterministic time. Late quota
// replies must not resume a route that already sent its timeout response.
for (const route of ['profile', 'fleets']) test(`${route} shares the remaining provider deadline and ignores a late quota commit`, async () => {
  const require = createRequire(import.meta.url), logs = [], calls = [], timers = new Map();
  let now = 0, next = 0, resolveLate;
  const late = new Promise(resolve => { resolveLate = resolve; });
  const budget = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../api/_lib/provider-budget.js', import.meta.url), 'utf8'), {
    module: budget, console: { error: value => logs.push(value) },
    require: name => name === 'node:async_hooks' ? { AsyncLocalStorage }
      : name === 'node:perf_hooks' ? { performance: { now: () => now } }
      : name === 'node:crypto' ? { randomUUID: () => 'quota-request-fixture' } : require(name),
  });
  const transport = { exports: {} }, env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-key' };
  const transportRequire = createRequire(new URL('../api/_lib/supabase.js', import.meta.url));
  vm.runInNewContext(readFileSync(new URL('../api/_lib/supabase.js', import.meta.url), 'utf8'), {
    module: transport, Buffer, URL, AbortController, process: { env },
    require: name => name === './provider-budget' ? budget.exports : transportRequire(name),
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/auth/v1/user')) { now = 7000; return Response.json(user); }
      if (new URL(url).pathname === '/rest/v1/fleets') { now = 8000; return Response.json([]); }
      assert.equal(new URL(url).pathname, '/rest/v1/rpc/reserve_account_write');
      return late;
    },
  });
  const file = new URL(`../api/${route}.js`, import.meta.url), routeRequire = createRequire(file), module = { exports: {} };
  vm.runInNewContext(readFileSync(file, 'utf8'), { module, process: { env },
    require: name => name === './_lib/supabase' ? transport.exports
      : name === './_lib/provider-budget' ? budget.exports : routeRequire(name) });
  const headers = {}; let ends = 0;
  const response = { setHeader(name, value) { headers[name] = value; }, end(value) { ends++; this.body = JSON.parse(value); } };
  const pending = module.exports({ method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: bodyFor(route) }, response);
  for (let n = 0; n < 20 && !calls.some(call => call.url.endsWith('/rpc/reserve_account_write')); n++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(calls.some(call => call.url.endsWith('/rpc/reserve_account_write')));
  assert.deepEqual([...timers.values()].map(timer => timer.ms), [route === 'profile' ? 5000 : 4000]);
  for (const timer of [...timers.values()]) timer.fn();
  await pending;
  assert.equal(response.statusCode, 504); assert.deepEqual(response.body, { ok: false, error: 'supabase_error' });
  assert.equal(calls.at(-1).options.signal.aborted, true); assert.equal(ends, 1);
  const before = calls.length;
  resolveLate(Response.json(success(operationFor(route))));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, before); assert.equal(ends, 1); assert.equal(timers.size, 0);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1, 'only the quota RPC was sent');
  assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /private-key|current@example|Bearer|profile|fleet/);
});

test('migration reporting names both dependent POST routes and keeps the prerequisite explicit', () => {
  const version = '20261114183018', rows = migrationInventory().filter(row => row.version);
  const report = statusReport(rows.filter(row => row.version !== version).map(row => ({ version: row.version })));
  assert.equal(report.pending.length, 1);
  assert.deepEqual(report.pending[0].dependent_api_routes, ['/api/profile', '/api/fleets']);
  assert.match(report.pending[0].purpose, /apply and verify before deploying/);
  for (const path of ['../BACKEND_SETUP.md', '../docs/ACCOUNT_WRITE_QUOTAS.md']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes(version + '_account_write_quota.sql'));
    assert.match(source, /before deploying/);
  }
});
