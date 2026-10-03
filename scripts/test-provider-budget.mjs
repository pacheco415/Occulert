import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {AsyncLocalStorage} from 'node:async_hooks';
const source=fs.readFileSync('api/_lib/provider-budget.js','utf8');
function boot(){let time=0,id=0;const logs=[],module={exports:{}};
 vm.runInNewContext(source,{module,require:name=>name==='node:async_hooks'?{AsyncLocalStorage}:name==='node:perf_hooks'?{performance:{now:()=>time}}:name==='node:crypto'?{randomUUID:()=>`fixture-request-${++id}`}:(()=>{throw Error('Unexpected import')})(),console:{error:value=>logs.push(value)}});
 return {lib:module.exports,logs,set:ms=>{time=ms},response:(status=200)=>({statusCode:status,headers:{},setHeader(key,value){this.headers[key]=value}})};
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
 const b=boot(),response=b.response();const child=Object.assign(async()=>b.lib.remainingProviderMs(8000),{validReport:()=>true});
 const inner=b.lib.withProviderBudget(child);assert.equal(inner.validReport(),true);
 const outer=b.lib.withProviderBudget(async(request,response)=>{b.set(11000);return inner(request,response)});
 assert.equal(await outer({},response),1000);assert.equal(response.headers['X-Occulert-Request-ID'],'fixture-request-1');
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
 const b=boot(),timers=new Map(),late=deferred(),calls=[],module={exports:{}};let next=0;
 vm.runInNewContext(fs.readFileSync('api/_lib/stripe-test.js','utf8'),{module,require:name=>name==='./provider-budget'?b.lib:{},process:{env:{STRIPE_TEST_SECRET_KEY:'sk_test_fixture',STRIPE_TEST_WEBHOOK_SECRET:'whsec_fixture',STRIPE_TEST_PRICE_STARTER:'price_start',STRIPE_TEST_PRICE_GROWTH:'price_growth'}},Buffer,URL,URLSearchParams,AbortController,
 setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
 fetch:async(url,options)=>{calls.push({url,options});return phase==='headers'?late.promise:{ok:true,text:()=>late.promise}}});
 const pending=b.lib.withProviderBudget(async()=>{b.set(7000);await assert.rejects(module.exports.stripeRequest('/v1/customers',{method:'POST'}),error=>error.status===504&&error.message==='stripe_timeout')})({},b.response());
 while(!calls.length)await new Promise(resolve=>setImmediate(resolve));assert.equal([...timers.values()][0].ms,5000);
 for(const timer of [...timers.values()])timer.fn();await pending;assert.equal(calls[0].options.signal.aborted,true);assert.equal(calls.length,1);
 late.resolve(phase==='headers'?{ok:true,text:async()=>'{"livemode":false}'}:'{"livemode":false}');await new Promise(resolve=>setImmediate(resolve));assert.equal(timers.size,0);assert.equal(calls.length,1);
});
