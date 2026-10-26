// Explicit local-only acceptance harness. Never accepts a database URL.
// Runtime packages live outside the repository; see docs/EVENT_IDEMPOTENCY.md.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const runtime=process.env.OCCULERT_PG_TEST_RUNTIME;
if(!runtime||!isAbsolute(runtime))throw new Error('Set OCCULERT_PG_TEST_RUNTIME to an absolute local directory containing pinned pg and @embedded-postgres/linux-x64 packages. No remote database is supported.');
const require=createRequire(join(runtime,'package.json'));
const {initdb,pg_ctl}=require('@embedded-postgres/linux-x64');
const {Client}=require('pg');
const root=mkdtempSync(join(tmpdir(),'occulert-idempotency-pg-'));
const data=join(root,'data');const clients=[];let initialized=false;
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const driver='33333333-3333-4333-8333-333333333333',session='44444444-4444-4444-8444-444444444444',second='55555555-5555-4555-8555-555555555555',key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const query='select record_idempotent_event($1::uuid,$2::uuid,$3::uuid,$4::text,$5::numeric,$6::numeric,$7::double precision,$8::double precision,$9::timestamptz) as result';
const args=(id=key,idSession=session)=>[owner,idSession,id,'drowsy',30,80,null,null,null];
async function connect(role=false){const c=new Client({host:root,port:55432,user:'fixture',database:'postgres'});await c.connect();clients.push(c);await c.query("set statement_timeout='10s';set timezone='UTC'");if(role)await c.query('set role service_role');return c;}
const rpc=async(c,values=args())=>(await c.query(query,values)).rows[0].result;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 execFileSync(initdb,['-D',data,'-U','fixture','--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject'],{stdio:'pipe'});initialized=true;
 // Private mkdtemp socket directory; TCP entirely disabled, no credentials saved.
 execFileSync(pg_ctl,['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${root} -p 55432 -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});
 const admin=await connect();
 await admin.query(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await admin.query(read('../db/schema.sql').replace('create extension if not exists "pgcrypto";',''));
 await admin.query(read('../supabase/migrations/20261022120000_revoke_direct_table_access.sql'));
 await admin.query(read('../supabase/migrations/20261026164040_atomic_event_idempotency.sql'));
 await admin.query('grant usage on schema public to service_role');
 const worker=await Promise.all(Array.from({length:12},()=>connect(true)));
 const reset=async()=>admin.query(`truncate auth.users cascade;insert into auth.users values('${owner}'),('${other}');insert into drivers(id,user_id,name) values('${driver}','${owner}','Fixture');insert into sessions(id,driver_id,started_at) values('${session}','${driver}',clock_timestamp()-interval '1 hour'),('${second}','${driver}',clock_timestamp()-interval '1 hour');`);
 const state=async()=> (await admin.query(`select (select count(*)::int from events) as events,(select count(*)::int from event_idempotency) as receipts,(select event_count from event_rate_limits where user_id='${owner}') as quota`)).rows[0];
 await reset();
 // Hold the first event insert long enough for the other independent backend
 // connections to overlap on the initial bucket creation/owner lock.
 await admin.query(`create function fixture_delay() returns trigger language plpgsql as $$begin perform pg_sleep(0.3);return new;end$$;create trigger fixture_delay before insert on events for each row execute function fixture_delay();`);
 const simultaneous=Promise.all(worker.map(c=>rpc(c)));
 await sleep(100);
 const waiting=Number((await admin.query("select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like 'select record_idempotent_event%'")).rows[0].count);
 assert.ok(waiting>0,'independent concurrent requests must actually contend on locks');
 const first=await simultaneous;
 assert.equal(first.filter(r=>!r.replayed).length,1);assert.equal(new Set(first.map(r=>r.event.id)).size,1);
 assert.deepEqual(await state(),{events:1,receipts:1,quota:1});
 await admin.query('drop trigger fixture_delay on events;drop function fixture_delay()');
 console.log('PASS: 12 simultaneous first-key requests, real lock contention, one event/receipt/quota.');

 await reset();await rpc(worker[0]);await admin.query('update event_rate_limits set event_count=59');
 const atLimit=await Promise.all(worker.map((c,n)=>rpc(c,args(`aaaaaaaa-aaaa-4aaa-8aaa-${String(n+1).padStart(12,'0')}`,n%2?second:session))));
 assert.equal(atLimit.filter(r=>r.event).length,1);assert.equal(atLimit.filter(r=>r.error==='event_rate_limited').length,11);
 assert.deepEqual(await state(),{events:2,receipts:2,quota:60});assert.equal((await rpc(worker[0])).replayed,true);
 console.log('PASS: concurrent cross-session burst boundary accepts only one remaining quota unit; replay stays free.');

 await reset();await admin.query(`insert into events(session_id,type) select '${session}','drowsy' from generate_series(1,499)`);
 const atCap=await Promise.all(worker.map((c,n)=>rpc(c,args(`bbbbbbbb-bbbb-4bbb-8bbb-${String(n+1).padStart(12,'0')}`))));
 assert.equal(atCap.filter(r=>r.event).length,1);assert.equal(atCap.filter(r=>r.error==='session_event_limit').length,11);
 assert.deepEqual(await state(),{events:500,receipts:1,quota:1});
 console.log('PASS: concurrent session cap accepts only the 500th event.');

 await reset();const original=await rpc(worker[0]);
 const different=await Promise.all(worker.map((c,n)=>rpc(c,[...args().slice(0,4),n%2?31:30,80,null,null,null])));
 assert.equal(different.filter(r=>r.replayed).length,6);assert.equal(different.filter(r=>r.error==='event_id_conflict').length,6);
 assert.deepEqual(await state(),{events:1,receipts:1,quota:1});
 console.log('PASS: concurrent equal/conflicting payloads preserve original and do not consume quota.');

 const closer=await connect();await closer.query('begin');await closer.query(`update sessions set ended_at=clock_timestamp()-interval '3 minutes' where id='${session}'`);
 let settled=false;const pending=rpc(worker[1],args(second)).then(result=>{settled=true;return result;});
 await sleep(100);assert.equal(settled,false,'new event should wait on concurrent session completion');await closer.query('commit');
 assert.equal((await pending).error,'session_ended');assert.equal((await rpc(worker[2])).event.id,original.event.id);
 assert.deepEqual(await state(),{events:1,receipts:1,quota:1});
 console.log('PASS: session-end lock wait rechecks current grace; accepted replay still returns original.');

 await reset();await rpc(worker[0]);const deleter=await connect();await deleter.query('begin');await deleter.query(`delete from sessions where id='${session}'`);
 const afterDelete=rpc(worker[1]);await sleep(100);await deleter.query('commit');
 assert.equal((await afterDelete).error,'session_not_found');assert.deepEqual(await state(),{events:0,receipts:0,quota:1});
 console.log('PASS: deletion contention cannot acknowledge or recreate removed session data.');
 console.log('Local PostgreSQL version:',(await admin.query('show server_version')).rows[0].server_version);
}catch(error){
 try{console.error(readFileSync(join(root,'postgres.log'),'utf8'));}catch{}
 throw error;
}finally{
 await Promise.allSettled(clients.map(c=>c.end()));
 if(initialized){
  let active=false;
  try{execFileSync(pg_ctl,['-D',data,'status'],{stdio:'pipe'});active=true;}
  catch(error){if(error.status!==3)throw error;}
  // Never remove a cluster while an uncertain startup may have left it running.
  if(active)execFileSync(pg_ctl,['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});
 }
 rmSync(root,{recursive:true,force:true});
}
