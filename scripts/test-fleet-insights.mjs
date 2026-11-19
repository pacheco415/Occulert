import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const transport = require('../api/_lib/supabase');
const ownerId = '11111111-1111-4111-8111-111111111111';
const fleetId = '22222222-2222-4222-8222-222222222222';
const apiKey = 'private-fixture-provider-key';
const counts = { roster_total: 4, active_drivers: 3, reporting_active_drivers: 2, sessions: 6, completed: 4,
  no_recorded_end: 1, invalid_recorded_end: 1, scored: 3, unscored: 3, valid_alert_records: 4,
  missing_alert_records: 2, alerts: 9, reviewed: 2, without_reviewed_followup: 4 };
const start = '2026-11-01T00:00:00Z';
const end = '2026-11-08T00:00:00Z';
const report = { ...counts, version: 1, days: 7, window_start: start, window_end: end,
  complete_period: true, interruption_reasons_available: false, unrecorded_sessions_detectable: false,
  average_safety_score: 63, detector_pipelines: { web_mediapipe_ear: 3, ios_mlkit_eye_probability: 3,
    android_mlkit_eye_probability: 0, unknown: 0 },
  company_name: 'Private Fleet', driver: { name: 'Private Driver', coordinates: [1, 2] }, secret_future_field: 45 };

function reply(text = ' Summary. ') {
  return Response.json({ type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text }] });
}
function setup(t, { user = { id: ownerId }, fleets = [{ id: fleetId, company_name: 'Private Fleet' }],
  result = report, provider = async () => reply() } = {}) {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    OCCULERT_FLEET_INSIGHTS_ENABLED: '1', ANTHROPIC_API_KEY: apiKey, OCCULERT_INSIGHTS_MODEL: '' })) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
  const auth = t.mock.method(transport, 'verifyAccessToken', async (token, options) => {
    assert.deepEqual(options, { cachedIdentity: true });
    return token === 'owner-token' ? user : null;
  });
  const database = t.mock.method(transport, 'pgFetch', async (path, options) => {
    if (path === 'fleets') {
      assert.equal(options.params.owner_user_id, 'eq.' + ownerId);
      return fleets;
    }
    assert.equal(path, 'rpc/fleet_period_report');
    assert.deepEqual(options, { method: 'POST', body: { p_actor_id: ownerId, p_fleet_id: fleetId, p_days: result.days } });
    return result;
  });
  const fetch = t.mock.method(globalThis, 'fetch', provider);
  const logs = t.mock.method(console, 'error', () => {});
  for (const path of ['../api/_lib/fleet-period', '../api/_lib/routes/fleet-insights', '../api/[endpoint]']) {
    delete require.cache[require.resolve(path)];
  }
  const dispatch = require('../api/[endpoint]');
  async function invoke(query = 'days=7', method = 'GET', token = 'owner-token') {
    const headers = {};
    const res = { setHeader: (k,v) => { headers[k.toLowerCase()] = v; }, end(raw) { this.body = JSON.parse(raw); } };
    await dispatch({ method, url: '/api/fleet-insights?' + query, headers: { authorization: 'Bearer ' + token } }, res);
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(headers.vary, 'Authorization');
    return { status: res.statusCode, body: res.body };
  }
  return { invoke, auth, database, fetch, logs };
}

test('feature must be explicitly enabled and configured before accessing data', async t => {
  const app = setup(t);
  for (const [flag, key] of [['', apiKey], ['true', apiKey], ['1', ' ']]) {
    process.env.OCCULERT_FLEET_INSIGHTS_ENABLED = flag;
    process.env.ANTHROPIC_API_KEY = key;
    assert.deepEqual(await app.invoke(), { status: 501, body: { ok: false, error: 'insights_not_configured' } });
  }
  assert.equal(app.auth.mock.callCount(), 0);
  assert.equal(app.database.mock.callCount(), 0);
  assert.equal(app.fetch.mock.callCount(), 0);
});

test('method, period and owner checks run before any provider call', async t => {
  const app = setup(t, { fleets: [] });
  assert.equal((await app.invoke('days=7', 'POST')).status, 405);
  for (const query of ['', 'days=07', 'days=7&days=30', 'days=90', 'days=7&fleet_id=' + fleetId]) {
    assert.equal((await app.invoke(query)).status, 400);
  }
  assert.equal((await app.invoke('days=7', 'GET', 'wrong')).status, 401);
  assert.equal(app.database.mock.callCount(), 0);
  assert.equal((await app.invoke()).status, 403);
  assert.equal(app.database.mock.callCount(), 1);
  assert.equal(app.fetch.mock.callCount(), 0);
});

for (const days of [7, 30]) test('only validated allowlisted counts and dates leave the backend for ' + days + ' days', async t => {
  const app = setup(t, { result: { ...report, days } });
  if (days === 30) process.env.OCCULERT_INSIGHTS_MODEL = 'fixture-custom-model';
  const model = days === 7 ? 'claude-haiku-5-5' : 'fixture-custom-model';
  const res = await app.invoke('days=' + days);
  assert.equal(res.status, 200);
  assert.equal(new Date(res.body.generated_at).toISOString(), res.body.generated_at);
  assert.deepEqual(res.body, { ok: true, summary: 'Summary.', model, days, window_start: start, window_end: end,
    generated_at: res.body.generated_at, ai_generated: true });
  assert.equal(app.fetch.mock.callCount(), 1);
  const [url, options] = app.fetch.mock.calls[0].arguments;
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(options.redirect, 'error');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['x-api-key'], apiKey);
  assert.equal(options.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(options.body);
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'system']);
  assert.equal(body.model, model);
  assert.equal(body.max_tokens, 400);
  assert.match(body.system, /missing alert records/);
  assert.deepEqual(body.messages, [{ role: 'user', content: JSON.stringify({ days, window_start: start, window_end: end, ...counts }) }]);
  assert.equal(app.logs.mock.callCount(), 0);
});

test('inconsistent aggregates stop before disclosure', async t => {
  const app = setup(t, { result: { ...report, sessions: 300 } });
  assert.equal((await app.invoke()).status, 502);
  assert.equal(app.fetch.mock.callCount(), 0);
});

test('empty, excessive, truncated and malformed replies and upstream failures return only generic errors', async t => {
  const app = setup(t);
  const failed = { status: 502, body: { ok: false, error: 'insights_unavailable' } };
  for (const response of [reply(' '), reply('a'.repeat(1201)), reply(apiKey), reply('a'.repeat(40000)),
    Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'cut off' }] }),
    new Response('invalid JSON ' + apiKey), new Response(apiKey, { status: 429 })]) {
    app.fetch.mock.mockImplementationOnce(async () => response);
    assert.deepEqual(await app.invoke(), failed);
  }
  app.fetch.mock.mockImplementationOnce(async () => { throw new Error(apiKey); });
  assert.deepEqual(await app.invoke(), failed);
  app.fetch.mock.mockImplementationOnce(async () => new Response(apiKey, { status: 504 }));
  assert.deepEqual(await app.invoke(), { status: 504, body: failed.body });
  assert.equal(app.fetch.mock.callCount(), 9);
  const logs = JSON.stringify(app.logs.mock.calls.map(call => call.arguments));
  assert.equal(logs.includes(apiKey), false);
  assert.equal(logs.includes('Private Fleet'), false);
});

test('the shared deadline aborts a stalled response body once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  const app = setup(t, { provider: async () => new Response(new ReadableStream({ pull() { started(); } })) });
  const pending = app.invoke();
  await reading;
  t.mock.timers.tick(12001);
  assert.deepEqual(await pending, { status: 504, body: { ok: false, error: 'insights_unavailable' } });
  assert.equal(app.fetch.mock.callCount(), 1);
  assert.equal(app.fetch.mock.calls[0].arguments[1].signal.aborted, true);
});
