import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

test('monthly allowance resets in UTC and shares one atomic admission with the hourly limit', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await initializeTestSchema(db, { supabaseDefaults: true });
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const fleet = '33333333-3333-4333-8333-333333333333';
  await db.query('insert into auth.users (id) values ($1), ($2)', [owner, other]);
  await db.query("insert into public.fleets (id, owner_user_id, company_name) values ($1,$2,'Fixture')", [fleet, owner]);
  const reserve = async actor => (await db.query('select public.reserve_fleet_question($1,$2) as r', [actor, fleet])).rows[0].r;
  const count = async sql => (await db.query(sql)).rows[0].n;
  const monthly = () => count('select attempts as n from public.fleet_question_monthly_usage');
  const hourly = () => count("select write_count as n from public.account_write_rate_limits where operation='fleet_ask'");
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(reserve(owner), /permission denied/);
    await assert.rejects(db.exec('select * from public.fleet_question_monthly_usage'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec("set time zone 'Pacific/Kiritimati'; set role service_role");
  assert.equal((await reserve(other)).error, 'fleet_not_found');
  assert.equal((await db.query('select * from public.fleet_question_monthly_usage')).rows.length, 0);
  for (let n = 1; n <= 20; n++) assert.equal((await reserve(owner)).monthly_remaining, 50 - n);
  assert.equal((await reserve(owner)).error, 'account_write_rate_limited');
  assert.equal(await monthly(), 20);
  await db.exec('reset role');
  await db.exec("update public.account_write_rate_limits set window_started_at = now() - interval '2 hours'; update public.fleet_question_monthly_usage set attempts=49");
  assert.equal((await reserve(owner)).monthly_remaining, 0);
  const denied = await reserve(owner);
  assert.equal(denied.error, 'fleet_question_monthly_limit');
  assert.ok(denied.retry_after > 0 && denied.retry_after <= 31 * 86400);
  assert.equal(await monthly(), 50);
  assert.equal(await hourly(), 1);
  // Transfer of fleet ownership preserves its monthly usage.
  await db.query('update public.fleets set owner_user_id=$1 where id=$2', [other, fleet]);
  assert.equal((await reserve(owner)).error, 'fleet_not_found');
  assert.equal((await reserve(other)).error, 'fleet_question_monthly_limit');
  await db.exec("update public.fleet_question_monthly_usage set month_start=(month_start - interval '1 month')::date");
  assert.equal((await reserve(other)).monthly_remaining, 49);
  assert.equal(await monthly(), 1);
  assert.equal(await count("select count(*)::int as n from public.fleet_question_monthly_usage where month_start=date_trunc('month',now() at time zone 'UTC')::date"), 1);
  await db.query('delete from public.fleets where id=$1', [fleet]);
  assert.equal(await count('select count(*)::int as n from public.fleet_question_monthly_usage'), 0);
});
