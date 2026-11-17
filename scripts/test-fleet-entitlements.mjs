import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { fleetDashboardContract, fleetDashboardRuntime } from './lib/fleet-dashboard-source.mjs';

const require = createRequire(import.meta.url);
const {
  PLAN_LIMITS, enforcementEnabled, planFromBilling, entitlementSummary, testBillingState, entitlementCheckPasses,
} = require('../api/_lib/fleet-entitlements');
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const OWNER = '11111111-1111-4111-8111-111111111111';
const FLEET = '22222222-2222-4222-8222-222222222222';
const OTHER = '99999999-9999-4999-8999-999999999999';
const plans = [{ plan: 'trial', active_drivers: 5 }, { plan: 'starter', active_drivers: 10 }, { plan: 'growth', active_drivers: 30 }];
const monthly = (active_drivers, month = '2026-11') => ({
  version: 1, definition: 'completed_session_v1', timezone: 'America/Los_Angeles', month,
  as_of: '2026-11-07T14:00:00Z', active_drivers,
});
const trialSummary = {
  version: 1, test_mode: true, enforced: false, plan: 'trial', plan_source: 'no_subscription',
  subscription_status: 'none', limit: { active_drivers: 5 }, usage: { active_drivers: 3, month: '2026-11' },
  within_limit: true, plans,
};
const migrationStatuses = () => {
  const sql = read('supabase/migrations/20260927030000_stripe_test_billing.sql');
  const check = sql.match(/status text not null default 'none' check \(status in \(([^)]+)\)\)/);
  assert.ok(check, 'the billing migration must still declare its status list');
  return [...check[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
};

test('server limits are the proposals published on the pricing page', () => {
  const page = read('fleet-pricing.html');
  const row = page.match(/<th scope="row">Active drivers<\/th><td>Up to (\d+)<\/td><td>Up to (\d+)<\/td><td>Up to (\d+)<\/td>/);
  assert.ok(row, 'the plan comparison must still publish one active-driver limit per plan');
  assert.deepEqual(row.slice(1).map(Number), ['trial', 'starter', 'growth'].map(plan => PLAN_LIMITS[plan].active_drivers));
  for (const [title, plan] of [['Starter', 'starter'], ['Growth', 'growth']]) {
    const card = page.match(new RegExp(`<h3>${title}</h3>[\\s\\S]*?Proposed limit: (\\d+) active drivers`));
    assert.equal(Number(card?.[1]), PLAN_LIMITS[plan].active_drivers, title);
  }
  // The page promises that limits are not enforced; the summary must agree by default.
  assert.match(page, /does not currently enforce paid plan limits/);
  assert.equal(entitlementSummary(null, null, { enforced: undefined }).enforced, false);
});

test('a plan comes only from an understood billing row', () => {
  assert.deepEqual(planFromBilling(null), { plan: 'trial', plan_source: 'no_subscription', subscription_status: 'none' });
  for (const [plan, status] of [['starter', 'active'], ['growth', 'trialing'], ['starter', 'past_due'], ['growth', 'active']]) {
    assert.deepEqual(planFromBilling({ plan, status }), { plan, plan_source: 'test_subscription', subscription_status: status });
  }
  // An ended, unpaid, paused or never-started subscription is back on trial terms.
  for (const status of ['none', 'incomplete', 'incomplete_expired', 'unpaid', 'canceled', 'paused']) {
    for (const plan of ['starter', 'growth', null]) {
      assert.deepEqual(planFromBilling({ plan, status }), { plan: 'trial', plan_source: 'no_subscription', subscription_status: status });
    }
  }
  // Every status the table accepts is understood, so a schema change cannot be guessed at silently.
  for (const status of migrationStatuses()) assert.notEqual(planFromBilling({ plan: 'starter', status }), null, status);
  for (const value of [undefined, [], 'starter', 7, { plan: 'enterprise', status: 'active' }, { plan: 'starter', status: 'live' },
    { plan: 'starter' }, { status: 'active' }, { plan: null, status: 'active' }, { plan: null, status: 'past_due' },
    { plan: ['starter'], status: 'active' }, { plan: 'starter', status: ['active'] }]) {
    assert.equal(planFromBilling(value), null, JSON.stringify(value));
    assert.equal(entitlementSummary(value, monthly(3)), null, JSON.stringify(value));
  }
});

test('the summary compares server usage with the plan limit and never guesses unknown usage', () => {
  assert.deepEqual(entitlementSummary(null, monthly(3)), trialSummary);
  assert.deepEqual(entitlementSummary({ plan: 'starter', status: 'active' }, monthly(12)), {
    ...trialSummary, plan: 'starter', plan_source: 'test_subscription', subscription_status: 'active',
    limit: { active_drivers: 10 }, usage: { active_drivers: 12, month: '2026-11' }, within_limit: false,
  });
  for (const [billing, count, within] of [[null, 5, true], [null, 6, false], [null, 0, true],
    [{ plan: 'starter', status: 'trialing' }, 10, true], [{ plan: 'starter', status: 'trialing' }, 11, false],
    [{ plan: 'growth', status: 'active' }, 30, true], [{ plan: 'growth', status: 'active' }, 31, false],
    // A canceled Starter fleet is measured against trial terms again.
    [{ plan: 'starter', status: 'canceled' }, 6, false]]) {
    assert.equal(entitlementSummary(billing, monthly(count)).within_limit, within, `${JSON.stringify(billing)} ${count}`);
  }
  for (const unknown of [null, undefined, {}, { active_drivers: -1, month: '2026-11' }, { active_drivers: 1.5, month: '2026-11' },
    { active_drivers: '3', month: '2026-11' }, { active_drivers: 3 }]) {
    const summary = entitlementSummary(null, unknown);
    assert.equal(summary.usage, null);
    assert.equal(summary.within_limit, null, 'unknown usage is neither within nor over the limit');
  }
  // Only plan and status are ever read from the row; nothing else can leak into the response.
  const leaked = JSON.stringify(entitlementSummary({ plan: 'growth', status: 'active', stripe_customer_id: 'cus_private',
    stripe_subscription_id: 'sub_private', checkout_session_url: 'https://checkout.stripe.com/private' }, monthly(1)));
  assert.doesNotMatch(leaked, /cus_|sub_|stripe|checkout/);
  assert.deepEqual(entitlementSummary(null, null).plans, plans);
});

test('enforcement is off unless the flag is exactly true, and the check never fails on missing data', () => {
  assert.equal(enforcementEnabled({}), false);
  for (const value of ['', '1', 'TRUE', 'True', 'yes', 'enforce', ' true', 'true ']) {
    assert.equal(enforcementEnabled({ OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED: value }), false, JSON.stringify(value));
  }
  assert.equal(enforcementEnabled({ OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED: 'true' }), true);
  const over = (enforced) => entitlementSummary(null, monthly(9), { enforced });
  assert.equal(over(false).enforced, false);
  assert.equal(over(true).enforced, true);
  assert.equal(over('true').enforced, false, 'only a boolean true turns enforcement on');
  // Default: everything passes, including a fleet over its proposed limit.
  assert.equal(entitlementCheckPasses(over(false)), true);
  assert.equal(entitlementCheckPasses(over(true)), false);
  assert.equal(entitlementCheckPasses(entitlementSummary(null, monthly(5), { enforced: true })), true);
  // Unknown usage or an unavailable summary must never lock an owner out.
  assert.equal(entitlementCheckPasses(entitlementSummary(null, null, { enforced: true })), true);
  for (const missing of [null, undefined, {}]) assert.equal(entitlementCheckPasses(missing), true);
  const saved = process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED;
  try {
    delete process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED;
    assert.equal(entitlementSummary(null, monthly(9)).enforced, false);
    process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED = 'true';
    assert.equal(entitlementSummary(null, monthly(9)).enforced, true);
  } finally {
    if (saved === undefined) delete process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED;
    else process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED = saved;
  }
});

test('the billing read selects two columns for one server-owned fleet and separates a missing table from a failure', async () => {
  const calls = [];
  const reader = result => async (table, options) => {
    calls.push({ table, options });
    if (result instanceof Error || (result && result.details)) throw result;
    return result;
  };
  assert.equal(await testBillingState(reader([]), FLEET), null);
  assert.deepEqual(calls, [{ table: 'fleet_billing_test', options: { params: { select: 'plan,status', fleet_id: 'eq.' + FLEET, limit: '1' } } }]);
  assert.deepEqual(await testBillingState(reader([{ plan: 'starter', status: 'active', stripe_customer_id: 'cus_private' }]), FLEET),
    { plan: 'starter', status: 'active' });
  assert.deepEqual(await testBillingState(reader([{ status: 'none' }]), FLEET), { plan: null, status: 'none' });
  // No test-billing migration means no subscription can exist.
  for (const code of ['42P01', 'PGRST205']) assert.equal(await testBillingState(reader({ details: { code } }), FLEET), null, code);
  // Anything else is unknown, not "no subscription".
  for (const failure of [new Error('timeout'), { details: { code: 'PGRST301' } }, Object.assign(new Error('supabase_request_failed'), { provider: 'supabase', status: 503, details: {} })]) {
    await assert.rejects(testBillingState(reader(failure), FLEET));
  }
  for (const malformed of [null, {}, 'rows', [null], ['starter'], [7]]) {
    await assert.rejects(testBillingState(reader(malformed), FLEET), /invalid_billing_state/, JSON.stringify(malformed));
  }
});

test('the real billing table serves the read to the service role only, for every stored state', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.fleets(id uuid primary key, owner_user_id uuid not null);
      grant usage on schema public to anon, authenticated, service_role;
      grant select on public.fleets to service_role;
      insert into public.fleets values ('${FLEET}', '${OWNER}'), ('${OTHER}', '${OTHER}');`);
    await db.exec(read('supabase/migrations/20260927030000_stripe_test_billing.sql'));
    for (const role of ['anon', 'authenticated']) {
      const { rows: [privilege] } = await db.query(
        "select has_table_privilege($1, 'public.fleet_billing_test', 'SELECT') as allowed", [role]);
      assert.equal(privilege.allowed, false, role);
    }
    const stored = async () => {
      await db.exec('set role service_role');
      try {
        // The exact projection and filter PostgREST runs for the summary.
        const { rows } = await db.query('select plan, status from public.fleet_billing_test where fleet_id = $1 limit 1', [FLEET]);
        return rows;
      } finally { await db.exec('reset role'); }
    };
    const state = async () => testBillingState(async () => stored(), FLEET);
    assert.equal(await state(), null);
    assert.deepEqual(entitlementSummary(await state(), monthly(3)), trialSummary);
    await db.query("insert into public.fleet_billing_test(fleet_id, stripe_customer_id) values ($1, 'cus_FixtureOwner'), ($2, 'cus_OtherFleet')", [FLEET, OTHER]);
    await db.query("update public.fleet_billing_test set plan = 'growth', status = 'active' where fleet_id = $1", [OTHER]);
    // A registered customer with no subscription yet is still on trial terms, and
    // another fleet's Growth subscription never reaches this fleet's summary.
    assert.deepEqual(await state(), { plan: null, status: 'none' });
    assert.equal(entitlementSummary(await state(), monthly(3)).plan, 'trial');
    for (const status of migrationStatuses()) {
      await db.query("update public.fleet_billing_test set plan = 'starter', status = $2 where fleet_id = $1", [FLEET, status]);
      const summary = entitlementSummary(await state(), monthly(7));
      const subscribed = ['trialing', 'active', 'past_due'].includes(status);
      assert.equal(summary.plan, subscribed ? 'starter' : 'trial', status);
      assert.equal(summary.subscription_status, status);
      assert.equal(summary.within_limit, subscribed, status);
    }
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select plan, status from public.fleet_billing_test'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('fleet summary derives the plan from the verified owner and stays available when billing is not', async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const libPath = require.resolve('../api/_lib/supabase');
  const handlerPath = require.resolve('../api/fleet-summary');
  const original = require.cache[libPath];
  const savedFlag = process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED;
  const run = async ({ billing, activity = monthly(12), flag }) => {
    const calls = [];
    require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
      bearerToken: () => 'fixture', verifyAccessToken: async () => ({ id: OWNER }),
      pgFetch: async (table, options) => {
        calls.push({ table, options });
        if (table === 'fleets') return [{ id: FLEET, company_name: 'Fixture', plan: 'growth' }];
        if (table === 'drivers') return [{ id: 'driver-1', name: 'Driver', active: true }];
        if (table === 'sessions') return [];
        if (table === 'rpc/fleet_monthly_activity') { if (activity instanceof Error) throw activity; return activity; }
        if (table === 'fleet_billing_test') { if (!Array.isArray(billing)) throw billing; return billing; }
        throw new Error('Unexpected query');
      },
    } };
    delete require.cache[handlerPath];
    if (flag === undefined) delete process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED;
    else process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED = flag;
    const response = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    // Every client-controlled place a plan or fleet could be claimed is ignored.
    await require(handlerPath)({ method: 'GET', url: `/api/fleet-summary?fleet_id=${OTHER}&plan=growth&enforced=false`,
      query: { fleet_id: OTHER, plan: 'growth' }, body: { plan: 'growth', entitlements: { plan: 'growth' } },
      headers: { authorization: 'Bearer fixture', 'x-occulert-plan': 'growth' } }, response);
    return { response, calls };
  };
  try {
    const active = await run({ billing: [{ plan: 'starter', status: 'active', stripe_customer_id: 'cus_private' }] });
    assert.equal(active.response.statusCode, 200);
    assert.deepEqual(active.response.body.entitlements, { ...trialSummary, plan: 'starter', plan_source: 'test_subscription',
      subscription_status: 'active', limit: { active_drivers: 10 }, usage: { active_drivers: 12, month: '2026-11' }, within_limit: false });
    assert.deepEqual(active.calls.find(call => call.table === 'fleet_billing_test').options,
      { params: { select: 'plan,status', fleet_id: 'eq.' + FLEET, limit: '1' } });
    assert.doesNotMatch(JSON.stringify(active.response.body), /cus_private/);
    // The legacy fleets.plan label is not a subscription and never selects limits.
    assert.equal(active.response.body.fleet.plan, 'growth');
    assert.deepEqual(active.calls.map(call => call.table), ['fleets', 'drivers', 'sessions', 'rpc/fleet_monthly_activity', 'fleet_billing_test']);

    const none = await run({ billing: [], activity: monthly(3) });
    assert.deepEqual(none.response.body.entitlements, trialSummary);
    const missingTable = await run({ billing: { details: { code: 'PGRST205' } }, activity: monthly(3) });
    assert.deepEqual(missingTable.response.body.entitlements, trialSummary);

    // A billing outage leaves the roster, activity and status intact and reports the plan as unavailable.
    for (const failure of [Object.assign(new Error('supabase_request_failed'), { provider: 'supabase', status: 503 }), new Error('timeout')]) {
      const outage = await run({ billing: failure });
      assert.equal(outage.response.statusCode, 200);
      assert.equal(outage.response.body.entitlements, null);
      assert.deepEqual(outage.response.body.monthly_activity, monthly(12));
      assert.equal(outage.response.body.drivers.length, 1);
    }
    const unknownRow = await run({ billing: [{ plan: 'enterprise', status: 'active' }] });
    assert.equal(unknownRow.response.body.entitlements, null);

    // An unavailable count is unknown usage, never zero and never over the limit.
    const noActivity = await run({ billing: [], activity: new Error('missing migration') });
    assert.equal(noActivity.response.body.monthly_activity, null);
    assert.deepEqual(noActivity.response.body.entitlements, { ...trialSummary, usage: null, within_limit: null });

    assert.equal((await run({ billing: [], flag: 'true' })).response.body.entitlements.enforced, true);
    assert.equal((await run({ billing: [], flag: '1' })).response.body.entitlements.enforced, false);
  } finally {
    if (original) require.cache[libPath] = original; else delete require.cache[libPath];
    delete require.cache[handlerPath];
    if (savedFlag === undefined) delete process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED;
    else process.env.OCCULERT_ENTITLEMENT_ENFORCEMENT_ENABLED = savedFlag;
  }
});

test('no route refuses a request because of the plan check', () => {
  // Every API file, so a route added later is covered without editing this list.
  const files = readdirSync(new URL('../api/', import.meta.url), { recursive: true })
    .map(name => 'api/' + String(name).split('\\').join('/')).filter(name => name.endsWith('.js')).sort();
  for (const expected of ['api/sessions.js', 'api/events.js', 'api/profile.js', 'api/accept-invitation.js', 'api/[endpoint].js',
    'api/_lib/routes/fleet-session-history.js', 'api/_lib/routes/billing-status.js']) assert.ok(files.includes(expected), expected);
  const users = files.filter(name => /fleet-entitlements|entitlementCheckPasses|entitlementSummary|OCCULERT_ENTITLEMENT/.test(read(name)));
  assert.deepEqual(users, ['api/_lib/fleet-entitlements.js', 'api/fleet-summary.js']);
  const summary = read('api/fleet-summary.js');
  assert.doesNotMatch(summary, /entitlementCheckPasses|enforcementEnabled/);
  // The summary route only reports; its status never depends on the plan.
  assert.match(summary, /entitlements: entitlements,/);
  // The driver's own pages never receive or read a plan: monitoring and alerts cannot depend on one.
  const browserSources = readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js')).sort();
  assert.ok(browserSources.includes('driver-app.js') && browserSources.includes('alerts.js') && browserSources.includes('detector.js'));
  assert.deepEqual(browserSources.filter(name => /entitlements|planUsage/i.test(read('src/' + name))), ['fleet-dashboard.js']);
});

function dashboardBlock() {
  const source = fleetDashboardRuntime();
  const start = source.indexOf('/* fleet-plan-usage:start */'), end = source.indexOf('/* fleet-plan-usage:end */');
  assert.ok(start >= 0 && end > start, 'the released dashboard must contain the plan usage block');
  return source.slice(start, end);
}

test('the dashboard shows only a valid server summary and treats anything else as unavailable', () => {
  const elements = Object.fromEntries(['planUsage', 'planUsageSummary', 'planUsageNote'].map(id => [id, { id, hidden: true, innerHTML: '', textContent: '' }]));
  const context = { document: { getElementById: id => elements[id] || null },
    rowHtml: (label, value, kind = '') => `[${label}|${value}|${kind}]` };
  vm.runInNewContext(`let fleetMode=false,protectedRefreshFailures=0,protectedFleetId='';${dashboardBlock()}
    globalThis.api={planUsageView,renderPlanUsage,set(next){({fleetMode=fleetMode,protectedRefreshFailures=protectedRefreshFailures,protectedFleetId=protectedFleetId}=next);if('entitlements' in next)protectedEntitlements=next.entitlements}};`, context);
  const { planUsageView, renderPlanUsage, set } = context.api;
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(planUsageView(trialSummary)), { enforced: false, plan: 'Free trial · no subscription',
    usage: '3 of 5 · 2026-11 (Pacific time)', over: 0, limits: 'Free trial 5 · Starter 10 · Growth 30' });
  const over = entitlementSummary({ plan: 'starter', status: 'past_due' }, monthly(12));
  assert.deepEqual(plain(planUsageView(over)), { enforced: false, plan: 'Starter · test subscription (past due)',
    usage: '12 of 10 · 2026-11 (Pacific time)', over: 2, limits: 'Free trial 5 · Starter 10 · Growth 30' });
  assert.equal(planUsageView(entitlementSummary({ plan: 'starter', status: 'canceled' }, null)).plan, 'Free trial · no active subscription (canceled)');
  assert.equal(planUsageView(entitlementSummary(null, null)).usage, 'Unavailable · proposed limit 5');
  // Every server summary the API can produce is displayable.
  for (const status of migrationStatuses()) for (const plan of ['starter', 'growth']) for (const count of [null, 0, 5, 6, 10, 11, 30, 31]) {
    const summary = entitlementSummary({ plan, status }, count === null ? null : monthly(count));
    assert.notEqual(planUsageView(summary), null, `${plan} ${status} ${count}`);
  }
  // A changed, partial, contradictory or hostile summary is never shown as a plan.
  const invalid = [null, undefined, 'trial', [], {}, { ...trialSummary, version: 2 }, { ...trialSummary, test_mode: false },
    { ...trialSummary, enforced: 'false' }, { ...trialSummary, plan: 'enterprise' }, { ...trialSummary, plan: 'constructor' },
    { ...trialSummary, limit: { active_drivers: 0 } }, { ...trialSummary, limit: { active_drivers: '5' } }, { ...trialSummary, limit: null },
    { ...trialSummary, limit: { active_drivers: 10 } }, { ...trialSummary, plans: plans.slice(0, 2) }, { ...trialSummary, plans: [...plans].reverse() },
    { ...trialSummary, plans: plans.map(entry => ({ ...entry, active_drivers: -1 })) }, { ...trialSummary, plans: null },
    { ...trialSummary, usage: { active_drivers: -1, month: '2026-11' } }, { ...trialSummary, usage: { active_drivers: 3, month: '2026-13' } },
    { ...trialSummary, usage: { active_drivers: 3, month: '<b>2026-11</b>' } }, { ...trialSummary, usage: 3 }, { ...trialSummary, usage: undefined },
    { ...trialSummary, within_limit: false }, { ...trialSummary, within_limit: null }, { ...trialSummary, usage: null, within_limit: true },
    { ...trialSummary, plan_source: 'test_subscription' }, { ...trialSummary, plan: 'starter', limit: { active_drivers: 10 } },
    { ...trialSummary, subscription_status: '<img src=x onerror=alert(1)>' }, { ...trialSummary, subscription_status: '' },
    { ...trialSummary, subscription_status: null }];
  for (const value of invalid) assert.equal(planUsageView(value), null, JSON.stringify(value));

  // Signed out: hidden. Signed in without a loaded fleet (no owned fleet, a failed
  // first load, an account switch in progress): hidden, because there is no plan to report.
  set({ entitlements: trialSummary }); renderPlanUsage();
  assert.equal(elements.planUsage.hidden, true);
  set({ fleetMode: true }); renderPlanUsage();
  assert.equal(elements.planUsage.hidden, true);
  // Signed in with a loaded fleet: the validated summary, or an explicit unavailable state.
  set({ protectedFleetId: FLEET }); renderPlanUsage();
  assert.equal(elements.planUsage.hidden, false);
  assert.equal(elements.planUsageSummary.innerHTML,
    '[Current plan|Free trial · no subscription|][Monthly active drivers|3 of 5 · 2026-11 (Pacific time)|][Proposed limits|Free trial 5 · Starter 10 · Growth 30 monthly active drivers|]');
  assert.equal(elements.planUsageNote.textContent,
    'Test mode: these limits are proposals and are not enforced. Nothing is blocked. Driver safety alerts are never limited by a plan.');
  set({ entitlements: over, protectedRefreshFailures: 2 }); renderPlanUsage();
  assert.equal(elements.planUsageSummary.innerHTML,
    '[Current plan|Starter · test subscription (past due)|][Monthly active drivers|12 of 10 · 2026-11 (Pacific time)|yellow][Over the proposed limit|2 drivers|yellow][Proposed limits|Free trial 5 · Starter 10 · Growth 30 monthly active drivers|]');
  assert.match(elements.planUsageNote.textContent, /not enforced\. Nothing is blocked\..* Refresh unavailable; showing the last loaded plan details\.$/);
  set({ entitlements: entitlementSummary(null, monthly(6)), protectedRefreshFailures: 0 }); renderPlanUsage();
  assert.match(elements.planUsageSummary.innerHTML, /\[Over the proposed limit\|1 driver\|yellow\]/);
  // With the server flag on, the page must not claim that nothing is blocked.
  set({ entitlements: entitlementSummary(null, monthly(6), { enforced: true }) }); renderPlanUsage();
  assert.equal(elements.planUsageNote.textContent,
    'Test mode: the server is checking these proposed limits. Driver safety alerts are never limited by a plan.');
  for (const value of [null, { ...trialSummary, plan: 'enterprise' }]) {
    set({ entitlements: value }); renderPlanUsage();
    assert.equal(elements.planUsageSummary.innerHTML, '[Plan details|Unavailable|]');
    assert.equal(elements.planUsageNote.textContent,
      'Plan details are unavailable right now. Use Refresh now to retry. Driver safety alerts are never limited by a plan.');
  }
  set({ protectedFleetId: '' }); renderPlanUsage();
  assert.equal(elements.planUsage.hidden, true);
  set({ fleetMode: false, protectedFleetId: FLEET }); renderPlanUsage();
  assert.equal(elements.planUsage.hidden, true);
});

test('the dashboard takes the plan from the summary response only and clears it with the account', () => {
  const contract = fleetDashboardContract(), runtime = fleetDashboardRuntime();
  assert.match(contract, /<section class="card" id="planUsage" aria-labelledby="planUsageTitle" hidden>/);
  assert.match(contract, /<h2 id="planUsageTitle">Plan and usage \(test mode\)<\/h2><a class="btn" href="\/fleet-pricing\.html">View proposed plans<\/a>/);
  assert.match(contract, /<div class="ops-list" id="planUsageSummary"><\/div>\s*<p class="sub" id="planUsageNote"><\/p>/);
  assert.match(contract, /#planUsage\[hidden\]\{display:none\}/);
  // One assignment from the server response, one reset; never browser storage or a request field.
  assert.deepEqual(runtime.match(/protectedEntitlements=[^=;,)]+/g),
    ['protectedEntitlements=null', 'protectedEntitlements=null', 'protectedEntitlements=result.body.entitlements||null']);
  assert.match(runtime, /function clearProtectedFleetCache\(\)\{resetDriverDetail\(\);protectedMonthlyActivity=null;protectedEntitlements=null;/);
  assert.match(runtime, /function renderOps\(rows\)\{renderMonthlyActivity\(\);renderPlanUsage\(\);/);
  assert.doesNotMatch(dashboardBlock(), /localStorage|sessionStorage|fetch\(|OcculertBackend/);
  // The released page loads the runtime that contains the panel logic.
  assert.equal(runtime, read(JSON.parse(read('asset-versions.json'))['fleet-dashboard.js']));
  assert.equal(runtime.trimEnd(), read('src/fleet-dashboard.js').trimEnd());
});
