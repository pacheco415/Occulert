import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import vm from 'node:vm';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const driver = '33333333-3333-4333-8333-333333333333', session = '44444444-4444-4444-8444-444444444444', second = '55555555-5555-4555-8555-555555555555';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = 'select record_limited_event($1::uuid,$2::uuid,$3::text,$4::numeric,$5::numeric,$6::double precision,$7::double precision,$8::timestamptz) as result';
const rpc = async (id = session, actor = owner, occurred = null) => (await db.query(sql, [actor,id,'drowsy',30,80,null,null,occurred])).rows[0].result;
const count = async () => Number((await db.query('select count(*) as n from events')).rows[0].n);
const context = { module:{exports:{}}, process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-key',OCCULERT_EVENT_LIMITS_ENABLED:'true'}}, require() { return {
  verifyAccessToken:async () => ({id:owner}), bearerToken:()=> 'fixture-token', pgFetch:async (table,options) => {
    assert.equal(table,'rpc/record_limited_event');assert.equal(options.method,'POST');const b=options.body;
    assert.equal(b.p_user_id,owner,'identity must come from verified token');
    return (await db.query(sql,[b.p_user_id,b.p_session_id,b.p_type,b.p_fatigue_score,b.p_confidence,b.p_latitude,b.p_longitude,b.p_occurred_at])).rows[0].result;
  },
}; } };
vm.runInNewContext(read('api/events.js'),context);
const post = async body => { const response={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}}; await context.module.exports({method:'POST',headers:{'content-type':'application/json'},body},response); return response; };
try {
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.exec(read('db/schema.sql').replace('create extension if not exists "pgcrypto";',''));
  await db.exec(read('supabase/migrations/20261003192000_atomic_event_quotas.sql'));
  await db.exec(`insert into auth.users values('${owner}'),('${other}');insert into drivers(id,user_id,name) values('${driver}','${owner}','Fixture');insert into sessions(id,driver_id,started_at) values('${session}','${driver}',clock_timestamp()-interval '1 hour'),('${second}','${driver}',clock_timestamp()-interval '1 hour');grant usage on schema public to anon,authenticated,service_role;grant select on events to service_role;`);
  for (const role of ['anon','authenticated']) { await db.exec(`set role ${role}`);await assert.rejects(rpc(),/permission denied/);await db.exec('reset role'); }
  await db.exec('grant select on event_rate_limits to authenticated;set role authenticated');
  assert.equal((await db.query('select * from event_rate_limits')).rows.length,0);await db.exec('reset role');
  const security=(await db.query("select prosecdef,proconfig from pg_proc where proname='record_limited_event'")).rows[0];assert.equal(security.prosecdef,true);assert.deepEqual(security.proconfig,['search_path=public, pg_temp']);
  await db.exec('set role service_role');
  assert.equal((await rpc(session,other)).error,'session_not_found');assert.equal(await count(),0);
  const first=await post({session_id:session,type:'drowsy',owner_id:other,fatigue_score:120,confidence:80});assert.equal(first.statusCode,200);assert.equal(first.body.event.fatigue_score,100);assert.equal(first.body.telemetry_trust,'unverified_client_report');
  for(let n=1;n<60;n++) assert.ok((await rpc(n%2?second:session)).event);
  const limited=await post({session_id:second,type:'drowsy'});assert.equal(limited.statusCode,429);assert.equal(limited.body.error,'event_rate_limited');assert.ok(Number(limited.headers['Retry-After'])>=1);assert.equal(await count(),60);
  await db.exec(`reset role;update event_rate_limits set window_started_at=clock_timestamp()-interval '61 seconds';set role service_role`);assert.ok((await rpc()).event);
  await db.exec(`reset role;update sessions set ended_at=clock_timestamp()-interval '3 minutes' where id='${second}';set role service_role`);assert.equal((await rpc(second)).error,'session_ended');
  const ended=await post({session_id:second,type:'drowsy'});assert.equal(ended.statusCode,409);
  assert.equal((await rpc(session,owner,'2000-01-01T00:00:00Z')).error,'invalid_occurred_at');assert.equal((await rpc(session,owner,'2099-01-01T00:00:00Z')).error,'invalid_occurred_at');
  await db.exec(`reset role;truncate events,event_rate_limits;insert into events(session_id,type) select '${session}','drowsy' from generate_series(1,499);set role service_role`);assert.ok((await rpc()).event);assert.equal((await rpc()).error,'session_event_limit');assert.equal(await count(),500);
  await db.exec(`reset role;truncate events,event_rate_limits;create function fixture_event_failure() returns trigger language plpgsql as $$begin raise exception 'fixture_insert_failed';end$$;create trigger fixture_event_failure before insert on events for each row execute function fixture_event_failure();set role service_role`);await assert.rejects(rpc(),/fixture_insert_failed/);assert.equal(await count(),0);
  await db.exec('reset role');assert.equal((await db.query('select * from event_rate_limits')).rows.length,0,'failed event insert must roll back bucket creation');
  await db.exec('drop trigger fixture_event_failure on events;set role service_role');assert.ok((await rpc()).event);
  await db.exec(`reset role;delete from auth.users where id='${owner}'`);assert.equal((await db.query('select * from event_rate_limits')).rows.length,0,'account deletion removes its rate bucket');
  console.log('Event quota SQL/API fixtures passed: tenant/permission/RLS denial, shared burst/cap boundaries, completion/time checks, rollback and deletion cleanup. PGlite serializes one connection.');
} finally { await db.close(); }
