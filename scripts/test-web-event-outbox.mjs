import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebEventOutboxAdapter, webEventLoginIdentity, webEventRetryEnabled } from '../src/event-outbox-adapter.js';
import { EVENT_OUTBOX_KEY } from '../lib/event-outbox.ts';

const META = 'occulert.event-outbox.lifecycle.v1';
const owner = '11111111-1111-4111-8111-111111111111', login = '22222222-2222-4222-8222-222222222222';
const session = '33333333-3333-4333-8333-333333333333';
let uuidSequence = 0;
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
function clock() {
  let time = Date.parse('2026-10-28T12:00:00.000Z'), next = 0;
  const timers = new Map();
  return { now: () => time, setTimeout: (work, delay) => { timers.set(++next, { work, at: time + delay }); return next; }, clearTimeout: id => timers.delete(id),
    async advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time && timers.delete(id)) timer.work(); await settle(); }, timers };
}
function locks({ beforeRelease = () => {} } = {}) {
  const held = new Set(), waiting = new Map();
  return { held, request(name, options, work) {
    return new Promise((resolve, reject) => {
      const run = () => {
        if (options.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        if (held.has(name)) {
          if (options.ifAvailable) { Promise.resolve(work(null)).then(resolve, reject); return; }
          const rows = waiting.get(name) || []; rows.push(run); waiting.set(name, rows); return;
        }
        held.add(name);
        Promise.resolve().then(() => work({ name })).then(resolve, reject).finally(async () => {
          await beforeRelease(name);
          held.delete(name); const rows = waiting.get(name) || []; const following = rows.shift(); if (following) following();
        });
      };
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      run();
    });
  } };
}
function fixture(options = {}) {
  const values = options.values || new Map(), time = options.time || clock(), mutex = options.mutex || locks();
  const target = new EventTarget(), writes = [], calls = [], statuses = [];
  let identity = { ownerId: owner, loginId: login }, sharing = true, capability = true, online = true, foreground = true;
  let transport = async (id, type, details) => ({ status: 200, ok: true, body: { ok: true, client_event_id: details.client_event_id, event: { session_id: id } } });
  const backend = { eventOutboxCapability: async () => capability, logQueuedEvent: async (...args) => {
    calls.push({ id: args[0], type: args[1], details: { ...args[2] }, current: args[3], signal: args[4].signal }); return transport(...args);
  } };
  let failure = null;
  const storage = { getItem: key => { if (failure === 'read') throw Error('read failed'); return values.get(key) ?? null; },
    setItem: (key, value) => { if (failure === 'write') throw Error('write failed'); writes.push({ key, value }); values.set(key, value); },
    removeItem: key => { if (failure === 'remove') throw Error('remove failed'); writes.push({ key, removed: true }); values.delete(key); } };
  const original = {}, reference = Promise.resolve(session);
  const adapterOptions = { enabled: true, backend, storage, locks: mutex, target, ...time, loginIdentity: () => identity,
    isSharingCurrent: () => sharing, isOnline: () => online, isForeground: () => foreground,
    randomUUID: () => `44444444-4444-4444-8444-${String(++uuidSequence).padStart(12, '0')}`, onStatus: status => statuses.push(status), ...options.adapterOptions };
  const adapter = createWebEventOutboxAdapter(adapterOptions);
  adapter.trackSession(original, reference);
  const queue = (type = 'drowsy', details = { fatigue_score: 34, confidence: 81 }, id = reference) => adapter.queue(original, id, type, details, new Date(time.now()).toISOString(), async () => { calls.push({ legacy: true }); });
  return { adapter, adapterOptions, backend, values, time, mutex, target, calls, statuses, writes, storage, original, reference, queue,
    identity: value => { identity = value; }, sharing: value => { sharing = value; }, capability: value => { capability = value; },
    transport: value => { transport = value; }, fail: value => { failure = value; }, online: value => { online = value; }, foreground: value => { foreground = value; },
    rows: () => JSON.parse(values.get(EVENT_OUTBOX_KEY)).rows,
    event(name, properties = {}) { const event = new Event(name); Object.assign(event, properties); target.dispatchEvent(event); },
    close: () => adapter.dispose() };
}

test('flag is exact and disabled or lockless construction has no storage, listener, or provider effects', async () => {
  for (const query of ['', '?event-outbox=0', '?event-outbox=true', '?event-outbox=1&event-outbox=1']) assert.equal(webEventRetryEnabled(query), false);
  assert.equal(webEventRetryEnabled('?event-outbox=1'), true);
  const effect = () => { throw Error('must stay untouched'); };
  for (const enabled of [false, true]) {
    const adapter = createWebEventOutboxAdapter({ enabled, locks: enabled ? {} : { request: effect }, randomUUID: effect, storage: new Proxy({}, { get: effect }), target: { addEventListener: effect }, backend: { eventOutboxCapability: effect, logQueuedEvent: effect } });
    assert.equal(adapter.available, false); assert.equal(adapter.queue(), null); await adapter.flush(); await adapter.revoke();
  }
});
test('login identity requires the same verified-owner subject and stable session UUID without retaining a token', () => {
  const backend = claims => ({ captureAuthContext: () => ({ auth: { user: { id: owner }, access_token: `unused.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.unused` } }) });
  assert.deepEqual(webEventLoginIdentity(backend({ sub: owner, session_id: login })), { ownerId: owner, loginId: login });
  for (const claims of [{ sub: owner }, { sub: 'different', session_id: login }, { sub: owner, session_id: 'bad' }]) assert.equal(webEventLoginIdentity(backend(claims)), null);
});
test('missing capability falls back before adoption, with no queue storage or listeners', async () => {
  const f = fixture(); f.capability(false); await f.queue();
  assert.deepEqual(f.calls, [{ legacy: true }]); assert.equal(f.writes.length, 0); assert.equal(f.values.size, 0); f.close();
});
test('the same-login refresh override requires an adopted live scope and ends synchronously on auth notification', async () => {
  const f = fixture(); assert.equal(f.adapter.isScopeCurrent(f.original), false);
  f.online(false); await f.queue(); assert.equal(f.adapter.isScopeCurrent(f.original), true);
  f.event('occulert:auth-lifecycle'); assert.equal(f.adapter.isScopeCurrent(f.original), false); await settle(); f.close();
});
test('minimal keyed payload snapshots all actual types without coordinates and validates durable acknowledgement', async () => {
  const f = fixture();
  for (const type of ['drowsy', 'distracted', 'yawn', 'head_nod']) await f.queue(type, { fatigue_score: 34, confidence: 81, latitude: 12, longitude: 34 });
  assert.deepEqual(f.calls.map(call => call.type), ['drowsy', 'distracted', 'yawn', 'head_nod']);
  assert.equal(new Set(f.calls.map(call => call.details.client_event_id)).size, 4);
  assert.deepEqual(Object.keys(f.calls[0].details).sort(), ['client_event_id', 'confidence', 'fatigue_score', 'occurred_at']);
  assert.equal(f.rows().length, 0); assert.equal(f.calls[0].current(), true); f.close();
});
test('offline persistence survives a controller restart in the same live consent period and replays the same ID', async () => {
  const f = fixture(); f.online(false); await f.queue();
  const saved = f.rows()[0]; assert.equal(f.calls.length, 0); f.close(); await settle();
  const next = fixture({ values: f.values, time: f.time, mutex: f.mutex }); next.online(false);
  // This is controller restoration, not page reload or a new consent grant.
  await next.queue('yawn'); next.online(true); await next.adapter.flush();
  assert.equal(next.calls[0].details.client_event_id, saved.event.event_id);
  assert.equal(next.calls[0].details.occurred_at, saved.event.detected_at);
  assert.equal(next.rows().length, 0); next.close();
});
test('a new explicit consent period clears old rows, advances generation and never auto-replays on reload', async () => {
  const f = fixture(); f.online(false); await f.queue(); const version = JSON.parse(f.values.get(META)).version;
  f.close(); await settle();
  const next = fixture({ values: f.values, time: f.time, mutex: f.mutex }); next.sharing(false);
  await next.adapter.flush(); assert.equal(next.calls.length, 0); assert.equal(next.rows().length, 1);
  next.sharing(true); await next.adapter.beginConsentPeriod();
  assert.equal(next.values.has(EVENT_OUTBOX_KEY), false); assert.ok(JSON.parse(next.values.get(META)).version > version);
  next.adapter.trackSession(next.original, next.reference); await next.queue(); assert.equal(next.calls.length, 1); next.close();
});
test('an unchecked second tab and a contending opted-in tab cannot overwrite the active queue', async () => {
  const first = fixture(); first.online(false); await first.queue(); const bytes = first.values.get(EVENT_OUTBOX_KEY), metadata = first.values.get(META);
  const second = fixture({ values: first.values, time: first.time, mutex: first.mutex }); second.sharing(false);
  await second.adapter.revoke(); assert.equal(first.values.get(EVENT_OUTBOX_KEY), bytes); assert.equal(first.values.get(META), metadata);
  second.sharing(true); await second.adapter.beginConsentPeriod(); second.adapter.trackSession(second.original, second.reference); await second.queue();
  assert.deepEqual(second.calls, [{ legacy: true }]); assert.equal(first.values.get(EVENT_OUTBOX_KEY), bytes); assert.equal(first.values.get(META), metadata);
  second.close(); first.online(true); await first.adapter.flush(); assert.equal(first.calls.length, 1); first.close();
});
test('a formerly contending consent period clears the previous tab queue before taking over a released lease', async () => {
  const first = fixture(); first.online(false); await first.queue(); const originalId = first.rows()[0].event.event_id;
  const second = fixture({ values: first.values, time: first.time, mutex: first.mutex }); second.online(false);
  await second.adapter.beginConsentPeriod(); second.adapter.trackSession(second.original, second.reference); await second.queue();
  assert.equal(second.rows()[0].event.event_id, originalId); assert.equal(second.calls[0].legacy, true);
  first.close(); await settle(); await second.queue('head_nod');
  assert.equal(second.rows().length, 1); assert.notEqual(second.rows()[0].event.event_id, originalId);
  second.online(true); await second.adapter.flush();
  assert.equal(second.calls.filter(row => !row.legacy).length, 1); assert.equal(second.calls.at(-1).type, 'head_nod'); second.close();
});
test('delayed document lease release permits legacy contention before a fresh keyed takeover', async () => {
  const released = deferred(), name = 'occulert.event-outbox.live-tab.v1';
  const mutex = locks({ beforeRelease: lock => lock === name ? released.promise : undefined });
  const first = fixture({ mutex }); first.online(false); await first.queue();
  const bytes = first.values.get(EVENT_OUTBOX_KEY), metadata = first.values.get(META), originalId = first.rows()[0].event.event_id;
  const second = fixture({ values: first.values, time: first.time, mutex }); second.online(false);
  await second.adapter.beginConsentPeriod(); second.adapter.trackSession(second.original, second.reference); await second.queue('yawn');
  first.close(); await settle(); assert.equal(mutex.held.has(name), true, 'document close does not imply browser lock release');
  await second.queue('head_nod');
  assert.deepEqual(second.calls, [{ legacy: true }, { legacy: true }]);
  assert.equal(first.values.get(EVENT_OUTBOX_KEY), bytes); assert.equal(first.values.get(META), metadata);
  released.resolve(); await settle(); assert.equal(mutex.held.has(name), false);
  await second.queue('head_nod'); assert.equal(second.rows().length, 1); assert.notEqual(second.rows()[0].event.event_id, originalId);
  assert.ok(JSON.parse(second.values.get(META)).version > JSON.parse(metadata).version);
  second.online(true); await second.adapter.flush();
  assert.equal(second.calls.length, 3); assert.equal(second.calls.filter(row => !row.legacy).length, 1);
  assert.equal(second.calls.at(-1).type, 'head_nod'); assert.notEqual(second.calls.at(-1).details.client_event_id, originalId);
  assert.equal(second.rows().length, 0); assert.equal(first.calls.length, 0); second.close();
});
test('a stale capability wait cannot release ownership acquired for a newer consent grant', async () => {
  const first = fixture(), capability = deferred(); first.backend.eventOutboxCapability = () => capability.promise;
  const stale = first.adapter.beginConsentPeriod(); await first.adapter.revoke(); const current = first.adapter.beginConsentPeriod();
  capability.resolve(true); await Promise.all([stale, current]); await settle();
  const second = fixture({ values: first.values, time: first.time, mutex: first.mutex });
  await second.adapter.beginConsentPeriod(); second.adapter.trackSession(second.original, second.reference); await second.queue();
  assert.deepEqual(second.calls, [{ legacy: true }]); second.close(); first.close();
});
test('logout after consent but before the first detection clears lifecycle metadata and releases its lease', async () => {
  const first = fixture(); await first.adapter.beginConsentPeriod();
  assert.equal(JSON.parse(first.values.get(META)).ownerId, owner);
  first.identity(null); first.event('storage', { key: 'occulert-auth' }); await settle();
  assert.equal(JSON.parse(first.values.get(META)).ownerId, null);
  const second = fixture({ values: first.values, time: first.time, mutex: first.mutex });
  await second.adapter.beginConsentPeriod(); second.adapter.trackSession(second.original, second.reference); await second.queue();
  assert.equal(second.calls.length, 1); assert.equal(second.calls[0].type, 'drowsy'); second.close(); first.close();
});
test('concurrent queues are atomic and a second tab cannot send duplicate keyed work', async () => {
  const f = fixture(); f.online(false); await Promise.all([f.queue('drowsy'), f.queue('yawn'), f.queue('head_nod')]);
  assert.equal(f.rows().length, 3); assert.equal(new Set(f.rows().map(row => row.event.event_id)).size, 3);
  f.online(true); await Promise.all([f.adapter.flush(), f.adapter.flush()]); assert.equal(f.calls.length, 3); assert.equal(f.rows().length, 0); f.close();
});
test('Retry-After and the five-send budget survive restart without a busy retry loop', async () => {
  const f = fixture(); f.transport(async () => ({ status: 429, retryAfterMs: 60_000, body: { error: 'event_rate_limited' } }));
  await f.queue(); assert.equal(f.calls.length, 1); await f.adapter.flush(); assert.equal(f.calls.length, 1);
  assert.equal(f.rows()[0].nextAttemptAt, f.time.now() + 60_000);
  for (let i = 0; i < 4; i++) { await f.time.advance(60_000); await f.adapter.flush(); }
  assert.equal(f.calls.length, 5); assert.equal(f.rows().length, 0); assert.equal(f.statuses.at(-1).exhausted, 1); f.close();
});
test('lost untimed response and controller restart preserve the persisted server-stamp intent and UUID', async () => {
  const f = fixture(); let first = true;
  f.transport(async () => first ? (first = false, { status: 400, body: { error: 'invalid_occurred_at' } }) : ({ status: 503, body: {} }));
  await f.queue(); assert.equal(f.calls.length, 2); const id = f.calls[0].details.client_event_id;
  assert.ok(f.calls[0].details.occurred_at); assert.equal(Object.hasOwn(f.calls[1].details, 'occurred_at'), false);
  assert.equal(f.rows()[0].timestampMode, 'server'); f.close(); await settle();
  const next = fixture({ values: f.values, time: f.time, mutex: f.mutex }); next.online(false); await next.queue('yawn');
  next.online(true); await next.time.advance(2_000); await next.adapter.flush();
  assert.equal(next.calls[0].details.client_event_id, id); assert.equal(Object.hasOwn(next.calls[0].details, 'occurred_at'), false); assert.equal(next.rows().length, 0); next.close();
});
for (const transition of ['consent', 'logout', 'switch', 'same-owner-login']) test(`${transition} invalidates a pending session and prevents legacy or keyed replay`, async () => {
  const f = fixture(), pending = deferred(); f.adapter.trackSession(f.original, pending.promise);
  const work = f.queue('drowsy', { fatigue_score: 34, confidence: 81 }, pending.promise); await settle();
  if (transition === 'consent') { f.sharing(false); await f.adapter.revoke(); }
  else { f.identity(transition === 'logout' ? null : { ownerId: transition === 'switch' ? 'other' : owner, loginId: 'different' }); f.event('occulert:auth-lifecycle'); }
  pending.resolve(session); await work; await settle(); assert.equal(f.calls.length, 0); assert.equal(f.values.has(EVENT_OUTBOX_KEY), false); f.close();
});
test('auth changes in another tab abort the active request and remove pending work', async () => {
  const f = fixture(), started = deferred(), response = deferred();
  f.transport(async (_id, _type, _details, current, options) => { started.resolve(); return Promise.race([response.promise, new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ status: 503, body: {} }), { once: true }))]); });
  const work = f.queue(); await started.promise; f.identity(null); f.event('storage', { key: 'occulert-auth' });
  assert.equal(f.calls[0].current(), false); await work; await settle(); assert.equal(f.values.has(EVENT_OUTBOX_KEY), false); assert.equal(f.calls.length, 1); f.close();
});
test('ordinary same-login token refresh leaves consent intact', async () => {
  const f = fixture(); f.online(false); await f.queue(); const before = f.values.get(META);
  f.event('storage', { key: 'occulert-auth' }); f.online(true); await f.adapter.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.values.get(META), before); f.close();
});
test('Stop discards only that session, including events waiting for its late session response', async () => {
  const f = fixture(); f.online(false); await f.queue();
  const later = Promise.resolve('55555555-5555-4555-8555-555555555555'); f.adapter.trackSession(f.original, later); await f.queue('yawn', { fatigue_score: 1, confidence: 90 }, later);
  f.adapter.stopSession(f.reference); await settle(); assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].event.session_id, await later);
  f.online(true); await f.adapter.flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].type, 'yawn'); f.close();
  const late = fixture(), pending = deferred(); late.adapter.trackSession(late.original, pending.promise);
  const work = late.queue('head_nod', { fatigue_score: 80, confidence: 90 }, pending.promise); await settle(); late.adapter.stopSession(pending.promise); pending.resolve(session);
  await work; await settle(); assert.equal(late.calls.length, 0); late.close();
});
test('cleanup failure stays disabled and never falls through to an unkeyed event', async () => {
  const f = fixture(); f.online(false); await f.queue(); f.fail('remove'); await f.adapter.revoke();
  f.online(true); await f.adapter.flush(); await f.queue(); assert.equal(f.calls.length, 0); assert.equal(f.statuses.at(-1).cleanupFailed, true);
  f.fail(null); await f.adapter.revoke(); assert.equal(f.values.has(EVENT_OUTBOX_KEY), false); f.close();
});
test('corrupt persistence fails closed, while explicit successful cleanup can recover', async () => {
  const f = fixture(); f.online(false); await f.queue(); f.online(true); f.values.set(EVENT_OUTBOX_KEY, '{bad'); await f.queue(); assert.equal(f.calls.length, 0); assert.equal(f.values.get(EVENT_OUTBOX_KEY), '{bad');
  await f.adapter.revoke(); await f.adapter.beginConsentPeriod(); f.adapter.trackSession(f.original, f.reference); await f.queue(); assert.equal(f.calls.length, 1); f.close();
});
test('an uncertain acknowledgement retains keyed work and hidden pages wait for foreground', async () => {
  const f = fixture(); f.transport(async () => ({ status: 200, body: { ok: true, client_event_id: 'wrong' } })); await f.queue();
  assert.equal(f.rows().length, 1); f.foreground(false); f.event('visibilitychange'); await f.time.advance(2_000); await f.adapter.flush(); assert.equal(f.calls.length, 1);
  f.foreground(true); f.event('visibilitychange'); await settle(); assert.equal(f.calls.length, 2); f.close();
});
test('a hung send is cancelled after eight seconds, retains identity, and does not block local callers', async () => {
  const f = fixture(), started = deferred(); f.transport(async () => { started.resolve(); return new Promise(() => {}); });
  const work = f.queue(); await started.promise; assert.equal(f.rows().length, 1);
  await f.time.advance(8_000); await work; assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.rows().length, 1); f.close();
});
test('event expiry during transport auth preparation fails the final dispatch guard', async () => {
  const f = fixture(), started = deferred(), response = deferred(); let posts = 0;
  f.transport(async (_id, _type, _details, current) => { started.resolve(); await response.promise; if (current()) posts++; return { status: 503, body: {} }; });
  const work = f.adapter.queue(f.original, f.reference, 'drowsy', { fatigue_score: 34, confidence: 81 }, new Date(f.time.now() - 900_000 + 1_000).toISOString(), () => assert.fail('legacy'));
  await started.promise; await f.time.advance(1_001); assert.equal(f.calls[0].current(), false); response.resolve(); await work;
  assert.equal(posts, 0); assert.equal(f.rows().length, 0); assert.equal(f.statuses.at(-1).expired, 1); f.close();
});
