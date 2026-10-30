import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const driver='33333333-3333-4333-8333-333333333333', otherDriver='33333333-3333-4333-8333-333333333334';
const session='44444444-4444-4444-8444-444444444444', second='55555555-5555-4555-8555-555555555555';
const foreign='66666666-6666-4666-8666-666666666666', key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const path='../supabase/migrations/20261026164040_atomic_event_idempotency.sql';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sql='select public.record_idempotent_event($1::uuid,$2::uuid,$3::uuid,$4::text,$5::numeric,$6::numeric,$7::double precision,$8::double precision,$9::timestamptz) as result';
const db=new PGlite();
const defaults={p_user_id:owner,p_session_id:session,p_client_event_id:key,p_type:'drowsy',p_fatigue_score:30,p_confidence:80,p_latitude:null,p_longitude:null,p_occurred_at:null};
const rpc=async changes=>{const b={...defaults,...changes};return(await db.query(sql,Object.keys(defaults).map(k=>b[k]))).rows[0].result;};
const count=async table=>Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
const quota=async()=>Number((await db.query('select event_count from event_rate_limits where user_id=$1',[owner])).rows[0]?.event_count||0);
async function reset(){
 await db.exec(`reset role;truncate auth.users cascade;
 insert into auth.users values('${owner}'),('${other}');
 insert into drivers(id,user_id,name) values('${driver}','${owner}','Owner'),('${otherDriver}','${other}','Other');
 insert into sessions(id,driver_id,started_at) values('${session}','${driver}',clock_timestamp()-interval '1 hour'),('${second}','${driver}',clock_timestamp()-interval '1 hour'),('${foreign}','${otherDriver}',clock_timestamp()-interval '1 hour');set role service_role;`);
}
function harness({enabled=true,user={id:owner},fetcher}={}){
 const calls=[];const route=new URL('../api/events.js',import.meta.url), routeRequire=createRequire(route);
 const ctx={module:{exports:{}},process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',...(enabled?{OCCULERT_EVENT_IDEMPOTENCY_ENABLED:'true'}:{})}},require:name=>name==='./_lib/supabase'?{
  bearerToken:()=> 'fixture',verifyAccessToken:async()=>user,pgFetch:async(table,options)=>{
   calls.push({table,options});if(fetcher)return fetcher(table,options);
   assert.equal(table,'rpc/record_idempotent_event');assert.equal(options.method,'POST');
   return rpc(options.body);
  }
 }:routeRequire(name)};
 vm.runInNewContext(read('../api/events.js'),ctx,{filename:route.pathname});
 return{calls,post:async(body,method='POST',contentType='application/json')=>{const headers={};const res={setHeader:(k,v)=>headers[k]=v,end:value=>res.body=JSON.parse(value)};await ctx.module.exports({method,headers:{'content-type':contentType},body},res);return{status:res.statusCode,body:res.body,headers};}};
}
const event={session_id:session,client_event_id:key,type:'drowsy',fatigue_score:30,confidence:80};

test('atomic event idempotency SQL/API contract',async t=>{
 try{
 await db.exec(`set timezone='UTC';create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await db.exec(read('../db/schema.sql').replace('create extension if not exists "pgcrypto";',''));
 await db.exec(read('../supabase/migrations/20261022120000_revoke_direct_table_access.sql'));
 await db.exec(read(path));
 await db.exec('grant usage on schema public to anon,authenticated,service_role');
 await t.test('service-only invoker RPC and closed RLS survive accidental client SELECT grants',async()=>{
  await reset();await db.exec('reset role');
  const s=(await db.query("select prosecdef,proconfig from pg_proc where proname='record_idempotent_event'")).rows[0];
  assert.equal(s.prosecdef,false);assert.deepEqual(s.proconfig,['search_path=public, pg_temp']);
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);await assert.rejects(rpc(),/permission denied/);
   for(const table of ['event_idempotency','event_rate_limits'])await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
   await db.exec('reset role');
  }
  await rpc();await db.exec('grant select on event_idempotency,event_rate_limits to authenticated;set role authenticated');
  for(const table of ['event_idempotency','event_rate_limits'])assert.equal(await count(table),0);
  await db.exec('reset role;revoke select on event_idempotency,event_rate_limits from authenticated');
 });
 await t.test('direct RPC rejects invalid identity/type/nonfinite metrics before reserving a key',async()=>{
  await reset();
  for(const change of [{p_user_id:null},{p_session_id:null},{p_type:null},{p_type:'unsafe'},
   {p_fatigue_score:'NaN'},{p_fatigue_score:'Infinity'},{p_confidence:-1},
   {p_latitude:'NaN'},{p_longitude:'Infinity'},{p_latitude:91}]){
   assert.equal((await rpc(change)).error,'invalid_event');
  }
  assert.equal(await count('events'),0);assert.equal(await count('event_idempotency'),0);assert.equal(await quota(),0);
 });
 await t.test('same accepted request returns original event without another quota unit',async()=>{
  await reset();const first=await rpc(),repeat=await rpc();assert.equal(first.replayed,false);assert.equal(repeat.replayed,true);
  assert.deepEqual(repeat.event,first.event);assert.equal(await count('events'),1);assert.equal(await quota(),1);
  assert.equal(await count('event_idempotency'),1);assert.equal(first.client_event_id,key);
  const stored=(await db.query('select * from event_idempotency')).rows[0];assert.equal(stored.payload_sha256.length,32);assert.equal(Object.keys(stored).length,4);
 });
 await t.test('canonical typed identity preserves microseconds and normalizes UUID/time/numeric representations',async()=>{
  await reset();const timestamp=(await db.query("select to_char(clock_timestamp()-interval '5 minutes','YYYY-MM-DD') as day")).rows[0].day;
  // Use a fixed in-session instant derived from the DB with a microsecond fraction.
  const ts=(await db.query("select to_char(clock_timestamp()-interval '5 minutes','YYYY-MM-DD\"T\"HH24:MI:SS')||'.123456+00:00' as ts")).rows[0].ts;
  assert.ok(timestamp);const first=await rpc({p_occurred_at:ts,p_latitude:-0,p_fatigue_score:'30.000'});
  const equivalent=(await db.query(`select to_char($1::timestamptz at time zone 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS.US')||'+05:30' as ts`,[ts])).rows[0].ts;
  await db.exec("set timezone='America/Los_Angeles'");
  const again=await rpc({p_client_event_id:key.toUpperCase(),p_occurred_at:equivalent,p_latitude:0,p_fatigue_score:30});
  await db.exec("set timezone='UTC'");
  assert.equal(again.replayed,true);assert.equal(again.event.id,first.event.id);
  assert.match(first.event.created_at,/\.123456/);
  assert.equal((await rpc({p_occurred_at:ts.replace('123456','123457'),p_latitude:0})).error,'event_id_conflict');
 });
 await t.test('coordinate fingerprint is stable across float text settings without losing precision',async()=>{
  await reset();const coord=12.123456789012345;
  await db.exec('set extra_float_digits=3');const first=await rpc({p_latitude:coord});
  await db.exec('set extra_float_digits=-3');const replay=await rpc({p_latitude:coord});
  assert.equal(replay.replayed,true);assert.equal(replay.event.id,first.event.id);
  assert.equal((await rpc({p_latitude:12.123456789012347})).error,'event_id_conflict');
  await db.exec('set extra_float_digits=3');
 });
 await t.test('different immutable fields conflict, never mutate original or consume quota',async()=>{
  await reset();const first=await rpc();
  for(const change of [{p_session_id:second},{p_type:'yawn'},{p_fatigue_score:31},{p_confidence:null},{p_latitude:1},{p_longitude:1},{p_occurred_at:new Date(Date.now()-60000).toISOString()}])assert.equal((await rpc(change)).error,'event_id_conflict');
  assert.deepEqual((await rpc()).event,first.event);assert.equal(await count('events'),1);assert.equal(await quota(),1);
 });
 await t.test('unauthorized replays cannot probe other owners, but same UUID under another owner is independent',async()=>{
  await reset();await rpc();assert.equal((await rpc({p_user_id:other})).error,'session_not_found');
  assert.equal((await rpc({p_session_id:foreign})).error,'session_not_found');
  assert.equal((await rpc({p_user_id:other,p_session_id:foreign})).replayed,false);assert.equal(await count('events'),2);
  await db.exec(`reset role;update drivers set user_id=null where id='${driver}';set role service_role`);
  assert.equal((await rpc()).error,'session_not_found');assert.equal(await count('events'),2);
 });
 await t.test('accepted replay survives ended grace, new identity does not reopen session',async()=>{
  await reset();const first=await rpc();await db.exec(`update sessions set ended_at=clock_timestamp()-interval '3 minutes' where id='${session}'`);
  assert.equal((await rpc()).event.id,first.event.id);
  assert.equal((await rpc({p_client_event_id:second})).error,'session_ended');assert.equal(await quota(),1);
 });
 await t.test('invalid occurrence does not reserve identity; omitted-time fallback can succeed once',async()=>{
  await reset();for(const ts of ['2000-01-01','2099-01-01','infinity','-infinity'])assert.equal((await rpc({p_occurred_at:ts})).error,'invalid_occurred_at');
  assert.equal(await count('event_idempotency'),0);assert.equal(await quota(),0);
  const first=await rpc();assert.equal(first.replayed,false);assert.equal((await rpc()).replayed,true);
  assert.equal((await rpc({p_occurred_at:first.event.created_at})).error,'event_id_conflict','explicit timestamp differs from omitted intent');
 });
 await t.test('omitted-time storage is server bounded, including session-end grace',async()=>{
  await reset();
  const before=(await db.query('select clock_timestamp()::text as now')).rows[0].now;
  const first=await rpc();
  const after=(await db.query('select clock_timestamp()::text as now')).rows[0].now;
  const inRange=(await db.query('select $1::timestamptz between $2::timestamptz and $3::timestamptz as ok',[first.event.created_at,before,after])).rows[0].ok;
  assert.equal(inRange,true,'active-session omission uses server processing time');
  await db.exec(`update sessions set ended_at=clock_timestamp()-interval '30 seconds' where id='${session}'`);
  const grace=await rpc({p_client_event_id:second});
  const matchesEnd=(await db.query('select ended_at=$1::timestamptz as ok from sessions where id=$2',[grace.event.created_at,session])).rows[0].ok;
  assert.equal(matchesEnd,true,'grace fallback is session end, not receipt or detected time');
  assert.equal(await count('events'),2);assert.equal(await quota(),2);
 });
 await t.test('user burst budget shared across sessions and keyed/unkeyed writes; duplicates free at quota',async()=>{
  await reset();const first=await rpc();
  for(let n=1;n<60;n++)assert.ok((await rpc({p_client_event_id:null,p_session_id:n%2?second:session})).event);
  const limited=await rpc({p_client_event_id:second});assert.equal(limited.error,'event_rate_limited');assert.ok(limited.retry_after>=1&&limited.retry_after<=60);
  assert.equal((await rpc()).event.id,first.event.id);assert.equal(await quota(),60);assert.equal(await count('events'),60);
  await db.exec("update event_rate_limits set window_started_at=clock_timestamp()-interval '61 seconds'");
  assert.equal((await rpc({p_client_event_id:second})).replayed,false);assert.equal(await quota(),1);
 });
 await t.test('500/session cap applies only to newly accepted event, not replay',async()=>{
  await reset();const first=await rpc();await db.exec(`insert into events(session_id,type) select '${session}','drowsy' from generate_series(1,499)`);
  assert.equal((await rpc({p_client_event_id:second})).error,'session_event_limit');assert.equal((await rpc()).event.id,first.event.id);
  assert.equal(await count('events'),500);assert.equal(await quota(),1);
 });
 await t.test('legacy null keys intentionally remain new events, while parallel submissions converge',async()=>{
  await reset();await rpc({p_client_event_id:null});await rpc({p_client_event_id:null});assert.equal(await count('events'),2);
  const results=await Promise.all(Array.from({length:12},()=>rpc()));
  assert.equal(new Set(results.map(r=>r.event.id)).size,1);assert.equal(results.filter(r=>!r.replayed).length,1);
  assert.equal(await count('events'),3);assert.equal(await quota(),3);
  // PGlite serializes one connection; this is not proof of multi-connection locking.
 });
 await t.test('database unique identity rejects an out-of-protocol duplicate ledger insert',async()=>{
  await reset();await rpc();await assert.rejects(db.exec('insert into event_idempotency select * from event_idempotency'),/duplicate key/);
 });
 await t.test('event or receipt failures roll back event, ledger, and quota in one transaction',async()=>{
  for(const table of ['events','event_idempotency']){
   await reset();await db.exec(`reset role;create function fixture_fail() returns trigger language plpgsql as $$begin raise exception 'fixture_insert_failed';end$$;create trigger fixture_fail before insert on ${table} for each row execute function fixture_fail();set role service_role`);
   await assert.rejects(rpc(),/fixture_insert_failed/);assert.equal(await count('events'),0);assert.equal(await count('event_idempotency'),0);assert.equal(await quota(),0);
   await db.exec(`reset role;drop trigger fixture_fail on ${table};drop function fixture_fail();set role service_role`);assert.equal((await rpc()).replayed,false);
  }
 });
 await t.test('session/account deletion cascades receipts; old owner cannot replay deleted data',async()=>{
  await reset();await rpc();await db.exec(`delete from sessions where id='${session}'`);assert.equal(await count('event_idempotency'),0);assert.equal((await rpc()).error,'session_not_found');
  await reset();await rpc();await db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role`);
  assert.equal(await count('event_idempotency'),0);assert.equal(await count('event_rate_limits'),0);assert.equal(await count('events'),0);
 });
 await t.test('API default-off fails closed for keyed requests and preserves legacy handler',async()=>{
  await reset();const h=harness({enabled:false});assert.equal((await h.post(event)).status,503);assert.equal(h.calls.length,0);
  const legacy=harness({enabled:false,fetcher:async(table,options)=>{
   if(table==='drivers')return[{id:driver}];if(table==='sessions')return[{id:session,started_at:new Date(Date.now()-60000).toISOString(),ended_at:null}];
   assert.equal(table,'events');return[{id:key,...options.body}];
  }});const {client_event_id,...body}=event;assert.equal((await legacy.post(body)).status,200);assert.equal(legacy.calls.at(-1).table,'events');
 });
 await t.test('API verifies owner, snapshots canonical current validation, and never automatically retries',async()=>{
  await reset();const h=harness();const first=await h.post({...event,owner_id:other,user_id:other,fatigue_score:'120',latitude:999,longitude:'12.5'});
  assert.equal(first.status,200);assert.equal(first.body.event.fatigue_score,100);assert.equal(first.body.event.latitude,null);assert.equal(first.body.event.longitude,12.5);
  assert.equal(h.calls[0].options.body.p_user_id,owner);assert.equal((await h.post({...event,fatigue_score:100,latitude:null,longitude:12.5})).body.replayed,true);
  assert.equal((await h.post({...event,confidence:1})).status,409);
  let attempts=0;const fail=harness({fetcher:async()=>{attempts++;throw Object.assign(new Error('timeout'),{status:504});}});
  assert.equal((await fail.post(event)).status,504);assert.equal(attempts,1);
 });
 await t.test('API validates keys/time/auth before RPC and rejects false acceptance',async()=>{
  await reset();for(const value of [null,undefined,[],{},'bad',123]){const h=harness();assert.equal((await h.post({...event,client_event_id:value})).status,400);assert.equal(h.calls.length,0);}
  for(const value of [null,123,'bad','2026-10-26T12:00:00.1234567Z']){const h=harness();assert.equal((await h.post({...event,occurred_at:value})).status,400);assert.equal(h.calls.length,0);}
  const unauth=harness({user:null});assert.equal((await unauth.post(event)).status,401);assert.equal(unauth.calls.length,0);
  for(const result of [null,{}, {event:{id:key,session_id:session},replayed:false}, {event:{id:key,session_id:foreign},client_event_id:key,replayed:false}])assert.equal((await harness({fetcher:async()=>result}).post(event)).status,502);
  const unavailable=harness({fetcher:async()=>{throw new Error('missing_rpc')}});assert.equal((await unavailable.post(event)).status,502);assert.equal(unavailable.calls.length,1);
 });
 await t.test('API forwards accepted occurrence spelling and microseconds unchanged',async()=>{
  await reset();const occurred_at=new Date(Date.now()-60000).toISOString().replace('Z','123Z');
  const h=harness();const result=await h.post({...event,occurred_at});assert.equal(result.status,200);
  assert.equal(h.calls[0].options.body.p_occurred_at,occurred_at);assert.equal((await h.post({...event,occurred_at})).body.replayed,true);
 });
 await t.test('API maps quota to bounded Retry-After and permanent conflicts',async()=>{
  for(const [error,status] of [['event_rate_limited',429],['session_event_limit',429],['session_ended',409],['event_id_conflict',409],['invalid_occurred_at',400],['session_not_found',404]]){
   const result=await harness({fetcher:async()=>({error,retry_after:999})}).post(event);assert.equal(result.status,status);if(error==='event_rate_limited')assert.equal(result.headers['Retry-After'],'60');
  }
 });
 }finally{await db.close();}
});
