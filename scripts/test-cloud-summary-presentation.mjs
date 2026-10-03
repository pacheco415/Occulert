import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudSummaryPresentation} from '../native-app/lib/cloudSummaryPresentation.ts';
test('only explicit confirmation with a cloud ID is presented as confirmed',()=>{
 for(const row of [{},{cloudSynced:'true',cloudSessionId:'cloud'},{cloudSynced:true},{cloudSynced:true,cloudSessionId:''}])assert.equal(cloudSummaryPresentation(row,[]).confirmed,false);
 assert.equal(cloudSummaryPresentation({cloudSynced:true,cloudSessionId:'cloud'},[]).confirmed,true);
});
test('pending, confirmed and uncertain cloud outcomes retain the actual local save',()=>{
 const pending=cloudSummaryPresentation({sessionId:'local'},['local']);assert.match(pending.label,/cloud summary pending/);
 const confirmed=cloudSummaryPresentation({sessionId:'local',cloudSynced:true,cloudSessionId:'cloud'},['local']);assert.match(confirmed.label,/cloud completion confirmed/);
 const unknown=cloudSummaryPresentation({sessionId:'other'},['local']);assert.match(unknown.label,/cloud completion not confirmed/);
 for(const item of [pending,confirmed,unknown])assert.match(item.label,/Saved on this iPhone/);
});

test('the actual History retry ignores duplicate taps and cannot update a blurred view',async()=>{
 const {readFileSync}=await import('node:fs'),{stripTypeScriptTypes}=await import('node:module'),vm=await import('node:vm');
 const {createSingleFlightActionRunner}=await import('../native-app/lib/singleFlightAction.ts');
 const source=readFileSync(new URL('../native-app/app/history.tsx',import.meta.url),'utf8');const start=source.indexOf('  const retrySavedCloudSummaries ='),end=source.indexOf('  const chooseHistoryFilter =',start);assert.ok(start>=0&&end>start);
 let release;const waiting=new Promise(resolve=>{release=resolve}),calls=[],busy=[];
 const scope={ownerId:'owner',consentVersion:1};
 const context={pendingCloud:{scope,count:1,localIds:['local']},pendingCloudSummaryStateIsCurrent:()=>true,historyLoadAttemptRef:{current:1},retryCloudRunnerRef:{current:createSingleFlightActionRunner()},retryCloudBusyRef:{current:false},focusedRef:{current:true},retryPendingCloudSessions:async passed=>{calls.push(passed);await waiting},load:async()=>assert.fail('blurred view must not reload'),setRetryCloudBusy:value=>busy.push(value),Alert:{alert:()=>assert.fail('unexpected failure')}};
 vm.runInNewContext(stripTypeScriptTypes(source.slice(start,end))+'\nglobalThis.retry=retrySavedCloudSummaries;',context);
 const first=context.retry();await context.retry();assert.deepEqual(calls,[scope]);assert.equal(context.retryCloudBusyRef.current,true);
 context.focusedRef.current=false;context.historyLoadAttemptRef.current++;release();await first;
 assert.deepEqual(busy,[true]);assert.equal(context.retryCloudBusyRef.current,false);
});
