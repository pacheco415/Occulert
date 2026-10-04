import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const source=fs.readFileSync('api/_lib/provider-budget.js','utf8');
function boot(){let time=0,id=0;const logs=[],module={exports:{}};
 vm.runInNewContext(source,{module,require:name=>name==='node:async_hooks'?{AsyncLocalStorage}:name==='node:perf_hooks'?{performance:{now:()=>time}}:name==='node:crypto'?{randomUUID:()=>`fixture-request-${++id}`}:(()=>{throw Error('Unexpected import')})(),console:{error:value=>logs.push(value)}});
 return {lib:module.exports,logs,set:ms=>{time=ms},now:()=>time,response:(status=200)=>({statusCode:status,headers:{},setHeader(key,value){this.headers[key]=value}})};
}
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}};
test('sequential provider calls use the remaining monotonic request allowance',async()=>{
 const b=boot();await b.lib.withProviderBudget(async()=>{assert.equal(b.lib.remainingProviderMs(8000),8000);b.set(7000);assert.equal(b.lib.remainingProviderMs(8000),5000);b.set(12000);assert.throws(()=>b.lib.remainingProviderMs(8000),error=>error.status===504)} )({},b.response());assert.equal(b.lib.remainingProviderMs(8000),8000);
});
test('concurrent requests retain separate deadlines and correlation IDs',async()=>{
 const b=boot(),a=deferred(),c=deferred(),ra=b.response(),rc=b.response();
 const first=b.lib.withProviderBudget(async()=>{await a.promise;return b.lib.remainingProviderMs(8000)})({},ra);
 b.set(7000);const second=b.lib.withProviderBudget(async()=>{await c.promise;return b.lib.remainingProviderMs(8000)})({},rc);
 b.set(9000);a.resolve();c.resolve();assert.equal(await first,3000);assert.equal(await second,8000);assert.notEqual(ra.headers['X-Occulert-Request-ID'],rc.headers['X-Occulert-Request-ID']);
});
test('router nesting preserves the outer deadline and exported helpers',async()=>{
 const b=boot(),response=b.response();const child=Object.assign(async()=>b.lib.remainingProviderMs(8000),{validReport:()=>true,config:{api:{bodyParser:false}}});
 const inner=b.lib.withProviderBudget(child);assert.equal(inner.validReport(),true);
 assert.equal(inner.config,child.config);
 const outer=b.lib.withProviderBudget(async(request,response)=>{b.set(11000);return inner(request,response)});
 assert.equal(await outer({},response),1000);assert.equal(response.headers['X-Occulert-Request-ID'],'fixture-request-1');
});

test('actual session route stops before a mutation after earlier provider work exhausts its budget',async()=>{
 const b=boot(),calls=[],supabase={exports:{}};
 const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-key'};
 vm.runInNewContext(fs.readFileSync('api/_lib/supabase.js','utf8'),{
  module:supabase,require:name=>name==='./provider-budget'?b.lib:require(name),process:{env},URL,AbortController,setTimeout,clearTimeout,
  fetch:async(url,options)=>{
   calls.push({url:String(url),options});
   if(calls.length===1){assert.match(String(url),/auth\/v1\/user$/);b.set(7000);return Response.json({id:'verified-user'});}
   const parsed=new URL(url);assert.equal(parsed.pathname,'/rest/v1/drivers');assert.equal(parsed.searchParams.get('user_id'),'eq.verified-user');
   b.set(13000);return Response.json([{id:'verified-driver',fleet_id:'verified-fleet'}]);
  },
 });
 const route={exports:{}};
 vm.runInNewContext(fs.readFileSync('api/sessions.js','utf8'),{
  module:route,process:{env},require:name=>name==='./_lib/supabase'?supabase.exports:name==='./_lib/provider-budget'?b.lib:require(name.startsWith('./_lib/')?'../api/'+name.slice(2):name),
 });
 const response=b.response();response.end=value=>{response.body=JSON.parse(value)};
 await route.exports({method:'POST',headers:{authorization:'Bearer fixture-token','content-type':'application/json'},body:{driver_id:'attacker-driver',fleet_id:'attacker-fleet'}},response);
 assert.equal(response.statusCode,502);assert.deepEqual(response.body,{ok:false,error:'supabase_error'});
 assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.headers['X-Occulert-Request-ID'],'fixture-request-1');
 assert.equal(calls.length,2);assert.ok(calls.every(call=>call.options.method===undefined||call.options.method==='GET'));
 assert.equal(b.logs.length,1);assert.equal(JSON.parse(b.logs[0]).requestId,response.headers['X-Occulert-Request-ID']);
 assert.doesNotMatch(b.logs[0],/attacker|verified-user|fixture-key|Bearer|fixture-token/);
});

test('a failed request does not leave its expired allowance in the next request',async()=>{
 const b=boot();
 await assert.rejects(b.lib.withProviderBudget(async()=>{b.set(13000);b.lib.remainingProviderMs(8000)})({},b.response()),error=>error.status===504);
 const response=b.response();
 assert.equal(await b.lib.withProviderBudget(async()=>b.lib.remainingProviderMs(8000))({},response),8000);
 assert.equal(response.headers['X-Occulert-Request-ID'],'fixture-request-2');
 assert.equal(b.logs.length,1);
});
test('failure diagnostics contain only fixed fields and generated IDs',async()=>{
 const b=boot(),response=b.response(503);await b.lib.withProviderBudget(async()=>{b.set(123)})({url:'/api/profile?email=private@example.test',body:{name:'Private Name'},headers:{authorization:'Bearer secret'}},response);
 const record=JSON.parse(b.logs[0]);assert.deepEqual(Object.keys(record).sort(),['elapsedMs','event','requestId','status','unhandled']);assert.equal(record.elapsedMs,123);assert.doesNotMatch(b.logs[0],/private|Private|secret|Bearer|email|profile/);
 await assert.rejects(b.lib.withProviderBudget(async()=>{throw Error('secret raw provider response')})({},b.response()));assert.equal(JSON.parse(b.logs[1]).unhandled,true);assert.doesNotMatch(b.logs[1],/secret raw/);
});
test('exhausted budget prevents a later Supabase mutation from being sent',async()=>{
 const b=boot(),calls=[],module={exports:{}};
 vm.runInNewContext(fs.readFileSync('api/_lib/supabase.js','utf8'),{module,require:()=>b.lib,process:{env:{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-key'}},URL,AbortController,setTimeout,clearTimeout,fetch:async(url)=>{calls.push(url);b.set(13000);return new Response(JSON.stringify({id:'fixture-user'}))}});
 await b.lib.withProviderBudget(async()=>{await module.exports.verifyAccessToken('fixture-token');await assert.rejects(module.exports.pgFetch('sessions',{method:'POST',body:{driver_id:'fixture-user'}}),error=>error.status===504)})({},b.response());
 assert.equal(calls.length,1);assert.match(calls[0],/auth\/v1\/user$/);
});

test('Supabase header/body deadlines shrink after earlier provider work and ignore late commits',async()=>{
 const b=boot(),timers=new Map(),calls=[],late=deferred(),module={exports:{}};let next=0;
 vm.runInNewContext(fs.readFileSync('api/_lib/supabase.js','utf8'),{module,require:()=>b.lib,process:{env:{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-key'}},URL,AbortController,
 setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
 fetch:async(url,options)=>{calls.push({url,options});if(calls.length===1){b.set(7000);return new Response(JSON.stringify({id:'fixture-user'}))}return late.promise}});
 const pending=b.lib.withProviderBudget(async()=>{await module.exports.verifyAccessToken('fixture-token');await assert.rejects(module.exports.pgFetch('sessions',{method:'POST',body:{driver_id:'fixture-user'}}),error=>error.status===504)})({},b.response());
 while(calls.length<2)await new Promise(resolve=>setImmediate(resolve));
 assert.equal([...timers.values()][0].ms,5000);for(const timer of [...timers.values()])timer.fn();await pending;assert.equal(calls[1].options.signal.aborted,true);assert.equal(calls.length,2);
 late.resolve(new Response(JSON.stringify([{id:'committed-session'}])));await new Promise(resolve=>setImmediate(resolve));assert.equal(timers.size,0);assert.equal(calls.length,2);
});

for(const phase of ['headers','body'])test(`Stripe deadline bounds ${phase} even when the provider ignores abort`,async()=>{
 const b=boot(),timers=new Map(),late=deferred(),calls=[],module={exports:{}};let next=0,bodyCalls=0;
 vm.runInNewContext(fs.readFileSync('api/_lib/stripe-test.js','utf8'),{module,require:name=>name==='./provider-budget'?b.lib:{},process:{env:{STRIPE_TEST_SECRET_KEY:'sk_test_fixture',STRIPE_TEST_WEBHOOK_SECRET:'whsec_fixture',STRIPE_TEST_PRICE_STARTER:'price_start',STRIPE_TEST_PRICE_GROWTH:'price_growth'}},Buffer,URL,URLSearchParams,AbortController,
 setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
 fetch:async(url,options)=>{calls.push({url,options});return phase==='headers'?late.promise:{ok:true,text:()=>{bodyCalls++;return late.promise}}}});
 const pending=b.lib.withProviderBudget(async()=>{b.set(7000);await assert.rejects(module.exports.stripeRequest('/v1/customers',{method:'POST'}),error=>error.status===504&&error.message==='stripe_timeout')})({},b.response());
 while(!calls.length||(phase==='body'&&!bodyCalls))await new Promise(resolve=>setImmediate(resolve));assert.equal([...timers.values()][0].ms,5000);
 for(const timer of [...timers.values()])timer.fn();await pending;assert.equal(calls[0].options.signal.aborted,true);assert.equal(calls.length,1);
 late.resolve(phase==='headers'?{ok:true,text:async()=>{bodyCalls++;return '{"livemode":false}'}}:'{"livemode":false}');await new Promise(resolve=>setImmediate(resolve));assert.equal(timers.size,0);assert.equal(calls.length,1);
 assert.equal(bodyCalls,phase==='headers'?0:1,'a timed-out late header must not start response-body consumption');
});

const settleTasks=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve))};
const fixtureEnv={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-key',
 LEAD_NOTIFY_WEBHOOK_URL:'https://notify.example.invalid/hook'};
function loadRoute(path,b,{supabase={},env=fixtureEnv,fetch=async()=>{throw Error('Unexpected fetch')},setTimeout:timer=setTimeout,clearTimeout:clear=clearTimeout}={}){
 const module={exports:{}},routeRequire=createRequire(new URL('../'+path,import.meta.url));
 const dependencies={supabase,env,fetch,setTimeout:timer,clearTimeout:clear};
 vm.runInNewContext(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{module,process:{env},URL,URLSearchParams,Buffer,AbortController,
  setTimeout:timer,clearTimeout:clear,fetch,require(name){
   if(name.endsWith('/provider-budget'))return b.lib;
   if(name.endsWith('/supabase'))return supabase;
   if(name.startsWith('./_lib/routes/'))return loadRoute('api/'+name.slice(2)+'.js',b,dependencies);
   return routeRequire(name);
  }});
 return module.exports;
}
function pilotNotificationFixture(insertAt){
 const b=boot(),late=deferred(),timers=new Map(),providerCalls=[],notifications=[];let next=0;
 const handler=loadRoute('api/pilot-leads.js',b,{
  supabase:{async pgFetch(table,options){providerCalls.push({table,options});if(table==='rpc/check_pilot_lead_rate_limit'){b.set(7000);return[{allowed:true}]}
   assert.equal(table,'pilot_leads');assert.equal(options.method,'POST');b.set(insertAt);return[{id:'stored-lead'}]}},
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms,at:b.now()});return id},clearTimeout:id=>timers.delete(id),
  fetch:async(url,options)=>{notifications.push({url,options});return late.promise},
 });
 const response=b.response();let writes=0;response.end=value=>{writes++;response.body=JSON.parse(value)};
 const request={method:'POST',headers:{origin:'https://www.occulert.com','content-type':'application/json'},body:{
  name:'Private Driver',company:'Private Fleet',email:'private@example.invalid',phone:'555-0100',message:'Private message',startedAt:new Date(Date.now()-3000).toISOString(),website:''}};
 return {b,late,timers,providerCalls,notifications,response,writes:()=>writes,run:()=>handler(request,response),
  expire(){for(const[id,timer]of [...timers]){timers.delete(id);b.set(timer.at+timer.ms);timer.fn()}}};
}
for(const[insertAt,expectedMs]of [[8000,3000],[11950,50],[12000,null],[12001,null]])test(`actual stored-lead notification retains success with ${12000-insertAt}ms request allowance left`,async()=>{
 const f=pilotNotificationFixture(insertAt),pending=f.run();await settleTasks();
 const scheduled=[...f.timers.values()].map(timer=>timer.ms);f.expire();await pending;
 assert.deepEqual(scheduled,expectedMs===null?[]:[expectedMs]);
 assert.equal(f.notifications.length,expectedMs===null?0:1);assert.equal(f.providerCalls.length,2,'exhaustion cannot send another provider mutation');
 assert.equal(f.response.statusCode,200);assert.deepEqual(f.response.body,{ok:true,stored:true,storage:'supabase'});
 assert.equal(f.response.headers['Cache-Control'],'no-store');assert.equal(f.b.logs.length,0);assert.equal(f.writes(),1);
 if(expectedMs!==null){const notification=f.notifications[0];assert.equal(notification.url,fixtureEnv.LEAD_NOTIFY_WEBHOOK_URL);assert.equal(notification.options.redirect,'error');assert.equal(notification.options.signal.aborted,true);
  const payload=JSON.parse(notification.options.body);assert.deepEqual(Object.keys(payload).sort(),['lead_id','received_at','source','type']);assert.equal(payload.lead_id,'stored-lead');
  assert.doesNotMatch(notification.options.body,/Private|private@example|555-0100/);assert.equal(f.b.now(),insertAt+expectedMs)}
 f.late.resolve({ok:true});await settleTasks();assert.equal(f.writes(),1);assert.equal(f.notifications.length,expectedMs===null?0:1);assert.equal(f.providerCalls.length,2);assert.equal(f.timers.size,0);
});

function fallbackFixture(rateAt,transport){
 const b=boot(),late=deferred(),timers=new Map(),calls=[];let next=0,writes=0;
 const env={...fixtureEnv,PILOT_LEADS_WEBHOOK_URL:'https://hook.example.invalid/leads'};
 const handler=loadRoute('api/pilot-leads.js',b,{env,
  supabase:{async pgFetch(table){assert.equal(table,'rpc/check_pilot_lead_rate_limit');b.set(rateAt);
   // Exercise the actual existing fallback after its real durable-rate guard.
   // Normal initially missing storage is separately asserted to fail closed.
   delete env.SUPABASE_URL;delete env.SUPABASE_SERVICE_ROLE_KEY;return[{allowed:true}]}},
  fetch:async(url,options)=>{calls.push({url,options});return transport?transport():late.promise},
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
 });
 const response=b.response();response.end=value=>{writes++;response.body=JSON.parse(value)};
 const request={method:'POST',headers:{origin:'https://www.occulert.com','content-type':'application/json'},body:{
  name:'Fixture Driver',company:'Fixture Fleet',email:'fixture@example.invalid',startedAt:new Date(Date.now()-3000).toISOString(),website:''}};
 return{b,late,timers,calls,response,request,handler,writes:()=>writes};
}
for(const[rateAt,expectedMs]of [[0,5000],[7000,5000],[11950,50],[12000,null],[12001,null]])test(`actual fallback settles with ${12000-rateAt}ms remaining despite an abort-ignoring fetch`,async()=>{
 const f=fallbackFixture(rateAt);let settled=false;const pending=f.handler(f.request,f.response).then(()=>{settled=true});
 await settleTasks();assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),expectedMs===null?[]:[expectedMs]);
 try{
  for(const timer of [...f.timers.values()]){f.b.set(rateAt+timer.ms);timer.fn()}
  await settleTasks();assert.equal(settled,true,'the response must settle at its hard deadline');
  assert.equal(f.response.statusCode,502);assert.deepEqual(f.response.body,{ok:false,error:'webhook_unreachable'});
  assert.equal(f.writes(),1);assert.equal(f.calls.length,expectedMs===null?0:1);assert.equal(f.response.headers['Cache-Control'],'no-store');
  if(expectedMs!==null){assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.calls[0].url,'https://hook.example.invalid/leads')}
 }finally{f.late.resolve({ok:true});await pending;await settleTasks()}
 assert.equal(f.writes(),1);assert.equal(f.response.statusCode,502,'late headers cannot overwrite a timeout');assert.equal(f.timers.size,0);
 assert.equal(f.b.logs.length,1);assert.doesNotMatch(f.b.logs[0],/Fixture|fixture@example|hook\.example|fixture-key/);
});
test('fallback retains ordinary success/provider-failure shapes and the missing-storage rate guard',async()=>{
 for(const[transport,status,body]of [
  [async()=>({ok:true}),200,{ok:true,stored:true,storage:'webhook'}],
  [async()=>({ok:false}),502,{ok:false,error:'webhook_failed'}],
  [async()=>{throw Error('private provider error')},502,{ok:false,error:'webhook_unreachable'}],
 ]){
  const f=fallbackFixture(7000,transport);await f.handler(f.request,f.response);
  assert.equal(f.response.statusCode,status);assert.deepEqual(f.response.body,body);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);assert.equal(f.writes(),1);
 }
 const b=boot(),handler=loadRoute('api/pilot-leads.js',b,{env:{PILOT_LEADS_WEBHOOK_URL:'https://hook.example.invalid/leads'},
  supabase:{pgFetch:async()=>assert.fail('initially absent storage must stop before rate RPC')},fetch:async()=>assert.fail('initially absent storage must not reach fallback')});
 const response=b.response();response.end=value=>{response.body=JSON.parse(value)};
 await handler(fallbackFixture(0).request,response);assert.equal(response.statusCode,503);assert.deepEqual(response.body,{ok:false,error:'rate_limit_unavailable'});
});

const budgetedEntries=['account','accept-invitation','events','fleet-followups','fleet-invitations','fleet-summary','fleets','pilot-leads','profile','public-config','sessions','[endpoint]'].map(name=>'api/'+name+'.js');
const budgetedChildren=['billing-checkout','billing-portal','billing-status','billing-webhook','fleet-period-report','fleet-session-history'].map(name=>'api/_lib/routes/'+name+'.js');
test('all deployable entries and routed children keep their actual request wrappers and report export',async()=>{
 for(const path of [...budgetedEntries,...budgetedChildren]){
  const b=boot(),handler=loadRoute(path,b,{supabase:{verifyAccessToken:async()=>null,bearerToken:()=>null}}),response=b.response();response.end=value=>{response.body=JSON.parse(value)};
  await handler({method:'TRACE',url:'/api/unknown',headers:{},query:{}},response);
  assert.equal(response.headers['X-Occulert-Request-ID'],'fixture-request-1',path);assert.equal(response.headers['Cache-Control'],'no-store',path);
  if(path.endsWith('/fleet-period-report.js')){assert.equal(typeof handler.validReport,'function');assert.equal(handler.validReport(null,7),false);assert.equal(response.headers.Vary,'Authorization')}
 }
});
test('the actual dispatcher and history child share one deadline and emit one sanitized failure',async()=>{
 const b=boot(),calls=[],user={id:'11111111-1111-4111-8111-111111111111'},handler=loadRoute('api/[endpoint].js',b,{supabase:{
  bearerToken:()=> 'private-token',verifyAccessToken:async()=>{b.set(7000);return user},async pgFetch(table){calls.push(table);assert.equal(b.lib.remainingProviderMs(8000),5000);throw Error('private provider failure')},
 }}),response=b.response();response.end=value=>{response.body=JSON.parse(value)};
 await handler({method:'GET',url:'/api/fleet-session-history?endpoint=fleet-session-history',query:{endpoint:'fleet-session-history'},headers:{authorization:'Bearer private-token'}},response);
 assert.deepEqual(calls,['fleets']);assert.equal(response.statusCode,502);assert.equal(response.headers.Vary,'Authorization');assert.equal(response.headers['Cache-Control'],'no-store');
 assert.equal(response.headers['X-Occulert-Request-ID'],'fixture-request-1');assert.equal(b.logs.length,1);const diagnostic=JSON.parse(b.logs[0]);assert.equal(diagnostic.elapsedMs,7000);assert.equal(diagnostic.requestId,'fixture-request-1');assert.doesNotMatch(b.logs[0],/private|11111111|fleet-session-history/);
});
