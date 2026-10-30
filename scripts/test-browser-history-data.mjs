import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const assets=JSON.parse(readFileSync(new URL('../asset-versions.json',import.meta.url),'utf8'));
const require=createRequire(import.meta.url),history=require('../'+assets['local-history.js']);
function fixture(raw,makeId){let stored=raw,writes=0,fail=false;const storage={getItem:()=>stored,setItem:(_key,value)=>{if(fail)throw Error('storage denied');stored=value;writes++}};return {api:history.create(storage,makeId),storage,get stored(){return stored},get writes(){return writes},set fail(value){fail=value}}}

test('legacy records get durable distinct IDs without discarding partial or unknown fields',()=>{
 const original=[{savedAt:'same',unknown:{keep:true}},{savedAt:'same'},{id:'existing',cloudSessionId:'cloud',safetyScore:72}];const ids=['existing','first','first','second'];
 const f=fixture(JSON.stringify(original),()=>ids.shift());const rows=f.api.load();
 assert.deepEqual(rows.map(row=>row.localRecordId),['first','second','existing']);assert.equal(f.writes,1);
 assert.deepEqual(rows.map(({localRecordId,historyVersion,...row})=>row),original);
 assert.deepEqual(f.api.load(),rows);assert.equal(f.writes,1);
 f.api.changeRecord('second',row=>({...row,alertReview:'accurate'}));assert.equal(f.api.load()[0].alertReview,undefined);assert.equal(f.api.load()[1].alertReview,'accurate');
});
test('unreadable, malformed and future data refuse every write and preserve stored bytes',()=>{
 for(const raw of ['','{','null','{}','[null]','[[]]','[{"id":"valid"},false]','[{"historyVersion":2}]','[{"historyVersion":"1"}]','[{"localRecordId":null}]']){
  const f=fixture(raw);assert.throws(()=>f.api.load());assert.throws(()=>f.api.update(()=>[]));assert.equal(f.stored,raw);assert.equal(f.writes,0);
 }
});
test('a failed migration exposes no transient IDs or replacement list',()=>{
 const raw='[{"unknown":42}]',f=fixture(raw,()=> 'stable');f.fail=true;
 assert.throws(()=>f.api.load(),/storage denied/);assert.equal(f.stored,raw);assert.equal(f.writes,0);
 f.fail=false;assert.equal(f.api.load()[0].localRecordId,'stable');assert.equal(f.writes,1);
});
test('existing duplicate aliases remain intact and keyed edits fail closed',()=>{
 const f=fixture('[{"id":"same","unknown":1},{"sessionId":"same","unknown":2}]');f.api.load();const bytes=f.stored;
 assert.throws(()=>f.api.changeRecord('same',row=>({...row,changed:true})),/ambiguous/);assert.equal(f.stored,bytes);
 assert.throws(()=>f.api.changeRecord('missing',row=>row),/missing/);
});
test('invalid callback results and exhausted identity candidates never overwrite history',()=>{
 const f=fixture('[{"id":"saved"}]');for(const candidate of [null,{},[null]])assert.throws(()=>f.api.update(()=>candidate));assert.equal(f.writes,0);
 const collisions=fixture('[{"id":"collision"},{}]',()=> 'collision');assert.throws(()=>collisions.api.load(),/identity/);assert.equal(collisions.writes,0);
});
test('actual driver persistence refuses malformed members instead of filtering them away',()=>{
 const source=readFileSync(new URL('../'+assets['driver-app.js'],import.meta.url),'utf8');const start=source.indexOf('function saveLocalSessionHistory('),end=source.indexOf('function setMonitoringUi(',start);assert.ok(start>=0&&end>start);
 const raw='[{"unknown":"preserve"},null]',f=fixture(raw),logs=[];
 const context={sessionStart:1000,localSessionId:'new',browserHistoryStore:()=>f.api,log:text=>logs.push(text)};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.save=saveLocalSessionHistory;',context);
 assert.equal(context.save({alerts:0}),null);assert.equal(f.stored,raw);assert.equal(f.writes,0);assert.match(logs[0],/Copy the session report/);
});


test('migration validates the complete array beyond the display limit and never truncates valid legacy history',()=>{
 const original=Array.from({length:60},(_,index)=>({id:'saved-'+index,unknown:{index},alerts:index}));
 const f=fixture(JSON.stringify(original));const rows=f.api.load();assert.equal(rows.length,60);
 assert.deepEqual(rows.map(({localRecordId,historyVersion,...row})=>row),original);
 const invalid=fixture(JSON.stringify([...original,null]));assert.throws(()=>invalid.api.load());assert.throws(()=>invalid.api.update(rows=>rows.slice(0,50)));assert.equal(invalid.writes,0);assert.equal(invalid.stored,JSON.stringify([...original,null]));
});
