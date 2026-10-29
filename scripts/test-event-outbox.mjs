import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createEventOutbox, EVENT_OUTBOX_KEY as KEY, EVENT_OUTBOX_LIMIT } from '../lib/event-outbox.ts';
const scope = { ownerId: 'owner-a', consentVersion: 1 };
const start = Date.parse('2026-10-26T12:00:00.000Z');
const event = (id = 'event-1') => ({ event_id: id, session_id: 'session-1', detected_at: new Date(start).toISOString(), expires_at: new Date(start + 60_000).toISOString(), type: 'drowsiness', fatigue: 70, confidence: 90 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(options = {}) {
  let raw = null, active = scope, clock = start;
  const storage = { getItem: async () => raw, setItem: async (_, value) => { raw = value; }, removeItem: async () => { raw = null; } };
  const current = s => active?.ownerId === s.ownerId && active?.consentVersion === s.consentVersion;
  const config = { enabled: true, idempotencyVerified: true, now: () => clock, ...options };
  return { storage, config, current, outbox: createEventOutbox(storage, current, config), raw: () => raw, setRaw: value => { raw = value; }, advance: ms => { clock += ms; }, switch: s => { active = s; } };
}
for (const config of [{}, { enabled: true }, { idempotencyVerified: true }]) test(`disabled gates never read, persist or send: ${JSON.stringify(config)}`, async () => {
  const fail = async () => assert.fail('must not access storage');
  const box = createEventOutbox({ getItem: fail, setItem: fail, removeItem: async () => {} }, () => true, config);
  assert.equal(await box.enqueue(scope, event()), false);
  await box.flush(scope, fail);
  assert.deepEqual(await box.pendingEntries(scope), []);
});
test('stable identity and immutable detection snapshot survive restart and uncertain send', async () => {
  const f = fixture(), original = event(), input = event();
  const queued = f.outbox.enqueue(scope, input); input.fatigue = 0; await queued;
  await f.outbox.flush(scope, async row => { assert.deepEqual(row, original); row.fatigue = 1; throw Error('response lost'); });
  f.advance(1000);
  const restart = createEventOutbox(f.storage, f.current, f.config);
  await restart.flush(scope, async row => { assert.deepEqual(row, original); return { status: 201 }; });
  assert.deepEqual(await restart.pendingEntries(scope), []);
});
test('identical queued identity is idempotent; conflicting payload cannot replace it', async () => {
  const f = fixture(); assert.equal(await f.outbox.enqueue(scope, event()), true);
  assert.equal(await f.outbox.enqueue(scope, event()), true);
  assert.equal(await f.outbox.enqueue(scope, { ...event(), fatigue: 0 }), false);
  assert.equal((await f.outbox.pendingEntries(scope))[0].fatigue, 70);
});
test('global queue bound rejects new rows without evicting pending rows', async () => {
  const f = fixture();
  for (let n = 0; n < EVENT_OUTBOX_LIMIT; n++) assert.equal(await f.outbox.enqueue(scope, event(`event-${n}`)), true);
  assert.equal(await f.outbox.enqueue(scope, event('overflow')), false);
  assert.equal((await f.outbox.pendingEntries(scope)).length, EVENT_OUTBOX_LIMIT);
});
for (const status of [200, 201, 204, 400, 401, 403, 408, 409, 410, 429, 500, 503, 504, 0, 302]) test(`classifies HTTP ${status}`, async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event());
  await f.outbox.flush(scope, async () => ({ status }));
  assert.equal((await f.outbox.pendingEntries(scope)).length, [200, 201, 204, 400, 403, 409, 410].includes(status) ? 0 : 1);
});
test('retry backoff and attempts are bounded', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event()); let calls = 0;
  const send = async () => { calls++; return { status: 503 }; };
  await f.outbox.flush(scope, send); await f.outbox.flush(scope, send); assert.equal(calls, 1);
  for (const delay of [1000, 2000, 4000, 8000]) { f.advance(delay); await f.outbox.flush(scope, send); }
  f.advance(16000); await f.outbox.flush(scope, send); assert.equal(calls, 5);
  assert.deepEqual(await f.outbox.pendingEntries(scope), []);
});
test('timestamp fallback persists untimed intent before a lost response and restart', async () => {
  const f = fixture(), sent = [];
  await f.outbox.enqueue(scope, event());
  await f.outbox.flush(scope, async (row, delivery) => {
    sent.push({ row, ...delivery });
    if (sent.length === 1) return { status: 400, error: 'invalid_occurred_at' };
    assert.equal(JSON.parse(f.raw()).rows[0].timestampMode, 'server');
    throw Error('Accepted fallback response was lost');
  });
  assert.deepEqual(sent.map(row => row.timestampMode), ['detected', 'server']);
  f.advance(2000);
  const restarted = createEventOutbox(f.storage, f.current, f.config);
  await restarted.flush(scope, async (row, delivery) => {
    assert.deepEqual(row, event());
    assert.equal(delivery.timestampMode, 'server');
    return { status: 200 };
  });
  assert.deepEqual(await restarted.pendingEntries(scope), []);
});
test('a rejected untimed fallback is final and counts toward the five-send budget', async () => {
  const f = fixture(); let calls = 0;
  await f.outbox.enqueue(scope, event());
  await f.outbox.flush(scope, async () => { calls++; return { status: 400, error: 'invalid_occurred_at' }; });
  assert.equal(calls, 2);
  assert.equal((await f.outbox.status(scope)).permanentRejected, 1);
  assert.deepEqual(await f.outbox.pendingEntries(scope), []);
});
test('a timestamp rejection on the fifth send cannot create a sixth fallback attempt', async () => {
  const f = fixture(); let calls = 0;
  await f.outbox.enqueue(scope, event());
  const send = async () => ++calls === 5 ? { status: 400, error: 'invalid_occurred_at' } : { status: 503 };
  await f.outbox.flush(scope, send);
  for (const delay of [1000, 2000, 4000, 8000]) { f.advance(delay); await f.outbox.flush(scope, send); }
  assert.equal(calls, 5); assert.equal((await f.outbox.status(scope)).exhausted, 1);
  assert.deepEqual(await f.outbox.pendingEntries(scope), []);
});
test('Retry-After survives restart and overrides exponential backoff without exceeding expiry', async () => {
  const f = fixture(); let calls = 0;
  await f.outbox.enqueue(scope, event());
  await f.outbox.flush(scope, async () => { calls++; return { status: 429, retryAfterMs: 30_000 }; });
  f.advance(29_999);
  const restarted = createEventOutbox(f.storage, f.current, f.config);
  await restarted.flush(scope, async () => assert.fail('Retry-After has not elapsed'));
  f.advance(1);
  await restarted.flush(scope, async () => { calls++; return { status: 429, retryAfterMs: 900_000 }; });
  assert.equal(calls, 2);
  assert.equal((await restarted.status(scope)).nextAttemptAt, start + 60_000);
  f.advance(30_000);
  assert.equal((await restarted.status(scope)).expired, 1);
});
test('session end invalidates pending enqueues and discards only that session', async () => {
  const f = fixture();
  await f.outbox.enqueue(scope, event());
  await f.outbox.enqueue(scope, { ...event('event-2'), session_id: 'session-2' });
  const queued = f.outbox.enqueue(scope, event('late'));
  const ended = f.outbox.invalidateSession(scope, 'session-1');
  assert.equal(await queued, false); await ended;
  assert.deepEqual((await f.outbox.pendingEntries(scope)).map(row => row.event_id), ['event-2']);
  assert.equal((await f.outbox.status(scope)).stopped, 1);
  assert.equal(await f.outbox.enqueue(scope, event('after-end')), false);
});
test('all current alert types retain their identity without substitutions', async () => {
  const f = fixture();
  const types = ['drowsy', 'distracted', 'yawn', 'head_nod'];
  for (const type of types) await f.outbox.enqueue(scope, { ...event(type), type });
  const sent = [];
  await f.outbox.flush(scope, async row => { sent.push(row.type); return { status: 200 }; });
  assert.deepEqual(sent, types);
});
test('owner and consent generation isolate saved events', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event());
  for (const next of [{ ownerId: 'owner-b', consentVersion: 1 }, { ownerId: 'owner-a', consentVersion: 2 }]) {
    f.switch(next); assert.deepEqual(await f.outbox.pendingEntries(next), []);
    await f.outbox.flush(next, async () => assert.fail('cannot send old scope'));
  }
  const next = { ownerId: 'owner-a', consentVersion: 2 };
  await f.outbox.enqueue(next, event('fresh')); assert.equal(JSON.parse(f.raw()).rows.length, 1);
});
test('revocation ignores late success and cannot repopulate cleared storage', async () => {
  const f = fixture(), started = deferred(), response = deferred();
  await f.outbox.enqueue(scope, event());
  const pending = f.outbox.flush(scope, async () => { started.resolve(); return response.promise; });
  await started.promise; f.switch(null); await f.outbox.clear();
  response.resolve({ status: 200 }); await pending; assert.equal(f.raw(), null);
});
test('clear invalidates a queued enqueue even if consent callback still returns true', async () => {
  const f = fixture(); const enqueue = f.outbox.enqueue(scope, event()); await f.outbox.clear();
  assert.equal(await enqueue, false); assert.equal(f.raw(), null);
});
test('concurrent flush is single-flight; newly enqueued rows survive older acknowledgement', async () => {
  const f = fixture(), started = deferred(), response = deferred();
  await f.outbox.enqueue(scope, event()); let calls = 0;
  const send = async row => { calls++; if (row.event_id === 'event-1') { started.resolve(); return response.promise; } return { status: 503 }; };
  const one = f.outbox.flush(scope, send), two = f.outbox.flush(scope, send);
  assert.equal(one, two); await started.promise; await f.outbox.enqueue(scope, event('event-2'));
  response.resolve({ status: 200 }); await one;
  assert.equal(calls, 2); assert.deepEqual((await f.outbox.pendingEntries(scope)).map(row => row.event_id), ['event-2']);
});
test('expiry prevents send and rejects stale or future detections', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event()); f.advance(60_000);
  await f.outbox.flush(scope, async () => assert.fail('expired'));
  assert.equal(await f.outbox.enqueue(scope, event()), false);
  const future = { ...event(), detected_at: new Date(start + 120_000).toISOString(), expires_at: new Date(start + 180_000).toISOString() };
  assert.equal(await f.outbox.enqueue(scope, future), false);
});
test('strict allowlist rejects coordinates, credentials and invalid payloads', async () => {
  const f = fixture();
  for (const invalid of [{ ...event(), latitude: 42 }, { ...event(), token: 'secret' }, { ...event(), fatigue: 101 }, { ...event(), expires_at: new Date(start + 900_001).toISOString() }, { ...event(), event_id: '' }]) await assert.rejects(f.outbox.enqueue(scope, invalid));
  assert.equal(f.raw(), null);
});
test('corrupt storage stays intact and cannot be sent or overwritten', async () => {
  const f = fixture(); f.setRaw('{broken');
  await assert.rejects(f.outbox.enqueue(scope, event()));
  await assert.rejects(f.outbox.flush(scope, async () => assert.fail('corrupt')));
  assert.equal(f.raw(), '{broken');
});
test('attempt-persistence failure prevents send and mutation queue recovers', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event());
  const original = f.storage.setItem; f.storage.setItem = async () => { throw Error('disk full'); };
  await assert.rejects(f.outbox.flush(scope, async () => assert.fail('not persisted')));
  f.storage.setItem = original; await f.outbox.flush(scope, async () => ({ status: 200 }));
  assert.deepEqual(await f.outbox.pendingEntries(scope), []);
});
test('failed acknowledgement retains identity for a safe server-deduplicated retry', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event()); const original = f.storage.setItem;
  await assert.rejects(f.outbox.flush(scope, async () => { f.storage.setItem = async () => { throw Error('disk failed'); }; return { status: 200 }; }));
  f.storage.setItem = original; f.advance(1000);
  await f.outbox.flush(scope, async row => { assert.equal(row.event_id, 'event-1'); return { status: 200 }; });
  assert.deepEqual(await f.outbox.pendingEntries(scope), []);
});

test('nonfinite input cannot be normalized to null by serialization', async () => {
  const f = fixture();
  for (const value of [NaN, Infinity, -Infinity]) {
    await assert.rejects(f.outbox.enqueue(scope, { ...event(), fatigue: value }));
    await assert.rejects(f.outbox.enqueue(scope, { ...event(), confidence: value }));
  }
  assert.equal(f.raw(), null);
});
test('equivalent payload keys in a different order remain idempotent', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event());
  assert.equal(await f.outbox.enqueue(scope, Object.fromEntries(Object.entries(event()).reverse())), true);
  assert.equal((await f.outbox.pendingEntries(scope)).length, 1);
});

test('slow attempt storage cannot dispatch after event expiry', async () => {
  const f = fixture(); await f.outbox.enqueue(scope, event());
  const original = f.storage.setItem;
  f.storage.setItem = async (...args) => { await original(...args); f.advance(60_000); };
  await f.outbox.flush(scope, async () => assert.fail('expired during persistence'));
});

test('experimental source is excluded from the public deployment', () => {
  const ignored = readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8').split(/\r?\n/).map(line => line.trim());
  assert.ok(ignored.includes('lib/'));
});
