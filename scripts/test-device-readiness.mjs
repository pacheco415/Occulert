import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDeviceReadiness,
  describeDeviceReadiness,
  isReadinessStale,
  READINESS_MAX_AGE_MS,
} from '../native-app/lib/deviceReadiness.ts';
import { createReadinessSession } from '../native-app/lib/deviceReadinessSession.ts';

const now = 100_000;
const baseline = () => ({
  checkedAt: now,
  camera: {
    permission: 'granted',
    frontAvailable: true,
    backAvailable: true,
    backPhysicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera'],
    multiCamSupported: true,
    frontBackMultiCamSupported: true,
    multiCamProbe: {
      state: 'withinBudget', hardwareCost: 0.7, systemPressureCost: 0.6,
      frontDeviceType: 'front', backDeviceType: 'back',
    },
  },
  outputs: { audio: true, haptic: true, watch: false },
  watch: { moduleAvailable: false, paired: false, appInstalled: false, reachable: false },
  motion: { state: 'not-built', authorization: 'unavailable', isAvailable: false, isActive: false },
});
const row = (snapshot, id, at = now) => describeDeviceReadiness(snapshot, at).find(item => item.id === id);

test('phone-only setup does not report missing optional devices as a required failure', () => {
  const snapshot = baseline();
  assert.ok(describeDeviceReadiness(snapshot, now).every(item => !item.attention));
  assert.equal(row(snapshot, 'watch').status, 'Alerts off');
  assert.equal(row(snapshot, 'motion').status, 'Unavailable');
});

test('camera access is not evidence of face tracking, and missing access gets actionable guidance', () => {
  const snapshot = baseline();
  assert.equal(row(snapshot, 'camera').status, 'Access granted');
  assert.match(row(snapshot, 'camera').detail, /framing and eye visibility/);
  for (const permission of ['denied', 'restricted', 'not-determined']) {
    snapshot.camera.permission = permission;
    assert.equal(row(snapshot, 'camera').attention, true);
    assert.equal(row(snapshot, 'camera').status, 'Access needed');
  }
  snapshot.camera.frontAvailable = false;
  assert.equal(row(snapshot, 'camera').status, 'Not found');
  snapshot.camera = null;
  assert.equal(row(snapshot, 'camera').status, 'Not confirmed');
});

test('road-camera readiness reports hardware facts without activating or promising detection', () => {
  const snapshot = baseline();
  assert.equal(row(snapshot, 'roadCamera').status, 'Load check passed');
  assert.match(row(snapshot, 'roadCamera').detail, /not activated/);
  snapshot.camera.multiCamProbe.state = 'overBudget';
  assert.equal(row(snapshot, 'roadCamera').status, 'Over budget');
  assert.equal(row(snapshot, 'roadCamera').attention, true);
  snapshot.camera.multiCamProbe.state = 'configurationFailed';
  assert.equal(row(snapshot, 'roadCamera').status, 'Load check failed');
  snapshot.camera.multiCamProbe.state = 'notAvailable';
  assert.equal(row(snapshot, 'roadCamera').status, 'Hardware capable');
  snapshot.camera.multiCamSupported = false;
  snapshot.camera.frontBackMultiCamSupported = false;
  assert.equal(row(snapshot, 'roadCamera').status, 'Single camera only');
  assert.match(row(snapshot, 'roadCamera').detail, /Driver monitoring keeps priority/);
  snapshot.camera.multiCamSupported = null;
  snapshot.camera.frontBackMultiCamSupported = null;
  assert.equal(row(snapshot, 'roadCamera').status, 'Support unknown');
  snapshot.camera.backAvailable = false;
  assert.equal(row(snapshot, 'roadCamera').status, 'Unavailable');
  snapshot.camera = null;
  assert.equal(row(snapshot, 'roadCamera').status, 'Not confirmed');
});

test('all phone-output combinations reflect preferences without claiming successful delivery', () => {
  const snapshot = baseline();
  for (const [audio, haptic, status] of [
    [false, false, 'Both off'], [true, false, 'Sound only'],
    [false, true, 'Vibration only'], [true, true, 'Sound + vibration'],
  ]) {
    snapshot.outputs = { audio, haptic, watch: true };
    const result = row(snapshot, 'outputs');
    assert.equal(result.status, status);
    assert.equal(result.attention, !audio && !haptic);
  }
  snapshot.outputs = null;
  assert.equal(row(snapshot, 'outputs').status, 'Not confirmed');
  assert.equal(row(snapshot, 'watch').status, 'Not confirmed');
});

test('Watch preference, pairing, installation, and reachability are separate requirements', () => {
  const snapshot = baseline();
  snapshot.outputs.watch = true;
  assert.equal(row(snapshot, 'watch').status, 'Not confirmed');
  snapshot.watch = { moduleAvailable: true, paired: true, appInstalled: false, reachable: false };
  assert.equal(row(snapshot, 'watch').status, 'Open Watch app');
  assert.match(row(snapshot, 'watch').detail, /then refresh/);
  snapshot.watch.appInstalled = true;
  snapshot.watch.reachable = false;
  assert.equal(row(snapshot, 'watch').status, 'Not reachable');
  snapshot.watch.reachable = true;
  assert.equal(row(snapshot, 'watch').status, 'Reachable');
  assert.match(row(snapshot, 'watch').detail, /does not confirm/);
});

test('headphone permission and availability do not imply validated fatigue detection', () => {
  const snapshot = baseline();
  snapshot.motion = { state: 'stopped', authorization: 'notDetermined', isAvailable: true, isActive: false };
  assert.equal(row(snapshot, 'motion').status, 'Permission pending');
  snapshot.motion.authorization = 'authorized';
  assert.equal(row(snapshot, 'motion').status, 'Available');
  assert.match(row(snapshot, 'motion').detail, /do not change fatigue scores or alerts/);
  snapshot.motion.authorization = 'restricted';
  assert.equal(row(snapshot, 'motion').status, 'Access off');
  snapshot.motion.state = 'error';
  assert.equal(row(snapshot, 'motion').status, 'Not confirmed');
});

test('expired, future, and invalid timestamps cannot keep affirmative device statuses', () => {
  const snapshot = baseline();
  assert.equal(isReadinessStale(snapshot, now + READINESS_MAX_AGE_MS - 1), false);
  for (const at of [now + READINESS_MAX_AGE_MS, now - 1, NaN]) {
    assert.equal(isReadinessStale(snapshot, at), true);
    assert.ok(describeDeviceReadiness(snapshot, at).every(item => item.status === 'Check again'));
  }
});

test('independent checks start together and one rejection preserves successful readings', async () => {
  const expected = baseline();
  const called = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const result = collectDeviceReadiness({
    camera: async () => { called.push('camera'); await gate; return expected.camera; },
    outputs: async () => { called.push('outputs'); await gate; return expected.outputs; },
    watch: async () => { called.push('watch'); throw new Error('bridge unavailable'); },
    motion: async () => { called.push('motion'); await gate; return expected.motion; },
  }, () => now);
  await Promise.resolve();
  assert.deepEqual(called.sort(), ['camera', 'motion', 'outputs', 'watch']);
  release();
  assert.deepEqual(await result, { ...expected, watch: null });
});

test('a stalled bridge times out without discarding other readings or accepting late changes', async () => {
  const expected = baseline();
  let release;
  const result = await collectDeviceReadiness({
    camera: async () => expected.camera,
    outputs: async () => expected.outputs,
    watch: () => new Promise(resolve => { release = resolve; }),
    motion: () => { throw new Error('synchronous native failure'); },
  }, () => now, 10);
  assert.deepEqual(result, { ...expected, watch: null, motion: null });
  release({ moduleAvailable: true, paired: true, appInstalled: true, reachable: true });
  await Promise.resolve();
  assert.equal(result.watch, null);
});

test('repeated refresh taps share one read; backgrounding discards it and permits a new check', async () => {
  const pending = [];
  const published = [];
  const session = createReadinessSession(() => new Promise(resolve => pending.push(resolve)), state => published.push(state), () => now);
  try {
    const first = session.refresh();
    await session.refresh();
    assert.equal(pending.length, 1);
    session.invalidate();
    const second = session.refresh();
    assert.equal(pending.length, 2);
    pending[0](baseline());
    await first;
    assert.equal(published.at(-1).busy, true, 'obsolete check cannot clear the newer busy state');
    const updated = { ...baseline(), outputs: { audio: false, haptic: false, watch: false } };
    pending[1](updated);
    await second;
    assert.equal(published.at(-1).snapshot, updated);
  } finally { session.dispose(); }
});

test('leaving the screen prevents pending completions from publishing', async () => {
  let finish;
  const published = [];
  const session = createReadinessSession(() => new Promise(resolve => { finish = resolve; }), state => published.push(state));
  const check = session.refresh();
  session.dispose();
  finish(baseline());
  await check;
  assert.equal(published.length, 1);
  assert.equal(published[0].busy, true);
});

test('expiry changes visible freshness and disposal cancels the timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  const published = [];
  const session = createReadinessSession(async () => baseline(), state => published.push(state));
  try {
    await session.refresh();
    assert.equal(isReadinessStale(published.at(-1).snapshot, published.at(-1).now), false);
    t.mock.timers.tick(READINESS_MAX_AGE_MS);
    assert.equal(isReadinessStale(published.at(-1).snapshot, published.at(-1).now), true);
    await session.refresh();
    session.dispose();
    const count = published.length;
    t.mock.timers.tick(READINESS_MAX_AGE_MS);
    assert.equal(published.length, count);
  } finally { session.dispose(); }
});

test('an unexpected read error clears busy state and allows retry', async () => {
  const published = [];
  let attempts = 0;
  const session = createReadinessSession(async () => {
    if (++attempts === 1) throw new Error('read failed');
    return baseline();
  }, state => published.push(state), () => now);
  try {
    await session.refresh();
    assert.equal(published.at(-1).busy, false);
    assert.equal(published.at(-1).snapshot, null);
    await session.refresh();
    assert.deepEqual(published.at(-1).snapshot, baseline());
  } finally { session.dispose(); }
});
