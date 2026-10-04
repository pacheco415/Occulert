import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const uuid = 'f89d1cf9-893f-4fb6-a924-6669b4568221';
const verifiedUser = { id: uuid, email: 'owner@example.com', email_confirmed_at: '2026-01-01' };
// Retain a valid same-user authentication proof when the recent-auth gate lands.
// The fixture still mocks the network verifier, not any route authorization gate.
function fixtureToken() {
  const claims = { sub: uuid, role: 'authenticated', session_id: uuid,
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] };
  return ['fixture', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fixture'].join('.');
}
const cases = [
  { route: 'sessions', method: 'POST', body: {}, limit: 4096, status: 200 },
  { route: 'sessions', method: 'PATCH', body: { session_id: uuid }, limit: 4096, status: 200 },
  { route: 'events', method: 'POST', body: { session_id: uuid, type: 'drowsy' }, limit: 4096, status: 200 },
  { route: 'profile', method: 'POST', body: {}, limit: 2048, status: 200 },
  { route: 'fleets', method: 'POST', body: { company_name: 'Test fleet' }, limit: 2048, status: 201 },
  { route: 'fleet-invitations', method: 'POST', body: { email: 'driver@example.com' }, limit: 2048, status: 201 },
  { route: 'fleet-invitations', method: 'DELETE', body: { invitation_id: uuid }, limit: 2048, status: 200 },
  { route: 'accept-invitation', method: 'POST', body: { token: 'a'.repeat(43) }, limit: 1024, status: 200 },
  { route: 'account', method: 'DELETE', body: { confirm: 'DELETE' }, limit: 256, status: 200, invalid: [400, 'confirmation_required'] },
  { route: 'fleet-followups', method: 'POST', body: { session_id: uuid, status: 'reviewed', expected_version: 0 }, limit: 1024, status: 200, invalid: [400, 'invalid_body'] },
  { route: 'pilot-leads', method: 'POST', body: { name: 'Test', company: 'Fleet', email: 'driver@example.com', startedAt: new Date(Date.now() - 10000).toISOString() }, limit: 4096, status: 200, invalid: [415, 'unsupported_media_type'] },
];

// Run each actual handler with its real local validation/response dependencies.
// Mock the verified identity and storage boundary, never the route's guards.
function harness(entry, options = {}) {
  const calls = [], mutations = [], auth = [];
  const routeUrl = new URL(`../api/${entry.route}.js`, import.meta.url);
  const routeRequire = createRequire(routeUrl);
  const storage = {
    bearerToken: req => req.headers.authorization.replace(/^Bearer /, ''),
    verifyAccessToken: async token => { auth.push(token); return Object.hasOwn(options, 'user') ? options.user : verifiedUser; },
    deleteAuthUser: async id => { mutations.push({ table: 'auth.users', id }); },
    pgFetch: async (table, opts = {}) => {
      calls.push({ table, ...opts });
      if (options.pgFetch) return options.pgFetch(table, opts, mutations);
      if (opts.method === 'POST' || opts.method === 'PATCH') mutations.push({ table, ...opts });
      if (table === 'rpc/check_pilot_lead_rate_limit') { mutations.pop(); return [{ allowed: true }]; }
      if (table === 'fleets' && !opts.method) return entry.route === 'fleets' ? [] : [{ id: uuid }];
      if (table === 'drivers' && !opts.method) return [{ id: uuid, fleet_id: uuid, name: 'Existing', vehicle_id: 'TRK-7' }];
      if (table === 'sessions' && !opts.method) return [{ id: uuid, started_at: new Date(Date.now() - 60000).toISOString(), ended_at: null }];
      if (table === 'rpc/create_fleet_invitation') return { id: uuid, email: 'driver@example.com', expires_at: '2026-11-01T00:00:00Z' };
      if (table === 'rpc/accept_fleet_invitation') return [{ fleet_id: uuid }];
      if (table === 'rpc/save_fleet_session_followup') return [{ session_id: uuid, status: 'reviewed', version: 1, updated_at: '2026-10-01T00:00:00Z' }];
      return [{ id: uuid, ...opts.body }];
    },
  };
  const context = { module: { exports: {} }, process: { env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } },
    URL, Buffer, AbortController, setTimeout, clearTimeout,
    fetch: () => { throw new Error('unexpected network'); },
    require: name => name === './_lib/supabase' ? storage : routeRequire(name) };
  vm.runInNewContext(readFileSync(routeUrl, 'utf8'), context, { filename: routeUrl.pathname });
  async function invoke(body = entry.body, media = 'application/json') {
    const headers = {};
    const response = { setHeader(name, value) { headers[name.toLowerCase()] = String(value); }, end(value) { this.body = JSON.parse(value); } };
    await context.module.exports({ method: entry.method, body, query: {}, headers: { authorization: 'Bearer ' + fixtureToken(), 'content-type': media,
      origin: 'https://www.occulert.com', host: 'www.occulert.com', 'x-vercel-forwarded-for': '203.0.113.10' } }, response);
    assert.equal(headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(headers['cache-control'], 'no-store');
    return { status: response.statusCode, body: response.body, headers };
  }
  return { invoke, calls, mutations, auth };
}

for (const entry of cases) test(`${entry.route} ${entry.method} rejects pseudo JSON without mutation and accepts case/parameters`, async () => {
  for (const media of ['application/jsonp', 'not-application/json', 'text/plain; application/json', 'application/json-extra']) {
    const h = harness(entry), result = await h.invoke(entry.body, media);
    const [status, error] = entry.invalid || [415, 'invalid_json_body'];
    assert.equal(result.status, status, media); assert.equal(result.body.error, error);
    assert.equal(h.mutations.length, 0);
    if (entry.route === 'account' || entry.route === 'pilot-leads') assert.equal(h.auth.length, 0);
    else assert.equal(h.auth.length, 1);
    const expectedReads = entry.route === 'fleets' || entry.route === 'fleet-followups' ? ['fleets'] : [];
    assert.deepEqual(h.calls.map(call => call.table), expectedReads);
  }
  const h = harness(entry), result = await h.invoke(entry.body, ' Application/JSON ; Charset=UTF-8');
  assert.equal(result.status, entry.status);
  assert.equal(h.mutations.length, 1);
});

for (const entry of cases) test(`${entry.route} ${entry.method} retains its parsed-object character limit and rejection stage`, async () => {
  const exact = { ...entry.body, padding: '' };
  exact.padding = 'é'.repeat(entry.limit - JSON.stringify(exact).length);
  assert.equal(JSON.stringify(exact).length, entry.limit);
  assert.ok(Buffer.byteLength(JSON.stringify(exact)) > entry.limit, 'this fixture distinguishes characters from bytes');
  const h = harness(entry), result = await h.invoke(exact);
  assert.equal(result.status, entry.route === 'fleet-followups' ? 400 : entry.status);
  if (entry.route === 'fleet-followups') { assert.equal(result.body.error, 'invalid_followup'); assert.equal(h.mutations.length, 0); }
  else assert.equal(h.mutations.length, 1);
  const large = harness(entry), rejected = await large.invoke({ ...exact, padding: exact.padding + 'é' });
  const [status, error] = entry.route === 'pilot-leads' ? [413, 'payload_too_large'] : entry.invalid || [415, 'invalid_json_body'];
  assert.equal(rejected.status, status); assert.equal(rejected.body.error, error);
  assert.equal(large.mutations.length, 0);
  for (const body of [[], 'not parsed JSON', null, true]) {
    const invalid = harness(entry), response = await invalid.invoke(body);
    const expected = entry.route === 'pilot-leads' ? [400, Array.isArray(body) ? 'invalid_body' : 'invalid_lead'] : entry.invalid || [415, 'invalid_json_body'];
    assert.equal(response.status, expected[0]); assert.equal(response.body.error, expected[1]); assert.equal(invalid.mutations.length, 0);
  }
});

test('body consolidation retains authentication and owner lookup precedence', async () => {
  for (const entry of cases.filter(entry => !['account', 'pilot-leads'].includes(entry.route))) {
    const h = harness(entry, { user: null });
    assert.equal((await h.invoke([], 'text/plain')).status, 401);
    assert.equal(h.calls.length, 0); assert.equal(h.mutations.length, 0);
  }
  for (const route of ['fleets', 'fleet-invitations', 'accept-invitation', 'fleet-followups']) {
    const entry = cases.find(entry => entry.route === route), h = harness(entry, { user: { id: uuid, email: 'owner@example.com' } });
    assert.equal((await h.invoke([], 'text/plain')).body.error, 'email_not_verified');
    assert.equal(h.calls.length, 0); assert.equal(h.mutations.length, 0);
  }
  const account = harness(cases.find(entry => entry.route === 'account'), { user: null });
  assert.equal((await account.invoke([], 'text/plain')).body.error, 'confirmation_required'); assert.equal(account.auth.length, 0);
  assert.equal((await account.invoke()).body.error, 'unauthorized'); assert.equal(account.mutations.length, 0);
  const followup = harness(cases.find(entry => entry.route === 'fleet-followups'), { pgFetch: async () => [] });
  assert.equal((await followup.invoke([], 'text/plain')).body.error, 'fleet_not_found'); assert.equal(followup.mutations.length, 0);
  const pilotEntry = cases.find(entry => entry.route === 'pilot-leads');
  for (const allowed of [false, 'outage']) {
    const pilot = harness(pilotEntry, { pgFetch: async table => { assert.equal(table, 'rpc/check_pilot_lead_rate_limit'); if (allowed === 'outage') throw new Error('outage'); return [{ allowed, retry_after_seconds: 30 }]; } });
    const response = await pilot.invoke([]);
    assert.equal(response.status, allowed === 'outage' ? 503 : 429); assert.equal(pilot.mutations.length, 0);
  }
});

test('strict optimistic counts and invitation UUID policy remain domain-specific', async () => {
  const entry = cases.find(entry => entry.route === 'fleet-followups');
  for (const expected_version of ['0', 0.5, -1, 2147483647, null, false]) {
    const h = harness(entry), result = await h.invoke({ ...entry.body, expected_version });
    assert.equal(result.body.error, 'invalid_followup'); assert.equal(h.mutations.length, 0);
  }
  const invitation = cases.find(entry => entry.route === 'fleet-invitations' && entry.method === 'DELETE');
  const h = harness(invitation), result = await h.invoke({ invitation_id: '018f9d48-b2d4-7abc-0123-456789abcdef' });
  assert.equal(result.body.error, 'invalid_invitation_id'); assert.equal(h.mutations.length, 0);
});
