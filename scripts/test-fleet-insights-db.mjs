import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

const require = createRequire(import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111';
const other = '11111111-1111-4111-8111-111111111112';
const fleet = '22222222-2222-4222-8222-222222222222';
const table = 'public.fleet_insight_summaries';
const claim = 'public.claim_fleet_insight_summary';
const finish = 'public.finish_fleet_insight_summary';

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await initializeTestSchema(db, { supabaseDefaults: true });
  await db.query('insert into auth.users(id) values ($1), ($2)', [owner, other]);
  await db.query('insert into public.fleets(id,owner_user_id,company_name) values ($1,$2,$3)', [fleet, owner, 'Fixture']);
  return db;
}

test('RLS, explicit privileges, cache constraints and owner checks survive legacy defaults', async t => {
  const db = await database(t);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const { rows: [access] } = await db.query(`select
      (select relrowsecurity from pg_class where oid=$1::regclass) as rls,
      has_table_privilege($2,$1,'SELECT') as read,
      has_table_privilege($2,$1,'INSERT') as insert,
      has_table_privilege($2,$1,'UPDATE') as update,
      has_function_privilege($2,$3,'EXECUTE') as claim,
      has_function_privilege($2,$4,'EXECUTE') as finish`, [
      table, role, claim + '(uuid,uuid,integer,text)', finish + '(uuid,uuid,integer,date,text,timestamptz,timestamptz)',
    ]);
    const allowed = role === 'service_role';
    assert.deepEqual(access, { rls: true, read: allowed, insert: allowed, update: allowed, claim: allowed, finish: allowed });
    if (!allowed) {
      await db.exec('set role ' + role);
      await assert.rejects(db.exec('select * from ' + table), /permission denied/);
      await db.exec('reset role');
    }
  }
  await db.exec('set role service_role');
  const reserve = (actor, days) => db.query(`select ${claim}($1,$2,$3,'fixture') as result`, [actor, fleet, days]);
  assert.equal((await reserve(other, 7)).rows[0].result, null);
  await assert.rejects(reserve(owner, 8), /check constraint/);
  const reserved = (await reserve(owner, 7)).rows[0].result;
  const complete = (actor, message) => db.query(`select ${finish}($1,$2,7,$3,$4,$5,$6) as result`,
    [actor, fleet, reserved.report_day, message, reserved.report.window_start, reserved.report.window_end]);
  assert.equal((await complete(other, 'foreign')).rows[0].result, null);
  for (const invalid of ['', ' ', 'a'.repeat(1201)]) await assert.rejects(complete(owner, invalid), /check constraint/);
  assert.equal((await complete(owner, 'first')).rows[0].result.summary, 'first');
  assert.equal((await complete(owner, 'overwrite')).rows[0].result, null);
  assert.equal((await reserve(other, 7)).rows[0].result, null);
  // Even an accidental SELECT grant cannot bypass the table's row policy.
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await db.exec('grant select on ' + table + ' to ' + role + '; set role ' + role);
    assert.deepEqual((await db.query('select * from ' + table)).rows, []);
    await db.exec('reset role');
  }
});

test('overlapping route requests reserve once, reuse the stored report, and isolate fleets, periods and UTC days', async t => {
  const db = await database(t);
  await db.exec('set role service_role');
  const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    OCCULERT_FLEET_INSIGHTS_ENABLED: '1', ANTHROPIC_API_KEY: 'fixture-provider-key', OCCULERT_INSIGHTS_MODEL: 'fixture-v1' };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }

  const paidAccess = require('../api/_lib/fleet-paid-access');
  t.mock.method(paidAccess, 'paidAccessConfig', () => ({ prices: ['fixture'] }));
  t.mock.method(paidAccess, 'hasPaidFleetAccess', async identity => identity.actorId === owner);
  const transport = require('../api/_lib/supabase');
  t.mock.method(transport, 'verifyAccessToken', async token => ({ id: token === 'owner' ? owner : other }));
  t.mock.method(transport, 'pgFetch', async (path, options) => {
    if (path === 'fleets') {
      return (await db.query('select id, company_name from public.fleets where owner_user_id=$1', [
        options.params.owner_user_id.slice(3),
      ])).rows;
    }
    const b = options.body;
    const args = [b.p_actor_id, b.p_fleet_id, b.p_days];
    if (path === 'rpc/claim_fleet_insight_summary') {
      return (await db.query(`select ${claim}($1,$2,$3,$4) as value`, [...args, b.p_model])).rows[0].value;
    }
    assert.equal(path, 'rpc/finish_fleet_insight_summary');
    return (await db.query(`select ${finish}($1,$2,$3,$4,$5,$6,$7) as value`, [
      ...args, b.p_report_day, b.p_summary, b.p_window_start, b.p_window_end,
    ])).rows[0].value;
  });
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const provider = t.mock.method(globalThis, 'fetch', async () => {
    started.resolve();
    await release.promise;
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Saved report.' }] });
  });
  const handler = require('../api/_lib/routes/fleet-insights');
  async function invoke(days, token = 'owner') {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(raw) { this.body = JSON.parse(raw); } };
    await handler({ method: 'GET', url: '/api/fleet-insights?days=' + days, headers: { authorization: 'Bearer ' + token } }, response);
    return response;
  }
  const first = invoke(7);
  try {
    await Promise.race([started.promise, first.then(() => { throw new Error('generation did not start'); })]);
    const concurrent = await invoke(7);
    assert.equal(concurrent.statusCode, 202);
    assert.equal(concurrent.headers['Retry-After'], '2');
    assert.equal(provider.mock.callCount(), 1);
  } finally { release.resolve(); }
  const original = await first;
  assert.equal(original.statusCode, 200);
  assert.equal(original.body.summary, 'Saved report.');
  assert.equal((await db.query('select count(*)::int as n from ' + table)).rows[0].n, 1);
  process.env.OCCULERT_INSIGHTS_MODEL = 'fixture-v2';
  assert.deepEqual((await invoke(7)).body, original.body);
  assert.equal((await invoke(7, 'other')).statusCode, 403);
  assert.equal(provider.mock.callCount(), 1);
  const monthly = await invoke(30);
  assert.equal(monthly.statusCode, 200);
  assert.equal(monthly.body.model, 'fixture-v2');
  assert.equal(provider.mock.callCount(), 2);

  // An earlier UTC day's row remains historical and does not satisfy today's lookup.
  await db.exec(`update ${table} set report_day=report_day-1, window_start=window_start-interval '24 hours',
    window_end=window_end-interval '24 hours' where days=7`);
  provider.mock.mockImplementationOnce(async () => { throw new Error('fixture outage'); });
  assert.equal((await invoke(7)).statusCode, 502);
  assert.equal((await invoke(7)).statusCode, 502);
  assert.equal(provider.mock.callCount(), 3);
  assert.equal((await db.query('select count(*)::int as n from ' + table)).rows[0].n, 3);
});
