import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const transport = require('../api/_lib/supabase');
const ownerId = '11111111-1111-4111-8111-111111111111';
const fleetId = '22222222-2222-4222-8222-222222222222';
const driverId = '33333333-3333-4333-8333-333333333333';
const secret = 'private-fixture-credential';
const question = 'How many sessions need review?';
const counts = { roster_total: 3, active_drivers: 2, reporting_active_drivers: 1, sessions: 4, completed: 3,
  no_recorded_end: 1, invalid_recorded_end: 0, scored: 1, unscored: 3, valid_alert_records: 3,
  missing_alert_records: 1, alerts: 7, reviewed: 1, without_reviewed_followup: 3 };
const end = '2026-11-23T00:00:00.000Z';
const start = days => new Date(Date.parse(end) - days * 86400000).toISOString();
const blocks = Array.from({ length: 6 }, (_, i) => ({ start_hour: i * 4, monitored_minutes: 120,
  drowsy_alerts: i, distracted_alerts: 2, rate_available: true, drowsy_alerts_per_hour: i / 2 }));
const providerReply = text => Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const readKey = 'rk_live_UnitFixture';
const price = { id: 'price_Start', type: 'recurring', livemode: true };
function paidSubscription() {
  const now = Math.floor(Date.now() / 1000);
  return { object: 'subscription', id: 'sub_Fixture', customer: 'cus_Fixture', livemode: true, status: 'active',
    metadata: { fleet_id: fleetId, owner_user_id: ownerId }, pause_collection: null,
    current_period_start: now - 60, current_period_end: now + 60,
    items: { has_more: false, data: [{ price: { ...price }, quantity: 1 }] },
    latest_invoice: { object: 'invoice', livemode: true, customer: 'cus_Fixture', subscription: 'sub_Fixture',
      status: 'paid', amount_paid: 1000, lines: { data: [{ type: 'subscription', subscription: 'sub_Fixture', price, amount: 1000,
        period: { start: now - 60, end: now + 60 } }] },
      charge: { object: 'charge', livemode: true, customer: 'cus_Fixture', status: 'succeeded', paid: true,
        captured: true, amount_captured: 1000, amount_refunded: 0, refunded: false, disputed: false } } };
}

function setup(t, { owned = true, allowed = true, subscription = paidSubscription, results = 1,
  provider = async () => providerReply('Three sessions need review.') } = {}) {
  t.mock.method(transport, 'verifyAccessToken', async token => token === 'owner' ? { id: ownerId } : null);
  const db = t.mock.method(transport, 'pgFetch', async (path, { params, body }) => {
    if (path === 'fleets') {
      assert.equal(params.owner_user_id, 'eq.' + ownerId);
      return owned ? [{ id: fleetId, company_name: 'Private Transit' }] : [];
    }
    if (path === 'drivers') {
      assert.equal(params.fleet_id, 'eq.' + fleetId);
      assert.equal(params.select, 'id,name,vehicle_id');
      if (params.id) { assert.equal(params.id, 'gt.' + driverId); return []; }
      return [{ id: driverId, name: 'María O’Brien', vehicle_id: 'Van-K4' }];
    }
    if (path === 'rpc/reserve_account_write') {
      assert.deepEqual(body, { p_user_id: ownerId, p_operation: 'fleet_ask' });
      return { user_id: ownerId, operation: 'fleet_ask', allowed,
        ...(!allowed && { error: 'account_write_rate_limited', retry_after: 32 }) };
    }
    const days = body.p_days;
    assert.deepEqual(body, { p_days: days, p_actor_id: ownerId, p_fleet_id: fleetId });
    const period = { version: 1, days, window_start: start(days), window_end: end };
    if (path === 'rpc/fleet_time_of_day_report') return { ...period, timezone: 'America/Los_Angeles', blocks };
    assert.equal(path, 'rpc/fleet_period_report');
    return { ...period, ...counts, complete_period: true, average_safety_score: null,
      interruption_reasons_available: false, unrecorded_sessions_detectable: false,
      detector_pipelines: { web_mediapipe_ear: 4, ios_mlkit_eye_probability: 0, android_mlkit_eye_probability: 0, unknown: 0 },
      private_future_field: { driverId, company: 'Private Transit' } };
  });
  const send = t.mock.fn(provider);
  const stripe = t.mock.fn(async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + readKey);
    assert.equal(options.headers['Stripe-Version'], '2024-06-20');
    assert.equal(options.body, undefined);
    if (url.pathname === '/v1/subscriptions/search') {
      assert.equal(url.searchParams.get('query'), `status:'active' AND metadata['fleet_id']:'${fleetId}' AND metadata['owner_user_id']:'${ownerId}'`);
      return Response.json({ object: 'search_result', has_more: results > 1,
        data: results ? [{ id: 'sub_Fixture', livemode: true }] : [] });
    }
    assert.equal(url.pathname, '/v1/subscriptions/sub_Fixture');
    assert.equal(url.searchParams.get('expand[]'), 'latest_invoice.charge');
    return Response.json(subscription());
  });
  t.mock.method(globalThis, 'fetch', (input, options) => {
    const url = new URL(input);
    if (url.origin === 'https://api.stripe.com') return stripe(url, options);
    assert.equal(url.href, 'https://api.anthropic.com/v1/messages');
    return send(input, options);
  });
  const logs = t.mock.method(console, 'error', () => {});
  for (const [key, value] of Object.entries({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    ANTHROPIC_API_KEY: secret, OCCULERT_FLEET_ASK_ENABLED: '1', OCCULERT_INSIGHTS_MODEL: 'fixture-model',
    STRIPE_FLEET_ACCESS_READ_KEY: readKey, OCCULERT_FLEET_ASK_PRICE_IDS: 'price_Start,price_Growth' })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  for (const path of ['../api/_lib/fleet-period', '../api/_lib/routes/fleet-ask', '../api/[endpoint]']) delete require.cache[require.resolve(path)];
  const dispatch = require('../api/[endpoint]');
  async function invoke({ body = { days: 7, question }, method = 'POST', query = '', token = 'owner', type = 'application/json' } = {}) {
    const headers = {};
    const response = { setHeader(name, value) { headers[name] = value; }, end(value) { this.body = JSON.parse(value); } };
    await dispatch({ url: '/api/fleet-ask' + query, method, body, headers: { authorization: 'Bearer ' + token, 'content-type': type } }, response);
    assert.equal(headers.Vary, 'Authorization');
    assert.equal(headers['Cache-Control'], 'no-store');
    return { status: response.statusCode, body: response.body, headers };
  }
  return { db, send, stripe, invoke, logs };
}

test('configuration gate does not access accounts or send a question', async t => {
  const app = setup(t);
  for (const [flag, key] of [['', secret], ['1', ' ']]) {
    process.env.OCCULERT_FLEET_ASK_ENABLED = flag; process.env.ANTHROPIC_API_KEY = key;
    const result = await app.invoke();
    assert.equal(result.status, 501); assert.equal(result.body.error, 'ask_not_configured');
  }
  assert.equal(app.db.mock.callCount() + app.send.mock.callCount() + app.stripe.mock.callCount(), 0);
});

test('method, shape, size, period, query, authentication and ownership are enforced', async t => {
  const app = setup(t, { owned: false });
  assert.equal((await app.invoke({ method: 'GET' })).status, 405);
  for (const options of [{ body: { days: 7, question, fleetId } }, { query: '?days=7' }, { body: { days: '7', question } },
    { body: { days: 30, question: ' a ' } }, { body: { days: 7, question: 'a'.repeat(301) } },
    { body: { days: 7, question: ' '.repeat(3000) + question } }, { type: 'text/plain' }, { body: [] }]) {
    assert.equal((await app.invoke(options)).status, 400);
  }
  assert.equal((await app.invoke({ token: '' })).status, 401);
  assert.equal((await app.invoke()).status, 403);
  assert.equal(app.send.mock.callCount(), 0);
});

test('personal details never consume a slot or reach the provider', async t => {
  const app = setup(t);
  for (const question of ['How did MARÍA do?', 'How did Brien do?', 'Call a@b.example', 'Call 4155550100',
    'Try (415) 555-0100', 'Check Private Transit', 'Check Van-K4', 'Look at ' + driverId, 'Look near 37.77, -122.42']) {
    const result = await app.invoke({ body: { question, days: 30 } });
    assert.equal(result.status, 400, question); assert.equal(result.body.error, 'question_has_personal_details');
  }
  assert.equal(app.send.mock.callCount(), 0);
  assert.ok(!app.db.mock.calls.some(call => call.arguments[0].includes('reserve')));
});

function assertNoPaidWork(app) {
  assert.equal(app.send.mock.callCount(), 0);
  assert.ok(app.db.mock.calls.every(call => !call.arguments[0].startsWith('rpc/')));
}

test('billing config accepts only a live restricted key and explicit price IDs', async t => {
  const app = setup(t);
  for (const [key, prices] of [['', 'price_Start'], ['rk_test_Fixture', 'price_Start'],
    ['sk_live_Fixture', 'price_Start'], [readKey, ''], [readKey, 'price_Start,invalid']]) {
    process.env.STRIPE_FLEET_ACCESS_READ_KEY = key;
    process.env.OCCULERT_FLEET_ASK_PRICE_IDS = prices;
    const result = await app.invoke();
    assert.equal(result.status, 501);
    assert.equal(result.body.error, 'paid_access_not_configured');
  }
  assert.equal(app.stripe.mock.callCount(), 0);
  assertNoPaidWork(app);
});

test('only current live paid coverage of the authenticated fleet authorizes a question', async t => {
  let change;
  const app = setup(t, { subscription: () => { const s = paidSubscription(); change(s); return s; } });
  for (change of [
    s => { s.status = 'trialing'; }, s => { s.status = 'past_due'; }, s => { s.status = 'canceled'; },
    s => { s.pause_collection = {}; }, s => { s.current_period_end = 1; },
    s => { s.metadata.fleet_id = driverId; }, s => { s.metadata.owner_user_id = driverId; },
    s => { s.items.data[0].price.id = 'price_Other'; }, s => { s.items.data[0].price.livemode = false; },
    s => { s.latest_invoice.amount_paid = 0; }, s => { s.latest_invoice.status = 'open'; },
    s => { s.latest_invoice.livemode = false; }, s => { s.latest_invoice.subscription = 'sub_Other'; },
    s => { s.latest_invoice.lines.data[0].period.end = 1; }, s => { s.latest_invoice.lines.data[0].amount = 0; },
    s => { s.latest_invoice.charge.refunded = true; }, s => { s.latest_invoice.charge.disputed = true; },
    s => { s.latest_invoice.charge = null; },
  ]) {
    const result = await app.invoke();
    assert.equal(result.status, 403, change.toString());
    assert.equal(result.body.error, 'paid_plan_required');
  }
  assertNoPaidWork(app);
  change = s => { s.livemode = false; };
  assert.equal((await app.invoke()).status, 502);
  assertNoPaidWork(app);
  change = s => { s.cancel_at_period_end = true; };
  assert.equal((await app.invoke()).status, 200);
  change = s => { s.latest_invoice.charge = null; s.latest_invoice.paid_out_of_band = true; };
  assert.equal((await app.invoke()).status, 200);
});

test('no subscription, ambiguous linkage and Stripe outages never reserve quota or send the question', async t => {
  for (const [count, status] of [[0, 403], [2, 502]]) {
    await t.test('subscription matches ' + count, async child => {
      const app = setup(child, { results: count });
      assert.equal((await app.invoke()).status, status);
      assert.equal(app.stripe.mock.callCount(), 1);
      assertNoPaidWork(app);
    });
  }
  const app = setup(t);
  app.stripe.mock.mockImplementationOnce(async () => new Response('private detail', { status: 503 }));
  const result = await app.invoke();
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { ok: false, error: 'ask_unavailable' });
  assertNoPaidWork(app);
});

test('hourly limit returns the wait time and skips reports and model', async t => {
  const app = setup(t, { allowed: false });
  const result = await app.invoke();
  assert.equal(result.status, 429); assert.equal(result.headers['Retry-After'], '32');
  assert.equal(app.send.mock.callCount(), 0);
  assert.equal(app.db.mock.calls.at(-1).arguments[0], 'rpc/reserve_account_write');
});

for (const days of [7, 30]) test('allowlisted request and answer for ' + days + ' days', async t => {
  const app = setup(t);
  const result = await app.invoke({ body: { days, question: '  ' + question + '  ' } });
  assert.equal(result.status, 200);
  const { generated_at } = result.body;
  assert.equal(new Date(generated_at).toISOString(), generated_at);
  assert.deepEqual(result.body, { ok: true, answer: 'Three sessions need review.', model: 'fixture-model', days,
    window_start: start(days), window_end: end, generated_at, ai_generated: true });
  const [url, options] = app.send.mock.calls[0].arguments;
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  const outbound = JSON.parse(options.body);
  assert.match(outbound.system, /emergency services now/);
  const period = n => ({ days: n, ...counts, alerts_per_day: n === 7 ? 1 : 0.2333, alerts_per_session: 1.75, share_reviewed: 0.25 });
  assert.deepEqual(JSON.parse(outbound.messages[0].content), { days, question, week: period(7), month: period(30),
    timezone: 'America/Los_Angeles', blocks });
  assert.doesNotMatch(options.body, /Private Transit|María|Van-K4|private_future_field|private-fixture-credential/);
  assert.equal(app.logs.mock.callCount(), 0);
});

test('provider failures, key echoes and invalid answers are private and never retried', async t => {
  const app = setup(t);
  const cases = [[504, new Response(secret, { status: 504 })], [502, new Response(secret, { status: 500 })],
    [502, providerReply(secret)], [502, providerReply('')], [502, providerReply('x'.repeat(701))]];
  for (const [status, response] of cases) {
    app.send.mock.mockImplementationOnce(async () => response);
    const result = await app.invoke();
    assert.equal(result.status, status); assert.deepEqual(result.body, { ok: false, error: 'ask_unavailable' });
  }
  assert.equal(app.send.mock.callCount(), cases.length);
  const logs = JSON.stringify(app.logs.mock.calls.map(item => item.arguments));
  assert.ok(!logs.includes(secret) && !logs.includes(question));
});

test('the shared request deadline cancels a slow model call without logging its input', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers();
  const app = setup(t, { provider: async (_url, { signal }) => {
    started.resolve(signal);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const pending = app.invoke();
  const signal = await started.promise;
  t.mock.timers.tick(12000);
  const result = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(result.status, 504);
  assert.equal(app.send.mock.callCount(), 1);
  assert.ok(!JSON.stringify(app.logs.mock.calls.map(call => call.arguments)).includes(question));
});
