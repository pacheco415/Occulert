import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL roles and fixture identities, never a deployed database.
const db = new PGlite();
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').replace('create extension if not exists "pgcrypto";', '');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ownerA = id(1), ownerB = id(2), driverA = id(3), driverB = id(4), unassigned = id(5), fleetA = id(11), fleetB = id(12), profileA = id(13), profileB = id(14), sessionA = id(23), sessionB = id(24);
const tables = ['fleets', 'drivers', 'sessions', 'events', 'fleet_invitations', 'pilot_leads'];
async function asUser(user, expected) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  for (const table of tables) assert.equal(Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n), expected[table] || 0, `${user} visible ${table} rows`);
  await db.exec('reset role');
}
try {
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(schema);
  await db.exec(`grant usage on schema public,auth to anon,authenticated,service_role;
    grant select,insert,update,delete on all tables in schema public to anon,authenticated,service_role;
    insert into auth.users values ('${ownerA}'),('${ownerB}'),('${driverA}'),('${driverB}'),('${unassigned}');
    insert into fleets(id,owner_user_id,company_name) values ('${fleetA}','${ownerA}','Fixture A'),('${fleetB}','${ownerB}','Fixture B');
    insert into drivers(id,user_id,fleet_id,name,email) values ('${profileA}','${driverA}','${fleetA}','A','a@example.com'),('${profileB}','${driverB}','${fleetB}','B','b@example.com'),('${id(15)}','${unassigned}',null,'Unassigned','unassigned@example.com');
    insert into sessions(id,driver_id,fleet_id) values ('${sessionA}','${profileA}','${fleetA}'),('${sessionB}','${profileB}','${fleetB}');
    insert into events(session_id,type) values ('${sessionA}','fixture'),('${sessionB}','fixture');
    insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at) values ('${fleetA}','unassigned@example.com','${'a'.repeat(64)}','${ownerA}',clock_timestamp()+interval '1 day');
    insert into pilot_leads(name,company,email) values ('Fixture','Fixture','contact@example.invalid');`);
  await asUser(ownerA, { fleets: 1, drivers: 1, sessions: 1 });
  await asUser(ownerB, { fleets: 1, drivers: 1, sessions: 1 });
  await asUser(driverA, { drivers: 1, sessions: 1, events: 1 });
  await asUser(driverB, { drivers: 1, sessions: 1, events: 1 });
  await asUser(unassigned, { drivers: 1 });
  await asUser(id(99), {});
  await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)");
  for (const table of tables) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
  await db.exec('reset role');

  // Even intentionally broad fixture grants do not permit direct writes.
  await db.exec('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [driverA]);
  assert.equal((await db.query('update drivers set fleet_id=$1 where id=$2 returning id', [fleetB, profileA])).rows.length, 0);
  assert.equal((await db.query('delete from sessions where id=$1 returning id', [sessionA])).rows.length, 0);
  await assert.rejects(db.query('insert into sessions(driver_id,fleet_id) values($1,$2)', [profileA, fleetA]), /row-level security/);
  await assert.rejects(db.query('insert into events(session_id,type) values($1,$2)', [sessionA, 'fixture']), /row-level security/);
  await assert.rejects(db.query('insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at) values($1,$2,$3,$4,now())', [fleetA, 'fixture@example.com', 'b'.repeat(64), driverA]), /row-level security/);
  await assert.rejects(db.query('select public.accept_fleet_invitation($1,$2,$3)', ['a'.repeat(64), unassigned, 'unassigned@example.com']), /permission denied/);
  await db.exec('reset role');
  await db.exec('set role service_role');
  const accept = async (hash, actor, email) => (await db.query('select public.accept_fleet_invitation($1,$2::uuid,$3) as result', [hash, actor, email])).rows[0].result;
  await assert.rejects(accept('a'.repeat(64), unassigned, 'attacker@example.com'), /invitation_email_mismatch/);
  const accepted = await accept('a'.repeat(64), unassigned, ' UNASSIGNED@example.com '); assert.equal(accepted.fleet_id, fleetA);
  await assert.rejects(accept('a'.repeat(64), unassigned, 'unassigned@example.com'), /invitation_already_used/);
  await db.query('insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at) values($1,$2,$3,$4,clock_timestamp()+interval\'1 day\')', [fleetA, 'b@example.com', 'c'.repeat(64), ownerA]);
  await assert.rejects(accept('c'.repeat(64), driverB, 'b@example.com'), /driver_already_assigned/);
  assert.equal((await db.query('select fleet_id from drivers where id=$1', [profileB])).rows[0].fleet_id, fleetB);
  // Both requests read an absent profile before either inserts. The real
  // unique index rejects the second insert; the API recovers by user scope.
  const concurrentUser = id(6);
  await db.exec('reset role'); await db.query('insert into auth.users values($1)', [concurrentUser]); await db.exec('set role service_role');
  let reads = 0, releaseReads, recovered = 0;
  const bothRead = new Promise(resolve => { releaseReads = resolve; });
  const require = createRequire(import.meta.url);
  const context = { module: { exports: {} }, process: { env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role' } }, require(name) {
    if (name !== './_lib/supabase') return require(name);
    return { verifyAccessToken: async () => ({ id: concurrentUser, email: 'concurrent@example.com' }), bearerToken: () => 'fixture-token', async pgFetch(table, options) {
      assert.equal(table, 'drivers');
      if (!options.method) {
        assert.equal(options.params.user_id, 'eq.' + concurrentUser);
        const rows = (await db.query('select * from drivers where user_id=$1', [concurrentUser])).rows;
        assert.equal(rows.length, 0); if (++reads === 2) releaseReads(); await bothRead; return rows;
      }
      const b = options.body;
      if (options.method === 'POST') {
        assert.equal(b.user_id, concurrentUser); assert.equal(b.fleet_id, null);
        try { return (await db.query('insert into drivers(user_id,fleet_id,name,email,vehicle_id,active) values($1,$2,$3,$4,$5,$6) returning *', [b.user_id,b.fleet_id,b.name,b.email,b.vehicle_id,b.active])).rows; }
        catch (error) { error.details = { code: error.code }; throw error; }
      }
      assert.equal(options.method, 'PATCH'); assert.deepEqual(JSON.parse(JSON.stringify(options.params)), { user_id: 'eq.' + concurrentUser });
      assert.equal(Object.hasOwn(b, 'fleet_id'), false); assert.equal(Object.hasOwn(b, 'user_id'), false); recovered++;
      return (await db.query('update drivers set name=$1,email=$2,vehicle_id=$3,active=$4 where user_id=$5 returning *', [b.name,b.email,b.vehicle_id,b.active,concurrentUser])).rows;
    } };
  } };
  vm.runInNewContext(readFileSync(new URL('../api/profile.js', import.meta.url), 'utf8'), context);
  const onboard = async name => {
    const response = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await context.module.exports({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { name, fleet_id: fleetB, user_id: driverB } }, response); return response;
  };
  const profiles = await Promise.all([onboard('One'), onboard('Two')]);
  assert.deepEqual(profiles.map(r => r.statusCode), [200, 200]); assert.equal(recovered, 1);
  assert.equal(profiles[0].body.driver.id, profiles[1].body.driver.id);
  const ownProfile = (await db.query('select * from drivers where user_id=$1', [concurrentUser])).rows;
  assert.equal(ownProfile.length, 1); assert.equal(ownProfile[0].fleet_id, null);
  assert.equal((await db.query('select name,fleet_id from drivers where user_id=$1', [driverB])).rows[0].name, 'B');
  assert.equal((await db.query('select name,fleet_id from drivers where user_id=$1', [driverB])).rows[0].fleet_id, fleetB);

  const policyCount = Number((await db.query("select count(*) as n from pg_policies where schemaname='public'")).rows[0].n); assert.equal(policyCount, 6);
  console.log('Tenant/RLS PostgreSQL fixtures passed: two owners, two members, unassigned/anonymous identities, closed writes and PII tables, invitation identity/one-time/assignment boundaries and concurrent profile recovery.');
} finally { await db.close(); }
