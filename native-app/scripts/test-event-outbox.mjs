import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createNativeEventOutbox } from '../lib/nativeEventOutbox.ts';
import { EVENT_OUTBOX_KEY } from '../../lib/event-outbox.ts';
import { createAsyncMutationQueue } from '../lib/asyncMutationQueue.ts';
import { createCachedBooleanPreference } from '../lib/cachedBooleanPreference.ts';
import { createSessionSummaryOutbox } from '../lib/sessionSummaryOutbox.ts';
import { pinnedSupabaseConfig, SUPABASE_ORIGIN } from '../lib/supabaseHost.ts';

const OWNER = '11111111-1111-4111-8111-111111111111', LOGIN = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333', META = 'occulert.native-event-outbox.lifecycle.v1';
let sequence = 0;
const uuid = () => `44444444-4444-4444-8444-${String(++sequence).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 160; i++) await Promise.resolve(); };
function clock() {
  let time = Date.parse('2026-10-28T12:00:00.000Z'), number = 0;
  const timers = new Map();
  return { now: () => time, setTimeout: (work, delay) => { timers.set(++number, { work, at: time + delay }); return number; }, clearTimeout: id => timers.delete(id),
    async advance(ms) { time += ms; for (const [id, item] of [...timers]) if (item.at <= time && timers.delete(id)) item.work(); await settle(); }, timers };
}
function fixture(options = {}) {
  const values = options.values || new Map(), time = options.time || clock(), calls = [], writes = [], statuses = [];
  let foreground = true, capable = true, current = true, failure = null;
  const lifecycle = { authVersion: 0, consentVersion: 0 }, authority = { ownerId: OWNER, loginId: LOGIN, lifecycle: { ...lifecycle } };
  let transport = async event => ({ status: 200, body: { ok: true, client_event_id: event.event_id, event: { session_id: event.session_id } } });
  const storage = {
    getItem: async key => { if (failure === 'read') throw Error('read'); return values.get(key) ?? null; },
    setItem: async (key, value) => { if (failure === 'write') throw Error('write'); writes.push({ key, value }); values.set(key, value); },
    removeItem: async key => { if (failure === 'remove') throw Error('remove'); writes.push({ key, removed: true }); values.delete(key); },
  };
  const adapterOptions = { enabled: true, storage, randomUUID: uuid, lifecycle: () => ({ ...lifecycle }), sessionScope: () => authority,
    isCurrent: () => current, capability: async () => capable, foreground: () => foreground,
    send: async (event, delivery, allowed, signal) => { calls.push({ event: { ...event }, delivery: { ...delivery }, allowed, signal }); return transport(event, delivery, allowed, signal); },
    onStatus: status => statuses.push(status), ...time, ...options.adapterOptions };
  const adapter = createNativeEventOutbox(adapterOptions), session = Promise.resolve(SESSION);
  const queue = (type = 'drowsy', sessionReference = session) => adapter.queue(sessionReference, type, 37, null, new Date(time.now()).toISOString(), async id => { calls.push({ legacy: id }); });
  return { values, time, calls, writes, statuses, lifecycle, authority, adapter, adapterOptions, storage, session, queue,
    rows: () => JSON.parse(values.get(EVENT_OUTBOX_KEY) || '{"rows":[]}').rows,
    foreground: value => { foreground = value; adapter.foregroundChanged(); }, capable: value => { capable = value; }, current: value => { current = value; },
    transport: value => { transport = value; }, fail: value => { failure = value; } };
}

test('native default-off neither reads queue storage nor calls UUID, capability or transport', async () => {
  const fail = () => assert.fail('default-off effect');
  const box = createNativeEventOutbox({ enabled: false, storage: { getItem: fail, setItem: fail, removeItem: fail }, randomUUID: fail,
    lifecycle: fail, sessionScope: fail, isCurrent: fail, capability: fail, foreground: fail, send: fail });
  assert.equal(box.queue(Promise.resolve(SESSION), 'drowsy', 10, null, new Date().toISOString(), fail), null);
  box.stopSession(SESSION); box.foregroundChanged(); await box.flush(); await box.revoke();
});
test('native capability absence falls back only before queue adoption without writing storage', async () => {
  const f = fixture(); f.capable(false); await f.queue();
  assert.deepEqual(f.calls, [{ legacy: SESSION }]); assert.equal(f.writes.length, 0);
});
test('native snapshots preserve UUID, metrics and actual type through independent concurrent detections', async () => {
  const f = fixture(); f.foreground(false);
  await Promise.all(['drowsy', 'distracted', 'yawn', 'head_nod'].map(type => f.queue(type)));
  assert.equal(f.rows().length, 4); assert.equal(new Set(f.rows().map(row => row.event.event_id)).size, 4);
  f.foreground(true); await f.adapter.flush();
  assert.deepEqual(f.calls.map(row => row.event.type), ['drowsy', 'distracted', 'yawn', 'head_nod']);
  assert.ok(f.calls.every(row => row.event.fatigue === 37 && row.event.confidence === null)); assert.equal(f.rows().length, 0);
});
test('a new native process discards unknown prior sessions and advances generation without changing sharing preference', async () => {
  const first = fixture(); first.values.set('occulert-cloud-sync-enabled', 'true'); first.foreground(false); await first.queue();
  const originalId = first.rows()[0].event.event_id, version = JSON.parse(first.values.get(META)).version;
  const next = fixture({ values: first.values, time: first.time }); next.foreground(false); await next.queue('yawn');
  assert.equal(next.rows().length, 1); assert.notEqual(next.rows()[0].event.event_id, originalId);
  assert.ok(JSON.parse(next.values.get(META)).version > version); assert.equal(next.values.get('occulert-cloud-sync-enabled'), 'true');
});
test('same live service controller restoration retains persisted untimed intent after a lost response', async () => {
  const f = fixture(); let attempt = 0;
  f.transport(async (_event, delivery) => {
    if (++attempt === 1) return { status: 400, body: { error: 'invalid_occurred_at' } };
    assert.equal(delivery.timestampMode, 'server'); assert.equal(f.rows()[0].timestampMode, 'server');
    return { status: 503 };
  });
  await f.queue(); const id = f.calls[0].event.event_id; assert.equal(f.calls.length, 2);
  const restoredController = { flush: () => f.adapter.flush() };
  f.transport(async event => ({ status: 200, body: { ok: true, client_event_id: event.event_id, event: { session_id: event.session_id } } }));
  await f.time.advance(2_000); await restoredController.flush();
  assert.equal(f.calls[2].event.event_id, id); assert.equal(f.calls[2].delivery.timestampMode, 'server'); assert.equal(f.rows().length, 0);
});
test('native Retry-After preserves one identity, stops at five sends, and reports exhaustion', async () => {
  const f = fixture(); f.transport(async () => ({ status: 429, retryAfterMs: 60_000 }));
  await f.queue(); await f.adapter.flush(); assert.equal(f.calls.length, 1);
  for (let i = 0; i < 4; i++) { await f.time.advance(60_000); await f.adapter.flush(); }
  assert.equal(f.calls.length, 5); assert.equal(new Set(f.calls.map(row => row.event.event_id)).size, 1);
  assert.equal(f.rows().length, 0); assert.equal(f.adapter.status().exhausted, 1);
});
test('native expiry is immutable and dispatch is forbidden after expiry during auth preparation', async () => {
  const f = fixture(), start = deferred(), response = deferred(); let posts = 0;
  f.transport(async (_event, _delivery, allowed) => { start.resolve(); await response.promise; if (allowed()) posts++; return { status: 503 }; });
  const work = f.adapter.queue(f.session, 'drowsy', 37, null, new Date(f.time.now() - 900_000 + 1_000).toISOString(), async () => assert.fail('legacy'));
  await start.promise; await f.time.advance(1_001); assert.equal(f.calls[0].allowed(), false); response.resolve(); await work;
  assert.equal(posts, 0); assert.equal(f.rows().length, 0); assert.equal(f.adapter.status().expired, 1);
});
for (const change of ['logout', 'switch', 'consent']) test(`native ${change} invalidates work while session creation waits`, async () => {
  const f = fixture(), pending = deferred(); const queued = f.queue('drowsy', pending.promise);
  if (change === 'consent') f.lifecycle.consentVersion++; else f.lifecycle.authVersion++;
  await f.adapter.revoke(); pending.resolve(SESSION); await queued;
  assert.equal(f.calls.length, 0); assert.equal(f.values.has(EVENT_OUTBOX_KEY), false);
});
test('native Stop invalidates a pending session immediately and discards only its queued records', async () => {
  const f = fixture(); f.foreground(false); await f.queue();
  const another = Promise.resolve('55555555-5555-4555-8555-555555555555'); await f.queue('yawn', another);
  f.adapter.stopSession(f.session); await settle(); assert.equal(f.rows().length, 1);
  f.foreground(true); await f.adapter.flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].event.type, 'yawn');
  const late = fixture(), pending = deferred(), work = late.queue('drowsy', pending.promise);
  late.adapter.stopSession(pending.promise); pending.resolve(SESSION); await work; assert.equal(late.calls.length, 0);
});
test('native revoke aborts an in-flight send and late success cannot restore cleared rows', async () => {
  const f = fixture(), start = deferred(), response = deferred();
  f.transport(async () => { start.resolve(); return response.promise; });
  const work = f.queue(); await start.promise; await f.adapter.revoke(); assert.equal(f.calls[0].allowed(), false);
  response.resolve({ status: 200, body: { ok: true } }); await work; assert.equal(f.values.has(EVENT_OUTBOX_KEY), false);
});
test('native failed cleanup remains fail-closed and can recover only after successful removal', async () => {
  const f = fixture(); f.foreground(false); await f.queue(); f.fail('remove'); await f.adapter.revoke();
  f.foreground(true); await f.queue(); await f.adapter.flush(); assert.equal(f.calls.length, 0); assert.equal(f.adapter.status().cleanupFailed, true);
  f.fail(null); await f.adapter.revoke(); await f.queue(); assert.equal(f.calls.length, 1);
});
test('a timed-out native write cannot be overtaken by cleanup or a later consent generation', async () => {
  const f = fixture(); f.foreground(false); const original = f.storage.setItem, pending = deferred(), entered = deferred(); let held = false;
  f.storage.setItem = async (key, value) => {
    if (key === EVENT_OUTBOX_KEY && !held) { held = true; entered.resolve(); await pending.promise; }
    return original(key, value);
  };
  const queued = f.queue(); await entered.promise; await f.time.advance(8_001); await queued;
  assert.equal(f.adapter.status().unavailable, true); const clearing = f.adapter.revoke(); await settle();
  assert.equal(f.values.has(EVENT_OUTBOX_KEY), false); pending.resolve(); await clearing; await settle();
  assert.equal(f.values.has(EVENT_OUTBOX_KEY), false); assert.equal(f.calls.length, 0);
  await f.queue('yawn'); assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].event.type, 'yawn');
});
test('a hung native sender ends after eight seconds with keyed uncertainty and no unkeyed fallback', async () => {
  const f = fixture(), entered = deferred(); f.transport(async () => { entered.resolve(); return new Promise(() => {}); });
  const queued = f.queue(); await entered.promise; await f.time.advance(8_001); await queued;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.rows().length, 1);
});
test('native capacity rejects the fifty-first alert and lazy expiry removes only ineligible rows', async () => {
  const f = fixture(); f.foreground(false);
  for (let i = 0; i < 51; i++) await f.queue();
  assert.equal(f.rows().length, 50); assert.equal(f.adapter.status().capacityRejected, 1);
  await f.time.advance(900_001); assert.equal(f.rows().length, 50, 'inactive processes cannot eagerly delete bytes');
  f.foreground(true); await f.adapter.flush();
  assert.equal(f.calls.length, 0); assert.equal(f.rows().length, 0); assert.equal(f.adapter.status().expired, 50);
});
test('corruption after adoption fails closed until explicit cleanup', async () => {
  const f = fixture(); f.foreground(false); await f.queue(); f.values.set(EVENT_OUTBOX_KEY, '{corrupt');
  f.foreground(true); await f.adapter.flush(); assert.equal(f.calls.length, 0); assert.equal(f.adapter.status().unavailable, true);
  await f.queue(); assert.equal(f.calls.length, 0); await f.adapter.revoke(); await f.queue(); assert.equal(f.calls.length, 1);
});

// Execute the complete native cloud module with only native bridges replaced.
const source = readFileSync(new URL('../lib/cloudSync.ts', import.meta.url), 'utf8');
const token = (owner = OWNER, login = LOGIN) => `unused.${Buffer.from(JSON.stringify({ sub: owner, session_id: login })).toString('base64url')}.unused`;
function cloudFixture({ enabled = true, capability = true, expiresIn = 3600, login = LOGIN } = {}) {
  const time = clock(), storage = new Map([['occulert-cloud-sync-enabled', 'true']]), calls = [], listeners = [];
  const secure = new Map([['occulert.cloud.auth.v1', JSON.stringify({ access_token: token(OWNER, login), refresh_token: 'fixture-refresh', expires_at: time.now() / 1000 + expiresIn, user: { id: OWNER, email: 'driver@example.com' } })]]);
  class Clock extends Date { static now() { return time.now(); } }
  const f = { time, storage, secure, calls, listeners, uuids: [], capability, appState: { currentState: 'active' },
    authResponse: () => ({ access_token: token(), refresh_token: 'fixture-refreshed', expires_in: 3600, user: { id: OWNER, email: 'driver@example.com' } }),
    transport: async (_url, init) => {
    const body = JSON.parse(init.body);
    return Response.json({ ok: true, event: { session_id: body.session_id }, client_event_id: body.client_event_id, replayed: false });
  } };
  const exports = {}, body = source.replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(`${stripTypeScriptTypes(body)}\nObject.assign(exports,{beginCloudSession,logCloudAlert,queueNativeCloudAlert,stopNativeCloudEvents,signOutOfCloud,setCloudSyncEnabled,signInToCloud,nativeCloudEventRetryStatus,refreshIfNeeded,nativeEventLogin});`, {
    exports, process: { env: { EXPO_PUBLIC_EVENT_OUTBOX: enabled ? '1' : undefined } }, Date: Clock, AbortController,
    createNativeEventOutbox, createAsyncMutationQueue, createCachedBooleanPreference, createSessionSummaryOutbox, pinnedSupabaseConfig,
    uuid: { v4: () => { const id = uuid(); f.uuids.push(id); return id; } }, Platform: { OS: 'ios', Version: 'test' },
    AppState: Object.assign(f.appState, { addEventListener: (_name, callback) => { listeners.push(callback); return { remove() {} }; } }),
    currentAppBuildInfo: () => ({}), formatAppBuildLabel: () => 'fixture', updateSessionHistory: async () => {},
    AsyncStorage: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { if (f.writeFailure === key) throw Error('fixture write'); storage.set(key, value); },
      removeItem: async key => { if (f.removeFailure === key) throw Error('fixture removal'); storage.delete(key); } },
    SecureStore: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device', isAvailableAsync: async () => true, getItemAsync: async key => secure.get(key) ?? null,
      setItemAsync: async (key, value) => { secure.set(key, value); }, deleteItemAsync: async key => { secure.delete(key); } },
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/api/public-config')) { await f.configWait; return Response.json({ ok: true, supabase: { configured: true, url: SUPABASE_ORIGIN, anonKey: 'fixture-public' },
        capabilities: f.capability ? { event_idempotency_protocol: 'client_event_uuid_v1' } : {} }); }
      if (url.endsWith('/api/profile')) return Response.json({ driver: { id: OWNER } });
      if (url.endsWith('/api/sessions')) { await f.sessionWait; return Response.json({ ok: true, session: { id: SESSION } }); }
      if (url.includes('/auth/v1/token?')) { await f.authWait; return Response.json(f.authResponse()); }
      if (url.includes('/auth/v1/logout?')) return Response.json({});
      return f.transport(url, init);
    },
  });
  return Object.assign(f, { api: exports, events: () => calls.filter(call => call.url.endsWith('/api/events')).map(call => JSON.parse(call.init.body)),
    active: next => { f.appState.currentState = next ? 'active' : 'background'; for (const listener of listeners) listener(f.appState.currentState); } });
}
test('native flag-off keeps the real legacy request body and creates no retry storage or lifecycle listener', async () => {
  const f = cloudFixture({ enabled: false }); const session = f.api.beginCloudSession();
  assert.equal(f.api.queueNativeCloudAlert(session, 61.4, new Date(f.time.now()).toISOString()), null);
  await f.api.logCloudAlert(await session, 61.4, new Date(f.time.now()).toISOString());
  assert.deepEqual(f.events(), [{ session_id: SESSION, type: 'drowsy', fatigue_score: 61, occurred_at: new Date(f.time.now()).toISOString() }]);
  assert.equal(f.listeners.length, 0); assert.equal(f.storage.has(META), false); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
});
test('native login hints decode bounded UTF-8 base64url without a browser atob global', () => {
  const f = cloudFixture(), payload = Buffer.from(JSON.stringify({ sub: OWNER, session_id: LOGIN, display_name: 'Prueba 🚗' })).toString('base64url');
  const auth = access_token => ({ access_token, user: { id: OWNER } });
  assert.deepEqual(structuredClone(f.api.nativeEventLogin(auth(`unused.${payload}.unused`))), { ownerId: OWNER, loginId: LOGIN });
  for (const encoded of ['x', 'Zh', '%%%', payload + '=', 'a'.repeat(16_385), Buffer.from([255]).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'another-owner', session_id: LOGIN })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: OWNER })).toString('base64url')]) assert.equal(f.api.nativeEventLogin(auth(`unused.${encoded}.unused`)), null);
});
test('the real native keyed sender uses one POST and validates a durable replay acknowledgement', async () => {
  const f = cloudFixture(); const session = f.api.beginCloudSession();
  await f.api.queueNativeCloudAlert(session, 61.4, new Date(f.time.now()).toISOString());
  assert.equal(f.events().length, 1); assert.match(f.events()[0].client_event_id, /^[0-9a-f-]{36}$/);
  assert.equal(f.events()[0].fatigue_score, 61); assert.equal(f.events()[0].confidence, null);
  assert.equal(f.api.nativeCloudEventRetryStatus().pending, 0);
});
test('real native timestamp fallback persists omitted wire intent after a lost response and replays the same key', async () => {
  const f = cloudFixture(); let attempt = 0;
  f.transport = async (_url, init) => {
    const event = JSON.parse(init.body);
    if (++attempt === 1) return Response.json({ error: 'invalid_occurred_at' }, { status: 400 });
    if (attempt === 2) throw Error('response lost');
    return Response.json({ ok: true, event: { session_id: event.session_id }, client_event_id: event.client_event_id, replayed: true });
  };
  // The fetch closure above reads f.transport; preserve that object identity.
  const session = f.api.beginCloudSession(); await f.api.queueNativeCloudAlert(session, 61.4, new Date(f.time.now()).toISOString());
  assert.equal(f.events().length, 2); assert.ok(f.events()[0].occurred_at); assert.equal(Object.hasOwn(f.events()[1], 'occurred_at'), false);
  await f.time.advance(2_000); await settle();
  assert.equal(f.events().length, 3); assert.deepEqual(f.events()[2], f.events()[1]);
});
for (const waitingFor of ['session response', 'earlier event']) test(`actual monitor captures one immutable UUID and timestamp before ${waitingFor}`, async () => {
  const f = cloudFixture(), wait = deferred(); if (waitingFor === 'session response') f.sessionWait = wait.promise;
  const session = f.api.beginCloudSession(), detectedAt = f.time.now(), result = { state: 'closed', fatigueScore: 61.4 };
  const queue = { current: waitingFor === 'earlier event' ? wait.promise : Promise.resolve() }, count = { current: 0 };
  const monitor = readFileSync(new URL('../app/monitor.tsx', import.meta.url), 'utf8');
  const from = monitor.indexOf("    const alerting = result.state === 'closed';"), end = '    prevAlertingRef.current = alerting;';
  assert.ok(from >= 0 && monitor.indexOf(end, from) > from);
  vm.runInNewContext(monitor.slice(from, monitor.indexOf(end, from) + end.length), {
    Date, now: detectedAt, result, prevAlertingRef: { current: false }, alertCountRef: count, setAlertCount() {},
    cloudSessionRef: { current: session }, cloudEventQueueRef: queue, queueNativeCloudAlert: f.api.queueNativeCloudAlert,
    logCloudAlert: () => assert.fail('keyed work cannot fall through'),
  });
  assert.equal(count.current, 1, 'local alert transition finishes before any native or network wait');
  assert.equal(f.uuids.length, 1, 'identity is allocated at detection');
  const id = f.uuids[0]; result.fatigueScore = 99; await settle();
  await f.time.advance(5_000); wait.resolve(); await queue.current;
  assert.equal(f.events().length, 1); assert.equal(f.events()[0].client_event_id, id);
  assert.equal(f.events()[0].fatigue_score, 61); assert.equal(f.events()[0].occurred_at, new Date(detectedAt).toISOString());
});
test('native capability absence preserves the real best-effort path without adopting queue storage', async () => {
  const f = cloudFixture({ capability: false }); const session = f.api.beginCloudSession();
  await f.api.queueNativeCloudAlert(session, 14, new Date(f.time.now()).toISOString());
  assert.equal(f.events().length, 1); assert.equal(Object.hasOwn(f.events()[0], 'client_event_id'), false);
  assert.equal(f.storage.has(META), false); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
});
for (const login of [null, 'opaque-login']) test(`native missing retry identity ${login} preserves guarded legacy delivery before adoption`, async () => {
  const f = cloudFixture({ login }), session = f.api.beginCloudSession(), occurredAt = new Date(f.time.now()).toISOString();
  await f.api.queueNativeCloudAlert(session, 30, occurredAt);
  assert.deepEqual(f.events(), [{ session_id: SESSION, type: 'drowsy', fatigue_score: 30, occurred_at: occurredAt }]);
  assert.equal(f.storage.has(META), false); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
});
for (const login of [null, 'opaque-login']) test(`same-owner native refresh without usable identity ${login} preserves the original legacy detection`, async () => {
  const f = cloudFixture({ login, expiresIn: -1 });
  f.authResponse = () => ({ access_token: token(OWNER, login), refresh_token: 'opaque-refreshed', expires_in: 3600, user: { id: OWNER, email: 'driver@example.com' } });
  const occurredAt = new Date(f.time.now()).toISOString();
  await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 30, occurredAt);
  assert.equal(f.calls.filter(call => call.url.includes('grant_type=refresh_token')).length, 1);
  assert.deepEqual(f.events(), [{ session_id: SESSION, type: 'drowsy', fatigue_score: 30, occurred_at: occurredAt }]);
  assert.equal(f.storage.has(META), false); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
});
for (const transition of ['consent', 'stop']) test(`unavailable native retry identity cannot bypass ${transition} while a session waits`, async () => {
  const f = cloudFixture({ login: null }), pending = deferred(); f.sessionWait = pending.promise;
  const session = f.api.beginCloudSession(), work = f.api.queueNativeCloudAlert(session, 30, new Date(f.time.now()).toISOString()); await settle();
  if (transition === 'consent') await f.api.setCloudSyncEnabled(false); else f.api.stopNativeCloudEvents(session);
  pending.resolve(); await work; assert.equal(f.events().length, 0); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
});
test('native keyed 401 is one event POST without forced auth refresh or immediate replay', async () => {
  const f = cloudFixture(); f.transport = async () => Response.json({ error: 'sign_in_required' }, { status: 401 });
  await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 30, new Date(f.time.now()).toISOString());
  assert.equal(f.events().length, 1); assert.equal(f.calls.filter(call => call.url.includes('grant_type=refresh_token')).length, 0);
  assert.equal(f.api.nativeCloudEventRetryStatus().pending, 1); const first = f.events()[0];
  await f.time.advance(2_000); assert.equal(f.events().length, 2); assert.deepEqual(f.events()[1], first);
});
test('routine native refresh retains the same login and pending event identity', async () => {
  const f = cloudFixture({ expiresIn: 5 }); let attempt = 0;
  f.transport = async (_url, init) => {
    const event = JSON.parse(init.body);
    return ++attempt === 1 ? Response.json({ error: 'event_rate_limited' }, { status: 429, headers: { 'Retry-After': '10' } })
      : Response.json({ ok: true, event: { session_id: event.session_id }, client_event_id: event.client_event_id, replayed: true });
  };
  await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 30, new Date(f.time.now()).toISOString());
  const first = f.events()[0]; await f.time.advance(10_000); await settle();
  assert.equal(f.events().length, 2); assert.deepEqual(f.events()[1], first);
  assert.equal(f.calls.filter(call => call.url.includes('grant_type=refresh_token')).length, 1);
  assert.equal(f.api.nativeCloudEventRetryStatus().pending, 0);
});
for (const change of ['login', 'owner', 'missing login']) test(`an unexpected changed ${change} in native refresh clears the old retry scope`, async () => {
  const f = cloudFixture({ expiresIn: 5 });
  f.transport = async () => Response.json({ error: 'event_rate_limited' }, { status: 429, headers: { 'Retry-After': '10' } });
  await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 30, new Date(f.time.now()).toISOString());
  f.authResponse = () => ({ access_token: token(change === 'owner' ? '66666666-6666-4666-8666-666666666666' : OWNER, change === 'missing login' ? null : '77777777-7777-4777-8777-777777777777'),
    refresh_token: 'unexpected-login', expires_in: 3600, user: { id: change === 'owner' ? '66666666-6666-4666-8666-666666666666' : OWNER, email: 'driver@example.com' } });
  await f.time.advance(10_000); await settle();
  assert.equal(f.events().length, 1); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
  assert.equal(JSON.parse(f.storage.get(META)).ownerId, null);
});
for (const transition of ['signout', 'consent', 'same-owner new login', 'another owner']) test(`actual native ${transition} invalidates an unresolved session before replay`, async () => {
  const f = cloudFixture(), pending = deferred(); f.sessionWait = pending.promise;
  const session = f.api.beginCloudSession(), work = f.api.queueNativeCloudAlert(session, 20, new Date(f.time.now()).toISOString()); await settle();
  if (transition === 'signout') await f.api.signOutOfCloud();
  else if (transition === 'consent') { await f.api.setCloudSyncEnabled(false); await f.api.setCloudSyncEnabled(true); }
  else {
    const owner = transition === 'another owner' ? '66666666-6666-4666-8666-666666666666' : OWNER;
    f.authResponse = () => ({ access_token: token(owner, '77777777-7777-4777-8777-777777777777'), refresh_token: 'new-login', expires_in: 3600, user: { id: owner, email: 'new@example.com' } });
    const result = await f.api.signInToCloud('new@example.com', 'test-password'); assert.equal(result.ok, true);
    assert.equal(f.storage.get('occulert-cloud-sync-enabled'), 'false');
  }
  pending.resolve(); await work; await f.time.advance(60_000);
  assert.equal(f.events().length, 0); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
});
test('actual native Stop cancels dispatch while a normal same-login refresh is pending', async () => {
  const f = cloudFixture({ expiresIn: 5 }), pending = deferred(); const session = f.api.beginCloudSession(); await session;
  await f.time.advance(5_001); f.authWait = pending.promise;
  const work = f.api.queueNativeCloudAlert(session, 25, new Date(f.time.now()).toISOString()); await settle();
  assert.equal(f.calls.filter(call => call.url.includes('grant_type=refresh_token')).length, 1);
  f.api.stopNativeCloudEvents(session); pending.resolve(); await work; await settle();
  assert.equal(f.events().length, 0); assert.equal(f.api.nativeCloudEventRetryStatus().pending, 0);
});
test('actual native foreground ownership pauses retries until active without changing wire intent', async () => {
  const f = cloudFixture(); f.active(false);
  await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 30, new Date(f.time.now()).toISOString());
  assert.equal(f.events().length, 0); assert.equal(f.api.nativeCloudEventRetryStatus().pending, 1);
  f.active(true); await settle(); assert.equal(f.events().length, 1); assert.equal(f.api.nativeCloudEventRetryStatus().pending, 0);
});
test('actual native cleanup failure preserves persisted opt-out and cannot re-enable until deletion succeeds', async () => {
  const f = cloudFixture(); f.active(false); await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 30, new Date(f.time.now()).toISOString());
  f.removeFailure = EVENT_OUTBOX_KEY;
  assert.equal(await f.api.setCloudSyncEnabled(false), false); assert.equal(f.storage.get('occulert-cloud-sync-enabled'), 'false');
  assert.equal(await f.api.setCloudSyncEnabled(true), false); assert.equal(f.api.nativeCloudEventRetryStatus().cleanupFailed, true);
  f.active(true); await f.time.advance(60_000); assert.equal(f.events().length, 0);
  f.removeFailure = null; assert.equal(await f.api.setCloudSyncEnabled(true), true); assert.equal(f.storage.has(EVENT_OUTBOX_KEY), false);
  await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 35, new Date(f.time.now()).toISOString()); assert.equal(f.events().length, 1);
});
for (const [header, expected] of [['60', 60_000], ['999999999', 900_000], ['invalid', 1_000], ['-1', 1_000]]) test(`actual native Retry-After ${header} is bounded before scheduling`, async () => {
  const f = cloudFixture(); f.transport = async () => Response.json({ error: 'event_rate_limited' }, { status: 429, headers: { 'Retry-After': header } });
  await f.api.queueNativeCloudAlert(f.api.beginCloudSession(), 30, new Date(f.time.now()).toISOString());
  assert.equal(f.api.nativeCloudEventRetryStatus().nextAttemptAt - f.time.now(), expected);
});
