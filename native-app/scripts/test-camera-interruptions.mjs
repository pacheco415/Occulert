import { readNativeMonitorSourceOwners } from './lib/monitor-source-owners.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createCaptureWatchdogFixture } from './lib/capture-camera-test-harness.mjs';
import {
  createCameraInterruptionObservation, normalizeCameraInterruption,
  readCameraInterruption, unknownCameraInterruption, MULTITASKING_CAMERA_MESSAGE,
} from '../lib/cameraInterruptions.ts';
import {
  applyCameraMultitaskingPatch, patchCameraMultitasking, originalCameraSession,
  readExperimentFlag, experimentFlag, experimentHelper, sourceRelativePath,
} from './patch-camera-multitasking.mjs';

const raw = (sequence = 1, rawReason = 4, interrupted = true) => ({
  state: 'available', deviceId: 'front', deviceIds: ['front'], interrupted, rawReason,
  reason: 'untrusted-label', sequence,
});
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const interruption = (sequence = 1, reason = 4, interrupted = true) => normalizeCameraInterruption(raw(sequence, reason, interrupted), 'front');

test('named multitasking event stops and cues once without restart budget; end does not resume', async () => {
  const f = createCaptureWatchdogFixture();
  f.interrupt(interruption()); f.interrupt(interruption(2));
  f.interrupt(interruption(3, null, false));
  await f.error();
  assert.equal(f.events.stops, 1); assert.equal(f.events.cues, 1);
  assert.equal(f.events.stopOptions[0].deferCloudFinalization, true);
  assert.equal(f.state.cameraRestartCountRef.current, 0);
  assert.equal(f.state.lastSampleAtRef.current, 1000);
  assert.deepEqual(f.events.epochs, []);
  assert.deepEqual(f.events.faults, [MULTITASKING_CAMERA_MESSAGE]);
  assert.equal(f.state.multitaskingCameraPausedRef.current, true);
  assert.equal(f.state.isRunningRef.current, false);
  f.cleanup();
});

test('watchdog queries the named native interruption before capture grace or restart reservation', async () => {
  let reads = 0;
  const f = createCaptureWatchdogFixture({ readInterruption: async () => { reads++; return interruption(); } });
  f.configure({ key: '30', configuration: { width: 1280, height: 720, fps: 30 } });
  f.setNow(1001); f.configure({ key: '15', configuration: { width: 1280, height: 720, fps: 15 } });
  assert.equal(f.state.captureTransitionRef.current.shouldDefer(6001, 1000), true);
  await f.tick(6001);
  assert.equal(reads, 1); assert.equal(f.events.stops, 1);
  assert.equal(f.state.cameraRestartCountRef.current, 0);
  assert.equal(f.tracker.snapshot().cameraStalls, 0);
  assert.equal(f.events.faults[0], MULTITASKING_CAMERA_MESSAGE);
  f.cleanup();
});

test('generic errors see the queued native reason first, including nonrecoverable error codes', async () => {
  for (const code of ['unknown/unknown', 'permission/camera-permission-denied']) {
    const f = createCaptureWatchdogFixture({ readInterruption: async () => interruption() });
    await f.error(code);
    assert.equal(f.events.faults[0], MULTITASKING_CAMERA_MESSAGE);
    assert.equal(f.events.stops, 1); assert.equal(f.state.cameraRestartCountRef.current, 0);
    f.cleanup();
  }
});

test('an event overtaking a recovery read stays latched after an unavailable reply', async () => {
  const pending = deferred();
  const f = createCaptureWatchdogFixture({ readInterruption: () => pending.promise });
  const recovery = f.error();
  f.interrupt(interruption());
  pending.resolve(unknownCameraInterruption('front'));
  await recovery;
  assert.equal(f.events.stops, 1); assert.equal(f.events.cues, 1);
  assert.deepEqual(f.events.faults, [MULTITASKING_CAMERA_MESSAGE]);
  assert.equal(f.state.cameraRestartCountRef.current, 0);
  f.cleanup();
});

test('concurrent error/watchdog reads reserve one restart and stale epochs cannot stop the recovery', async () => {
  const f = createCaptureWatchdogFixture({ readInterruption: async () => interruption(1, null, false) });
  await Promise.all([f.error(), f.tick(6001)]);
  assert.equal(f.state.cameraRestartCountRef.current, 1);
  assert.equal(f.events.stops, 0);
  assert.deepEqual(f.events.epochs, [1]);
  await f.error('unknown/unknown', 0);
  assert.equal(f.events.stops, 0);
  await f.error();
  assert.equal(f.events.stops, 1); assert.equal(f.state.cameraRestartCountRef.current, 1);
  f.cleanup();
});

test('a fresh sample or a replacement session invalidates pending watchdog/error work', async () => {
  const pending = deferred(), f = createCaptureWatchdogFixture({ readInterruption: () => pending.promise });
  const watchdog = f.tick(6001); f.sample(6500); pending.resolve(interruption(1, null, false)); await watchdog;
  assert.equal(f.state.cameraRestartCountRef.current, 0); assert.equal(f.events.stops, 0); f.cleanup();
  const old = deferred(), next = createCaptureWatchdogFixture({ readInterruption: () => old.promise });
  const error = next.error(); next.state.cameraInterruptionGenerationRef.current++;
  old.resolve(interruption()); await error;
  assert.equal(next.state.cameraRestartCountRef.current, 0); assert.equal(next.events.stops, 0); next.cleanup();
  const priorDevice = deferred(), changed = createCaptureWatchdogFixture({ readInterruption: () => priorDevice.promise });
  const priorError = changed.error(); changed.state.cameraDeviceIdRef.current = 'new-front';
  priorDevice.resolve(interruption()); await priorError;
  assert.equal(changed.state.cameraRestartCountRef.current, 0); assert.equal(changed.events.stops, 0); changed.cleanup();
  const owner = createCaptureWatchdogFixture(); owner.state.cameraCallbackOwnerRef.current++;
  await owner.error('unknown/unknown', 0, 0);
  assert.equal(owner.state.cameraRestartCountRef.current, 0); assert.equal(owner.events.stops, 0); owner.cleanup();
  const disposed = createCaptureWatchdogFixture(); disposed.cleanup();
  await disposed.error('unknown/unknown', 0, 0);
  assert.equal(disposed.state.cameraRestartCountRef.current, 0); assert.equal(disposed.events.stops, 0);
  const during = deferred(), pendingDispose = createCaptureWatchdogFixture({ readInterruption: () => during.promise });
  const pendingError = pendingDispose.error(); pendingDispose.cleanup(); during.resolve(interruption()); await pendingError;
  assert.equal(pendingDispose.state.cameraRestartCountRef.current, 0); assert.equal(pendingDispose.events.stops, 0);
  const replay = createCaptureWatchdogFixture(); replay.replayLifetime();
  await replay.error('unknown/unknown', 0, 0);
  assert.equal(replay.state.cameraRestartCountRef.current, 1, 'Strict Mode effect replay preserves the current rendered Camera callback');
  replay.cleanup();
});

test('actual screen interruption subscription rejects disposed callbacks and invalidates pending reads', () => {
  const monitor = readNativeMonitorSourceOwners().camera;
  const start = monitor.indexOf('  useEffect(() => {\n    if (!cameraIdentityActive', monitor.indexOf('  const handleCameraInterruption'));
  const end = monitor.indexOf('\n  const checkCameraInterruption', start);
  assert.ok(start >= 0 && end > start);
  let cleanup, receive, calls = 0, removes = 0;
  const generation = { current: 0 };
  vm.runInNewContext(monitor.slice(start, end), {
    cameraIdentityActive: true, cameraEpoch: 0, device: { id: 'front' }, cameraInterruptionGenerationRef: generation,
    cameraDeviceIdRef: { current: 'front' }, cameraEpochRef: { current: 0 },
    cameraCallbackOwner: 0, cameraCallbackOwnerRef: { current: 0 },
    useEffect: effect => { cleanup = effect(); }, handleCameraInterruption: () => calls++,
    observeCameraInterruptions: (_id, listener) => { receive = listener; return { ready: Promise.resolve(null), remove() { removes++; } }; },
  });
  receive(interruption()); cleanup(); receive(interruption(2));
  assert.equal(calls, 1); assert.equal(removes, 1); assert.equal(generation.current, 1);
});

test('Apple interruption reasons retain unknown and require the matching camera', () => {
  for (const [reason, label] of [[1, 'background'], [2, 'audioInUse'], [3, 'videoInUse'], [4, 'multitasking'], [5, 'systemPressure'], [99, 'unknown']]) {
    assert.equal(normalizeCameraInterruption(raw(1, reason), 'front').reason, label);
  }
  assert.equal(normalizeCameraInterruption(raw(2, 4, false), 'front').reason, 'none');
  for (const value of [null, {}, raw(-1), raw(1.5), { ...raw(), deviceId: 'back' }, { ...raw(), interrupted: null }]) {
    assert.deepEqual(normalizeCameraInterruption(value, 'front'), unknownCameraInterruption('front'));
  }
  assert.equal(normalizeCameraInterruption({ ...raw(), deviceIds: ['back'] }, 'front', true).state, 'notAvailable');
  assert.equal(MULTITASKING_CAMERA_MESSAGE, 'Camera paused because another app is sharing the screen. Make Occulert full screen, then restart when parked.');
});

test('listener precedes snapshot; delayed initial read and old events cannot undo a named interruption', async () => {
  const initial = deferred(), updates = [], order = [];
  let emit;
  const native = {
    addListener(name, listener) { assert.equal(name, 'cameraInterrupted'); order.push('listen'); emit = listener; return { remove() {} }; },
    getCameraInterruptionState(id) { assert.equal(id, 'front'); order.push('query'); return initial.promise; },
  };
  const observation = createCameraInterruptionObservation(native, 'front', state => updates.push(state));
  emit(raw(3)); emit(raw(2, 4, false)); emit({ ...raw(4), deviceIds: ['back'] });
  initial.resolve(raw(1, 4, false));
  assert.equal((await observation.ready).reason, 'multitasking');
  assert.deepEqual(order, ['listen', 'query']);
  assert.equal(updates.length, 1);
  emit(raw(4, null, false));
  assert.equal(updates.at(-1).reason, 'none');
  observation.remove();
});

test('removed subscription ignores queued callbacks and late reads without removing its successor', async () => {
  const initial = deferred(), listeners = [], removed = [], old = [], current = [];
  const native = {
    addListener(name, listener) { listeners.push(listener); const id = listeners.length - 1; return { remove() { removed.push(id); } }; },
    getCameraInterruptionState() { return initial.promise; },
  };
  const first = createCameraInterruptionObservation(native, 'front', x => old.push(x));
  first.remove(); first.remove();
  const second = createCameraInterruptionObservation(native, 'front', x => current.push(x));
  listeners[0](raw(3)); listeners[1](raw(3)); initial.resolve(raw(1));
  assert.equal((await first.ready).state, 'notAvailable');
  await second.ready;
  assert.equal(old.length, 0); assert.equal(current.length, 1); assert.deepEqual(removed, [0]);
  second.remove();
});

test('missing optional module remains unknown; failed or stalled transport is explicit and bounded', async () => {
  for (const native of [null, {}]) {
    assert.deepEqual(await readCameraInterruption(native, 'front'), unknownCameraInterruption('front'));
  }
  for (const native of [{ getCameraInterruptionState: async () => { throw Error('unavailable'); } }, { getCameraInterruptionState: async () => ({ bad: true }) }]) {
    assert.equal((await readCameraInterruption(native, 'front')).state, 'queryFailed');
  }
  assert.equal((await readCameraInterruption({ getCameraInterruptionState: async () => unknownCameraInterruption('front') }, 'front')).state, 'notAvailable');
  const started = Date.now();
  assert.equal((await readCameraInterruption({ getCameraInterruptionState: () => new Promise(() => {}) }, 'front')).state, 'queryFailed');
  assert.ok(Date.now() - started < 1500, 'a stalled bridge cannot hold recovery indefinitely');
});

test('a failed status transport stops visibly and leaves restart budget available', async () => {
  for (const path of ['error', 'watchdog']) {
    const f = createCaptureWatchdogFixture({ readInterruption: () => readCameraInterruption({ getCameraInterruptionState: async () => { throw Error('bridge unavailable'); } }, 'front') });
    if (path === 'error') await f.error(); else await f.tick(6001);
    assert.equal(f.events.stops, 1); assert.equal(f.events.cues, 1);
    assert.equal(f.state.cameraRestartCountRef.current, 0);
    assert.equal(f.state.lastSampleAtRef.current, 1000);
    f.cleanup();
  }
});

const source = () => originalCameraSession(readFileSync(new URL('../' + sourceRelativePath, import.meta.url), 'utf8'));

test('experiment is opt-in, strict about invalid flags, and pins all VC source bytes and version', () => {
  for (const env of [{}, { [experimentFlag]: '' }, { [experimentFlag]: '0' }]) assert.equal(readExperimentFlag(env), false);
  assert.equal(readExperimentFlag({ [experimentFlag]: '1' }), true);
  for (const value of ['true', 'false', ' 1', '2']) assert.throws(() => readExperimentFlag({ [experimentFlag]: value }), /must be 0 or 1/);
  const original = source();
  assert.deepEqual(patchCameraMultitasking(original, '4.7.3', false), { source: original, changed: false });
  assert.throws(() => patchCameraMultitasking(original, '4.7.4', true), /expected.*4.7.3/);
  assert.throws(() => patchCameraMultitasking(original + '// changed', '4.7.3', false), /source changed/);
  const patched = patchCameraMultitasking(original, '4.7.3', true).source;
  assert.equal((patched.match(/\.startRunning\(\)/g) ?? []).length, 1, 'both video start paths use the guarded helper');
  assert.equal((patched.match(/startRunningWithOcculertMultitaskingExperiment\(\)/g) ?? []).length, 3);
  assert.equal(patchCameraMultitasking(patched, '4.7.3', true).changed, false);
  assert.deepEqual(patchCameraMultitasking(patched, '4.7.3', false), { source: original, changed: true });
  assert.throws(() => patchCameraMultitasking(patched.replace('= true', '= false'), '4.7.3', true), /source changed/);
});

test('postinstall enables and removes only its own patch, with no mutation on invalid inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'occulert-multitasking-patch-'));
  const path = join(root, sourceRelativePath), packagePath = join(root, 'node_modules/react-native-vision-camera/package.json');
  try {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source()); writeFileSync(packagePath, JSON.stringify({ version: '4.7.3' }));
    assert.deepEqual(applyCameraMultitaskingPatch(root, {}), { enabled: false, changed: false });
    assert.deepEqual(applyCameraMultitaskingPatch(root, { [experimentFlag]: '1' }), { enabled: true, changed: true });
    const patched = readFileSync(path, 'utf8');
    assert.deepEqual(applyCameraMultitaskingPatch(root, { [experimentFlag]: '1' }), { enabled: true, changed: false });
    assert.throws(() => applyCameraMultitaskingPatch(root, { [experimentFlag]: 'yes' }));
    assert.equal(readFileSync(path, 'utf8'), patched);
    assert.deepEqual(applyCameraMultitaskingPatch(root, {}), { enabled: false, changed: true });
    assert.equal(readFileSync(path, 'utf8'), source());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native metadata snapshot is committed before delivery, scoped to live devices, and ordered', { skip: process.platform !== 'darwin' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'occulert-interruption-state-'));
  try {
    const store = new URL('../modules/occulert-device-condition/ios/OcculertCameraInterruptionState.swift', import.meta.url);
    const main = join(root, 'main.swift'), executable = join(root, 'state-test');
    writeFileSync(main, `import Foundation
let store = OcculertCameraInterruptionState()
let first = store.update(sessionId: "frontSession", deviceIds: ["front"], interrupted: true, rawReason: 4)
// Simulate bridge delivery still queued: recovery already reads the named reason.
let beforeDelivery = store.snapshot(deviceId: "front", liveSessionIds: ["frontSession"])
precondition(beforeDelivery["reason"] as? String == "multitasking")
precondition(beforeDelivery["sequence"] as? Int == first["sequence"] as? Int)
_ = store.update(sessionId: "anotherFront", deviceIds: ["front"], interrupted: false, rawReason: nil)
let aggregate = store.snapshot(deviceId: "front", liveSessionIds: ["frontSession", "anotherFront"])
precondition(aggregate["reason"] as? String == "multitasking")
precondition(aggregate["sequence"] as? Int == 2)
_ = store.update(sessionId: "backSession", deviceIds: ["back"], interrupted: false, rawReason: nil)
precondition(store.snapshot(deviceId: "front", liveSessionIds: ["frontSession", "backSession"])["interrupted"] as? Bool == true)
_ = store.update(sessionId: "frontSession", deviceIds: ["front"], interrupted: false, rawReason: nil)
precondition(store.snapshot(deviceId: "front", liveSessionIds: ["frontSession"])["reason"] as? String == "none")
precondition(store.snapshot(deviceId: "front", liveSessionIds: [])["state"] as? String == "notAvailable")
precondition(OcculertCameraInterruptionState.reason(99, interrupted: true) == "unknown")
print("native interruption state passed")
`);
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(root, 'module-cache'), store.pathname, main, '-o', executable], { stdio: 'pipe', timeout: 60000 });
    assert.match(execFileSync(executable, { encoding: 'utf8' }), /state passed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native experiment sets supported access before start and never sets it while running or unsupported', { skip: process.platform !== 'darwin' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'occulert-multitasking-order-'));
  try {
    const main = join(root, 'main.swift'), executable = join(root, 'order-test');
    writeFileSync(main, `final class Session {
var isRunning = false
var isMultitaskingCameraAccessSupported = false
var writes = 0
var isMultitaskingCameraAccessEnabled = false { didSet { precondition(!isRunning); precondition(isMultitaskingCameraAccessSupported); writes += 1 } }
func startRunning() { if isMultitaskingCameraAccessSupported && !isRunning { precondition(isMultitaskingCameraAccessEnabled) }; isRunning = true }
}
final class Camera { let captureSession = Session()
${experimentHelper.replace('  private func', '  func')}
}
let supported = Camera(); supported.captureSession.isMultitaskingCameraAccessSupported = true
supported.startRunningWithOcculertMultitaskingExperiment(); precondition(supported.captureSession.writes == 1)
supported.startRunningWithOcculertMultitaskingExperiment(); precondition(supported.captureSession.writes == 1)
let unsupported = Camera(); unsupported.startRunningWithOcculertMultitaskingExperiment(); precondition(unsupported.captureSession.writes == 0)
print("native start order passed")
`);
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(root, 'module-cache'), main, '-o', executable], { stdio: 'pipe', timeout: 60000 });
    assert.match(execFileSync(executable, { encoding: 'utf8' }), /start order passed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
