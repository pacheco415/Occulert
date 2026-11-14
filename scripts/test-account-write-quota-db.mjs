import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

const accounts = {
  first: '11111111-1111-4111-8111-111111111111',
  second: '22222222-2222-4222-8222-222222222222',
  missing: '99999999-9999-4999-8999-999999999999',
};
const signature = 'public.reserve_account_write(uuid,text)';
const limits = { profile: 60, fleet: 10 };

for (const supabaseDefaults of [false, true]) {
  test(`account write quotas replay the canonical chain with ${supabaseDefaults ? 'historical Supabase' : 'strict'} grants`, async t => {
    const db = new PGlite();
    const reserve = async (user = accounts.first, operation = 'profile') =>
      (await db.query('select public.reserve_account_write($1::uuid,$2::text) as result', [user, operation])).rows[0].result;
    const buckets = async () => (await db.query(
      'select to_jsonb(b) as bucket from public.account_write_rate_limits b order by user_id,operation',
    )).rows.map(row => row.bucket);
    const bucket = async (user = accounts.first, operation = 'profile') =>
      (await db.query('select to_jsonb(b) as bucket from public.account_write_rate_limits b where user_id=$1 and operation=$2', [user, operation])).rows[0]?.bucket ?? null;
    async function admin(sql, params) {
      await db.exec('reset role');
      try { return params === undefined ? await db.exec(sql) : await db.query(sql, params); }
      finally { await db.exec('set role service_role'); }
    }
    async function reset() {
      await admin(`truncate auth.users cascade;
        insert into auth.users(id) values ('${accounts.first}'),('${accounts.second}');`);
    }
    async function withRole(role, work) {
      await db.exec(`reset role; set role ${role}`);
      try { return await work(); }
      finally { await db.exec('reset role; set role service_role'); }
    }
    const admitted = (user = accounts.first, operation = 'profile') => ({ allowed: true, user_id: user, operation });
    function denied(result, user, operation, maxRetry = 3600) {
      assert.deepEqual(Object.keys(result).sort(), ['allowed', 'error', 'operation', 'retry_after', 'user_id']);
      assert.equal(result.allowed, false);
      assert.equal(result.error, 'account_write_rate_limited');
      assert.equal(result.user_id, user);
      assert.equal(result.operation, operation);
      assert.ok(Number.isInteger(result.retry_after));
      assert.ok(result.retry_after >= 1 && result.retry_after <= maxRetry);
    }

    try {
      // Execute the actual migration after its real prerequisites. Do not add
      // fixture grants to make a migration with missing service access pass.
      await initializeTestSchema(db, { supabaseDefaults });
      await db.exec('set role service_role');

      await t.test('only service_role can use the counter or RPC, without direct auth access', async () => {
        await reset();
        const properties = (await admin(`select
          has_schema_privilege('service_role','auth','USAGE') as auth_usage,
          has_table_privilege('service_role','auth.users','SELECT') as auth_select,
          has_table_privilege('service_role','auth.users','UPDATE') as auth_update,
          has_function_privilege('service_role',$1,'EXECUTE') as service_execute,
          (select prosecdef from pg_proc where oid=$1::regprocedure) as definer,
          (select proconfig from pg_proc where oid=$1::regprocedure) as config,
          (select relrowsecurity from pg_class where oid='public.account_write_rate_limits'::regclass) as rls`, [signature])).rows[0];
        assert.deepEqual(properties, {
          auth_usage: false, auth_select: false, auth_update: false,
          service_execute: true, definer: true,
          config: ['search_path=pg_catalog, pg_temp'], rls: true,
        });
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',
            ['service_role', 'public.account_write_rate_limits', privilege])).rows[0].allowed, true);
        }
        for (const role of ['anon', 'authenticated']) {
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
            assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',
              [role, 'public.account_write_rate_limits', privilege])).rows[0].allowed, false, `${role} ${privilege}`);
          }
          assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed', [role, signature, 'EXECUTE'])).rows[0].allowed, false);
          await withRole(role, async () => {
            await assert.rejects(reserve(), /permission denied/);
            await assert.rejects(buckets(), /permission denied/);
            await assert.rejects(db.query('select * from auth.users'), /permission denied/);
          });
        }
        assert.deepEqual(await reserve(), admitted(), 'the definer can lock its auth parent without granting service_role auth access');
      });

      await t.test('RLS still hides and protects counters after accidental browser table grants', async () => {
        await reset();
        await reserve();
        const before = await buckets();
        await admin('grant select,insert,update,delete on public.account_write_rate_limits to anon,authenticated');
        try {
          for (const role of ['anon', 'authenticated']) {
            await withRole(role, async () => {
              assert.deepEqual(await buckets(), []);
              assert.equal((await db.query('update public.account_write_rate_limits set write_count=0 returning user_id')).rows.length, 0);
              assert.equal((await db.query('delete from public.account_write_rate_limits returning user_id')).rows.length, 0);
              await assert.rejects(db.query(`insert into public.account_write_rate_limits
                (user_id,operation,window_started_at,write_count) values ($1,'fleet',clock_timestamp(),0)`, [accounts.first]), /row-level security/);
              await assert.rejects(reserve(), /permission denied/);
            });
          }
          assert.deepEqual(await buckets(), before);
        } finally {
          await admin('revoke all on public.account_write_rate_limits from anon,authenticated');
        }
      });

      await t.test('invalid actors and operations cannot create buckets; a driver profile is not a prerequisite', async () => {
        await reset();
        for (const [user, operation] of [[null, 'profile'], [accounts.first, null], [accounts.first, ''],
          [accounts.first, 'PROFILE'], [accounts.first, 'profile '], [accounts.first, 'unknown']]) {
          assert.deepEqual(await reserve(user, operation), { allowed: false, error: 'invalid_account_write' });
        }
        await assert.rejects(reserve('not-a-uuid'), error => error.code === '22P02');
        assert.deepEqual(await reserve(accounts.missing), {
          allowed: false, user_id: accounts.missing, operation: 'profile', error: 'account_not_found',
        });
        assert.deepEqual(await buckets(), []);
        assert.equal(Number((await db.query('select count(*) as n from public.drivers')).rows[0].n), 0);
        assert.deepEqual(await reserve(), admitted());
        assert.equal((await bucket()).write_count, 1);
        assert.equal(Number((await db.query('select count(*) as n from public.drivers')).rows[0].n), 0);
      });

      await t.test('queued callers share first-row initialization and exhaust only the selected account and operation', async () => {
        await reset();
        // PGlite serializes statements on one connection. These concurrent JS
        // callers exercise the actual SQL/transaction boundaries and limits;
        // they do not establish multi-connection PostgreSQL lock contention.
        for (const [operation, limit] of Object.entries(limits)) {
          const results = await Promise.all(Array.from({ length: limit + 12 }, () => reserve(accounts.first, operation)));
          assert.equal(results.filter(result => result.allowed).length, limit);
          assert.equal(results.filter(result => !result.allowed).length, 12);
          for (const result of results) {
            if (result.allowed) assert.deepEqual(result, admitted(accounts.first, operation));
            else denied(result, accounts.first, operation);
          }
          assert.equal((await bucket(accounts.first, operation)).write_count, limit);
        }
        assert.equal((await buckets()).length, 2, 'each operation retains one bounded row');
        const full = await buckets();
        for (const operation of Object.keys(limits)) {
          denied(await reserve(accounts.first, operation), accounts.first, operation);
        }
        assert.deepEqual(await buckets(), full, 'denial must not increment counters or move their fixed windows');
        assert.deepEqual(await reserve(accounts.second), admitted(accounts.second));
        assert.equal((await bucket(accounts.second)).write_count, 1, 'another account has an independent budget');
      });

      await t.test('accepted calls retain their window and queued rollover callers cannot overspend the next window', async () => {
        await reset();
        for (const [operation, limit] of Object.entries(limits)) {
          await reserve(accounts.first, operation);
          const first = await bucket(accounts.first, operation);
          await reserve(accounts.first, operation);
          const second = await bucket(accounts.first, operation);
          assert.equal(second.window_started_at, first.window_started_at);
          assert.equal(second.write_count, 2);
          await admin(`update public.account_write_rate_limits
            set write_count=$3,window_started_at=clock_timestamp()-interval '1 hour'
            where user_id=$1 and operation=$2`, [accounts.first, operation, limit]);
          const before = (await db.query('select clock_timestamp()::text as now')).rows[0].now;
          const results = await Promise.all(Array.from({ length: limit + 3 }, () => reserve(accounts.first, operation)));
          const after = (await db.query('select clock_timestamp()::text as now')).rows[0].now;
          assert.equal(results.filter(result => result.allowed).length, limit);
          assert.equal(results.filter(result => !result.allowed).length, 3);
          for (const result of results.filter(result => !result.allowed)) denied(result, accounts.first, operation);
          const renewed = await bucket(accounts.first, operation);
          assert.equal(renewed.write_count, limit);
          assert.equal((await db.query('select $1::timestamptz between $2::timestamptz and $3::timestamptz as bounded',
            [renewed.window_started_at, before, after])).rows[0].bounded, true, 'the reset uses the database clock during the new reservation');
          denied(await reserve(accounts.first, operation), accounts.first, operation);
          assert.deepEqual(await bucket(accounts.first, operation), renewed);
        }
      });

      await t.test('Retry-After describes the remaining fixed window with a bounded integer', async () => {
        await reset();
        for (const [operation, limit] of Object.entries(limits)) {
          await reserve(accounts.first, operation);
          await admin(`update public.account_write_rate_limits
            set write_count=$3,window_started_at=clock_timestamp()-interval '59 minutes 30 seconds'
            where user_id=$1 and operation=$2`, [accounts.first, operation, limit]);
          const before = await bucket(accounts.first, operation);
          denied(await reserve(accounts.first, operation), accounts.first, operation, 30);
          assert.deepEqual(await bucket(accounts.first, operation), before);
        }
      });

      await t.test('profile deletion cannot reset an account quota, while auth deletion cascades only that account', async () => {
        await reset();
        await reserve();
        await reserve(accounts.first, 'fleet');
        await reserve(accounts.second);
        await db.query('insert into public.drivers(user_id,name) values ($1,$2)', [accounts.first, 'Quota fixture']);
        const firstBefore = await bucket();
        await db.query('delete from public.drivers where user_id=$1', [accounts.first]);
        assert.deepEqual(await bucket(), firstBefore);
        const otherBefore = await bucket(accounts.second);
        await admin('delete from auth.users where id=$1', [accounts.first]);
        assert.equal(await bucket(), null);
        assert.equal(await bucket(accounts.first, 'fleet'), null);
        assert.deepEqual(await bucket(accounts.second), otherBefore);
        assert.deepEqual(await reserve(), {
          allowed: false, user_id: accounts.first, operation: 'profile', error: 'account_not_found',
        });
        assert.deepEqual(await buckets(), [otherBefore]);
      });

      await t.test('table constraints enforce actor, operation, bounded count and composite uniqueness', async () => {
        await reset();
        const insert = (user, operation, count) => db.query(`insert into public.account_write_rate_limits
          (user_id,operation,window_started_at,write_count) values ($1,$2,clock_timestamp(),$3)`, [user, operation, count]);
        for (const [operation, count] of [['profile', -1], ['profile', 61], ['fleet', -1], ['fleet', 11], ['other', 0]]) {
          await assert.rejects(insert(accounts.first, operation, count), error => error.code === '23514');
        }
        await assert.rejects(insert(accounts.first, 'profile', null), error => error.code === '23502');
        await assert.rejects(insert(null, 'profile', 0), error => error.code === '23502');
        await assert.rejects(insert(accounts.first, null, 0), error => error.code === '23502');
        await assert.rejects(insert(accounts.missing, 'profile', 0), error => error.code === '23503');
        await assert.rejects(db.query(`insert into public.account_write_rate_limits
          (user_id,operation,window_started_at,write_count) values ($1,'profile',null,0)`, [accounts.first]), error => error.code === '23502');
        assert.deepEqual(await buckets(), []);
        await insert(accounts.first, 'profile', 0);
        await assert.rejects(insert(accounts.first, 'profile', 0), error => error.code === '23505');
        await insert(accounts.first, 'fleet', 0);
        await insert(accounts.second, 'profile', 0);
        assert.equal((await buckets()).length, 3);
      });

      await t.test('failed reservation updates roll back initialization and preserve existing buckets', async () => {
        await reset();
        await admin(`create function public.quota_fixture_reservation_failure() returns trigger language plpgsql as $$begin
          raise exception 'quota_fixture_reservation_failed'; end$$;
          create trigger quota_fixture_reservation_failure before update on public.account_write_rate_limits
          for each row execute function public.quota_fixture_reservation_failure();`);
        try {
          await assert.rejects(reserve(), /quota_fixture_reservation_failed/);
          assert.deepEqual(await buckets(), [], 'a failed initial counter increment rolls back its inserted row');
        } finally {
          await admin('drop trigger quota_fixture_reservation_failure on public.account_write_rate_limits; drop function public.quota_fixture_reservation_failure()');
        }
        await reserve();
        const before = await bucket();
        await admin(`create function public.quota_fixture_reservation_failure() returns trigger language plpgsql as $$begin
          raise exception 'quota_fixture_reservation_failed'; end$$;
          create trigger quota_fixture_reservation_failure before update on public.account_write_rate_limits
          for each row execute function public.quota_fixture_reservation_failure();`);
        try {
          await assert.rejects(reserve(), /quota_fixture_reservation_failed/);
          assert.deepEqual(await bucket(), before);
        } finally {
          await admin('drop trigger quota_fixture_reservation_failure on public.account_write_rate_limits; drop function public.quota_fixture_reservation_failure()');
        }
      });

      await t.test('an admitted attempt stays charged when a later business transaction fails', async () => {
        await reset();
        assert.deepEqual(await reserve(), admitted());
        const before = await bucket();
        await admin(`create function public.quota_fixture_profile_failure() returns trigger language plpgsql as $$begin
          raise exception 'quota_fixture_profile_failed'; end$$;
          create trigger quota_fixture_profile_failure before insert on public.drivers
          for each row execute function public.quota_fixture_profile_failure();`);
        try {
          await assert.rejects(db.query('insert into public.drivers(user_id,name) values ($1,$2)', [accounts.first, 'Quota fixture']), /quota_fixture_profile_failed/);
          assert.equal(Number((await db.query('select count(*) as n from public.drivers')).rows[0].n), 0);
          assert.deepEqual(await bucket(), before, 'the completed reservation is a separate durable transaction, not a successful-write counter');
        } finally {
          await admin('drop trigger quota_fixture_profile_failure on public.drivers; drop function public.quota_fixture_profile_failure()');
        }
      });
    } finally {
      await db.close();
    }
  });
}
