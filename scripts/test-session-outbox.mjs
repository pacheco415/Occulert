import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionOutbox } from '../native-app/lib/sessionOutbox.ts';
function storage() { let raw = null; return { getItem: async () => raw, setItem: async (_key, value) => { raw = value; } }; }
const row = (id = 'one', owner = 'owner-a') => ({ id, owner, start: { client_session_id: id }, created: false, events: [] });
const allowed = async () => true;

test('offline session and alerts survive restart; lost acknowledgements cannot duplicate server records', async () => {
  const disk = storage(); let box = createSessionOutbox(disk);
  await box.add(row(), allowed);
  await box.event('one', { id: 'event-one', body: { client_event_id: 'event-one' } });
  await box.finish('one', { session_id: 'one', ended_at: 'original-time' }, 'local-one');
  await box.flush(async () => 'retry', async () => assert.fail('offline cannot sync'), async () => assert.fail('offline cannot fail permanently'));
  box = createSessionOutbox(disk);
  const records = new Map(); let loseAck = true;
  const send = async (_owner, method, path, body) => {
    const key = method + path + (body.client_event_id || body.client_session_id || body.session_id);
    records.set(key, body);
    if (loseAck) { loseAck = false; return 'retry'; }
    return 'sent';
  };
  const synced = [];
  await box.flush(send, async id => synced.push(id), async () => assert.fail());
  assert.equal((await box.list()).length, 1);
  await Promise.all([
    box.flush(send, async id => synced.push(id), async () => assert.fail()),
    box.flush(send, async id => synced.push(id), async () => assert.fail()),
  ]);
  assert.equal(records.size, 3);
  assert.deepEqual(synced, ['local-one']);
  assert.deepEqual(await box.list(), []);
});

test('revocation during an upload stops remaining requests and does not resurrect cleared data', async () => {
  const box = createSessionOutbox(storage()); await box.add(row(), allowed);
  await box.event('one', { id: 'e', body: {} });
  let resolve; const sending = new Promise(r => { resolve = r; }); let count = 0;
  const flush = box.flush(async (_owner, _method, _path, _body, markDispatched) => {
    assert.equal(await markDispatched(), true);
    count++;
    await sending;
    return 'sent';
  }, async () => assert.fail(), async () => assert.fail());
  await new Promise(r => setTimeout(r, 0));
  let clearFinished = false;
  const clear = box.clear().then(() => { clearFinished = true; });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(clearFinished, true, 'local revocation must not wait for the active request');
  assert.equal((await box.list())[0].abandoned, true);
  resolve();
  await Promise.all([clear, flush]);
  assert.equal(count, 1);
  const cancelled = [];
  await box.flush(async (owner, method, _path, body) => {
    if (method === 'DELETE') cancelled.push({ owner, sessionId: body.session_id });
    return 'sent';
  }, async () => assert.fail(), async () => {});
  assert.deepEqual(cancelled, [{ owner: 'owner-a', sessionId: 'one' }]);
  assert.deepEqual(await box.list(), []);
});

test('revocation drops a start that was durably known to have never reached the network', async () => {
  const disk = storage();
  const box = createSessionOutbox(disk);
  await box.add(row('never-sent'), allowed);
  await box.clear();
  assert.deepEqual(await box.list(), []);
  assert.deepEqual(await createSessionOutbox(disk).list(), []);
});

test('a second clear during confirmed cleanup retains the tombstone until an idempotent retry', async () => {
  const disk = storage();
  const box = createSessionOutbox(disk);
  await box.add({ ...row('cleanup-race'), cancelToken: 'token', createAttempted: true }, allowed);
  await box.clear();
  let release;
  const response = new Promise(resolve => { release = resolve; });
  let sends = 0;
  const first = box.flush(async () => {
    sends += 1;
    await response;
    return 'sent';
  }, async () => assert.fail(), async () => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  await box.clear();
  release();
  await first;
  assert.equal((await box.list())[0].abandoned, true);
  await box.flush(async () => { sends += 1; return 'sent'; }, async () => assert.fail(), async () => {});
  assert.equal(sends, 2);
  assert.deepEqual(await box.list(), []);
});

test('revocation cancels an acknowledged start whose finish is still pending', async () => {
  const box = createSessionOutbox(storage());
  await box.add(row('created'), allowed);
  await box.finish('created', { session_id: 'created' }, 'local-created');
  await box.flush(async (_owner, method) => method === 'PATCH' ? 'retry' : 'sent',
    async () => assert.fail(), async () => assert.fail());
  assert.equal((await box.list())[0].created, true);
  await box.clear();
  assert.equal((await box.list())[0].abandoned, true);
  const cancelled = [];
  await box.flush(async (owner, method, _path, body) => {
    if (method === 'DELETE') cancelled.push({ owner, sessionId: body.session_id });
    return 'sent';
  }, async () => assert.fail(), async () => {});
  assert.deepEqual(cancelled, [{ owner: 'owner-a', sessionId: 'created' }]);
  assert.deepEqual(await box.list(), []);
});

test('revocation during local completion acknowledgement preserves cleanup for the committed final PATCH', async () => {
  const box = createSessionOutbox(storage());
  await box.add({ ...row('late-finish'), cancelToken: 'token' }, allowed);
  await box.finish('late-finish', { session_id: 'late-finish' }, 'local-late');
  let acknowledge;
  let markAcknowledgement;
  const acknowledgementStarted = new Promise(resolve => { markAcknowledgement = resolve; });
  const acknowledgement = new Promise(resolve => { acknowledge = resolve; });
  const flush = box.flush(async (_owner, method, _path, _body, markDispatched) => {
    if (method === 'POST') assert.equal(await markDispatched(), true);
    return 'sent';
  }, async () => {
    markAcknowledgement();
    await acknowledgement;
  }, async () => assert.fail());
  await acknowledgementStarted;
  await box.clear();
  acknowledge();
  await flush;
  assert.equal((await box.list())[0].abandoned, true);
  const methods = [];
  await box.flush(async (_owner, method) => { methods.push(method); return 'sent'; }, async () => assert.fail(), async () => {});
  assert.deepEqual(methods, ['DELETE']);
  assert.deepEqual(await box.list(), []);
});

test('revocation during the final outbox removal restores cleanup after the stale write finishes', async () => {
  let raw = null;
  let blockRemoval = false;
  let releaseRemoval;
  let markRemovalStarted;
  const removalStarted = new Promise(resolve => { markRemovalStarted = resolve; });
  const disk = {
    getItem: async () => raw,
    setItem: async (_key, value) => {
      if (blockRemoval && value === '[]') {
        blockRemoval = false;
        markRemovalStarted();
        await new Promise(resolve => { releaseRemoval = resolve; });
      }
      raw = value;
    },
  };
  const box = createSessionOutbox(disk);
  await box.add({ ...row('write-race'), cancelToken: 'token' }, allowed);
  await box.finish('write-race', { session_id: 'write-race' });
  blockRemoval = true;
  const flush = box.flush(async (_owner, method, _path, _body, markDispatched) => {
    if (method === 'POST') assert.equal(await markDispatched(), true);
    return 'sent';
  }, async () => {}, async () => assert.fail());
  await removalStarted;
  const clear = box.clear();
  releaseRemoval();
  await Promise.all([flush, clear]);
  assert.equal((await box.list())[0].abandoned, true);
  await box.flush(async () => 'sent', async () => assert.fail(), async () => {});
  assert.deepEqual(await box.list(), []);
});

test('revoked cleanup rows reject late monitor telemetry mutations', async () => {
  const box = createSessionOutbox(storage());
  await box.add({ ...row('revoked'), cancelToken: 'token', createAttempted: true }, allowed);
  await box.clear();
  assert.equal(await box.event('revoked', { id: 'late', body: { client_event_id: 'late' } }), false);
  assert.equal(await box.markPartial('revoked'), false);
  assert.equal(await box.finish('revoked', { session_id: 'revoked' }, 'late-local'), false);
  const [tombstone] = await box.list();
  assert.equal(tombstone.abandoned, true);
  assert.deepEqual(tombstone.events, []);
  assert.equal(tombstone.finish, undefined);
  assert.equal(tombstone.localSessionId, undefined);
});

test('an old consent check cannot append after revocation', async () => {
  const box = createSessionOutbox(storage()); let resolve;
  const add = box.add(row(), () => new Promise(r => { resolve = r; }));
  await box.clear(); resolve(true);
  assert.equal(await add, false); assert.deepEqual(await box.list(), []);
});

test('new events appended during an upload survive acknowledgement of older events', async () => {
  const box = createSessionOutbox(storage()); await box.add(row(), allowed);
  await box.event('one', { id: 'old', body: { id: 'old' } });
  await box.flush(async (_owner, _method, path) => {
    if (path === '/api/events') await box.event('one', { id: 'new', body: { id: 'new' } });
    return 'sent';
  }, async () => {}, async () => {});
  assert.deepEqual((await box.list())[0].events.map(e => e.id), ['new']);
});

test('failed local acknowledgement retains the finished session for retry', async () => {
  const box = createSessionOutbox(storage()); await box.add(row(), allowed);
  await box.finish('one', {}, 'local');
  await assert.rejects(box.flush(async () => 'sent', async () => { throw new Error('storage unavailable'); }, async () => {}));
  assert.equal((await box.list()).length, 1);
  await box.flush(async () => 'sent', async () => {}, async () => {});
  assert.deepEqual(await box.list(), []);
});

test('a different account cannot send an old account queue', async () => {
  const box = createSessionOutbox(storage()); await box.add(row(), allowed);
  let writes = 0;
  await box.flush(async owner => { if (owner !== 'owner-b') return 'retry'; writes++; return 'sent'; }, async () => {}, async () => {});
  assert.equal(writes, 0); assert.equal((await box.list()).length, 1);
});

test('clear recovers malformed queue storage without replaying payloads', async () => {
  let raw = '{broken';
  const box = createSessionOutbox({
    getItem: async () => raw,
    setItem: async (_key, value) => { raw = value; },
  });
  await box.clear();
  assert.deepEqual(await box.list(), []);
});

test('a transient recovery read can retry during the same app run', async () => {
  let reads = 0;
  const box = createSessionOutbox({
    getItem: async () => {
      reads += 1;
      if (reads === 1) throw new Error('storage temporarily unavailable');
      return '[]';
    },
    setItem: async () => {},
  });
  await assert.rejects(box.list());
  assert.deepEqual(await box.list(), []);
  assert.equal(reads, 3, 'the successful retry plus list read should reach storage');
});

test('clear cannot deadlock behind a mutation queued in the same turn', async () => {
  const box = createSessionOutbox(storage());
  await box.add(row(), allowed);
  const event = box.event('one', { id: 'same-turn', body: {} });
  const clear = box.clear();
  await Promise.race([
    Promise.all([event, clear]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('outbox clear deadlocked')), 250)),
  ]);
  assert.deepEqual(await box.list(), []);
});

test('clear waits for an in-flight recovery write before persisting revocation', async () => {
  let raw = JSON.stringify([row('recovering')]);
  let releaseRecovery;
  let markRecoveryStarted;
  const recoveryStarted = new Promise(resolve => { markRecoveryStarted = resolve; });
  const box = createSessionOutbox({
    getItem: async () => raw,
    setItem: async (_key, value) => {
      if (value !== '[]' && !releaseRecovery) {
        markRecoveryStarted();
        await new Promise(resolve => { releaseRecovery = resolve; });
      }
      raw = value;
    },
  });
  await recoveryStarted;
  let clearFinished = false;
  const clear = box.clear().then(() => { clearFinished = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(clearFinished, false, 'clear must serialize behind recovery');
  releaseRecovery();
  await clear;
  assert.equal((await box.list())[0].abandoned, true);
});

test('relaunch cleans up unfinished drives without replaying them as live sessions', async () => {
  const disk = storage(); const original = createSessionOutbox(disk);
  await original.add(row('interrupted'), allowed);
  await original.add({ ...row('ack-lost'), created: true }, allowed);
  await original.add(row('complete'), allowed);
  await original.finish('complete', {}, 'local-complete');
  const recovered = createSessionOutbox(disk); const sent = [];
  await recovered.flush(async (_owner, method, path, body) => {
    sent.push({ method, path, body });
    return 'sent';
  }, async () => {}, async () => {});
  assert.equal(sent.some(call => call.body.client_session_id === 'interrupted'), false);
  assert.equal(sent.some(call => call.body.client_session_id === 'ack-lost'), false);
  assert.deepEqual(sent.filter(call => call.method === 'DELETE').map(call => call.body.session_id), ['ack-lost']);
  assert.equal(sent.some(call => call.body.client_session_id === 'complete'), true);
  assert.deepEqual(await recovered.list(), []);
});

test('a permanent rejection cannot poison later session uploads', async () => {
  const box = createSessionOutbox(storage());
  await box.add(row('rejected'), allowed);
  await box.finish('rejected', {}, 'local-rejected');
  await box.add(row('accepted'), allowed);
  await box.finish('accepted', {}, 'local-accepted');
  const completed = []; const failed = [];
  await box.flush(async (_owner, method, _path, body) => (
    method === 'POST' && body.client_session_id === 'rejected' ? 'discard' : 'sent'
  ), async (localId, _cloudId, partial) => completed.push({ localId, partial }), async localId => failed.push(localId));
  assert.deepEqual(failed, ['local-rejected']);
  assert.deepEqual(completed, [{ localId: 'local-accepted', partial: false }]);
  assert.deepEqual(await box.list(), []);
});

test('revocation cleanup runs before a retryable upload for a replacement account', async () => {
  const box = createSessionOutbox(storage());
  await box.add({ ...row('old-account', 'owner-old'), createAttempted: true }, allowed);
  await box.clear();
  await box.add(row('new-account', 'owner-new'), allowed);
  await box.finish('new-account', {}, 'local-new');
  const calls = [];
  await box.flush(async (owner, method, _path, body) => {
    calls.push({ owner, method, id: body.session_id || body.client_session_id });
    return method === 'POST' ? 'retry' : 'sent';
  }, async () => assert.fail(), async () => {});
  assert.deepEqual(calls, [
    { owner: 'owner-old', method: 'DELETE', id: 'old-account' },
    { owner: 'owner-new', method: 'POST', id: 'new-account' },
  ]);
  assert.deepEqual((await box.list()).map(item => item.id), ['new-account']);
});

test('a mismatched create ID schedules cleanup for both possible server rows', async () => {
  const box = createSessionOutbox(storage());
  await box.add(row('expected'), allowed);
  await box.finish('expected', {}, 'local-expected');
  await box.flush(async (_owner, method) => (
    method === 'POST' ? { cleanupIds: ['expected', 'unexpected'] } : 'sent'
  ), async () => assert.fail(), async () => assert.fail());
  assert.deepEqual((await box.list())[0].cleanupIds, ['expected', 'unexpected']);

  const retryMethods = [];
  await box.flush(async (_owner, method, _path, body) => {
    retryMethods.push({ method, body });
    return 'retry';
  }, async () => assert.fail(), async () => assert.fail());
  assert.deepEqual(retryMethods, [
    { method: 'DELETE', body: { session_id: 'expected' } },
    { method: 'DELETE', body: { session_id: 'unexpected' } },
  ]);
  assert.deepEqual((await box.list())[0].cleanupIds, ['expected', 'unexpected']);

  const failed = [];
  await box.flush(async () => 'sent', async () => assert.fail(), async localId => failed.push(localId));
  assert.deepEqual(failed, ['local-expected']);
  assert.deepEqual(await box.list(), []);
});

test('final explicit cleanup stays durable until local history records the removal', async () => {
  const box = createSessionOutbox(storage());
  await box.add({
    ...row('cleanup-history'),
    cleanupIds: ['cloud-cleanup-history'],
    localSessionId: 'local-cleanup-history',
  }, allowed);
  await assert.rejects(box.flush(
    async () => 'sent',
    async () => assert.fail(),
    async () => { throw new Error('history unavailable'); },
  ));
  assert.deepEqual((await box.list())[0].cleanupIds, ['cloud-cleanup-history']);
  const failed = [];
  await box.flush(async () => 'sent', async () => assert.fail(), async id => failed.push(id));
  assert.deepEqual(failed, ['local-cleanup-history']);
  assert.deepEqual(await box.list(), []);
});

test('one rejected event marks a completed summary as partial and continues', async () => {
  const box = createSessionOutbox(storage());
  await box.add(row('partial'), allowed);
  await box.event('partial', { id: 'bad-event', body: { client_event_id: 'bad-event' } });
  await box.finish('partial', {}, 'local-partial');
  const completed = [];
  await box.flush(async (_owner, _method, path) => path === '/api/events' ? 'discard' : 'sent',
    async (localId, cloudId, partial) => completed.push({ localId, cloudId, partial }), async () => assert.fail());
  assert.deepEqual(completed, [{ localId: 'local-partial', cloudId: 'partial', partial: true }]);
  assert.deepEqual(await box.list(), []);
});

test('an alert queue failure can mark the eventual summary for review', async () => {
  const box = createSessionOutbox(storage());
  await box.add(row('partial'), allowed);
  await box.finish('partial', {}, 'local-partial', true);
  const completed = [];
  await box.flush(async () => 'sent',
    async (localId, cloudId, partial) => completed.push({ localId, cloudId, partial }), async () => assert.fail());
  assert.deepEqual(completed, [{ localId: 'local-partial', cloudId: 'partial', partial: true }]);
});

test('retryable cleanup is bounded and cannot starve a later completed summary', async () => {
  const disk = storage(); const original = createSessionOutbox(disk);
  for (let index = 0; index < 5; index += 1) {
    await original.add({ ...row(`interrupted-${index}`), createAttempted: true }, allowed);
  }
  await original.add(row('complete'), allowed);
  await original.finish('complete', {}, 'local-complete');
  const recovered = createSessionOutbox(disk); const completed = []; const methods = [];
  await recovered.flush(async (_owner, method) => {
    methods.push(method);
    return method === 'DELETE' ? 'retry' : 'sent';
  },
    async localId => completed.push(localId), async () => assert.fail());
  assert.deepEqual(completed, ['local-complete']);
  assert.deepEqual(methods.slice(0, 3), ['DELETE', 'DELETE', 'DELETE']);
  assert.deepEqual(methods.slice(3), ['POST', 'PATCH']);
  assert.equal(methods.filter(method => method === 'DELETE').length, 3);
  assert.deepEqual((await recovered.list()).map(item => item.id), [
    'interrupted-3', 'interrupted-4', 'interrupted-0', 'interrupted-1', 'interrupted-2',
  ]);

  await recovered.flush(async (_owner, method, _path, body) => (
    method === 'DELETE' && body.session_id === 'interrupted-0' ? 'retry' : 'sent'
  ), async () => assert.fail(), async () => {});
  await recovered.flush(async (_owner, method, _path, body) => (
    method === 'DELETE' && body.session_id === 'interrupted-0' ? 'retry' : 'sent'
  ), async () => assert.fail(), async () => {});
  assert.deepEqual((await recovered.list()).map(item => item.id), ['interrupted-0']);
});
