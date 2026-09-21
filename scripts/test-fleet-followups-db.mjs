import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20260921040303_fleet_session_followups.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
try {
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create table public.fleets(id uuid primary key, owner_user_id uuid references auth.users on delete cascade);
    create table public.sessions(id uuid primary key, fleet_id uuid references fleets on delete set null);
    grant usage on schema public to anon, authenticated, service_role;
    grant select, update on public.sessions, public.fleets to service_role;
    insert into auth.users values ('${owner}'), ('${other}');
    insert into fleets values ('${owner}', '${owner}');
    insert into sessions values ('${session}', '${owner}');`);
  await db.exec(migration);
  const save = async (actor, status, version) => (await db.query(
    'select * from public.save_fleet_session_followup($1::uuid,$2::uuid,$3::text,$4::integer)',
    [actor, session, status, version],
  )).rows;
  await db.exec('set role service_role');
  await assert.rejects(save(other, 'reviewed', 0), /Session not found/);
  let rows = await save(owner, 'in_progress', 0);
  assert.equal(rows[0].version, 1);
  assert.equal(rows[0].updated_by, owner);
  assert.equal((await save(owner, 'reviewed', 0)).length, 0, 'duplicate creation must conflict');
  assert.equal((await save(owner, 'reviewed', 9)).length, 0, 'stale edits must not overwrite');
  rows = await save(owner, 'reviewed', 1);
  assert.equal(rows[0].version, 2);
  assert.equal(rows[0].status, 'reviewed');
  await assert.rejects(save(owner, 'safe_to_drive', 2), /Invalid follow-up/);
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from fleet_session_followups'), /permission denied/);
    await assert.rejects(save(owner, 'open', 2), /permission denied/);
    await db.exec('reset role');
  }
  // RLS stays closed even if a future grant accidentally exposes SELECT.
  await db.exec('grant select on fleet_session_followups to authenticated; set role authenticated');
  assert.equal((await db.query('select * from fleet_session_followups')).rows.length, 0);
  await db.exec('reset role');
  const security = await db.query("select prosecdef, proconfig from pg_proc where proname='save_fleet_session_followup'");
  assert.equal(security.rows[0].prosecdef, false);
  await db.exec(`update fleets set owner_user_id='${other}'; set role service_role`);
  await assert.rejects(save(owner, 'open', 2), /Session not found/);
  assert.equal((await save(other, 'open', 2))[0].version, 3);
  await db.exec(`reset role; delete from sessions where id='${session}'`);
  assert.equal((await db.query('select * from fleet_session_followups')).rows.length, 0);
  console.log('Fleet follow-up SQL passed: ownership, revisions, permissions, RLS, and cascade deletion.');
} finally { await db.close(); }
