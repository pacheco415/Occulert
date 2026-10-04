import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const apiRoot = fileURLToPath(new URL('../api/', import.meta.url));
const OWNER = '11111111-1111-4111-8111-111111111111';
const FLEET = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const SESSION = '01890f80-7237-7c38-893d-026c203e47b8';
const user = { id: OWNER, email: 'owner@example.com', email_confirmed_at: '2026-01-01' };
const fleet = { id: FLEET, owner_user_id: OWNER, company_name: 'Fixture fleet', plan: 'trial' };
const env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role',
  SUPABASE_ANON_KEY: 'fixture-public-key', STRIPE_TEST_SECRET_KEY: 'sk_test_fixture',
  STRIPE_TEST_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_TEST_PRICE_STARTER: 'price_starter',
  STRIPE_TEST_PRICE_GROWTH: 'price_growth', STRIPE_TEST_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
};
// The account fixture remains compatible with the separately reviewed recent-auth gate.
function bearer() {
  const claims = { sub: OWNER, role: 'authenticated', session_id: DRIVER,
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] };
  return ['fixture', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fixture'].join('.');
}
function report() {
  return { version: 1, days: 30, window_start: '2026-09-01T00:00:00Z', window_end: '2026-10-01T00:00:00Z',
    complete_period: true, interruption_reasons_available: false, unrecorded_sessions_detectable: false,
    roster_total: 0, active_drivers: 0, reporting_active_drivers: 0, sessions: 0, completed: 0,
    no_recorded_end: 0, invalid_recorded_end: 0, scored: 0, unscored: 0, average_safety_score: null,
    valid_alert_records: 0, missing_alert_records: 0, alerts: 0, reviewed: 0, without_reviewed_followup: 0,
    detector_pipelines: { web_mediapipe_ear: 0, ios_mlkit_eye_probability: 0,
      android_mlkit_eye_probability: 0, unknown: 0 } };
}
function fixture(options = {}) {
  const calls = [], authCalls = [], deleted = [], network = [], modules = new Map();
  const fixtureEnv = { ...env, ...options.env };
  const defaultPg = async table => {
    if (table === 'fleets') return [fleet];
    if (table === 'drivers') return [{ id: DRIVER, fleet_id: FLEET, name: 'Fixture driver', active: true }];
    if (table === 'rpc/check_pilot_lead_rate_limit') return { allowed: true, retry_after_seconds: 0 };
    if (table === 'rpc/fleet_period_report') return report();
    if (['sessions', 'events', 'fleet_invitations', 'fleet_session_followups', 'fleet_billing_test'].includes(table)) return [];
    throw new Error('Unexpected fixture query: ' + table);
  };
  const supabase = {
    bearerToken: request => String(request.headers.authorization || '').replace(/^Bearer /, ''),
    verifyAccessToken: async token => {
      authCalls.push(token);
      if (options.authFailure) throw options.authFailure;
      return Object.hasOwn(options, 'user') ? options.user : user;
    },
    pgFetch: async (table, query = {}) => {
      calls.push({ table, query });
      return options.pgFetch ? options.pgFetch(table, query, defaultPg) : defaultPg(table);
    },
    deleteAuthUser: async id => { deleted.push(id); },
    serverStorageConfigured: () => Boolean(fixtureEnv.SUPABASE_URL && fixtureEnv.SUPABASE_SERVICE_ROLE_KEY),
  };
  // Only the Supabase module is substituted. Local CommonJS dependencies use
  // actual route-relative files, including Stripe parsing/signatures and cursor validation.
  function load(filename) {
    const absolute = require.resolve(filename);
    if (absolute === resolve(apiRoot, '_lib/supabase.js')) return supabase;
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} }; modules.set(absolute, module);
    const context = {
      module, exports: module.exports, process: { env: fixtureEnv }, Buffer, URL, URLSearchParams,
      Date, AbortController, setTimeout, clearTimeout,
      fetch: async (...args) => { network.push(args); throw new Error('Network is forbidden in this fixture'); },
      require: name => name.startsWith('.') ? load(resolve(dirname(absolute), name)) : require(name),
    };
    vm.runInNewContext(readFileSync(absolute, 'utf8'), context, { filename: absolute });
    return module.exports;
  }
  async function invoke(filename, request, initialHeaders = {}) {
    const headers = Object.fromEntries(Object.entries(initialHeaders).map(([key, value]) => [key.toLowerCase(), value]));
    const response = { statusCode: 200, setHeader(key, value) { headers[key.toLowerCase()] = String(value); },
      end(raw) { this.raw = raw; this.body = JSON.parse(raw); } };
    await load(resolve(apiRoot, filename))(request, response);
    assert.equal(network.length, 0, 'response-contract probes must never make network requests');
    return { status: response.statusCode, body: response.body, raw: response.raw, headers };
  }
  return { invoke, calls, authCalls, deleted };
}
function request(path, method = 'GET', body, headers = {}, query = {}) {
  return { method, url: path, body, query, headers: {
    authorization: 'Bearer ' + bearer(), 'content-type': 'application/json',
    origin: 'https://www.occulert.com', host: 'www.occulert.com',
    'x-vercel-forwarded-for': '203.0.113.10', ...headers,
  } };
}
function jsonResponse(result, status, body) {
  assert.equal(result.status, status);
  assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.raw, JSON.stringify(result.body));
  if (body !== undefined) assert.deepEqual(result.body, body);
}
const direct = [
  ['account', 'DELETE', 'DELETE', { confirm: 'DELETE' }],
  ['accept-invitation', 'POST', 'POST', { token: 'a'.repeat(43) }],
  ['events', 'POST', 'POST', { session_id: SESSION, type: 'drowsy' }],
  ['fleet-followups', 'GET', 'GET, POST'], ['fleet-invitations', 'GET', 'GET, POST, DELETE'],
  ['fleet-summary', 'GET', 'GET'], ['fleets', 'GET', 'GET, POST'],
  ['pilot-leads', 'POST', 'POST'], ['profile', 'POST', 'POST', {}],
  ['public-config', 'GET', 'GET'], ['sessions', 'GET', 'GET, POST, PATCH'],
];
function directRequest(name, method, body) {
  return request('/api/' + name, method, body, {}, name === 'sessions' ? { session_id: SESSION } : {});
}
for (const [name, method, allow, body] of direct) {
  test(`${name} retains its method envelope and Allow header`, async () => {
    const app = fixture();
    const result = await app.invoke(name + '.js', directRequest(name, 'OPTIONS', body));
    jsonResponse(result, 405, { ok: false, error: 'method_not_allowed' });
    assert.equal(result.headers.allow, allow);
  });
  test(`${name} retains its configured/unconfigured response contract`, async () => {
    const app = fixture({ env: { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } });
    const result = await app.invoke(name + '.js', directRequest(name, method, body));
    if (name === 'public-config') {
      jsonResponse(result, 200, { ok: true, capabilities: {}, supabase: { configured: false } });
    } else if (name === 'pilot-leads') {
      jsonResponse(result, 503, { ok: false, error: 'rate_limit_unavailable' });
    } else {
      jsonResponse(result, 501);
      assert.equal(result.body.ok, false); assert.equal(result.body.error, 'backend_not_configured');
    }
    assert.equal(app.authCalls.length, 0); assert.equal(app.calls.length, 0); assert.deepEqual(app.deleted, []);
  });
  if (!['pilot-leads', 'public-config'].includes(name)) test(`${name} retains unauthorized response before storage`, async () => {
    const app = fixture({ user: null });
    const result = await app.invoke(name + '.js', directRequest(name, method, body));
    jsonResponse(result, 401, { ok: false, error: 'unauthorized' });
    assert.equal(app.calls.length, 0); assert.deepEqual(app.deleted, []);
  });
}

const children = [
  ['billing-checkout', 'POST', { plan: 'starter' }, { 'idempotency-key': 'fixture-checkout-123' }],
  ['billing-portal', 'POST'], ['billing-status', 'GET'], ['billing-webhook', 'POST'],
  ['fleet-session-history', 'GET'], ['fleet-period-report', 'GET'],
];
function childRequest(name, method, body, headers = {}) {
  const path = '/api/' + name + (name === 'fleet-period-report' ? '?days=30' : '');
  return request(path, method, body, headers, name === 'fleet-period-report' ? { days: '30' } : {});
}
function childHeaders(result, name) {
  if (name.startsWith('billing-')) assert.equal(result.headers['x-content-type-options'], 'nosniff');
  else assert.equal(result.headers.vary, 'Authorization');
}
for (const [name, method, body, headers] of children) {
  for (const routed of [false, true]) {
    const filename = routed ? '[endpoint].js' : '_lib/routes/' + name + '.js';
    test(`${name} ${routed ? 'router' : 'direct child'} keeps method/config errors and its extra header`, async () => {
      const app = fixture({ env: { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } });
      let result = await app.invoke(filename, childRequest(name, 'OPTIONS', body, headers));
      jsonResponse(result, 405, { ok: false, error: 'method_not_allowed' });
      childHeaders(result, name); assert.equal(result.headers.allow, method);
      result = await app.invoke(filename, childRequest(name, method, body, headers));
      jsonResponse(result, 501, { ok: false, error: 'backend_not_configured' }); childHeaders(result, name);
      assert.equal(app.authCalls.length, 0); assert.equal(app.calls.length, 0);
    });
    if (name !== 'billing-webhook') test(`${name} ${routed ? 'router' : 'direct child'} keeps auth errors and its extra header`, async () => {
      const app = fixture({ user: null });
      const result = await app.invoke(filename, childRequest(name, method, body, headers));
      jsonResponse(result, 401, { ok: false, error: 'unauthorized' }); childHeaders(result, name);
      assert.equal(app.calls.length, 0);
    });
  }
}

test('router rejects path/query dispatch with exact error-only JSON envelopes', async () => {
  const app = fixture();
  let result = await app.invoke('[endpoint].js', request('/api/not-a-route?endpoint=billing-status'));
  jsonResponse(result, 404, { error: 'not_found' });
  result = await app.invoke('[endpoint].js', request('/api/billing-status', 'GET', undefined, {}, { endpoint: 'billing-portal' }));
  jsonResponse(result, 400, { error: 'invalid_query' });
  assert.equal(app.authCalls.length, 0); assert.equal(app.calls.length, 0);
});

test('router forwards history/report successes with Vary and preserves all zero/null aggregate fields', async () => {
  const app = fixture();
  const history = await app.invoke('[endpoint].js', request('/api/fleet-session-history?endpoint=fleet-session-history', 'GET', undefined, {}, { endpoint: 'fleet-session-history' }));
  jsonResponse(history, 200); childHeaders(history, 'fleet-session-history');
  assert.deepEqual(history.body.sessions, []); assert.equal(history.body.next_cursor, null);
  assert.equal(history.body.has_more, false); assert.equal(history.body.privacy.includes_location, false);
  const period = await app.invoke('[endpoint].js', request('/api/fleet-period-report?endpoint=fleet-period-report&days=30', 'GET', undefined, {}, { endpoint: 'fleet-period-report', days: '30' }));
  jsonResponse(period, 200); childHeaders(period, 'fleet-period-report');
  assert.deepEqual(period.body.report, report());
  assert.deepEqual(period.body.fleet, { id: FLEET, company_name: 'Fixture fleet' });
});

test('billing-status router keeps informational success shape and does not require verified email', async () => {
  const app = fixture({ user: { id: OWNER } });
  const result = await app.invoke('[endpoint].js', childRequest('billing-status', 'GET'));
  jsonResponse(result, 200, { ok: true, test_mode: true, informational_only: true,
    billing: { plan: null, status: 'none', current_period_end: null, cancel_at_period_end: false, updated_at: null } });
  childHeaders(result, 'billing-status');
});

test('account confirmation and period query validation retain their pre-auth order', async () => {
  const app = fixture({ user: null });
  const deletion = await app.invoke('account.js', request('/api/account', 'DELETE', {}));
  jsonResponse(deletion, 400, { ok: false, error: 'confirmation_required' });
  const period = await app.invoke('[endpoint].js', request('/api/fleet-period-report?days=90', 'GET', undefined, {}, { days: '90' }));
  jsonResponse(period, 400, { ok: false, error: 'invalid_period' }); childHeaders(period, 'fleet-period-report');
  assert.equal(app.authCalls.length, 0); assert.equal(app.calls.length, 0); assert.deepEqual(app.deleted, []);
});

test('sessions preserve auth/driver rejection before unsupported-method rejection', async () => {
  const unsigned = fixture({ user: null });
  jsonResponse(await unsigned.invoke('sessions.js', request('/api/sessions', 'OPTIONS')), 401, { ok: false, error: 'unauthorized' });
  const missingDriver = fixture({ pgFetch: async () => [] });
  jsonResponse(await missingDriver.invoke('sessions.js', request('/api/sessions', 'OPTIONS')), 403, { ok: false, error: 'driver_profile_not_found' });
});

test('account success retains its exact envelope and deletes only the verified user', async () => {
  const app = fixture();
  const result = await app.invoke('account.js', request('/api/account', 'DELETE', { confirm: 'DELETE', owner_user_id: FLEET }));
  jsonResponse(result, 200, { ok: true, deleted: true }); assert.deepEqual(app.deleted, [OWNER]);
});

test('pilot stages retain origin/media/rate precedence, distinct body errors and Retry-After', async () => {
  const limited = fixture({ pgFetch: async table => {
    assert.equal(table, 'rpc/check_pilot_lead_rate_limit'); return { allowed: false, retry_after_seconds: 17 };
  } });
  let result = await limited.invoke('pilot-leads.js', request('/api/pilot-leads', 'POST', [], { origin: 'https://foreign.example' }));
  jsonResponse(result, 403, { ok: false, error: 'origin_not_allowed' }); assert.equal(limited.calls.length, 0);
  result = await limited.invoke('pilot-leads.js', request('/api/pilot-leads', 'POST', [], { 'content-type': 'application/jsonp' }));
  jsonResponse(result, 415, { ok: false, error: 'unsupported_media_type' }); assert.equal(limited.calls.length, 0);
  result = await limited.invoke('pilot-leads.js', request('/api/pilot-leads', 'POST', []));
  jsonResponse(result, 429, { ok: false, error: 'rate_limited' }); assert.equal(result.headers['retry-after'], '17');
  assert.equal(limited.calls.length, 1); assert.equal(limited.authCalls.length, 0);
  const allowed = fixture();
  jsonResponse(await allowed.invoke('pilot-leads.js', request('/api/pilot-leads', 'POST', [])), 400, { ok: false, error: 'invalid_body' });
  jsonResponse(await allowed.invoke('pilot-leads.js', request('/api/pilot-leads', 'POST', { padding: 'x'.repeat(4096) })), 413, { ok: false, error: 'payload_too_large' });
  jsonResponse(await allowed.invoke('pilot-leads.js', request('/api/pilot-leads', 'POST', '{}')), 400, { ok: false, error: 'invalid_lead' });
});

test('invitation RPC rate errors keep their exact status/code and retry duration', async () => {
  for (const [code, retry] of [['resend_too_soon', '60'], ['invitation_rate_limited', '3600']]) {
    const app = fixture({ pgFetch: async (table, query, fallback) => {
      if (table === 'rpc/create_fleet_invitation') throw { details: { code: 'P0001', message: code } };
      return fallback(table, query);
    } });
    const result = await app.invoke('fleet-invitations.js', request('/api/fleet-invitations', 'POST', { email: 'driver@example.com' }));
    jsonResponse(result, 429, { ok: false, error: code }); assert.equal(result.headers['retry-after'], retry);
  }
});

test('summary success retains timing and protected projection metadata through shared serialization', async () => {
  const app = fixture();
  const result = await app.invoke('fleet-summary.js', request('/api/fleet-summary'));
  jsonResponse(result, 200);
  assert.match(result.headers['server-timing'], /^fleet;dur=\d+, roster;dur=\d+, events;dur=\d+$/);
  assert.deepEqual(result.body.privacy, { includes_location: false, includes_personal_media: false, includes_raw_motion: false });
  assert.equal(result.body.events_included, true); assert.deepEqual(result.body.events, []);
});

test('billing parser preserves string/object UTF-8 byte limits, media errors and config precedence', async () => {
  const probe = async (body, type = 'application/json', fixtureOptions = { user: null }) => {
    const app = fixture(fixtureOptions);
    const result = await app.invoke('[endpoint].js', childRequest('billing-checkout', 'POST', body,
      { 'content-type': type, 'idempotency-key': 'fixture-checkout-123' }));
    childHeaders(result, 'billing-checkout');
    return { app, result };
  };
  for (const body of [{ plan: 'starter' }, '  {"plan":"starter"}  ']) {
    const { app, result } = await probe(body);
    jsonResponse(result, 401, { ok: false, error: 'unauthorized' }); assert.equal(app.authCalls.length, 1);
  }
  // Both encodings are 2048 bytes at the boundary, while the Unicode object
  // is much shorter in JavaScript characters. One extra ASCII byte crosses it.
  const boundary = { plan: 'é'.repeat(1018) + 'x' };
  assert.equal(Buffer.byteLength(JSON.stringify(boundary)), 2048);
  for (const body of [boundary, JSON.stringify(boundary)]) {
    const { app, result } = await probe(body);
    jsonResponse(result, 400, { ok: false, error: 'invalid_plan' }); assert.equal(app.authCalls.length, 0);
  }
  const oversized = { plan: boundary.plan + 'x' };
  for (const body of [oversized, JSON.stringify(oversized)]) {
    const { app, result } = await probe(body);
    jsonResponse(result, 400, { ok: false, error: 'invalid_json_body' });
    assert.equal(app.authCalls.length, 0); assert.equal(app.calls.length, 0); assert.deepEqual(app.deleted, []);
  }
  for (const type of ['application/jsonp', 'text/application/json', ' Application/JSON']) {
    const { app, result } = await probe({ plan: 'starter' }, type);
    jsonResponse(result, 400, { ok: false, error: 'invalid_json_body' });
    assert.equal(app.authCalls.length, 0); assert.equal(app.calls.length, 0);
  }
  const mixed = await probe({ plan: 'starter' }, 'Application/JSON; charset=utf-8');
  jsonResponse(mixed.result, 401, { ok: false, error: 'unauthorized' });
  const misconfigured = await probe([], 'application/json', { user: null, env: { STRIPE_TEST_SECRET_KEY: 'sk_live_forbidden' } });
  jsonResponse(misconfigured.result, 501, { ok: false, error: 'billing_test_not_configured' });
  assert.equal(misconfigured.app.authCalls.length, 0); assert.equal(misconfigured.app.calls.length, 0);
  const portal = fixture({ user: null });
  jsonResponse(await portal.invoke('[endpoint].js', childRequest('billing-portal', 'POST', undefined, { 'content-type': 'text/plain' })), 401, { ok: false, error: 'unauthorized' });
});

function webhookRequest(raw, { signature = true, declaredLength = raw.length } = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', env.STRIPE_TEST_WEBHOOK_SECRET)
    .update(Buffer.concat([Buffer.from(timestamp + '.'), raw])).digest('hex');
  const req = request('/api/billing-webhook?endpoint=billing-webhook', 'POST', { forged_parsed_body: true },
    { 'content-type': 'text/plain', 'content-length': String(declaredLength),
      'stripe-signature': signature ? `t=${timestamp},v1=${digest}` : 'invalid' }, { endpoint: 'billing-webhook' });
  req[Symbol.asyncIterator] = async function* () {
    assert.equal(this, req, 'router must retain the original webhook request/iterator receiver');
    yield raw.subarray(0, 13); yield raw.subarray(13);
  };
  return req;
}
test('webhook direct/router preserve signed raw bytes, ignored success and bounded-stream errors', async () => {
  const raw = Buffer.from('{ "id":"evt_fixture", "type":"unhandled.fixture", "livemode":false }\n');
  for (const filename of ['_lib/routes/billing-webhook.js', '[endpoint].js']) {
    const app = fixture();
    let result = await app.invoke(filename, webhookRequest(raw));
    jsonResponse(result, 200, { ok: true, ignored: true }); childHeaders(result, 'billing-webhook');
    result = await app.invoke(filename, webhookRequest(raw, { signature: false }));
    jsonResponse(result, 400, { ok: false, error: 'invalid_signature' }); childHeaders(result, 'billing-webhook');
    result = await app.invoke(filename, webhookRequest(Buffer.alloc(1024 * 1024 + 1), { declaredLength: 0 }));
    jsonResponse(result, 413, { ok: false, error: 'webhook_too_large' }); childHeaders(result, 'billing-webhook');
    assert.equal(app.authCalls.length, 0); assert.equal(app.calls.length, 0);
  }
});

test('billing safe-error envelope and history/report feature failures retain extra headers', async () => {
  const billing = fixture({ authFailure: new Error('private upstream detail') });
  const hidden = await billing.invoke('[endpoint].js', childRequest('billing-status', 'GET'));
  jsonResponse(hidden, 502, { ok: false, error: 'billing_unavailable' }); childHeaders(hidden, 'billing-status');
  for (const [name, status, error] of [['fleet-session-history', 502, 'fleet_history_unavailable'],
    ['fleet-period-report', 503, 'period_report_not_enabled']]) {
    const app = fixture({ pgFetch: async () => { throw { details: { code: 'PGRST202' } }; } });
    const result = await app.invoke('[endpoint].js', childRequest(name, 'GET'));
    jsonResponse(result, status, { ok: false, error }); childHeaders(result, name);
  }
});
