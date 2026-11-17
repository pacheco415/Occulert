import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const NO_PROFILE = '55555555-5555-4555-8555-555555555555';
const FLEET = '61111111-1111-4111-8111-111111111111';
const OTHER_FLEET = '62222222-2222-4222-8222-222222222222';
const DRIVER = '71111111-1111-4111-8111-111111111111';
const OTHER_DRIVER = '72222222-2222-4222-8222-222222222222';
const RECORD = 'select public.record_parked_alert_check($1::uuid,$2::timestamptz,$3::text,$4::boolean) as result';
const COUNTS = 'select public.fleet_parked_alert_check_counts($1::uuid) as result';

test('parked check database keeps minimal latest results inside verified membership and owner scope', async t => {
  const db = new PGlite();
  const stamp = (delta = 0) => new Date(Date.now() - 300000 + delta).toISOString();
  const record = async ({ user = USER, completed = stamp(), platform = 'web', confirmed = true } = {}) =>
    (await db.query(RECORD, [user, completed, platform, confirmed])).rows[0].result;
  const counts = async (owner = OWNER) => (await db.query(COUNTS, [owner])).rows[0].result;
  const stored = async () => (await db.query('select * from public.parked_alert_checks order by driver_id, fleet_id')).rows;
  async function admin(sql, values) {
    await db.exec('reset role');
    try { return values === undefined ? await db.exec(sql) : await db.query(sql, values); }
    finally { await db.exec('set role service_role'); }
  }
  async function reset() {
    await admin(`truncate auth.users cascade;
      insert into auth.users values ('${OWNER}'),('${OTHER_OWNER}'),('${USER}'),('${OTHER_USER}'),('${NO_PROFILE}');
      insert into public.fleets(id,company_name,owner_user_id) values
        ('${FLEET}','First fleet','${OWNER}'),('${OTHER_FLEET}','Other fleet','${OTHER_OWNER}');
      insert into public.drivers(id,user_id,fleet_id,name) values
        ('${DRIVER}','${USER}','${FLEET}','First driver'),
        ('${OTHER_DRIVER}','${OTHER_USER}','${OTHER_FLEET}','Other driver');`);
  }

  try {
    // The canonical chain must revoke even historical broad default privileges.
    await initializeTestSchema(db, { supabaseDefaults: true });
    await db.exec('set role service_role');

    await t.test('RLS and invoker RPCs deny direct browser roles and grant only the service role', async () => {
      await reset();
      await record();
      const policy = (await admin(`select
        (select relrowsecurity from pg_class where oid='public.parked_alert_checks'::regclass) as rls,
        (select prosecdef from pg_proc where oid='public.record_parked_alert_check(uuid,timestamptz,text,boolean)'::regprocedure) as record_definer,
        (select prosecdef from pg_proc where oid='public.fleet_parked_alert_check_counts(uuid)'::regprocedure) as counts_definer,
        (select proconfig from pg_proc where oid='public.record_parked_alert_check(uuid,timestamptz,text,boolean)'::regprocedure) as config,
        has_schema_privilege('service_role','auth','USAGE') as auth_usage,
        has_table_privilege('service_role','auth.users','SELECT') as auth_select`, [])).rows[0];
      assert.deepEqual(policy, { rls: true, record_definer: false, counts_definer: false,
        config: ['search_path=pg_catalog, pg_temp'], auth_usage: false, auth_select: false });
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',
          ['service_role', 'public.parked_alert_checks', privilege])).rows[0].allowed, true);
      }
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        await assert.rejects(stored(), /permission denied/);
        await assert.rejects(record(), /permission denied/);
        await assert.rejects(counts(), /permission denied/);
        await db.exec('reset role;set role service_role');
      }
      await admin('grant select on public.parked_alert_checks to anon, authenticated');
      try {
        for (const role of ['anon', 'authenticated']) {
          await db.exec(`set role ${role}`);
          assert.equal((await stored()).length, 0, 'RLS still denies rows after an accidental SELECT grant');
          await assert.rejects(record(), /permission denied/);
          await db.exec('reset role;set role service_role');
        }
      } finally { await admin('revoke select on public.parked_alert_checks from anon, authenticated'); }
    });

    await t.test('token actor selects current driver and fleet and owner counts do not cross fleets', async () => {
      await reset();
      const completed = stamp();
      const accepted = await record({ completed });
      assert.deepEqual(Object.keys(accepted.check).sort(), ['completed_at', 'confirmed', 'platform']);
      assert.equal(Date.parse(accepted.check.completed_at), Date.parse(completed));
      assert.equal(accepted.check.confirmed, true);
      assert.equal(accepted.check.platform, 'web');
      const rows = await stored();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].driver_id, DRIVER);
      assert.equal(rows[0].fleet_id, FLEET);
      assert.deepEqual(await counts(), { fleet_id: FLEET, active_driver_count: 1, confirmed_driver_count: 1 });
      assert.deepEqual(await counts(OTHER_OWNER), { fleet_id: OTHER_FLEET, active_driver_count: 1, confirmed_driver_count: 0 });
      assert.equal(await counts(USER), null);
      assert.equal(await counts(NO_PROFILE), null);
      await record({ user: OTHER_USER, platform: 'ios', confirmed: false });
      assert.deepEqual(await counts(), { fleet_id: FLEET, active_driver_count: 1, confirmed_driver_count: 1 });
      assert.deepEqual(await counts(OTHER_OWNER), { fleet_id: OTHER_FLEET, active_driver_count: 1, confirmed_driver_count: 0 });
      const columns = (await db.query(`select column_name from information_schema.columns
        where table_schema='public' and table_name='parked_alert_checks' order by ordinal_position`)).rows;
      assert.deepEqual(columns.map(row => row.column_name),
        ['driver_id', 'fleet_id', 'completed_at', 'platform', 'confirmed', 'received_at']);
    });

    await t.test('latest no replaces yes, stale arrivals cannot reverse it, identical repeats are read-only', async () => {
      await reset();
      const first = stamp(), second = stamp(1000);
      await record({ completed: first });
      await record({ completed: second, platform: 'android', confirmed: false });
      const latest = await stored();
      assert.equal(latest.length, 1);
      assert.equal(latest[0].confirmed, false);
      assert.deepEqual(await counts(), { fleet_id: FLEET, active_driver_count: 1, confirmed_driver_count: 0 });
      assert.deepEqual(await record({ completed: first }), { error: 'stale_parked_alert_check' });
      assert.deepEqual(await record({ completed: second, platform: 'android' }), { error: 'stale_parked_alert_check' });
      const replay = await record({ completed: second, platform: 'android', confirmed: false });
      assert.equal(replay.check.confirmed, false);
      assert.deepEqual(await stored(), latest, 'a duplicate does not alter the received time or create another record');
      await record({ completed: stamp(2000) });
      assert.deepEqual(await counts(), { fleet_id: FLEET, active_driver_count: 1, confirmed_driver_count: 1 });
    });

    await t.test('inactive, missing and unassigned drivers cannot write; old fleet checks never follow membership', async () => {
      await reset();
      assert.deepEqual(await record({ user: NO_PROFILE }), { error: 'driver_not_in_active_fleet' });
      await record();
      await db.query('update public.drivers set active=false where id=$1', [DRIVER]);
      assert.deepEqual(await record(), { error: 'driver_not_in_active_fleet' });
      assert.deepEqual(await counts(), { fleet_id: FLEET, active_driver_count: 0, confirmed_driver_count: 0 });
      await db.query('update public.drivers set active=true,fleet_id=null where id=$1', [DRIVER]);
      assert.deepEqual(await record(), { error: 'driver_not_in_active_fleet' });
      await db.query('update public.drivers set fleet_id=$1 where id=$2', [OTHER_FLEET, DRIVER]);
      assert.deepEqual(await counts(), { fleet_id: FLEET, active_driver_count: 0, confirmed_driver_count: 0 });
      assert.deepEqual(await counts(OTHER_OWNER), { fleet_id: OTHER_FLEET, active_driver_count: 2, confirmed_driver_count: 0 });
      await record({ completed: stamp(2000) });
      assert.deepEqual(await counts(OTHER_OWNER), { fleet_id: OTHER_FLEET, active_driver_count: 2, confirmed_driver_count: 1 });
      assert.equal((await stored()).length, 2, 'each fleet has only its own check');
      await db.query('update public.fleets set owner_user_id=$1 where id=$2', [NO_PROFILE, FLEET]);
      assert.equal(await counts(OWNER), null, 'a previous owner loses the aggregate immediately');
      assert.deepEqual(await counts(NO_PROFILE), { fleet_id: FLEET, active_driver_count: 0, confirmed_driver_count: 0 });
      const replacementFleet = '63333333-3333-4333-8333-333333333333';
      await db.query('insert into public.fleets(id,company_name,owner_user_id) values($1,$2,$3)',
        [replacementFleet, 'Replacement fleet', OWNER]);
      assert.deepEqual(await counts(OWNER), { fleet_id: replacementFleet, active_driver_count: 0, confirmed_driver_count: 0 },
        'server fleet identity lets a client reject counts fetched after its owner workspace changed');
    });

    await t.test('database validates fields independently of the API and constrains stored rows', async () => {
      await reset();
      for (const input of [
        { user: null }, { completed: null }, { completed: 'infinity' }, { completed: '-infinity' },
        { completed: new Date(Date.now() - 86401000).toISOString() },
        { completed: new Date(Date.now() + 301000).toISOString() },
        { platform: null }, { platform: 'web device ID' }, { platform: '' }, { confirmed: null },
      ]) assert.deepEqual(await record(input), { error: 'invalid_parked_alert_check' });
      assert.equal((await stored()).length, 0);
      await record();
      await assert.rejects(db.query('update public.parked_alert_checks set completed_at=$1', ['infinity']), /check constraint/);
      await assert.rejects(db.query('update public.parked_alert_checks set platform=$1', ['identifier']), /check constraint/);
      await assert.rejects(db.query('update public.parked_alert_checks set confirmed=null'), /not-null constraint/);
    });

    await t.test('counts cover the complete active roster instead of the dashboard snapshot cap', async () => {
      await reset();
      await db.query(`insert into public.drivers(id,fleet_id,name,active)
        select gen_random_uuid(),$1,'Fixture '||n,n<>501 from generate_series(1,501) n`, [FLEET]);
      await db.query(`insert into public.parked_alert_checks(driver_id,fleet_id,completed_at,platform,confirmed)
        select id,fleet_id,clock_timestamp(),'web',true from public.drivers where fleet_id=$1`, [FLEET]);
      assert.deepEqual(await counts(), { fleet_id: FLEET, active_driver_count: 501, confirmed_driver_count: 501 });
      assert.deepEqual(await counts(OTHER_OWNER), { fleet_id: OTHER_FLEET, active_driver_count: 1, confirmed_driver_count: 0 });
    });

    await t.test('account, driver and fleet deletion cascade the corresponding check records', async () => {
      await reset();
      await record();
      await record({ user: OTHER_USER });
      await admin('delete from auth.users where id=$1', [USER]);
      assert.equal((await stored()).length, 1);
      assert.equal((await stored())[0].driver_id, OTHER_DRIVER);
      await reset();
      await record();
      await db.query('delete from public.drivers where id=$1', [DRIVER]);
      assert.equal((await stored()).length, 0);
      await reset();
      await record();
      await record({ user: OTHER_USER });
      await admin('delete from auth.users where id=$1', [OWNER]);
      assert.equal((await stored()).length, 1);
      assert.equal((await stored())[0].fleet_id, OTHER_FLEET);
      assert.equal(await counts(OWNER), null);
      assert.deepEqual(await record(), { error: 'driver_not_in_active_fleet' });
    });
  } finally { await db.close(); }
});
