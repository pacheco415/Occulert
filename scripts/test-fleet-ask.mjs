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
    current_period_start: now - 60, current_period_end: now + 600,
    items: { has_more: false, data: [{ price: { ...price }, quantity: 1 }] },
    latest_invoice: { object: 'invoice', livemode: true, customer: 'cus_Fixture', subscription: 'sub_Fixture',
      status: 'paid', amount_paid: 1000, lines: { data: [{ type: 'subscription', subscription: 'sub_Fixture', price, amount: 1000,
        period: { start: now - 60, end: now + 600 } }] },
      charge: { object: 'charge', livemode: true, customer: 'cus_Fixture', status: 'succeeded', paid: true,
        captured: true, amount_captured: 1000, amount_refunded: 0, refunded: false, disputed: false } } };
}

function setup(t, { pilotGrant = null, pilotFlag = '', companyName = 'Private Transit', roster = [{ id: driverId, name: 'María O’Brien', vehicle_id: 'Van-K4' }], activeTestSubscription = false, testOwner = ownerId, cacheEnabled = false, releaseFails = false, owned = true, allowed = true, quotaError = 'account_write_rate_limited', remaining = 49, subscription = paidSubscription, results = 1,
  provider = async () => providerReply('Three sessions need review.') } = {}) {
  // A question spends quota and a model call, so only a fresh Supabase Auth check
  // (which rejects signed-out sessions) may authorize it; a cached JWT check may not.
  t.mock.method(transport, 'verifyAccessToken', async (token, options) =>
    token === 'owner' && options?.freshUser === true && options.cachedIdentity !== true ? { id: ownerId } : null);
  let cache;
  const db = t.mock.method(transport, 'pgFetch', async (path, { params, body, mergeDuplicates }) => {
    if (path === 'rpc/fleet_active_pilot') {
      assert.deepEqual(body, { p_actor_id: ownerId, p_fleet_id: fleetId });
      return pilotGrant;
    }
    if (path === 'fleet_billing_test') {
      assert.equal(params.fleet_id, 'eq.' + fleetId);
      assert.equal(params.status, 'eq.active');
      assert.equal(params.owner_user_id, 'eq.' + ownerId);
      return activeTestSubscription ? [{ fleet_id: fleetId, owner_user_id: testOwner, status: 'active', stripe_subscription_id: 'sub_Test' }] : [];
    }
    if (path === 'fleet_paid_access_cache') {
      if (!body) return cacheEnabled && cache && params.policy_tag === 'eq.' + cache.policy_tag ? [cache] : [];
      assert.equal(mergeDuplicates, true);
      assert.equal(body.fleet_id, fleetId);
      assert.equal(body.owner_id, ownerId);
      cache = body; return [body];
    }
    if (path === 'fleets') {
      assert.equal(params.owner_user_id, 'eq.' + ownerId);
      return owned ? [{ id: fleetId, company_name: companyName }] : [];
    }
    if (path === 'drivers') {
      assert.equal(params.fleet_id, 'eq.' + fleetId);
      assert.equal(params.select, 'id,name,vehicle_id');
      assert.equal(params.limit, '1000');
      const rest = params.id ? roster.filter(driver => driver.id > params.id.slice(3)) : roster;
      return { rows: rest.slice(0, 1000), total: rest.length };
    }
    if (path === 'rpc/release_fleet_question') {
      assert.deepEqual(body, { p_actor_id: ownerId, p_fleet_id: fleetId, p_month_start: '2026-11-01' });
      if (releaseFails) throw new Error('release unavailable');
      return remaining + 1;
    }
    if (path === 'rpc/reserve_fleet_question' || path === 'rpc/reserve_fleet_pilot_question') {
      assert.deepEqual(body, { p_actor_id: ownerId, p_fleet_id: fleetId });
      return { user_id: ownerId, fleet_id: fleetId, allowed,
        ...(allowed ? { monthly_remaining: remaining, month_start: '2026-11-01' } : { error: quotaError, retry_after: quotaError === 'fleet_question_monthly_limit' ? 86400 : 32 }) };
    }
    const days = body.p_days;
    assert.deepEqual(body, { p_days: days, p_actor_id: ownerId, p_fleet_id: fleetId });
    const period = { version: 1, days, window_start: start(days), window_end: end };
    if (path === 'rpc/fleet_time_of_day_report') return { ...period, timezone: 'America/Los_Angeles', blocks };
    assert.equal(path, 'rpc/fleet_period_report');
    return { ...period, ...counts, complete_period: true, monitored_hours: 2, alerts_per_monitored_hour: 1.5, average_safety_score: null,
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
    OCCULERT_FLEET_PILOT_ENTITLEMENTS: pilotFlag, STRIPE_FLEET_ACCESS_READ_KEY: readKey, OCCULERT_FLEET_ASK_PRICE_IDS: 'price_Start,price_Growth' })) {
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
    'Try (415) 555-0100', 'Check Van-K4', 'Look at ' + driverId, 'Look near 37.77, -122.42']) {
    const result = await app.invoke({ body: { question, days: 30 } });
    assert.equal(result.status, 400, question); assert.equal(result.body.error, 'question_has_personal_details');
  }
  assert.equal(app.send.mock.callCount(), 0);
  assert.ok(!app.db.mock.calls.some(call => call.arguments[0].includes('reserve')));
});

test('aggregate questions can mention dates, durations and ordinary roster words', async t => {
  const app = setup(t, { roster: [
    { id: driverId, name: 'Will Day', vehicle_id: '30' },
    { id: fleetId.replace('22222222', '44444444'), name: 'June', vehicle_id: '7' },
  ] });
  for (const question of ['How many alerts since 2026-11-01?', 'How did we do in the last 30 days?',
    'Which hour had the most alerts in the last 7 days?', 'What were alerts per day this month?',
    'Will alerts go down next month?', 'Since 11/01/2026?', 'Since 11-01-2026?', 'Since June 12, 2026?']) {
    assert.equal((await app.invoke({ body: { days: 30, question } })).status, 200, question);
  }
  for (const question of ['Check Will Day', 'Check truck 30', 'Check #7', 'Call 415-2026-11-01',
    'Since 2026-11-01, call 415-555-0100']) {
    assert.equal((await app.invoke({ body: { days: 30, question } })).body.error, 'question_has_personal_details', question);
  }
});

test('calendar ranges are allowed while spaced dial strings remain private', async t => {
  const app = setup(t);
  for (const question of ['How many alerts from 2026-11-01 - 2026-11-24?', 'Compare alerts in 2025 2026',
    'Compare 11-01-2026 and 11-24-2026', 'Compare 2026-11-01–2026-11-24',
    'Compare 2026-11-01-2026-11-24', 'Compare 2025-2026']) {
    assert.equal((await app.invoke({ body: { question, days: 30 } })).status, 200, question);
  }
  for (const question of ['Call 415 555 1234', 'Call 415 555 2026', 'Dial 2025 2026', 'Compare 2025 2026, call 415 555 1234',
    'Look at 2026-02-30 - 2026-03-01']) {
    assert.equal((await app.invoke({ body: { question, days: 30 } })).body.error, 'question_has_personal_details', question);
  }
  assert.equal(app.send.mock.callCount(), 6);
});

test('slightly long answers keep complete sentences and the counter', async t => {
  const app = setup(t);
  const warn = t.mock.method(console, 'warn', () => {});
  const sentence = 'The fleet logged 3.5 alerts per monitored hour.';
  const prefix = Array(12).fill(sentence).join(' ');
  app.send.mock.mockImplementationOnce(async () => providerReply(prefix + ' ' + 'Detail '.repeat(27) + 'continues.'));
  assert.equal((await app.invoke()).body.answer, prefix);
  assert.deepEqual(warn.mock.calls[0].arguments, ['fleet_ai_output_rejected', { feature: 'fleet_ask', reason: 'character_limit' }]);
  for (const rejected of ['Too short. ' + 'x'.repeat(700), prefix + ' ' + 'x'.repeat(700) + secret]) {
    app.send.mock.mockImplementationOnce(async () => providerReply(rejected));
    assert.equal((await app.invoke()).body.attempt_released, true);
  }
});

test('size rejections identify the feature and reason without logging content', async t => {
  const app = setup(t);
  const warn = t.mock.method(console, 'warn', () => {});
  for (const [reason, reply] of [
    ['character_limit', providerReply('x'.repeat(701))],
    ['max_tokens', Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'private reply' }] })],
  ]) {
    app.send.mock.mockImplementationOnce(async () => reply);
    assert.equal((await app.invoke()).body.attempt_released, true);
    assert.deepEqual(warn.mock.calls.at(-1).arguments, ['fleet_ai_output_rejected', { feature: 'fleet_ask', reason }]);
  }
  assert.equal(warn.mock.callCount(), 2);
});

for (const [name, question] of [
  ['Kevin Long', 'How long were sessions this week?'],
  ['Miles Davis', 'How many miles did the fleet cover?'],
  ['Miles Davis', 'How many miles have we logged?'],
  ['Tyler Best', 'What was the best time of day?'],
  ['Sam Most', 'When did we have the most alerts?'],
  ['Sam Most', 'When did most alerts occur?'],
  ['Grace Hall', 'What was the grace period?'],
]) test('ordinary words in aggregate questions with ' + name + ' on the roster', async t => {
  const app = setup(t, { roster: [{ id: driverId, name, vehicle_id: 'Van-7' }] });
  assert.equal((await app.invoke({ body: { days: 7, question } })).status, 200);
  for (const personal of [`How did ${name.toLowerCase()} do?`, `How many alerts did ${name.split(' ')[0]} have?`, 'Check Van-7']) {
    const reply = await app.invoke({ body: { days: 7, question: personal } });
    assert.equal(reply.body.error, 'question_has_personal_details', personal);
  }
  assert.equal(app.send.mock.callCount(), 1);
});

test('clear first names still stop individual questions', async t => {
  const app = setup(t, { roster: [{ id: driverId, name: 'Kevin Long' }] });
  assert.equal((await app.invoke({ body: { days: 7, question: 'How many alerts did Kevin have?' } })).body.error,
    'question_has_personal_details');
  assert.equal(app.send.mock.callCount(), 0);
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
  assert.equal(app.db.mock.calls.at(-1).arguments[0], 'rpc/reserve_fleet_question');
});

test('exhausted monthly allowance skips report reads and the model', async t => {
  const app = setup(t, { allowed: false, quotaError: 'fleet_question_monthly_limit' });
  const result = await app.invoke();
  assert.equal(result.status, 429);
  assert.equal(result.body.error, 'fleet_question_monthly_limit');
  assert.equal(result.headers['Retry-After'], '86400');
  assert.equal(app.send.mock.callCount(), 0);
  assert.equal(app.db.mock.calls.at(-1).arguments[0], 'rpc/reserve_fleet_question');
});

test('a malformed remaining count never authorizes a model call', async t => {
  const app = setup(t, { remaining: 50 });
  assert.equal((await app.invoke()).status, 502);
  assert.equal(app.send.mock.callCount(), 0);
});

for (const days of [7, 30]) test('allowlisted request and answer for ' + days + ' days', async t => {
  const app = setup(t);
  const result = await app.invoke({ body: { days, question: '  ' + question + '  ' } });
  assert.equal(result.status, 200);
  const { generated_at } = result.body;
  assert.equal(new Date(generated_at).toISOString(), generated_at);
  assert.deepEqual(result.body, { ok: true, answer: 'Three sessions need review.', model: 'fixture-model', days, monthly_remaining: 49,
    window_start: start(days), window_end: end, generated_at, ai_generated: true });
  const [url, options] = app.send.mock.calls[0].arguments;
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  const outbound = JSON.parse(options.body);
  assert.match(outbound.system, /under 600 characters/);
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
    [502, new Response('', { status: 529 })], [502, providerReply(secret)], [502, providerReply('')], [502, providerReply('x'.repeat(701))]];
  for (const [status, response] of cases) {
    app.send.mock.mockImplementationOnce(async () => response);
    const result = await app.invoke();
    assert.equal(result.status, status); assert.deepEqual(result.body, { ok: false, error: 'ask_unavailable', attempt_released: true, monthly_remaining: 50 });
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
  assert.equal(result.body.monthly_remaining, 50);
  assert.equal(result.status, 504);
  assert.equal(app.send.mock.callCount(), 1);
  assert.ok(!JSON.stringify(app.logs.mock.calls.map(call => call.arguments)).includes(question));
});

test('a failed credit keeps its original error and never promises a restored slot', async t => {
  const app = setup(t, { releaseFails: true, provider: async () => new Response('', { status: 504 }) });
  const result = await app.invoke();
  assert.equal(result.status, 504);
  assert.deepEqual(result.body, { ok: false, error: 'ask_unavailable' });
  assert.equal(app.db.mock.calls.filter(call => call.arguments[0] === 'rpc/release_fleet_question').length, 1);
});

test('cached paid and unpaid decisions expire and protect roster reads', async t => {
  for (const paid of [true, false]) await t.test(paid ? 'paid' : 'unpaid', async child => {
    child.mock.timers.enable({ apis: ['Date'] });
    const app = setup(child, { cacheEnabled: true, results: paid ? 1 : 0 });
    const status = paid ? 200 : 403;
    assert.equal((await app.invoke()).status, status);
    assert.equal((await app.invoke()).status, status);
    const searches = () => app.stripe.mock.calls.filter(call => call.arguments[0].pathname.endsWith('/search')).length;
    assert.equal(searches(), 1);
    child.mock.timers.tick(paid ? 299999 : 59999);
    assert.equal((await app.invoke()).status, status);
    assert.equal(searches(), 1);
    child.mock.timers.tick(1);
    assert.equal((await app.invoke()).status, status);
    assert.equal(searches(), 2);
    if (!paid) assert.ok(!app.db.mock.calls.some(call => call.arguments[0] === 'drivers'));
  });
});

test('positive cache ends with paid invoice coverage even inside the five-minute TTL', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 24) });
  const paid = paidSubscription();
  paid.latest_invoice.lines.data[0].period.end = Math.floor(Date.now() / 1000) + 30;
  const app = setup(t, { cacheEnabled: true, subscription: () => paid });
  assert.equal((await app.invoke()).status, 200);
  t.mock.timers.tick(29000);
  assert.equal((await app.invoke()).status, 200);
  t.mock.timers.tick(1000);
  assert.equal((await app.invoke()).status, 403);
  assert.equal(app.stripe.mock.calls.filter(call => call.arguments[0].pathname.endsWith('/search')).length, 2);
});

test('entitlement cache allows only server role access and cascades with its owners', async t => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { initializeTestSchema } = await import('./lib/test-schema.mjs');
  const db = new PGlite(); t.after(() => db.close());
  await initializeTestSchema(db, { supabaseDefaults: true });
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.fleet_paid_access_cache'::regclass")).rows[0].relrowsecurity, true);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const r = await db.query("select has_table_privilege($1,'public.fleet_paid_access_cache',$2) as allowed", [role, privilege]);
      assert.equal(r.rows[0].allowed, role === 'service_role');
    }
  }
  await db.query('insert into auth.users(id) values ($1)', [ownerId]);
  await db.query("insert into fleets(id,owner_user_id,company_name) values ($1,$2,'fixture')", [fleetId, ownerId]);
  await db.query("insert into fleet_paid_access_cache values ($1,$2,'fixture',true,now())", [fleetId, ownerId]);
  await db.query('delete from auth.users where id=$1', [ownerId]);
  assert.deepEqual((await db.query('select * from fleet_paid_access_cache')).rows, []);
});

test('only an explicitly enabled Vercel preview can use test billing for paid AI', async t => {
  for (const [deployment, flag, active, status] of [
    ['preview', '1', true, 200], ['preview', '1', false, 403], ['preview', '0', true, 501],
    ['production', '1', true, 501], ['development', '1', true, 501], ['', '1', true, 501],
  ]) await t.test([deployment, flag, active].join('/'), async child => {
    const previous = [process.env.VERCEL_ENV, process.env.OCCULERT_PREVIEW_TEST_ENTITLEMENT, process.env.OCCULERT_PREVIEW_FLEET_IDS];
    child.after(() => ['VERCEL_ENV','OCCULERT_PREVIEW_TEST_ENTITLEMENT', 'OCCULERT_PREVIEW_FLEET_IDS'].forEach((key,i) => {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }));
    process.env.OCCULERT_PREVIEW_FLEET_IDS = fleetId;
    process.env.VERCEL_ENV = deployment;
    process.env.OCCULERT_PREVIEW_TEST_ENTITLEMENT = flag;
    const app = setup(child, { activeTestSubscription: active });
    delete process.env.STRIPE_FLEET_ACCESS_READ_KEY;
    assert.equal((await app.invoke()).status, status);
    assert.equal(app.stripe.mock.callCount(), 0);
    const reads = app.db.mock.calls.map(call => call.arguments[0]);
    assert.equal(reads.includes('fleet_billing_test'), deployment === 'preview' && flag === '1');
    assert.ok(!reads.includes('fleet_paid_access_cache'));
  });
});

test('preview billing requires both an allowlisted fleet and its verified subscription owner', async t => {
  for (const [list, testOwner, status] of [
    ['', ownerId, 501], ['*', ownerId, 501], [fleetId + ',broken', ownerId, 501],
    [driverId, ownerId, 403], [fleetId, driverId, 403], [fleetId, null, 403],
    [driverId + ', ' + fleetId, ownerId, 200],
  ]) await t.test([list, testOwner, status].join('/'), async child => {
    const app = setup(child, { activeTestSubscription: true, testOwner });
    const settings = { VERCEL_ENV: 'preview', OCCULERT_PREVIEW_TEST_ENTITLEMENT: '1',
      OCCULERT_PREVIEW_FLEET_IDS: list, STRIPE_FLEET_ACCESS_READ_KEY: '' };
    for (const [key, value] of Object.entries(settings)) {
      const old = process.env[key];
      process.env[key] = value;
      child.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
    }
    assert.equal((await app.invoke()).status, status);
    if (status !== 200) assertNoPaidWork(app);
  });
});

test('production verifies live billing even when the preview flag and an active test row are present', async t => {
  const saved = [process.env.VERCEL_ENV, process.env.OCCULERT_PREVIEW_TEST_ENTITLEMENT, process.env.OCCULERT_PREVIEW_FLEET_IDS];
  t.after(() => ['VERCEL_ENV', 'OCCULERT_PREVIEW_TEST_ENTITLEMENT', 'OCCULERT_PREVIEW_FLEET_IDS'].forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
  }));
  process.env.OCCULERT_PREVIEW_FLEET_IDS = fleetId;
  process.env.VERCEL_ENV = 'production';
  process.env.OCCULERT_PREVIEW_TEST_ENTITLEMENT = '1';
  const app = setup(t, { activeTestSubscription: true, results: 0 });
  assert.equal((await app.invoke()).status, 403);
  assert.equal(app.stripe.mock.callCount(), 1);
  assert.ok(!app.db.mock.calls.some(call => call.arguments[0] === 'fleet_billing_test'));
});

test('preview entitlement announces itself at startup only when enabled on a preview', () => {
  const id = require.resolve('../api/_lib/fleet-paid-access');
  const saved = require.cache[id];
  const previous = [process.env.VERCEL_ENV, process.env.OCCULERT_PREVIEW_TEST_ENTITLEMENT, process.env.OCCULERT_PREVIEW_FLEET_IDS];
  const warnings = [];
  const original = console.warn;
  try {
    process.env.OCCULERT_PREVIEW_FLEET_IDS = fleetId;
    console.warn = message => warnings.push(message);
    for (const [environment, flag, count] of [['production', '1', 0], ['preview', '0', 0], ['preview', '1', 1]]) {
      process.env.VERCEL_ENV = environment;
      process.env.OCCULERT_PREVIEW_TEST_ENTITLEMENT = flag;
      delete require.cache[id];
      require(id);
      assert.equal(warnings.length, count);
    }
    assert.match(warnings[0], /preview test entitlement is enabled/i);
  } finally {
    console.warn = original;
    if (saved) require.cache[id] = saved;
    else delete require.cache[id];
    for (const [i, key] of ['VERCEL_ENV', 'OCCULERT_PREVIEW_TEST_ENTITLEMENT', 'OCCULERT_PREVIEW_FLEET_IDS'].entries()) {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }
  }
});
test('owner questions and privacy reasons against a fleet with word-like surnames', async t => {
  const names = ['Adam Driver', 'Jane Early', 'Tom Rest', 'Maria Shift', 'Sam Morning', 'Ann Weekend',
    'Lee Fleet', 'Kevin Long', 'Will Rich', 'June Day', 'Alex Price', 'Casey Young', 'Miles Davis'];
  const roster = names.map((name, i) => ({ name, id: driverId.slice(0, -3) + String(i).padStart(3, '0'), vehicle_id: 'Van-' + i }));
  const app = setup(t, { roster });
  const allowed = [
    'How many alerts per driver this week?', 'Are early morning alerts going up?', 'Are drivers taking rest breaks after alerts?',
    'Which shift has the most alerts?', 'Do we get more alerts in the morning?', 'Were there more alerts on the weekend?',
    'How is the fleet doing compared to last month?', 'How many sessions ended normally?', 'What is the average session length?',
    'Which time of day has the highest alert rate?', 'Did evening alerts increase?', 'What changed over the last week?',
    'How long were sessions this week?', 'How many miles did we cover?', 'Did the night shift log more sessions?',
    'Are there missing alert records?', 'What share of sessions has a score?', 'How many sessions need review?',
    'Were there alerts in the afternoon?', 'Which period had more completed sessions?', 'When was monitoring most consistent?',
    'Are there enough monitored hours to compare shifts?', 'How often were alerts recorded?', 'How many active drivers reported?',
    'What was the fleet average?', 'Are sessions ending early?', 'What was the trend in missing scores?',
    'How many shifts were monitored?', 'Are weekday sessions longer?', 'Is weekend coverage improving?',
    'How many drivers joined a session?', 'How many total hours did we monitor?', 'Did alerts decline in the last 30 days?',
    'Which day had the best coverage?', 'How many breaks were recorded?', 'Did any sessions have no end time?',
    'Which alerts are counted in this report?', 'How many reviewed followups were there?', 'How do these counts compare with last week?',
    'Were more sessions scored this month?', 'What share had an invalid end time?', 'What is missing from this report?',
    'How many alerts per monitored hour?', 'Does the fleet have enough data?', 'Which shifts have low coverage?',
    'What was the baseline last month?', 'How many alerts yesterday?', 'Was June a busy month?',
    'Will the report include late sessions?', 'Is the average weighted by hours?', 'How many short sessions were there?',
    'What is the price per fleet?', 'Do young drivers appear separately in these totals?', 'Is the dataset rich enough to compare shifts?',
    'Can we compare 7 and 30 days?', 'How did Private Transit do this week?', 'How did PRIVATE—TRANSIT do yesterday?',
    'How did Acme Logistics do this week?', 'What is the best time for rest?', 'Were drivers active on both weekend days?',
    'How much time did we monitor in the morning?', 'When did most drivers start a session?'
  ];
  const blocked = {
    driver_or_vehicle: ['How did Adam Driver do?', "What were Jane Early’s results?", 'How did Tom Rest do?',
      'Review Maria Shift', 'Show Sam Morning', 'How did Ann Weekend do?', 'Check Lee Fleet', 'How did Kevin Long do?',
      'How did Will Rich do?', 'Show June Day', 'Show Alex Price', 'Compare Casey Young and Miles Davis',
      'How many alerts did Kevin have?', 'Did Miles drive today?', "What are Driver’s totals?", "How was Early's week?",
      'How did Long perform?', 'Did Early finish the shift?', 'Show Tom', 'Check Ann', 'What did Rest report?', 'Did Shift log any alerts?', 'Did Day drive today?', 'Please review Van-0', 'Check van-12'],
    identifier: ['What happened on ' + driverId + '?', 'Look at ' + ownerId, 'Review ' + fleetId],
    contact: ['Email help@example.org', 'Can I call (415) 555-0123?', 'Contact 510 555 0199', 'Call 4155550100'],
    location: ['What happened near 37.77, -122.42?', 'Compare alerts at 40.1; -73.2', 'How about +37.5, -122.1?']
  };
  for (const question of allowed) {
    const result = await app.invoke({ body: { days: 7, question } });
    assert.equal(result.status, 200, question);
    const payload = JSON.parse(JSON.parse(app.send.mock.calls.at(-1).arguments[1].body).messages[0].content);
    if (/private. transit|private.transit/i.test(question)) assert.match(payload.question, /the fleet/);
    assert.doesNotMatch(payload.question, /private.transit/i);
  }
  for (const [reason, questions] of Object.entries(blocked)) {
    for (const question of questions) {
      const result = await app.invoke({ body: { days: 7, question } });
      assert.equal(result.status, 400, question);
      assert.deepEqual(result.body, { ok: false, error: 'question_has_personal_details', reason }, question);
    }
  }
  assert.equal(app.send.mock.callCount(), allowed.length);
});

test('company mentions are replaced before transmission and remaining driver references still block', async t => {
  const app = setup(t, { companyName: 'Acme Logistics' });
  const ask = question => app.invoke({ body: { days: 7, question } });
  assert.equal((await ask('How did Acme Logistics do this week?')).status, 200);
  const input = JSON.parse(JSON.parse(app.send.mock.calls[0].arguments[1].body).messages[0].content);
  assert.equal(input.question, 'How did the fleet do this week?');
  assert.equal((await ask('How did María do at Acme Logistics?')).body.reason, 'driver_or_vehicle');
  assert.equal(app.send.mock.callCount(), 1);
});

test('personal details beyond the first thousand roster entries still block disclosure', async t => {
  const roster = Array.from({ length: 1001 }, (_, i) => ({
    id: driverId.slice(0, -4) + String(i).padStart(4, '0'), name: i === 1000 ? 'Kevin Long' : 'Adam Driver'
  }));
  const app = setup(t, { roster });
  const reply = await app.invoke({ body: { days: 7, question: 'How many alerts did Kevin have?' } });
  assert.equal(reply.body.reason, 'driver_or_vehicle');
  assert.equal(app.db.mock.calls.filter(call => call.arguments[0] === 'drivers').length, 2);
  assert.equal(app.send.mock.callCount(), 0);
});

test('production pilot access precedes Stripe only for a current, enabled grant', async t => {
  for (const [label, flag, offset, expected, billingCalls] of [
    ['enabled', '1', 60000, 200, 0], ['expired', '1', -60000, 403, 1], ['flag off', '', 60000, 403, 1],
  ]) await t.test(label, async child => {
    const grant = { expires_at: new Date(Date.now() + offset).toISOString(), monthly_question_cap: 3 };
    const app = setup(child, { pilotFlag: flag, pilotGrant: grant, results: 0, remaining: 2 });
    if (label === 'enabled') delete process.env.STRIPE_FLEET_ACCESS_READ_KEY;
    const result = await app.invoke();
    assert.equal(result.status, expected);
    assert.equal(app.stripe.mock.callCount(), billingCalls);
    assert.equal(app.db.mock.calls.some(call => call.arguments[0] === 'rpc/reserve_fleet_pilot_question'), expected === 200);
    assert.equal(app.db.mock.calls.some(call => call.arguments[0] === 'rpc/fleet_active_pilot'), flag === '1');
    if (expected === 200) assert.equal(result.body.monthly_remaining, 2);
  });
});
