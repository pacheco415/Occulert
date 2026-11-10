import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

const users = {
  first: '11111111-1111-4111-8111-111111111111',
  second: '22222222-2222-4222-8222-222222222222',
  fleetOwner: '77777777-7777-4777-8777-777777777777',
  otherFleetOwner: '88888888-8888-4888-8888-888888888888',
  noProfile: '99999999-9999-4999-8999-999999999999',
};
const drivers = {
  first: '33333333-3333-4333-8333-333333333333',
  second: '33333333-3333-4333-8333-333333333334',
};
const fleets = {
  first: '44444444-4444-4444-8444-444444444444',
  second: '44444444-4444-4444-8444-444444444445',
};
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = n => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const startSql = `select public.start_rate_limited_session(
  $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text) as result`;
const eventSql = `select public.record_idempotent_event(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::numeric, $6::numeric,
  $7::double precision, $8::double precision, $9::timestamptz) as result`;
const startDefaults = {
  p_user_id: users.first, p_session_id: id(1), p_device: 'fixture phone',
  p_browser: 'fixture browser', p_detector_pipeline: 'web_mediapipe_ear',
  p_detector_version: 'fixture.1', p_app_version: '1.0.0',
};

test('legacy event and atomic session-start quota database contracts', async t => {
  const db = new PGlite();
  const start = async (changes = {}) => {
    const body = { ...startDefaults, ...changes };
    return (await db.query(startSql, Object.keys(startDefaults).map(name => body[name]))).rows[0].result;
  };
  const event = async ({ user = users.first, session = id(1), client = null } = {}) =>
    (await db.query(eventSql, [user, session, client, 'drowsy', 30, 80, null, null, null])).rows[0].result;
  async function admin(sql, params) {
    await db.exec('reset role');
    try { return params === undefined ? await db.exec(sql) : await db.query(sql, params); }
    finally { await db.exec('set role service_role'); }
  }
  async function reset() {
    await admin(`truncate auth.users cascade;
      insert into auth.users values ${Object.values(users).map(value => `('${value}')`).join(',')};
      insert into public.fleets(id,company_name,owner_user_id) values
        ('${fleets.first}','First fleet','${users.fleetOwner}'),
        ('${fleets.second}','Second fleet','${users.otherFleetOwner}');
      insert into public.drivers(id,user_id,fleet_id,name) values
        ('${drivers.first}','${users.first}','${fleets.first}','First driver'),
        ('${drivers.second}','${users.second}','${fleets.second}','Second driver');`);
  }
  const count = async table => Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n);
  const bucket = async (user = users.first) =>
    (await db.query('select to_jsonb(b) as bucket from public.session_start_rate_limits b where user_id=$1', [user])).rows[0]?.bucket ?? null;
  const stored = async session =>
    (await db.query('select to_jsonb(s) as session from public.sessions s where id=$1', [session])).rows[0]?.session ?? null;

  try {
    // Replay the real canonical chain under historical Supabase default grants
    // too: the new migration must explicitly revoke those browser privileges.
    await initializeTestSchema(db, { supabaseDefaults: true });

    await t.test('service-only RPC and counter keep auth-schema access narrow', async () => {
      await reset();
      const privileges = (await admin(`select
        has_schema_privilege('service_role','auth','USAGE') as auth_usage,
        has_table_privilege('service_role','auth.users','SELECT') as auth_select,
        has_table_privilege('service_role','auth.users','UPDATE') as auth_update,
        has_function_privilege('service_role',
          'public.start_rate_limited_session(uuid,uuid,text,text,text,text,text)','EXECUTE') as service_execute,
        (select prosecdef from pg_proc where oid=
          'public.start_rate_limited_session(uuid,uuid,text,text,text,text,text)'::regprocedure) as definer,
        (select proconfig from pg_proc where oid=
          'public.start_rate_limited_session(uuid,uuid,text,text,text,text,text)'::regprocedure) as config,
        (select relrowsecurity from pg_class where oid='public.session_start_rate_limits'::regclass) as rls`, [])).rows[0];
      assert.deepEqual(privileges, { auth_usage: false, auth_select: false, auth_update: false,
        service_execute: true, definer: true, config: ['search_path=pg_catalog, pg_temp'], rls: true });
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',
          ['service_role', 'public.session_start_rate_limits', privilege])).rows[0].allowed, true);
      }
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(start(), /permission denied/);
          await assert.rejects(db.query('select * from public.session_start_rate_limits'), /permission denied/);
          await assert.rejects(db.query('select * from auth.users'), /permission denied/);
        } finally { await db.exec('reset role;set role service_role'); }
      }
      assert.equal((await start()).replayed, false, 'the definer can lock the actor without direct auth grants');
    });

    await t.test('RLS still hides counters after accidental browser SELECT grants', async () => {
      await reset();
      await start();
      await admin('grant select on public.session_start_rate_limits to anon,authenticated');
      try {
        for (const role of ['anon', 'authenticated']) {
          await db.exec(`set role ${role}`);
          assert.equal(await count('session_start_rate_limits'), 0);
          await assert.rejects(start(), /permission denied/);
          await db.exec('reset role;set role service_role');
        }
      } finally { await admin('revoke select on public.session_start_rate_limits from anon,authenticated'); }
    });

    await t.test('invalid metadata or missing profile never creates a quota row', async () => {
      await reset();
      for (const changes of [
        { p_user_id: null }, { p_device: 'd'.repeat(121) }, { p_browser: 'b'.repeat(241) },
        { p_detector_pipeline: 'client_attested' }, { p_detector_version: '<script>' },
        { p_detector_version: 'v'.repeat(81) }, { p_app_version: 'bad\nversion' },
      ]) assert.deepEqual(await start(changes), { error: 'invalid_session' });
      for (const user of [users.noProfile, id(999)]) {
        assert.deepEqual(await start({ p_user_id: user }), { error: 'driver_profile_not_found' });
      }
      assert.equal(await count('session_start_rate_limits'), 0);
      assert.equal(await count('sessions'), 0);
    });

    await t.test('new starts preserve metadata and use server-derived identity and time', async () => {
      await reset();
      const before = (await db.query('select clock_timestamp()::text as now')).rows[0].now;
      const result = await start();
      const after = (await db.query('select clock_timestamp()::text as now')).rows[0].now;
      assert.equal(result.replayed, false);
      assert.equal(result.session.id, id(1));
      assert.equal(result.session.driver_id, drivers.first);
      assert.equal(result.session.fleet_id, fleets.first);
      for (const name of ['device', 'browser', 'detector_pipeline', 'detector_version', 'app_version']) {
        assert.equal(result.session[name], startDefaults['p_' + name]);
      }
      assert.equal(result.session.ended_at, null);
      assert.equal((await db.query('select $1::timestamptz between $2::timestamptz and $3::timestamptz as bounded',
        [result.session.started_at, before, after])).rows[0].bounded, true);
      assert.equal((await db.query(`select b.window_started_at=s.started_at as same
        from public.session_start_rate_limits b join public.sessions s on s.id=$1
        where b.user_id=$2`, [id(1), users.first])).rows[0].same, true);
      assert.equal((await bucket()).start_count, 1);
      assert.deepEqual(result.session, await stored(id(1)));
    });

    await t.test('omitted UUID creates a new row each time and nullable metadata stays null', async () => {
      await reset();
      const args = { p_session_id: null, p_device: null, p_browser: null,
        p_detector_pipeline: null, p_detector_version: null, p_app_version: null };
      const first = await start(args), second = await start(args);
      assert.notEqual(first.session.id, second.session.id);
      for (const name of ['device', 'browser', 'detector_pipeline', 'detector_version', 'app_version']) {
        assert.equal(first.session[name], null);
      }
      assert.equal((await bucket()).start_count, 2);
    });

    await t.test('a hostile public to_jsonb overload cannot replace a returned owned session', async () => {
      await reset();
      await admin(`create function public.to_jsonb(public.sessions) returns jsonb language plpgsql as $$begin
          raise exception 'hostile_public_to_jsonb_must_not_run';
        end$$;`);
      try {
        const created = await start();
        assert.equal(created.session.id, id(1));
        assert.equal(created.session.driver_id, drivers.first);
        assert.equal(created.session.fleet_id, fleets.first);
        assert.equal(created.replayed, false);
        assert.equal((await start()).session.id, id(1));
        assert.equal((await bucket()).start_count, 1);
      } finally { await admin('drop function public.to_jsonb(public.sessions)'); }
    });

    await t.test('30 accepted starts exhaust only that driver and denied starts do not move the window', async () => {
      await reset();
      for (let n = 1; n <= 30; n++) assert.equal((await start({ p_session_id: id(n) })).replayed, false);
      const full = await bucket();
      for (let n = 31; n <= 32; n++) {
        const result = await start({ p_session_id: id(n) });
        assert.equal(result.error, 'session_start_rate_limited');
        assert.ok(Number.isInteger(result.retry_after) && result.retry_after >= 1 && result.retry_after <= 3600);
      }
      assert.deepEqual(await bucket(), full);
      assert.equal(await count('sessions'), 30);
      assert.equal((await start({ p_user_id: users.second, p_session_id: id(40) })).replayed, false);
      assert.equal((await bucket(users.second)).start_count, 1);
      assert.equal((await bucket()).start_count, 30);
    });

    await t.test('expired one-hour window resets on the next accepted start, anchored to its server time', async () => {
      await reset();
      await start();
      await admin(`update public.session_start_rate_limits
        set window_started_at=clock_timestamp()-interval '1 hour 1 second',start_count=30`);
      const result = await start({ p_session_id: id(2) });
      assert.equal(result.replayed, false);
      assert.equal((await bucket()).start_count, 1);
      assert.equal((await db.query(`select b.window_started_at=s.started_at as same
        from public.session_start_rate_limits b join public.sessions s on s.id=$1
        where b.user_id=$2`, [id(2), users.first])).rows[0].same, true);
    });

    await t.test('owned UUID replay is free at quota and retains completed historical fleet and summary', async () => {
      await reset();
      for (let n = 1; n <= 30; n++) await start({ p_session_id: id(n) });
      await admin(`update public.sessions set ended_at=clock_timestamp(),average_fatigue=0,
          max_fatigue=90,safety_score=88,alert_count=0,head_nod_count=1 where id='${id(1)}';
        update public.drivers set fleet_id='${fleets.second}' where id='${drivers.first}'`);
      const original = await stored(id(1)), full = await bucket();
      const replay = await start({ p_session_id: id(1).toUpperCase(), p_device: 'changed', p_app_version: '9.0' });
      assert.deepEqual(replay, { session: original, replayed: true });
      assert.equal(replay.session.fleet_id, fleets.first);
      assert.deepEqual(await bucket(), full);
      assert.equal(await count('sessions'), 30);
    });

    await t.test('foreign UUID conflicts do not expose a row or create or charge an actor counter', async () => {
      await reset();
      const foreign = await start({ p_user_id: users.second, p_session_id: id(1) });
      assert.deepEqual(await start(), { error: 'session_id_conflict' });
      assert.equal(await bucket(), null);
      assert.equal((await bucket(users.second)).start_count, 1);
      assert.deepEqual(await stored(id(1)), foreign.session);
    });

    await t.test('an insert-time primary-key conflict rolls back first counter initialization and never retries', async () => {
      await reset();
      await admin(`create sequence public.quota_fixture_calls;
        create function public.quota_fixture_collision() returns trigger language plpgsql as $$begin
          if pg_trigger_depth()=1 then
            perform nextval('public.quota_fixture_calls');
            insert into public.sessions(id,driver_id,device) values(new.id,'${drivers.second}','competing fixture');
          end if;
          return new;
        end$$;
        create trigger quota_fixture_collision before insert on public.sessions
          for each row execute function public.quota_fixture_collision();`);
      try {
        assert.deepEqual(await start(), { error: 'session_id_conflict' });
        assert.equal(await bucket(), null);
        assert.equal(await count('sessions'), 0, 'the competing same-transaction fixture also rolls back');
        assert.equal(Number((await admin('select last_value from public.quota_fixture_calls', [])).rows[0].last_value), 1);
      } finally {
        await admin(`drop trigger quota_fixture_collision on public.sessions;
          drop function public.quota_fixture_collision();drop sequence public.quota_fixture_calls;`);
      }
      // This deterministic fixture proves rollback scope, not real concurrent locking.
    });

    await t.test('unrelated or unattributed unique violations remain failures rather than UUID conflicts', async () => {
      await reset();
      await admin(`insert into public.sessions(id,driver_id,device) values('${id(99)}','${drivers.second}','fixture phone');
        create unique index quota_fixture_other_unique on public.sessions(device) where device is not null;`);
      try {
        await assert.rejects(start(), error => error.code === '23505' && error.constraint === 'quota_fixture_other_unique');
        assert.equal(await bucket(), null);
        assert.equal(await count('sessions'), 1);
      } finally { await admin('drop index public.quota_fixture_other_unique'); }
      await admin(`create function public.quota_fixture_unique() returns trigger language plpgsql as $$begin
          raise exception using errcode='23505',message='unattributed_fixture_unique';
        end$$;
        create trigger quota_fixture_unique before insert on public.sessions
          for each row execute function public.quota_fixture_unique();`);
      try {
        await assert.rejects(start({ p_session_id: id(2) }), error => error.code === '23505');
        assert.equal(await bucket(), null);
      } finally { await admin('drop trigger quota_fixture_unique on public.sessions;drop function public.quota_fixture_unique()'); }
    });

    await t.test('write errors cannot enter the private membership read/lock retry loop', async () => {
      await reset();
      await admin(`create sequence public.quota_fixture_calls;
        create function public.quota_fixture_retry_state() returns trigger language plpgsql as $$begin
          perform nextval('public.quota_fixture_calls');
          raise exception using errcode='PSQ01',message='write_must_not_retry';
        end$$;
        create trigger quota_fixture_retry_state before insert on public.sessions
          for each row execute function public.quota_fixture_retry_state();`);
      try {
        await assert.rejects(start(), error => error.code === 'PSQ01');
        assert.equal(await count('sessions'), 0);
        assert.equal(await bucket(), null);
        assert.equal(Number((await admin('select last_value from public.quota_fixture_calls', [])).rows[0].last_value), 1);
      } finally {
        await admin(`drop trigger quota_fixture_retry_state on public.sessions;
          drop function public.quota_fixture_retry_state();drop sequence public.quota_fixture_calls;`);
      }
    });

    await t.test('session or counter write failure rolls back both new and existing quota state', async () => {
      for (const table of ['sessions', 'session_start_rate_limits']) {
        for (const existing of [false, true]) {
          await reset();
          if (existing) await start();
          const prior = await bucket(), priorCount = await count('sessions');
          await admin(`create function public.quota_fixture_fail() returns trigger language plpgsql as $$begin
              raise exception 'quota_fixture_write_failed';
            end$$;
            create trigger quota_fixture_fail before ${table === 'sessions' ? 'insert' : 'update'} on public.${table}
              for each row execute function public.quota_fixture_fail();`);
          try {
            await assert.rejects(start({ p_session_id: id(2) }), /quota_fixture_write_failed/);
            assert.deepEqual(await bucket(), prior);
            assert.equal(await count('sessions'), priorCount);
          } finally { await admin(`drop trigger quota_fixture_fail on public.${table};drop function public.quota_fixture_fail()`); }
        }
      }
    });

    await t.test('account deletion removes only its own start counter and sessions', async () => {
      await reset();
      await start();
      await start({ p_user_id: users.second, p_session_id: id(2) });
      await admin('delete from auth.users where id=$1', [users.first]);
      assert.equal(await bucket(), null);
      assert.equal((await bucket(users.second)).start_count, 1);
      assert.equal(await stored(id(1)), null);
      assert.equal((await stored(id(2))).driver_id, drivers.second);
      assert.deepEqual(await start(), { error: 'driver_profile_not_found' });
    });

    await t.test('fleet-owner deletion preserves members and their quota; later starts derive null membership', async () => {
      await reset();
      await start();
      await admin('delete from auth.users where id=$1', [users.fleetOwner]);
      assert.equal((await bucket()).start_count, 1);
      assert.equal((await stored(id(1))).fleet_id, null, 'existing database deletion policy is preserved');
      const result = await start({ p_session_id: id(2) });
      assert.equal(result.session.driver_id, drivers.first);
      assert.equal(result.session.fleet_id, null);
      assert.equal((await bucket()).start_count, 2);
    });

    await t.test('legacy and keyed events share the existing 60-per-minute budget across sessions', async () => {
      await reset();
      await start();
      await start({ p_session_id: id(2) });
      await start({ p_user_id: users.second, p_session_id: id(3) });
      const first = await event({ client: key(1) });
      for (let n = 1; n < 60; n++) {
        const result = await event({ session: n % 2 ? id(1) : id(2), client: n % 2 ? null : key(n + 1) });
        assert.equal(result.replayed, false);
      }
      for (const client of [null, key(99)]) {
        const limited = await event({ client });
        assert.equal(limited.error, 'event_rate_limited');
        assert.ok(limited.retry_after >= 1 && limited.retry_after <= 60);
      }
      assert.equal((await event({ client: key(1) })).event.id, first.event.id);
      assert.equal((await db.query('select event_count from public.event_rate_limits where user_id=$1', [users.first])).rows[0].event_count, 60);
      assert.equal((await event({ user: users.second, session: id(3) })).replayed, false);
      assert.equal((await bucket()).start_count, 2, 'events do not charge the independent start quota');
      assert.equal((await start({ p_session_id: id(4) })).replayed, false, 'event exhaustion does not block a new start');
    });

    await t.test('legacy event budget resets by server time while the 500-per-session cap persists', async () => {
      await reset();
      await start();
      const first = await event({ client: key(1) });
      await admin(`update public.event_rate_limits set event_count=60,
          window_started_at=clock_timestamp()-interval '61 seconds';`);
      assert.equal((await event()).replayed, false);
      assert.equal((await db.query('select event_count from public.event_rate_limits where user_id=$1', [users.first])).rows[0].event_count, 1);
      await admin(`insert into public.events(session_id,type) select '${id(1)}','drowsy' from generate_series(1,498)`);
      for (const client of [null, key(99)]) assert.deepEqual(await event({ client }), { error: 'session_event_limit' });
      assert.equal((await event({ client: key(1) })).event.id, first.event.id);
      assert.equal(await count('events'), 500);
      assert.equal((await db.query('select event_count from public.event_rate_limits where user_id=$1', [users.first])).rows[0].event_count, 1);
    });
  } finally { await db.close(); }
});
