import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionSummaryOutbox, SESSION_SUMMARY_OUTBOX_KEY as KEY } from '../native-app/lib/sessionSummaryOutbox.ts';
const scope = { ownerId: 'owner-a', consentVersion: 1 };
const entry = id => ({ session_id: id, ended_at: '2026-10-03T12:00:00.000Z', average_fatigue: 12, max_fatigue: 40, safety_score: 72, alert_count: 1, head_nod_count: 0 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(onSynced) {
  const values = new Map();
  let active = scope;
  const storage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } };
  const current = value => active?.ownerId === value.ownerId && active?.consentVersion === value.consentVersion;
  return { values, storage, current, outbox: createSessionSummaryOutbox(storage, current, onSynced), switch: value => { active = value; } };
}

test('a restart retries the exact saved finish timestamp and metrics', async () => {
  const f = fixture();
  await f.outbox.enqueue(scope, entry('one'));
  await f.outbox.flush(scope, async () => ({ ok: false, status: 503 }));
  const restart = createSessionSummaryOutbox(f.storage, f.current);
  const sent = [];
  const synced = await restart.flush(scope, async row => { sent.push(row); return { ok: true, status: 200 }; });
  assert.deepEqual(sent, [entry('one')]);
  assert.ok(synced.has('one'));
  assert.deepEqual(JSON.parse(f.values.get(KEY))[scope.ownerId], []);
});
test('a duplicate keeps the first finish and capacity never evicts pending records', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) assert.equal(await f.outbox.enqueue(scope, entry(String(i))), true);
  assert.equal(await f.outbox.enqueue(scope, entry('overflow')), false);
  await f.outbox.enqueue(scope, { ...entry('0'), safety_score: 0 });
  const rows = JSON.parse(f.values.get(KEY))[scope.ownerId];
  assert.equal(rows.length, 20);
  assert.equal(rows[0].safety_score, 72);
});
for (const status of [401, 408, 429, 503, 400, 404]) test(`retry status ${status} retains or removes the entry appropriately`, async () => {
  const f = fixture(); await f.outbox.enqueue(scope, entry('one'));
  await f.outbox.flush(scope, async () => ({ ok: false, status }));
  assert.equal(JSON.parse(f.values.get(KEY))[scope.ownerId].length, [400, 404].includes(status) ? 0 : 1);
});
test('another account cannot send a previous owner summary', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, entry('one'));
  const other = { ownerId: 'owner-b', consentVersion: 2 }; f.switch(other);
  let calls = 0;
  await f.outbox.flush(other, async () => { calls++; return { ok: true, status: 200 }; });
  assert.equal(calls, 0);
  assert.equal(JSON.parse(f.values.get(KEY))[scope.ownerId].length, 1);
});
test('consent revocation clears storage and ignores late responses', async () => {
  const f = fixture(), started = deferred(), response = deferred();
  await f.outbox.enqueue(scope, entry('one'));
  const pending = f.outbox.flush(scope, async () => { started.resolve(); return response.promise; });
  await started.promise; f.switch(null); await f.outbox.clear();
  response.resolve({ ok: true, status: 200 });
  assert.equal((await pending).size, 0);
  assert.equal(f.values.has(KEY), false);
});
test('a new pending summary survives completion of an older in-flight summary', async () => {
  const f = fixture(), started = deferred(), response = deferred();
  await f.outbox.enqueue(scope, entry('one'));
  const pending = f.outbox.flush(scope, async () => { started.resolve(); return response.promise; });
  await started.promise; await f.outbox.enqueue(scope, entry('two'));
  response.resolve({ ok: true, status: 200 }); await pending;
  assert.deepEqual(JSON.parse(f.values.get(KEY))[scope.ownerId].map(row => row.session_id), ['two']);
});
test('unreadable summaries stay intact without sending or overwriting them', async () => {
  const f = fixture(); f.values.set(KEY, '{broken');
  await assert.rejects(f.outbox.enqueue(scope, entry('one')));
  await assert.rejects(f.outbox.flush(scope, async () => { assert.fail('must not send malformed storage'); }));
  assert.equal(f.values.get(KEY), '{broken');
});
test('a failed local history acknowledgement retains the retry-safe summary', async () => {
  let failure = true;
  const f = fixture(async () => { if (failure) throw Error('history unavailable'); });
  await f.outbox.enqueue(scope, entry('one'));
  await f.outbox.flush(scope, async () => ({ ok: true, status: 200 }));
  assert.equal(JSON.parse(f.values.get(KEY))[scope.ownerId].length, 1);
  failure = false;
  await f.outbox.flush(scope, async () => ({ ok: true, status: 200 }));
  assert.equal(JSON.parse(f.values.get(KEY))[scope.ownerId].length, 0);
});

test('pending snapshots are owner-scoped, copied and invalidated by account changes',async()=>{
 const f=fixture();await f.outbox.enqueue(scope,{...entry('one'),local_session_id:'local-one'});
 const pending=await f.outbox.pendingEntries(scope);assert.equal(pending[0].local_session_id,'local-one');pending[0].session_id='changed';
 assert.equal((await f.outbox.pendingEntries(scope))[0].session_id,'one');
 f.switch({ownerId:'owner-b',consentVersion:1});assert.deepEqual(await f.outbox.pendingEntries(scope),[]);
});

test('a stalled read-only queue snapshot cannot hold subsequent outbox mutations',async()=>{
 const waiting=deferred();let stored=null,stall=false;
 const storage={getItem:async()=>{if(stall){stall=false;return waiting.promise}return stored},setItem:async(_key,value)=>{stored=value},removeItem:async()=>{stored=null}};
 const outbox=createSessionSummaryOutbox(storage,()=>true);await outbox.enqueue(scope,entry('one'));
 const before=stored;stall=true;const pending=outbox.pendingEntries(scope);
 await outbox.enqueue(scope,entry('two'));assert.equal(JSON.parse(stored)[scope.ownerId].length,2);
 waiting.resolve(before);assert.equal((await pending).length,1);
});
