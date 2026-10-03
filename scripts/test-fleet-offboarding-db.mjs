import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite(),read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333',driver='44444444-4444-4444-8444-444444444444',fleet='55555555-5555-4555-8555-555555555555',next='66666666-6666-4666-8666-666666666666';
const remove=async (actor=owner) => (await db.query('select remove_fleet_driver($1::uuid,$2::uuid) as result',[actor,driver])).rows[0].result;
const leave=async (expected=next) => (await db.query('select leave_fleet($1::uuid,$2::uuid) as result',[user,expected])).rows[0].result;
let actor=owner;
const context={URL,module:{exports:{}},process:{env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',OCCULERT_FLEET_OFFBOARDING_ENABLED:'true'}},require(){return{bearerToken:()=> 'fixture',verifyAccessToken:async()=>({id:actor}),pgFetch:async(table,options)=>{
 if(table==='drivers')return (await db.query('select id,fleet_id from drivers where user_id=$1',[actor])).rows;
 const b=options.body;
 if(table==='rpc/remove_fleet_driver')return (await db.query('select remove_fleet_driver($1::uuid,$2::uuid) as result',[b.p_owner_user_id,b.p_driver_id])).rows[0].result;
 assert.equal(table,'rpc/leave_fleet');return (await db.query('select leave_fleet($1::uuid,$2::uuid) as result',[b.p_user_id,b.p_expected_fleet_id])).rows[0].result;
}};}};
vm.runInNewContext(read('api/_lib/routes/fleet-offboarding.js'),context);
const invoke=async(method,path,body)=>{const response={setHeader(){},end(value){this.body=JSON.parse(value);}};await context.module.exports({method,url:path,query:{},headers:{'content-type':'application/json'},body},response);return response;};
try {
 await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await db.exec(read('db/schema.sql').replace('create extension if not exists "pgcrypto";',''));
 await db.exec(read('supabase/migrations/20261003192500_fleet_offboarding.sql'));
 await db.exec(`insert into auth.users values('${owner}'),('${other}'),('${user}');insert into fleets(id,owner_user_id,company_name) values('${fleet}','${owner}','First'),('${next}','${other}','Next');insert into drivers(id,user_id,fleet_id,name) values('${driver}','${user}','${fleet}','Fixture');insert into sessions(driver_id,fleet_id) values('${driver}','${fleet}');grant usage on schema public to anon,authenticated,service_role;grant select on drivers to service_role;`);
 for(const role of ['anon','authenticated']) {await db.exec(`set role ${role}`);await assert.rejects(remove(),/permission denied/);await assert.rejects(leave(),/permission denied/);await db.exec('reset role');}
 await db.exec('grant select on fleet_membership_removals to authenticated;set role authenticated');assert.equal((await db.query('select * from fleet_membership_removals')).rows.length,0);await db.exec('reset role');
 await db.exec('set role service_role');assert.equal((await remove(other)).error,'driver_not_found');
 assert.equal((await invoke('DELETE','/api/fleet-drivers',{driver_id:driver})).statusCode,400);
 assert.equal((await invoke('DELETE','/api/fleet-drivers',{driver_id:driver,confirm:true,owner_user_id:other})).statusCode,200);
 await db.exec('reset role');assert.equal((await db.query('select fleet_id,active from drivers')).rows[0].fleet_id,null);assert.equal((await db.query('select active from drivers')).rows[0].active,true);assert.equal((await db.query('select count(*) as n from drivers where fleet_id=$1',[fleet])).rows[0].n,0);assert.equal((await db.query('select fleet_id from sessions')).rows[0].fleet_id,fleet);
 await db.query(`insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at) values($1,'fixture@example.com',$2,$3,clock_timestamp()+interval '1 day')`,[next,'a'.repeat(64),other]);
 await db.exec('set role service_role');const accepted=(await db.query('select accept_fleet_invitation($1,$2::uuid,$3) as result',['a'.repeat(64),user,'fixture@example.com'])).rows[0].result;assert.equal(accepted.fleet_id,next);
 actor=user;assert.equal((await invoke('GET','/api/fleet-membership')).body.membership.fleet_id,next);
 assert.equal((await invoke('POST','/api/fleet-membership',{confirm:true,fleet_id:fleet})).statusCode,409,'stale confirmation must not leave a newly joined fleet');
 assert.equal((await invoke('POST','/api/fleet-membership',{confirm:true,fleet_id:next,user_id:owner})).body.left,true);assert.equal((await leave()).left,false,'repeat leave after confirmed removal is harmless');
 await db.exec('reset role');const audit=(await db.query('select removed_by,reason from fleet_membership_removals order by removed_at')).rows;assert.deepEqual(audit,[{removed_by:owner,reason:'owner_removed'},{removed_by:user,reason:'driver_left'}]);assert.equal((await db.query('select fleet_id from sessions')).rows[0].fleet_id,fleet);
 context.process.env.OCCULERT_FLEET_OFFBOARDING_ENABLED='false';assert.equal((await invoke('DELETE','/api/fleet-drivers',{driver_id:driver,confirm:true})).statusCode,501);
 console.log('Fleet offboarding SQL/API fixtures passed: cross-fleet/client denial, confirmation, historical preservation, reassignment, stale leave guard, repeat leave, actor identity and disabled gate.');
} finally {await db.close();}
