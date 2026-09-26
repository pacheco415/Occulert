import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { createWatchMonitoringMessage } from '../native-app/lib/watchMessages.ts';

// Run the production bridge with a fake native module and clock, so stalled
// native promises exercise real deadlines without a device or real-time waits.
const source = readFileSync(new URL('../native-app/lib/watchBridge.ts', import.meta.url), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let count = 0; count < 40; count += 1) await Promise.resolve(); };
const statusMethods = ['getIsPaired', 'getIsWatchAppInstalled', 'getReachability'];
const unknownStatus = { moduleAvailable: true, paired: false, appInstalled: false, reachable: false };
const connectedStatus = { moduleAvailable: true, paired: true, appInstalled: true, reachable: true };
const noDelivery = { accepted: false, reachable: false, acknowledged: false, roundTripMs: null };
const plain = value => JSON.parse(JSON.stringify(value));

function fakeClock() {
  let now = 1_800_000_000_000, nextTimer = 0;
  const timers = new Map();
  return {
    timers,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, at: now + Math.max(0, delay) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    rewind(ms) { now -= ms; },
    async advance(ms) {
      await flush();
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

function watchFixture({ platform = 'ios', missingModule = false } = {}) {
  const clock = fakeClock(), contexts = [], messages = [], queries = [];
  const f = { clock, contexts, messages, queries, moduleLoads: 0, liveReply: 'ack', contextFails: false };
  const native = {
    updateApplicationContext(message) {
      contexts.push(message);
      if (f.contextFails) throw new Error('context unavailable');
    },
    sendMessage(message, reply, error) {
      messages.push(message);
      if (f.liveReply === 'ack') reply?.({ received: true });
      if (f.liveReply === 'error') error?.(new Error('live channel unavailable'));
    },
  };
  const answers = Object.fromEntries(statusMethods.map(name => [name, () => Promise.resolve(false)]));
  statusMethods.forEach(name => {
    native[name] = () => { queries.push(name); return answers[name](); };
  });
  const body = source.replace(/^import[\s\S]*?;\s*/gm, '')
    .replace(/^export type \{[^}]+\} from .*;\s*$/gm, '')
    .replace(/^export (?:default )?/gm, '');
  const api = {};
  vm.runInNewContext(`${stripTypeScriptTypes(body)}\nObject.assign(api, {getWatchStatus,isWatchAvailable,sendAlertToWatch,sendMonitoringStatusToWatch});`, {
    api, Date: clock.Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Platform: { OS: platform }, createWatchMonitoringMessage,
    require(name) {
      assert.equal(name, 'react-native-watch-connectivity');
      f.moduleLoads += 1;
      if (missingModule) throw new Error('module not linked');
      return native;
    },
  }, { timeout: 1000 });
  return { ...f, api, native, answers, clock,
    get moduleLoads() { return f.moduleLoads; },
    set liveReply(value) { f.liveReply = value; },
    set contextFails(value) { f.contextFails = value; },
  };
}

// Observe rather than await an unbounded promise: the old implementation must
// fail an assertion instead of leaving the test runner waiting indefinitely.
function observe(promise) {
  const observation = { settled: false, value: undefined, error: undefined };
  promise.then(value => { observation.value = value; observation.settled = true; },
    error => { observation.error = error; observation.settled = true; });
  return observation;
}
function result(observation) {
  assert.equal(observation.settled, true, 'the bridge operation must settle within its deadline');
  assert.equal(observation.error, undefined);
  return plain(observation.value);
}
const alertPayload = { level: 'alert', perclos: 0.4567, at: 1_800_000_000_000 };
const monitoringPayload = { running: true, state: 'open', fatigueScore: 10, perclos: 0.1, sessionTime: 5, at: alertPayload.at };

for (const contextFails of [false, true]) {
  test(`a positive live reply is accepted despite false status flags and context failure=${contextFails}`, async () => {
    const f = watchFixture();
    f.contextFails = contextFails;
    const pending = observe(f.api.sendAlertToWatch(alertPayload));
    assert.equal(f.messages.length, 1, 'live delivery starts before activation or status checks');
    assert.equal(f.queries.length, 0);
    await f.clock.advance(500);
    assert.deepEqual(result(pending), { accepted: true, reachable: true, acknowledged: true, roundTripMs: 0 });
    assert.equal(f.clock.timers.size, 0);
  });
}

for (const failedMethod of statusMethods) {
  test(`a positive live reply survives a rejected ${failedMethod} query`, async () => {
    const f = watchFixture();
    f.answers[failedMethod] = () => Promise.reject(new Error('native query failed'));
    const pending = observe(f.api.sendAlertToWatch(alertPayload));
    await f.clock.advance(500);
    assert.deepEqual(result(pending), { accepted: true, reachable: true, acknowledged: true, roundTripMs: 0 });
    assert.equal(f.clock.timers.size, 0);
  });
}

for (const stalled of [...statusMethods, 'all']) {
  test(`stalled ${stalled} status queries return conservatively at the deadline and permit retry`, async () => {
    const f = watchFixture();
    for (const name of statusMethods) {
      if (stalled === 'all' || stalled === name) f.answers[name] = () => new Promise(() => {});
    }
    const pending = observe(f.api.getWatchStatus());
    await f.clock.advance(499);
    assert.equal(f.queries.length, 0, 'activation receives a bounded settle period');
    await f.clock.advance(1);
    assert.equal(f.queries.length, 3);
    await f.clock.advance(1499);
    assert.equal(pending.settled, false);
    await f.clock.advance(1);
    assert.deepEqual(result(pending), unknownStatus);
    assert.equal(f.clock.timers.size, 0, 'timeout releases every timer');
    statusMethods.forEach(name => { f.answers[name] = () => Promise.resolve(true); });
    const retry = observe(f.api.getWatchStatus());
    await flush();
    assert.deepEqual(result(retry), connectedStatus);
    assert.equal(f.queries.length, 6, 'retry performs fresh native queries');
    assert.equal(f.clock.timers.size, 0, 'successful retry clears its deadline');
  });
}

for (const completion of ['resolve', 'reject']) {
  test(`a late native ${completion} after timeout cannot replace recovered cached status`, async () => {
    const f = watchFixture(), late = deferred();
    f.answers.getIsPaired = () => late.promise;
    const expired = observe(f.api.getWatchStatus());
    await f.clock.advance(2000);
    assert.deepEqual(result(expired), unknownStatus);
    statusMethods.forEach(name => { f.answers[name] = () => Promise.resolve(true); });
    assert.deepEqual(plain(await f.api.getWatchStatus()), connectedStatus);
    if (completion === 'resolve') late.resolve(false); else late.reject(new Error('late native failure'));
    await flush();
    assert.deepEqual(plain(await f.api.getWatchStatus(5000)), connectedStatus);
    assert.equal(f.queries.length, 6, 'the recovered cache remains usable without another query');
    assert.equal(f.clock.timers.size, 0);
  });
}

for (const newerReachable of [false, true]) {
  test(`an older overlapping read cannot replace newer reachable=${newerReachable} cached status`, async () => {
    const f = watchFixture(), olderQueries = statusMethods.map(() => deferred());
    statusMethods.forEach((name, index) => { f.answers[name] = () => olderQueries[index].promise; });
    const older = observe(f.api.getWatchStatus());
    await f.clock.advance(500);
    statusMethods.forEach(name => { f.answers[name] = () => Promise.resolve(newerReachable); });
    const newerStatus = newerReachable ? connectedStatus : unknownStatus;
    assert.deepEqual(plain(await f.api.getWatchStatus()), newerStatus);
    olderQueries.forEach(query => query.resolve(!newerReachable));
    await flush();
    result(older);
    assert.deepEqual(plain(await f.api.getWatchStatus(5000)), newerStatus);
    assert.equal(f.queries.length, 6);
    assert.equal(f.clock.timers.size, 0);
  });
}

for (const liveReply of ['ack', 'none']) {
  test(`alert delivery with live reply=${liveReply} is bounded when every status query stalls`, async () => {
    const f = watchFixture();
    f.liveReply = liveReply;
    statusMethods.forEach(name => { f.answers[name] = () => new Promise(() => {}); });
    const pending = observe(f.api.sendAlertToWatch(alertPayload));
    await f.clock.advance(2000);
    assert.deepEqual(result(pending), liveReply === 'ack'
      ? { accepted: true, reachable: true, acknowledged: true, roundTripMs: 0 }
      : noDelivery);
    assert.equal(f.clock.timers.size, 0);
  });
}

test('saved context with unknown status and no live reply does not claim acceptance', async () => {
  const f = watchFixture();
  f.liveReply = 'none';
  const pending = observe(f.api.sendAlertToWatch(alertPayload));
  await f.clock.advance(1500);
  assert.deepEqual(result(pending), noDelivery);
  assert.equal(f.contexts.length, 1);
  assert.equal(f.clock.timers.size, 0);
});

test('saved context for an installed paired but unreachable companion is accepted without acknowledgment', async () => {
  const f = watchFixture();
  f.liveReply = 'none';
  f.answers.getIsPaired = () => Promise.resolve(true);
  f.answers.getIsWatchAppInstalled = () => Promise.resolve(true);
  const pending = observe(f.api.sendAlertToWatch(alertPayload));
  await f.clock.advance(1500);
  assert.deepEqual(result(pending), { accepted: true, reachable: false, acknowledged: false, roundTripMs: null });
  assert.equal(f.clock.timers.size, 0);
});

test('reachable status establishes pairing and installation despite false activation flags', async () => {
  const f = watchFixture();
  f.answers.getReachability = () => Promise.resolve(true);
  const pending = observe(f.api.getWatchStatus());
  await f.clock.advance(500);
  assert.deepEqual(result(pending), connectedStatus);
  assert.equal(f.clock.timers.size, 0);
});

test('optional missing native status methods remain conservative', async () => {
  const f = watchFixture();
  statusMethods.forEach(name => { delete f.native[name]; });
  const pending = observe(f.api.getWatchStatus());
  await f.clock.advance(500);
  assert.deepEqual(result(pending), unknownStatus);
  assert.equal(f.clock.timers.size, 0);
});

test('cached status stays fresh for five seconds after a delayed native check completes', async () => {
  const f = watchFixture(), delayed = deferred();
  f.answers.getIsPaired = () => delayed.promise;
  f.answers.getIsWatchAppInstalled = () => Promise.resolve(true);
  f.answers.getReachability = () => Promise.resolve(true);
  const pending = observe(f.api.getWatchStatus());
  await f.clock.advance(1900);
  delayed.resolve(true);
  await flush();
  assert.deepEqual(result(pending), connectedStatus);
  statusMethods.forEach(name => { f.answers[name] = () => Promise.resolve(false); });
  await f.clock.advance(4000);
  assert.deepEqual(plain(await f.api.getWatchStatus(5000)), connectedStatus);
  assert.equal(f.queries.length, 3, 'the cache age starts at query completion');
  await f.clock.advance(1000);
  assert.deepEqual(plain(await f.api.getWatchStatus(5000)), unknownStatus);
  assert.equal(f.queries.length, 6, 'a five-second-old result requires a new native check');
  assert.equal(f.clock.timers.size, 0);
});

test('clock rollback invalidates future cached status and keeps activation settle within 500 ms', async () => {
  const f = watchFixture();
  statusMethods.forEach(name => { f.answers[name] = () => Promise.resolve(true); });
  const initial = observe(f.api.getWatchStatus());
  await f.clock.advance(500);
  assert.deepEqual(result(initial), connectedStatus);
  f.clock.rewind(1000);
  statusMethods.forEach(name => { f.answers[name] = () => Promise.resolve(false); });
  const pending = observe(f.api.getWatchStatus(5000));
  await f.clock.advance(499);
  assert.equal(pending.settled, false, 'the cache from the future cannot be reused');
  assert.equal(f.queries.length, 3);
  await f.clock.advance(1);
  assert.deepEqual(result(pending), unknownStatus);
  assert.equal(f.queries.length, 6, 'clock rollback must not extend activation settling');
  assert.equal(f.clock.timers.size, 0);
});

for (const options of [{ platform: 'android' }, { platform: 'web' }, { missingModule: true }]) {
  test(`Watch operations safely no-op with ${JSON.stringify(options)}`, async () => {
    const f = watchFixture(options);
    assert.deepEqual(plain(await f.api.getWatchStatus()), { ...unknownStatus, moduleAvailable: false });
    assert.equal(await f.api.isWatchAvailable(), false);
    assert.deepEqual(plain(await f.api.sendAlertToWatch(alertPayload)), noDelivery);
    assert.deepEqual(plain(await f.api.sendMonitoringStatusToWatch(monitoringPayload)), noDelivery);
    assert.equal(f.moduleLoads, options.missingModule ? 1 : 0);
    assert.equal(f.contexts.length, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.queries.length, 0);
    assert.equal(f.clock.timers.size, 0);
  });
}
