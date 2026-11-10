import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import {
  createMotionActivityObservation, classifyMotionActivitySample,
  MOTION_ACTIVITY_EVIDENCE_TTL_MS, MOTION_ACTIVITY_BRIDGE_MAX_AGE_MS,
} from '../native-app/lib/motionActivityObservation.ts';
import { createUnansweredAlertObservation } from '../native-app/lib/unansweredAlertObservation.ts';

const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const status = (owner, changes = {}) => ({ owner, state: 'active', authorization: 'authorized', isAvailable: true, isActive: true, ...changes });
const reportedFlags = { automotive: true, stationary: false, walking: false, running: false, cycling: false, unknown: false };

function fixture({ enabled = true, start } = {}) {
  const f = { now: 100_000, wall: 1_000_000, clockReads: 0, calls: [], activities: [], statuses: [] };
  f.start = start ?? (owner => Promise.resolve(status(owner)));
  const subscribe = (kind, listener) => {
    const entry = { listener, removed: false }; f[kind].push(entry); f.calls.push({ kind: 'listen', event: kind });
    return { remove() { entry.removed = true; f.calls.push({ kind: 'remove', event: kind }); } };
  };
  const bridge = {
    start(owner) { f.calls.push({ kind: 'start', owner }); return f.start(owner); },
    stop(owner) { f.calls.push({ kind: 'stop', owner }); return Promise.resolve(); },
    addActivityListener: listener => subscribe('activities', listener),
    addStatusListener: listener => subscribe('statuses', listener),
  };
  const clocks = { now: () => { f.clockReads++; return f.now; }, wallNow: () => { f.clockReads++; return f.wall; } };
  const observation = createMotionActivityObservation(enabled, bridge, clocks);
  return Object.assign(f, { observation, bridge, clocks,
    owner() { return f.calls.findLast(call => call.kind === 'start')?.owner; },
    begin() { observation.begin(); return this.owner(); },
    advance(amount) { f.now += amount; f.wall += amount; },
    sample(changes = {}, owner = this.owner()) {
      const value = { owner, authorization: 'authorized', confidence: 'high', activityStartedAt: f.wall,
        sourceUptimeMs: f.now, receivedUptimeMs: f.now, receivedAt: f.wall, ...reportedFlags, ...changes };
      for (const entry of f.activities) if (!entry.removed) entry.listener(value);
      return value;
    },
    emitStatus(changes = {}, owner = this.owner()) {
      for (const entry of f.statuses) if (!entry.removed) entry.listener(status(owner, changes));
    },
  });
}

function wrapperFixture(native = null, flag) {
  const source = readFileSync(new URL('../native-app/lib/motionActivity.ts', import.meta.url), 'utf8');
  const body = stripTypeScriptTypes(source.replace(/^import[\s\S]*?;\s*/gm, '')).replace(/^export /gm, '');
  const calls = [], exports = {};
  vm.runInNewContext(body + '\nObject.assign(exports,{createMotionActivityBridge,MOTION_ACTIVITY_OBSERVATION_ENABLED});', {
    exports, process: { env: { EXPO_PUBLIC_MOTION_ACTIVITY_OBSERVATION: flag } },
    requireOptionalNativeModule(name) { calls.push(name); return native; },
  }, { timeout: 1_000 });
  return { ...exports, calls };
}

test('the motion wrapper flag accepts only literal 1 and native lookup remains lazy', () => {
  for (const flag of [undefined, '', '0', 'true', 'false', '1']) {
    const f = wrapperFixture(null, flag);
    assert.equal(f.MOTION_ACTIVITY_OBSERVATION_ENABLED, flag === '1');
    assert.deepEqual(f.calls, [], 'importing the wrapper does not inspect or start native motion');
    f.createMotionActivityBridge(); assert.deepEqual(f.calls, ['OcculertMotionActivity']);
  }
});

test('the optional native wrapper preserves ownership, handles absence and never leaks native exception text', async () => {
  const missing = wrapperFixture().createMotionActivityBridge();
  const notBuilt = await missing.start('missing-owner');
  assert.equal(notBuilt.owner, 'missing-owner'); assert.equal(notBuilt.state, 'not-built');
  assert.equal(notBuilt.isAvailable, false); assert.equal(notBuilt.isActive, false);
  missing.addActivityListener(() => assert.fail('no native source')).remove();
  missing.addStatusListener(() => assert.fail('no native source')).remove(); await missing.stop('missing-owner');
  const calls = [], native = {
    async start(owner) { calls.push(['start', owner]); throw Error('private-native-details'); },
    async stop(owner) { calls.push(['stop', owner]); throw Error('private-native-details'); },
    addListener(event, listener) { calls.push(['listen', event]); return { remove() { calls.push(['remove', event]); } }; },
  };
  const bridge = wrapperFixture(native).createMotionActivityBridge();
  const failed = await bridge.start('owner');
  assert.equal(failed.state, 'error'); assert.equal(failed.owner, 'owner');
  assert.doesNotMatch(JSON.stringify(failed), /private-native-details/);
  const activity = bridge.addActivityListener(() => {}), state = bridge.addStatusListener(() => {});
  activity.remove(); state.remove(); await bridge.stop('owner');
  assert.deepEqual(calls, [['start','owner'],['listen','onActivity'],['listen','onStatusChange'],['remove','onActivity'],['remove','onStatusChange'],['stop','owner']]);
});

test('disabled collection makes no bridge or clock calls and enabled construction waits for explicit begin', () => {
  const off = fixture({ enabled: false }); off.observation.begin(); off.observation.stop();
  assert.equal(off.observation.category(), 'unknown'); assert.deepEqual(off.calls, []); assert.equal(off.clockReads, 0);
  const on = fixture(); assert.deepEqual(on.calls, []); assert.equal(on.clockReads, 0);
  on.begin(); assert.deepEqual(on.calls.slice(0, 3).map(call => call.kind), ['listen','listen','start']);
  on.observation.stop();
});

test('only high-confidence authorized unambiguous flags receive descriptive automotive or stationary labels', () => {
  const sample = { authorization: 'authorized', confidence: 'high', ...reportedFlags };
  assert.equal(classifyMotionActivitySample(sample), 'reported-activity');
  assert.equal(classifyMotionActivitySample({ ...sample, automotive: false, stationary: true }), 'not-moving');
  for (const changes of [
    { stationary: true }, { automotive: false }, { unknown: true }, { walking: true }, { running: true }, { cycling: true },
    { automotive: false, walking: true }, { confidence: 'low' }, { confidence: 'medium' }, { confidence: 'unknown' },
    { confidence: 'invalid' }, { authorization: 'notDetermined' }, { automotive: 1 }, { stationary: undefined },
  ]) assert.equal(classifyMotionActivitySample({ ...sample, ...changes }), 'unknown', JSON.stringify(changes));
  for (const authorization of ['denied', 'restricted']) assert.equal(classifyMotionActivitySample({ ...sample, authorization }), 'denied');
  for (const value of [null, [], {}, 'automotive']) assert.equal(classifyMotionActivitySample(value), 'unknown');
});

test('evidence expires at the bounded change/source age plus real receipt latency without status or read renewal', async () => {
  assert.equal(MOTION_ACTIVITY_EVIDENCE_TTL_MS, 10_000); assert.equal(MOTION_ACTIVITY_BRIDGE_MAX_AGE_MS, 1_000);
  const f = fixture(); f.begin(); await settle();
  f.sample({ activityStartedAt: f.wall - 9_000, sourceUptimeMs: f.now - 9_000, receivedAt: f.wall - 1_000 });
  // Both independent age estimates are 8/9 seconds at receipt, plus one second in the bridge.
  assert.equal(f.observation.category(), 'reported-activity');
  f.advance(1_000); f.emitStatus(); assert.equal(f.observation.category(), 'stale');
  const fresh = fixture(); fresh.begin(); await settle(); fresh.sample();
  for (let index = 0; index < 10; index++) { fresh.advance(1_000); fresh.emitStatus(); assert.equal(fresh.observation.category(), 'reported-activity'); }
  fresh.advance(1); assert.equal(fresh.observation.category(), 'stale');
  assert.equal(fresh.observation.category(), 'stale'); f.observation.stop(); fresh.observation.stop();
});

test('source, activity-change and bridge freshness each reject stale data and all future or invalid times fail closed', () => {
  const cases = [
    [f => ({ sourceUptimeMs: f.now - 10_001 }), 'stale'],
    [f => ({ activityStartedAt: f.wall - 10_001 }), 'stale'],
    [f => ({ receivedAt: f.wall - 1_001, activityStartedAt: f.wall - 1_001 }), 'stale'],
    [f => ({ receivedAt: f.wall + 1 }), 'unknown'],
    [f => ({ activityStartedAt: f.wall + 1 }), 'unknown'],
    [f => ({ sourceUptimeMs: f.now + 1 }), 'unknown'],
    [() => ({ receivedAt: NaN }), 'unknown'], [() => ({ sourceUptimeMs: Infinity }), 'unknown'],
    [() => ({ receivedUptimeMs: -1 }), 'unknown'], [() => ({ activityStartedAt: -1 }), 'unknown'],
  ];
  for (const [changes, expected] of cases) {
    const f = fixture(); f.begin(); f.sample(changes(f)); assert.equal(f.observation.category(), expected); f.observation.stop();
  }
  const boundary = fixture(); boundary.begin();
  boundary.sample({ receivedAt: boundary.wall - 1_000, activityStartedAt: boundary.wall - 1_000 });
  assert.equal(boundary.observation.category(), 'reported-activity'); boundary.observation.stop();
});

test('replayed and backward source reports cannot renew or preserve positive evidence', () => {
  for (const backward of [false, true]) {
    const f = fixture(); f.begin(); const first = f.sample(); assert.equal(f.observation.category(), 'reported-activity');
    f.advance(100); f.sample({ sourceUptimeMs: first.sourceUptimeMs - (backward ? 1 : 0) });
    assert.equal(f.observation.category(), 'unknown');
    f.advance(10_001); assert.notEqual(f.observation.category(), 'reported-activity'); f.observation.stop();
  }
});

test('denial, restriction, missing native support and error stay distinct and late events cannot revive revoked ownership', async () => {
  for (const [changes, expected] of [
    [{ state: 'denied', authorization: 'denied' }, 'denied'], [{ authorization: 'restricted' }, 'denied'],
    [{ state: 'unavailable', isAvailable: false }, 'unavailable'], [{ state: 'not-built', isAvailable: false }, 'unavailable'],
    [{ state: 'error' }, 'unknown'], [{ state: 'stopped', isActive: false }, 'unknown'],
  ]) {
    const f = fixture({ start: owner => Promise.resolve(status(owner, changes)) }); const owner = f.begin();
    const activity = f.activities[0]; await settle(); assert.equal(f.observation.category(), expected);
    assert.ok(f.calls.some(call => call.kind === 'stop' && call.owner === owner));
    activity.listener({ owner, authorization: 'authorized', confidence: 'high', activityStartedAt: f.wall,
      sourceUptimeMs: f.now, receivedUptimeMs: f.now, receivedAt: f.wall, ...reportedFlags });
    assert.equal(f.observation.category(), expected); assert.ok(f.activities.every(entry => entry.removed));
  }
});

test('a stalled or rejected native start does not block begin or teardown', async () => {
  const pending = deferred(); const f = fixture({ start: () => pending.promise });
  assert.equal(f.observation.begin(), undefined); const owner = f.owner();
  assert.equal(f.observation.category(), 'unknown'); f.observation.stop();
  assert.ok(f.calls.some(call => call.kind === 'stop' && call.owner === owner));
  pending.reject(Error('permission transport failed')); await settle(); assert.equal(f.observation.category(), 'unknown');
});

test('a newer session ignores old startup completion and removed listener callbacks without stopping its owner', async () => {
  const pending = deferred(); const f = fixture({ start: () => pending.promise }); const oldOwner = f.begin(), old = f.activities[0];
  f.observation.stop(); f.start = owner => Promise.resolve(status(owner)); const newOwner = f.begin(); assert.notEqual(newOwner, oldOwner);
  await settle(); f.sample(); assert.equal(f.observation.category(), 'reported-activity');
  pending.resolve(status(oldOwner)); await settle();
  old.listener({ owner: oldOwner, authorization: 'denied' }); f.emitStatus({ authorization: 'denied' }, oldOwner);
  assert.equal(f.observation.category(), 'reported-activity');
  assert.equal(f.calls.filter(call => call.kind === 'stop' && call.owner === newOwner).length, 0); f.observation.stop();
});

test('a stale-owner event cannot suppress the current pending permission result', async () => {
  const pending = deferred(); const f = fixture({ start: () => pending.promise }); const owner = f.begin();
  f.sample({}, 'older-owner'); pending.resolve(status(owner, { state: 'denied', authorization: 'denied' })); await settle();
  assert.equal(f.observation.category(), 'denied');
});

test('a valid activity event outranks an older pending starting result, and source clock resets are session scoped', async () => {
  const pending = deferred(); const f = fixture({ start: () => pending.promise }); const owner = f.begin(); f.sample();
  pending.resolve(status(owner, { state: 'starting', isActive: false })); await settle();
  assert.equal(f.observation.category(), 'reported-activity');
  f.observation.stop(); f.start = next => Promise.resolve(status(next)); f.begin();
  f.sample({ sourceUptimeMs: 1, receivedUptimeMs: 1 }); assert.equal(f.observation.category(), 'reported-activity'); f.observation.stop();
});

test('invalid or discontinuous receiver clocks invalidate ownership rather than fast-forward evidence', () => {
  for (const change of [f => { f.now--; }, f => { f.wall--; }, f => { f.wall += 1_001; }, f => { f.now = NaN; }]) {
    const f = fixture(); const owner = f.begin(); f.sample(); change(f);
    assert.equal(f.observation.category(), 'unknown'); assert.ok(f.calls.some(call => call.kind === 'stop' && call.owner === owner));
  }
});

test('motion changes only the final aggregate label, preserving six-second observation timing and local snapshot privacy', async () => {
  for (const category of ['unknown','unavailable','denied','stale','not-moving','reported-activity']) {
    const f = fixture(); f.begin(); await settle();
    if (category === 'unavailable') f.emitStatus({ state: 'not-built', isAvailable: false });
    else if (category === 'denied') f.emitStatus({ authorization: 'denied' });
    else if (category === 'stale') f.sample({ activityStartedAt: f.wall - 10_001 });
    else if (category === 'not-moving') f.sample({ automotive: false, stationary: true });
    else if (category === 'reported-activity') f.sample({ rawTimeline: ['never-persist'] });
    const observer = createUnansweredAlertObservation(true, f.clocks, () => f.observation.category());
    const generation = observer.begin();
    const sample = () => observer.sample({ generation, sampledAt: f.wall, sourceAt: f.now + 50_000, state: 'closed' });
    sample(); observer.criticalOutput(generation, { level: 'critical', decisionId: 1, decisionAt: f.wall, acceptedAt: f.wall, channel: 'phone-haptic' });
    for (let index = 0; index < 11; index++) { f.advance(500); sample(); }
    assert.equal(observer.snapshot().candidates, 0, category);
    f.advance(500); sample(); const snapshot = observer.snapshot();
    assert.equal(snapshot.candidates, 1, category); assert.equal(snapshot.byMotion[category], 1);
    assert.equal(Object.values(snapshot.byMotion).reduce((sum, count) => sum + count, 0), 1);
    assert.deepEqual(Object.keys(snapshot).sort(), ['byMotion','candidates','evidence','mode','version']);
    assert.doesNotMatch(JSON.stringify(snapshot), /activityStartedAt|receivedAt|Uptime|owner|rawTimeline|never-persist/);
    observer.stop(); f.observation.stop();
  }
});
