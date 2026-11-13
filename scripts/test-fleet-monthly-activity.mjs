import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const { monthlyActivity } = require('../api/_lib/fleet-monthly-activity');
const OWNER='11111111-1111-4111-8111-111111111111';
const FLEET='22222222-2222-4222-8222-222222222222';
const OTHER='99999999-9999-4999-8999-999999999999';
const report={version:1,definition:'completed_session_v1',timezone:'America/Los_Angeles',month:'2026-11',
  as_of:'2026-11-07T14:00:00Z',active_drivers:73};

test('complete calendar aggregate uses completion, distinct drivers and historical fleet, independent of roster and 50-row cap', async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table fleets(id uuid primary key,owner_user_id uuid);
      create table sessions(id uuid default gen_random_uuid(),fleet_id uuid,driver_id uuid,
        started_at timestamptz,ended_at timestamptz);
      alter table fleets enable row level security; alter table sessions enable row level security;
      grant select on fleets,sessions to service_role;
      create policy service_fleets on fleets to service_role using(true);
      create policy service_sessions on sessions to service_role using(true);`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261107160000_fleet_monthly_activity.sql',import.meta.url),'utf8'));
    await db.query('insert into fleets values($1,$2)',[FLEET,OWNER]);
    // One transaction freezes now(), making first-of-month fixtures deterministic.
    await db.exec(`begin; set local timezone='Pacific/Honolulu';
      insert into sessions(fleet_id,driver_id,started_at,ended_at)
        select '${FLEET}',gen_random_uuid(),now()-interval '1 second',now()
        from generate_series(1,75);
      -- Duplicate completions do not add drivers.
      insert into sessions(fleet_id,driver_id,started_at,ended_at)
        select fleet_id,driver_id,started_at,ended_at from sessions;
      -- A session begun last month and completed at the Pacific boundary counts.
      insert into sessions(fleet_id,driver_id,started_at,ended_at)
        select '${FLEET}',gen_random_uuid(),m-interval '1 hour',m from
          (select date_trunc('month',now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' as m) t;
      -- Previous month, null end, reversed duration, future end, and another fleet do not count.
      insert into sessions(fleet_id,driver_id,started_at,ended_at) values
        ('${FLEET}',gen_random_uuid(),now()-interval '40 days',
          (date_trunc('month',now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles')-interval '1 microsecond'),
        ('${FLEET}',gen_random_uuid(),now(),null),
        ('${FLEET}',gen_random_uuid(),now()+interval '1 second',now()),
        ('${FLEET}',gen_random_uuid(),now(),now()+interval '1 second'),
        ('${OTHER}',gen_random_uuid(),now(),now());`);
    const query='select fleet_monthly_activity($1::uuid,$2::uuid) as value';
    await db.exec('set local role service_role');
    const {rows:[{value}]}=await db.query(query,[OWNER,FLEET]);
    assert.equal(value.active_drivers,76);
    assert.equal(value.timezone,'America/Los_Angeles');
    assert.equal(monthlyActivity(value)?.month,value.month);
    assert.equal((await db.query(query,[OTHER,FLEET])).rows[0].value,null);
    assert.equal((await db.query(query,[null,FLEET])).rows[0].value,null);
    assert.equal((await db.query(query,[OWNER,OTHER])).rows[0].value,null);
    await db.exec('reset role');
    for(const role of ['anon','authenticated']){
      const {rows:[privilege]}=await db.query(`select has_function_privilege($1,
        'fleet_monthly_activity(uuid,uuid)','EXECUTE') as allowed`,[role]);
      assert.equal(privilege.allowed,false);
    }
    await db.exec('delete from sessions');
    assert.equal((await db.query(query,[OWNER,FLEET])).rows[0].value.active_drivers,0);
    await db.exec('rollback');
  } finally {await db.close();}
});

test('aggregate validation strips extra fields and rejects unavailable or malformed totals',()=>{
  assert.deepEqual(monthlyActivity({...report,driver_id:'private',coordinates:[1,2]}),report);
  for(const value of [null,{}, {...report,active_drivers:-1},{...report,active_drivers:1.5},
    {...report,active_drivers:'73'},{...report,month:'2026-13'},
    {...report,timezone:'UTC'},{...report,as_of:'invalid'},
    {...report,month:'2026-10'}]) assert.equal(monthlyActivity(value),null);
});

test('Pacific calendar SQL handles local midnight and both daylight-saving transitions independently of database timezone',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table fleets(id uuid primary key,owner_user_id uuid);
      create table sessions(fleet_id uuid,driver_id uuid,started_at timestamptz,ended_at timestamptz);
      set timezone='Asia/Tokyo';`);
    await db.query('insert into fleets values($1,$2)',[FLEET,OWNER]);
    const ends=[
      '2026-11-01T06:59:59Z', // October 31, 23:59:59 PDT.
      '2026-11-01T07:00:00Z', // November begins in daylight time.
      '2026-11-01T08:30:00Z', // First 01:30, before the fall-back.
      '2026-11-01T09:30:00Z', // Second 01:30, after the fall-back.
      '2026-12-01T07:59:59Z', // November ends in standard time.
      '2026-12-01T08:00:00Z',
      '2026-03-01T07:59:59Z',
      '2026-03-01T08:00:00Z', // March begins in standard time.
      '2026-03-08T09:59:59Z', // 01:59:59 PST, before the spring-forward.
      '2026-03-08T10:00:00Z', // 03:00 PDT.
      '2026-04-01T06:59:59Z', // March ends in daylight time.
      '2026-04-01T07:00:00Z',
    ];
    for(const end of ends)await db.query(`insert into sessions values
      ($1,gen_random_uuid(),$2::timestamptz-interval '1 second',$2::timestamptz)`,[FLEET,end]);
    const sql=readFileSync(new URL('../supabase/migrations/20261107160000_fleet_monthly_activity.sql',import.meta.url),'utf8');
    assert.equal(sql.split('v_now timestamptz := now();').length,2);
    for(const [clock,month,count] of [
      ['2026-11-01T06:59:59Z','2026-10',1],
      ['2026-11-01T07:00:00Z','2026-11',1],
      ['2026-12-01T07:59:59Z','2026-11',4],
      ['2026-12-01T08:00:00Z','2026-12',1],
      ['2026-03-01T07:59:59Z','2026-02',1],
      ['2026-03-01T08:00:00Z','2026-03',1],
      ['2026-04-01T06:59:59Z','2026-03',4],
      ['2026-04-01T07:00:00Z','2026-04',1],
    ]){
      // Inject only the transaction clock into the actual migration function;
      // production has no caller-controlled clock or timezone parameter.
      await db.exec(sql.replace('v_now timestamptz := now();',`v_now timestamptz := '${clock}'::timestamptz;`));
      const {rows:[{value}]}=await db.query('select fleet_monthly_activity($1::uuid,$2::uuid) as value',[OWNER,FLEET]);
      assert.equal(value.month,month,clock);
      assert.equal(value.active_drivers,count,clock);
      assert.deepEqual(monthlyActivity(value),value,clock);
      assert.equal(monthlyActivity({...value,month:new Date(clock).toISOString().slice(0,7)})?.month,
        new Date(clock).toISOString().slice(0,7)===month?month:undefined);
    }
  } finally {await db.close();}
});

test('fleet summary derives activity scope from verified identity and safely handles missing migration',async()=>{
  process.env.SUPABASE_URL='https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
  const libPath=require.resolve('../api/_lib/supabase');
  const handlerPath=require.resolve('../api/fleet-summary');
  const original=require.cache[libPath];
  try {
    for(const missing of [false,true]){
      const calls=[];
      require.cache[libPath]={id:libPath,filename:libPath,loaded:true,exports:{
        bearerToken:()=> 'fixture',verifyAccessToken:async()=>({id:OWNER}),
        pgFetch:async(table,options)=>{
          calls.push({table,options});
          if(table==='fleets')return [{id:FLEET,company_name:'Fixture',plan:'test'}];
          if(table==='drivers'||table==='sessions')return [];
          if(table==='rpc/fleet_monthly_activity'){
            if(missing)throw {details:{code:'PGRST202'}};
            return {...report,driver_id:'not-for-client'};
          }
          throw new Error('Unexpected query');
        },
      }};
      delete require.cache[handlerPath];
      const headers={};
      const response={setHeader:(key,value)=>headers[key.toLowerCase()]=value,
        end(value){this.body=JSON.parse(value);}};
      await require(handlerPath)({method:'GET',url:'/api/fleet-summary?fleet_id='+OTHER,
        headers:{authorization:'Bearer fixture'}},response);
      assert.equal(response.statusCode,200);
      assert.deepEqual(response.body.monthly_activity,missing?null:report);
      assert.equal(headers['cache-control'],'no-store');
      assert.deepEqual(calls.find(c=>c.table==='rpc/fleet_monthly_activity').options.body,
        {p_actor_id:OWNER,p_fleet_id:FLEET});
    }
  } finally {if(original)require.cache[libPath]=original;else delete require.cache[libPath];delete require.cache[handlerPath];}
});
