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
