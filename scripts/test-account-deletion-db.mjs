import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Real, isolated Postgres execution. No production credentials or accounts.
const db = new PGlite();
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const tables = schema.slice(schema.indexOf('create table if not exists fleets'), schema.indexOf('create table if not exists pilot_leads'));
// Recreate the deployed pre-feature constraints, then exercise the migration.
const baseline = tables.replaceAll('references auth.users(id) on delete cascade', 'references auth.users(id)')
  .replaceAll('references fleets(id) on delete set null', 'references fleets(id) on delete cascade');
const migration = readFileSync(new URL('../supabase/migrations/20260912170153_atomic_account_deletion.sql', import.meta.url), 'utf8');
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
  `);
  await db.exec(baseline);
  await db.exec(migration);
  await db.exec(`
    insert into auth.users values
      ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002'),
      ('00000000-0000-0000-0000-000000000003');
    insert into fleets(id, company_name, owner_user_id) values
      ('10000000-0000-0000-0000-000000000001', 'Test fleet', '00000000-0000-0000-0000-000000000001');
    insert into drivers(id, fleet_id, user_id, name)
      select ('20000000-0000-0000-0000-00000000000' || n)::uuid,
        '10000000-0000-0000-0000-000000000001',
        ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'Test driver'
      from generate_series(1,3) n;
    insert into sessions(id, driver_id, fleet_id)
      select ('30000000-0000-0000-0000-00000000000' || n)::uuid,
        ('20000000-0000-0000-0000-00000000000' || n)::uuid,
        '10000000-0000-0000-0000-000000000001' from generate_series(1,3) n;
    insert into events(session_id, type) select id, 'test' from sessions;
    insert into fleet_invitations(fleet_id, email, token_hash, invited_by, accepted_by, expires_at)
      values ('10000000-0000-0000-0000-000000000001', 'fixture@example.invalid', 'fixture',
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now());
  `);
  const count = async (table) => Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
  // An additional restrictive FK models any downstream failure, including Storage ownership.
  await db.exec(`create table public.deletion_blocker(user_id uuid references auth.users);
    insert into deletion_blocker values ('00000000-0000-0000-0000-000000000001');`);
  await assert.rejects(db.exec("delete from auth.users where id='00000000-0000-0000-0000-000000000001'"));
  assert.equal(await count('auth.users'), 3);
  assert.equal(await count('drivers'), 3);
  assert.equal(await count('sessions'), 3);
  assert.equal(await count('events'), 3);
  assert.equal(await count('fleets'), 1);
  assert.equal(await count('fleet_invitations'), 1);
  await db.exec('drop table deletion_blocker');
  // A member deletes only their own history; the owner and other member remain.
  await db.exec("delete from auth.users where id='00000000-0000-0000-0000-000000000002'");
  for (const table of ['auth.users', 'drivers', 'sessions', 'events']) assert.equal(await count(table), 2);
  assert.equal(await count('fleets'), 1);
  assert.equal(await count('fleet_invitations'), 0);
  // Owner deletion removes their own records and fleet, preserving the final member's history.
  await db.exec("delete from auth.users where id='00000000-0000-0000-0000-000000000001'");
  for (const table of ['auth.users', 'drivers', 'sessions', 'events']) assert.equal(await count(table), 1);
  assert.equal(await count('fleets'), 0);
  for (const table of ['drivers', 'sessions']) {
    assert.equal((await db.query(`select fleet_id from ${table}`)).rows[0].fleet_id, null);
  }
  assert.equal((await db.query('select user_id from drivers')).rows[0].user_id, '00000000-0000-0000-0000-000000000003');
  console.log('Account deletion database tests passed: rollback, member deletion, owner deletion, and preserved member history.');
} finally {
  await db.close();
}
