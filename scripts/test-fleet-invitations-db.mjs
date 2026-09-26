import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url), db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const fleet = '33333333-3333-4333-8333-333333333333', otherFleet = '44444444-4444-4444-8444-444444444444';
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').replace('create extension if not exists "pgcrypto";', '');
const migration = readFileSync(new URL('../supabase/migrations/20260926010000_atomic_fleet_invitation_creation.sql', import.meta.url), 'utf8');
const rpcSql = 'select public.create_fleet_invitation($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::uuid) as invitation';
const rpc = async (email, hash, replace = null, actor = owner, target = fleet) => (await db.query(rpcSql, [target, actor, 'owner@example.com', email, hash, replace])).rows[0].invitation;
const count = async () => Number((await db.query('select count(*) as n from fleet_invitations')).rows[0].n);
const reset = () => db.exec('reset role; truncate fleet_invitations; set role service_role');
const routeContext = { module: { exports: {} }, process: { env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role' } }, require(name) {
  if (name !== './_lib/supabase') return require(name);
  return { bearerToken: () => 'fixture-token', verifyAccessToken: async () => ({ id: owner, email: 'owner@example.com', email_confirmed_at: '2026-01-01' }), async pgFetch(table, options) {
    if (table === 'fleets') return (await db.query('select id,company_name,plan from fleets where owner_user_id=$1', [owner])).rows;
    assert.equal(table, 'rpc/create_fleet_invitation'); assert.equal(options.method, 'POST');
    const b = options.body;
    try { return (await db.query(rpcSql, [b.p_fleet_id, b.p_owner_user_id, b.p_owner_email, b.p_email, b.p_token_hash, b.p_replace_invitation_id])).rows[0].invitation; }
    catch (error) { error.details = { code: error.code, message: error.message }; throw error; }
  } };
} };
vm.runInNewContext(readFileSync(new URL('../api/fleet-invitations.js', import.meta.url), 'utf8'), routeContext);
async function post(body) { const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(value) { this.body = JSON.parse(value); } }; await routeContext.module.exports({ method: 'POST', headers: { 'content-type': 'application/json' }, body }, response); return response; }
try {
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(schema); await db.exec(migration);
  await db.exec(`grant usage on schema public,auth to anon,authenticated,service_role;
    grant select,insert,update on fleets,fleet_invitations to service_role;
    insert into auth.users values ('${owner}'),('${other}');
    insert into fleets(id,owner_user_id,company_name) values ('${fleet}','${owner}','Fixture A'),('${otherFleet}','${other}','Fixture B');`);

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`); await assert.rejects(rpc('fixture@example.com', 'a'.repeat(64)), /permission denied/); await db.exec('reset role');
  }
  await db.exec('grant select on fleet_invitations to authenticated; set role authenticated');
  assert.equal((await db.query('select * from fleet_invitations')).rows.length, 0); await db.exec('reset role');
  const security = (await db.query("select prosecdef,proconfig from pg_proc where proname='create_fleet_invitation'")).rows[0];
  assert.equal(security.prosecdef, false); assert.deepEqual(security.proconfig, ['search_path=public, pg_temp']);
  await db.exec('set role service_role');
  await assert.rejects(rpc('fixture@example.com', 'a'.repeat(64), null, other), /fleet_not_found/); assert.equal(await count(), 0);
  for (const [email, message] of [['bad', 'invalid_email'], [' OWNER@EXAMPLE.COM ', 'cannot_invite_self']]) await assert.rejects(rpc(email, 'a'.repeat(64)), new RegExp(message));

  // PGlite serializes statements; these simultaneous API calls exercise the
  // real transaction and errors. The fleet row lock is reviewed in source;
  // this fixture does not claim multi-connection PostgreSQL stress coverage.
  let results = await Promise.all([post({ email: 'Driver@Example.com' }), post({ email: ' driver@example.com ' })]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]); assert.equal(await count(), 1);
  const created = results.find(r => r.statusCode === 201).body.invitation;
  assert.match(created.accept_path, /^\/accept-invite.html#token=[\w-]{43}$/);
  assert.equal(created.email, 'driver@example.com'); assert.equal(JSON.stringify(created).includes('token_hash'), false);
  await assert.rejects(rpc(null, 'b'.repeat(64), created.id), /resend_too_soon/);
  await db.query("update fleet_invitations set created_at=clock_timestamp()-interval '2 minutes' where id=$1", [created.id]);

  // Force the exact formerly orphaning revoke failure after the new insert.
  await db.exec(`reset role; create function public.fixture_revoke_failure() returns trigger language plpgsql as $$ begin if new.revoked_at is not null then raise exception 'fixture_revoke_failed'; end if; return new; end $$;
    create trigger fixture_revoke_failure before update on fleet_invitations for each row execute function public.fixture_revoke_failure(); set role service_role;`);
  const failed = await post({ replace_invitation_id: created.id }); assert.equal(failed.statusCode, 502); assert.equal(await count(), 1);
  assert.equal((await db.query('select revoked_at from fleet_invitations')).rows[0].revoked_at, null);
  await db.exec('reset role; drop trigger fixture_revoke_failure on fleet_invitations; set role service_role');
  results = await Promise.all([post({ replace_invitation_id: created.id, email: 'attacker@example.com' }), post({ replace_invitation_id: created.id })]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 404]); assert.equal(await count(), 2);
  assert.equal(results.find(r => r.statusCode === 201).body.invitation.email, 'driver@example.com');
  assert.equal(Number((await db.query('select count(*) as n from fleet_invitations where revoked_at is null')).rows[0].n), 1);
  await assert.rejects(rpc(null, 'c'.repeat(64), created.id, other, otherFleet), /invitation_not_found/);

  await reset();
  await db.query(`insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at,created_at)
    select $1,'fixture-'||n||'@example.com',lpad(n::text,64,'0'),$2,clock_timestamp()+interval '1 day',clock_timestamp()-interval '2 minutes' from generate_series(1,19) n`, [fleet, owner]);
  results = await Promise.all([post({ email: 'boundary-a@example.com' }), post({ email: 'boundary-b@example.com' })]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 429]); assert.equal(await count(), 20);
  assert.equal(results.find(r => r.statusCode === 429).body.error, 'invitation_rate_limited'); assert.equal(results.find(r => r.statusCode === 429).headers['Retry-After'], '3600');

  await reset();
  await db.query(`insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at,created_at)
    select $1,'fixture-'||n||'@example.com',lpad(n::text,64,'0'),$2,clock_timestamp()+interval '1 day',clock_timestamp()-interval '2 hours' from generate_series(1,99) n`, [fleet, owner]);
  results = await Promise.all([post({ email: 'pending-a@example.com' }), post({ email: 'pending-b@example.com' })]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 429]); assert.equal(await count(), 100); assert.equal(results.find(r => r.statusCode === 429).body.error, 'too_many_pending_invitations');
  const replace = (await db.query('select id from fleet_invitations order by created_at limit 1')).rows[0].id;
  assert.equal((await post({ replace_invitation_id: replace })).statusCode, 201, 'replacement consumes no additional pending slot');
  assert.equal(Number((await db.query('select count(*) as n from fleet_invitations where revoked_at is null')).rows[0].n), 100);

  await reset();
  await db.query(`insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at,created_at)
    select $1,'expired-'||n||'@example.com',lpad(n::text,64,'0'),$2,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '2 hours' from generate_series(1,100) n`, [fleet, owner]);
  assert.equal((await post({ email: 'expired-1@example.com' })).statusCode, 201, 'expired invitations count for neither active duplicates nor pending quota');
  console.log('Invitation API/Postgres fixtures passed: duplicate/rate/pending boundaries, resend rollback/cooldown, ownership, permissions, RLS, and token privacy. PGlite uses one connection.');
} finally { await db.close(); }
