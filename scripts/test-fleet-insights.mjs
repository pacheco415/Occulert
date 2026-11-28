import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

const require = createRequire(import.meta.url);
const paidAccess = require('../api/_lib/fleet-paid-access');
const transport = require('../api/_lib/supabase');
const { remainingProviderMs } = require('../api/_lib/provider-budget');
const ownerId = '11111111-1111-4111-8111-111111111111';
const fleetId = '22222222-2222-4222-8222-222222222222';
const apiKey = 'private-fixture-provider-key';
const counts = { roster_total: 4, active_drivers: 3, reporting_active_drivers: 2, sessions: 6, completed: 4,
  no_recorded_end: 1, invalid_recorded_end: 1, scored: 3, unscored: 3, valid_alert_records: 4,
  missing_alert_records: 2, alerts: 9, reviewed: 2, without_reviewed_followup: 4 };
const start = '2026-11-01T00:00:00Z';
const end = '2026-11-08T00:00:00Z';
const report = { ...counts, version: 1, days: 7, window_start: start, window_end: end,
  complete_period: true, monitored_hours: 2, alerts_per_monitored_hour: 1.5, interruption_reasons_available: false, unrecorded_sessions_detectable: false,
  average_safety_score: 63, detector_pipelines: { web_mediapipe_ear: 3, ios_mlkit_eye_probability: 3,
    android_mlkit_eye_probability: 0, unknown: 0 },
  company_name: 'Private Fleet', driver: { name: 'Private Driver', coordinates: [1, 2] }, secret_future_field: 45 };

function reply(text = ' Summary. ') {
  return Response.json({ type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text }] });
}
function fakeClock(t, now = Date.parse(end)) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  t.mock.method(performance, 'now', () => Date.now() - now);
  return ms => t.mock.timers.tick(ms);
}
function setup(t, { user = { id: ownerId }, fleets = [{ id: fleetId, company_name: 'Private Fleet' }],
  result = report, provider = async () => reply(), onDatabaseCall = () => {}, cachedEntry, paid = true, configured = true } = {}) {
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    OCCULERT_FLEET_INSIGHTS_ENABLED: '1', ANTHROPIC_API_KEY: apiKey, OCCULERT_INSIGHTS_MODEL: '' })) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
  const billing = { key: 'fixture', prices: ['price_fixture'] };
  t.mock.method(paidAccess, 'paidAccessConfig', () => configured ? billing : null);
  t.mock.method(paidAccess, 'hasPaidFleetAccess', async (owner, config) => {
    assert.equal(owner.actorId, ownerId);
    assert.equal(owner.fleet.id, fleetId);
    assert.equal(config, billing);
    return paid;
  });
  const auth = t.mock.method(transport, 'verifyAccessToken', async (token, options) => {
    assert.deepEqual(options, { freshUser: true });
    return token === 'owner-token' ? user : null;
  });
  const database = t.mock.method(transport, 'pgFetch', async (path, options) => {
    const budget = remainingProviderMs(8000);
    onDatabaseCall(path, budget);
    if (path === 'fleets') {
      assert.equal(options.params.owner_user_id, 'eq.' + ownerId);
      return fleets;
    }
    const { p_actor_id, p_fleet_id, p_days } = options.body;
    assert.deepEqual([options.method, p_actor_id, p_fleet_id, p_days], ['POST', ownerId, fleetId, result.days]);
    if (path === 'rpc/claim_fleet_insight_attempt') {
      if (cachedEntry) return { claimed: false, entry: cachedEntry };
      return { claimed: true, attempt_count: 1, next_allowed_at: new Date(Date.now() + 120000).toISOString(), report_day: end.slice(0, 10), report: result };
    }
    assert.equal(path, 'rpc/finish_fleet_insight_attempt');
    assert.equal(options.body.p_report_day, end.slice(0, 10));
    return { summary: options.body.p_summary, days: p_days,
      model: process.env.OCCULERT_INSIGHTS_MODEL || 'claude-haiku-5-5',
      window_start: options.body.p_window_start, window_end: options.body.p_window_end,
      finished_at: new Date().toISOString() };
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
    const result = { status: res.statusCode, body: res.body };
    if (headers['retry-after'] !== undefined) result.retryAfter = headers['retry-after'];
    return result;
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

for (const configured of [false, true]) test('no summary claim or cached read without paid access: ' + configured, async t => {
  const app = setup(t, { configured, paid: false, cachedEntry: { summary: 'previously paid' } });
  assert.deepEqual(await app.invoke(), { status: configured ? 403 : 501,
    body: { ok: false, error: configured ? 'paid_plan_required' : 'paid_access_not_configured' } });
  assert.deepEqual(app.database.mock.calls.map(call => call.arguments[0]), ['fleets']);
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
  assert.match(body.system, /under 1,000 characters/);
  assert.match(body.system, /missing alert records/);
  assert.deepEqual(body.messages, [{ role: 'user', content: JSON.stringify({ days, window_start: start, window_end: end, ...counts, monitored_hours: 2, alerts_per_monitored_hour: 1.5, comparison: { status: 'unavailable' } }) }]);
  assert.equal(app.logs.mock.callCount(), 0);
});

test('summaries keep the last complete sentence within the summary cap', async t => {
  const app = setup(t);
  t.mock.method(console, 'warn', () => {});
  const prefix = Array(22).fill('The fleet recorded 2.5 alerts per session.').join(' ');
  app.fetch.mock.mockImplementationOnce(async () => reply(prefix + ' ' + 'Detail '.repeat(51) + 'continues.'));
  assert.equal((await app.invoke()).body.summary, prefix);
});

test('inconsistent aggregates stop before disclosure', async t => {
  const app = setup(t, { result: { ...report, sessions: 300 } });
  assert.equal((await app.invoke()).status, 502);
  assert.equal(app.fetch.mock.callCount(), 0);
});

test('empty, excessive, truncated and malformed replies and upstream failures return only generic errors', async t => {
  fakeClock(t);
  const app = setup(t);
  const warn = t.mock.method(console, 'warn', () => {});
  const failed = { status: 502, retryAfter: '120', body: {
    ok: false, error: 'insights_unavailable', retry_after: '2026-11-08T00:02:00.000Z',
  } };
  for (const response of [reply(' '), reply('a'.repeat(1201)), reply(apiKey), reply('a'.repeat(40000)),
    Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'cut off' }] }),
    new Response('invalid JSON ' + apiKey), new Response(apiKey, { status: 429 })]) {
    app.fetch.mock.mockImplementationOnce(async () => response);
    assert.deepEqual(await app.invoke(), failed);
  }
  app.fetch.mock.mockImplementationOnce(async () => { throw new Error(apiKey); });
  assert.deepEqual(await app.invoke(), failed);
  app.fetch.mock.mockImplementationOnce(async () => new Response(apiKey, { status: 504 }));
  assert.deepEqual(await app.invoke(), { ...failed, status: 504 });
  assert.deepEqual(warn.mock.calls.map(call => call.arguments), [
    ['fleet_ai_output_rejected', { feature: 'fleet_insights', reason: 'character_limit' }],
    ['fleet_ai_output_rejected', { feature: 'fleet_insights', reason: 'response_byte_limit' }],
    ['fleet_ai_output_rejected', { feature: 'fleet_insights', reason: 'max_tokens' }],
  ]);
  assert.equal(app.fetch.mock.callCount(), 9);
  const logs = JSON.stringify(app.logs.mock.calls.map(call => call.arguments));
  assert.equal(logs.includes(apiKey), false);
  assert.equal(logs.includes('Private Fleet'), false);
});

test('a slow provider result is saved and the request can finish at 11.8 seconds', async t => {
  const tick = fakeClock(t);
  const app = setup(t, {
    provider: async () => { tick(9499); return reply(); },
    onDatabaseCall(path, budget) {
      if (path === 'rpc/finish_fleet_insight_attempt') {
        assert.equal(budget, 2501);
        tick(2301);
      }
    },
  });
  const result = await app.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.body.summary, 'Summary.');
  assert.equal(performance.now(), 11800);
});

for (const delay of [5501, 12000]) test('no slot or paid call after an owner lookup taking ' + delay + ' ms', async t => {
  const tick = fakeClock(t);
  const app = setup(t, { onDatabaseCall(path) { if (path === 'fleets') tick(delay); } });
  assert.deepEqual(await app.invoke(), { status: 503, retryAfter: '5', body: { ok: false, error: 'insights_unavailable' } });
  assert.deepEqual(app.database.mock.calls.map(call => call.arguments[0]), ['fleets']);
  assert.equal(app.fetch.mock.callCount(), 0);
});

test('a slow claim with only the save reserve left records failure without starting a paid call', async t => {
  const tick = fakeClock(t);
  const app = setup(t, { onDatabaseCall(path) {
    if (path === 'fleets') tick(5500);
    if (path === 'rpc/claim_fleet_insight_attempt') tick(4000);
  } });
  assert.equal((await app.invoke()).status, 504);
  const [path, options] = app.database.mock.calls.at(-1).arguments;
  assert.equal(path, 'rpc/finish_fleet_insight_attempt');
  assert.equal(options.body.p_summary, null);
  assert.equal(app.fetch.mock.callCount(), 0);
});

test('a provider body arriving at 11.8 seconds times out once and leaves time to finalize the reservation', async t => {
  const tick = fakeClock(t);
  const started = Promise.withResolvers();
  const message = new TextEncoder().encode(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Late.' }] }));
  const finishBudgets = [];
  const app = setup(t, {
    provider: async () => new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(message);
          controller.close();
        }, 11800 - performance.now());
        started.resolve();
      },
    })),
    onDatabaseCall(path, budget) {
      if (path === 'rpc/claim_fleet_insight_attempt') tick(300);
      if (path === 'rpc/finish_fleet_insight_attempt') finishBudgets.push(budget);
    },
  });
  const pending = app.invoke();
  await started.promise;
  tick(9200);
  const timedOut = await pending;
  assert.equal(timedOut.status, 504);
  assert.ok(Number(timedOut.retryAfter) > 0 && Number(timedOut.retryAfter) <= 120);
  assert.equal(timedOut.body.error, 'insights_unavailable');
  assert.deepEqual(finishBudgets, [2500]);
  assert.equal(app.database.mock.calls.at(-1).arguments[1].body.p_summary, null);
  tick(2300);
  assert.equal(app.fetch.mock.callCount(), 1);
  assert.equal(app.fetch.mock.calls[0].arguments[1].signal.aborted, true);
});

for (const finished of [true, false]) test('a spent ' + (finished ? 'finished' : 'abandoned') + ' reservation advertises UTC midnight', async t => {
  fakeClock(t, Date.parse('2026-11-08T23:59:58.050Z'));
  const app = setup(t, { cachedEntry: { summary: null, attempt_count: 3, report_day: '2026-11-08', created_at: end, finished_at: finished ? end : null } });
  assert.deepEqual(await app.invoke(), { status: 502, retryAfter: '2', body: {
    ok: false, error: 'insights_unavailable', retry_after: '2026-11-09T00:00:00.000Z',
  } });
  assert.equal(app.fetch.mock.callCount(), 0);
});
