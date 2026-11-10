import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureCameraFixture, createCaptureWatchdogFixture } from './lib/capture-camera-test-harness.mjs';
import { createCaptureLoadDiagnostics } from '../lib/captureLoadDiagnostics.ts';
import { isActiveSessionCheckpoint, parseActiveSessionCheckpoint } from '../lib/sessionRecoveryModel.ts';
import { deriveCameraLoadPolicy } from '../lib/cameraResilience.ts';
import {
  CAPTURE_LOAD_EXPERIMENT,
  CAPTURE_TRANSITION_GRACE_MS,
  ROAD_STREAM_EVALUATION_FPS,
  captureLoadConfiguration,
  createCaptureTransitionGuard,
  deriveRoadStreamLoadPolicy,
  selectCaptureLoadFormat,
} from '../lib/captureLoadPolicy.ts';

const format = (videoWidth, videoHeight, minFps = 15, maxFps = 30) => ({ videoWidth, videoHeight, minFps, maxFps });
const roadConditions = { evaluationRequested: true, thermalState: 'nominal', pressureLevel: 'nominal' };

test('road evaluation stays disabled without an exact explicit request', () => {
  const disabled = { mode: 'disabled', requestedRoadFps: 0, reason: 'not-requested' };
  assert.deepEqual(deriveRoadStreamLoadPolicy({ thermalState: 'nominal', pressureLevel: 'nominal' }), disabled);
  for (const evaluationRequested of [false, undefined, null, 0, 1, 'true', {}, []]) {
    assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, evaluationRequested }), disabled);
  }
  assert.deepEqual(deriveRoadStreamLoadPolicy({
    ...roadConditions, evaluationRequested: false, thermalState: 'critical', fallbackLatched: true,
  }), disabled);
});

test('only known nominal or fair load proposes the fixed five-fps evaluation tier', () => {
  assert.equal(ROAD_STREAM_EVALUATION_FPS, 5);
  for (const thermalState of ['nominal', 'fair']) {
    for (const pressureLevel of ['nominal', 'fair']) {
      assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, thermalState, pressureLevel }), {
        mode: 'evaluation', requestedRoadFps: 5, reason: 'none',
      });
    }
  }
});

test('serious heat or pressure drops the road recommendation before driver settings are considered', () => {
  for (const thermalState of ['serious', 'critical']) {
    assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, thermalState }), {
      mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'heat',
    });
  }
  for (const pressureLevel of ['serious', 'critical', 'shutdown']) {
    assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, pressureLevel }), {
      mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'pressure',
    });
  }
});

test('unknown or malformed conditions and latch values never propose road frames', () => {
  const fallback = { mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'unknown' };
  for (const value of ['unknown', 'unrecognized', null, undefined, NaN, Infinity, -1, 0, true, {}, []]) {
    assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, thermalState: value }), fallback);
    assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, pressureLevel: value }), fallback);
  }
  for (const fallbackLatched of [null, 'true', 'false', 1, 0, {}, []]) {
    assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, fallbackLatched }), fallback);
  }
});

test('a caller-owned fallback latch survives cooling and an evaluation toggle until a new parked session', () => {
  const hot = deriveRoadStreamLoadPolicy({ ...roadConditions, thermalState: 'serious' });
  const fallbackLatched = hot.mode === 'driverOnlyFallback';
  const retained = { mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'latched' };
  assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, fallbackLatched }), retained);
  assert.equal(deriveRoadStreamLoadPolicy({ ...roadConditions, fallbackLatched, evaluationRequested: false }).requestedRoadFps, 0);
  assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, fallbackLatched }), retained);
  assert.deepEqual(deriveRoadStreamLoadPolicy({ ...roadConditions, fallbackLatched: false }), {
    mode: 'evaluation', requestedRoadFps: 5, reason: 'none',
  }, 'the future owner resets the latch only for a new parked session');
});

test('road decisions are pure and share neither input state nor mutable results', () => {
  const input = Object.freeze({ ...roadConditions, fallbackLatched: false });
  const before = structuredClone(input);
  const first = deriveRoadStreamLoadPolicy(input);
  const second = deriveRoadStreamLoadPolicy(input);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  first.requestedRoadFps = 0;
  assert.deepEqual(deriveRoadStreamLoadPolicy(input), { mode: 'evaluation', requestedRoadFps: 5, reason: 'none' });
  assert.deepEqual(input, before);
});

test('road fallback leaves the existing driver reduction and critical-heat stop decisions intact', () => {
  for (const [thermalState, mode, analysisIntervalMs, reason] of [
    ['nominal', 'normal', 100, 'none'],
    ['serious', 'reduced', 200, 'heat'],
    ['critical', 'stop', 200, 'heat'],
  ]) {
    const input = Object.freeze({ thermalState, lowPowerMode: false, batteryLevel: 1, isCharging: false });
    const before = deriveCameraLoadPolicy(input);
    const road = deriveRoadStreamLoadPolicy({ ...roadConditions, thermalState, pressureLevel: 'serious' });
    assert.equal(road.requestedRoadFps, 0);
    assert.deepEqual(deriveCameraLoadPolicy(input), before);
    assert.deepEqual(before, { mode, analysisIntervalMs, reason });
    assert.equal(Object.hasOwn(road, 'analysisIntervalMs'), false);
  }
});

test('capture experiment is disabled without the explicit build flag', () => {
  assert.equal(CAPTURE_LOAD_EXPERIMENT, process.env.EXPO_PUBLIC_CAPTURE_LOAD_EXPERIMENT === '1');
  assert.equal(captureLoadConfiguration(false, format(1280, 720), 'normal'), null);
  assert.equal(captureLoadConfiguration(false, format(1280, 720), 'reduced'), null);
});

test('selection requires both frame rates and both video dimensions, and chooses the smallest usable area', () => {
  const expected = format(1280, 720);
  const candidates = [
    format(640, 480), format(1920, 600), format(1280, 720, 30, 30),
    format(1280, 720, 15, 24), format(1280, 720, NaN, 60),
    format(Infinity, 720), format(1280, 720, -1, 60),
    format(1920, 1080), format(2560, 1440), expected,
  ];
  const original = [...candidates];
  assert.strictEqual(selectCaptureLoadFormat(candidates), expected);
  assert.strictEqual(selectCaptureLoadFormat(candidates.toReversed()), expected);
  assert.deepEqual(candidates, original, 'the device-owned format array stays intact');
  assert.deepEqual(selectCaptureLoadFormat([format(720, 1280)]), format(720, 1280));
  assert.equal(selectCaptureLoadFormat([]), undefined);
  assert.equal(selectCaptureLoadFormat([format(1280, 720, 30, 60)]), undefined, '30-only ranges use the existing default capture fallback');
});

test('available capture requests 30 normally and a supported 15 under reduced load', () => {
  const chosen = selectCaptureLoadFormat([format(1920, 1080, 1, 60), format(1280, 720)]);
  assert.deepEqual(captureLoadConfiguration(true, chosen, 'normal'), { width: 1280, height: 720, fps: 30 });
  assert.deepEqual(captureLoadConfiguration(true, chosen, 'reduced'), { width: 1280, height: 720, fps: 15 });
  assert.deepEqual(captureLoadConfiguration(true, chosen, 'stop'), { width: 1280, height: 720, fps: 15 });
  assert.equal(captureLoadConfiguration(true, undefined, 'reduced'), null);
});

test('initial selection, missing samples and an already-stalled stream receive no grace', () => {
  for (const state of [
    { hasSample: false, lastSampleAt: 0, at: 9_000 },
    { hasSample: true, lastSampleAt: 1_000, at: 6_001 },
    { hasSample: true, lastSampleAt: NaN, at: 6_001 },
  ]) {
    const guard = createCaptureTransitionGuard();
    assert.equal(guard.observe({ ...state, key: '30', stallTimeoutMs: 5_000 }), false);
    assert.equal(guard.observe({ ...state, key: '15', stallTimeoutMs: 5_000 }), false);
    assert.equal(guard.shouldDefer(6_001, state.lastSampleAt), false);
  }
});

test('thermal flapping cannot extend one stalled frame gap beyond the fixed transition deadline', () => {
  const guard = createCaptureTransitionGuard();
  const observe = (key, at, lastSampleAt = 1_000) => guard.observe({ key, at, lastSampleAt, hasSample: true, stallTimeoutMs: 5_000 });
  assert.equal(observe('30', 1_000), false);
  assert.equal(observe('15', 5_900), true);
  assert.equal(CAPTURE_TRANSITION_GRACE_MS, 2_000);
  for (let at = 6_000; at < 8_000; at += 100) {
    assert.equal(observe(at % 200 ? '15' : '30', at), false);
    assert.equal(guard.shouldDefer(at, 1_000), true);
  }
  assert.equal(guard.shouldDefer(8_000, 1_000), false);
  assert.equal(observe('30', 8_001), false);
  assert.equal(observe('15', 8_002), false);
  assert.equal(guard.shouldDefer(8_002, 1_000), false);
  assert.equal(observe('30', 8_100, 8_000), true, 'a genuinely new sample permits a later independent transition');
  assert.equal(guard.shouldDefer(8_101, 8_100), false, 'a new sample ends that grace immediately');
  guard.reset();
  assert.equal(observe('15', 8_200, 8_100), false, 'a new session begins without transition grace');
});

test('disabled experiment passes original Camera props and callbacks without format/fps overrides', async () => {
  const device = { id: 'front', formats: [format(1920, 1080), format(1280, 720)] };
  const callbacks = { onError() {}, onInitialized() {}, frameProcessor() {} };
  const changes = [];
  const f = createCaptureCameraFixture({ device, ...callbacks, onCaptureConfiguration: change => changes.push(change) });
  await f.mount();
  try {
    const identity = f.camera.props.identity;
    for (const loadMode of ['normal', 'reduced', 'normal']) {
      await f.update({ loadMode });
      assert.strictEqual(f.camera.props.device, device);
      assert.equal(Object.hasOwn(f.camera.props, 'format'), false);
      assert.equal(Object.hasOwn(f.camera.props, 'fps'), false);
      for (const [name, callback] of Object.entries(callbacks)) assert.strictEqual(f.camera.props[name], callback);
      assert.equal(f.camera.props.pixelFormat, 'yuv');
      assert.equal(f.camera.props.resizeMode, 'contain');
      assert.strictEqual(f.camera.props.identity, identity);
    }
    assert.equal(changes.length, 0);
    assert.equal(f.calls.mounts, 1);
    assert.equal(f.calls.unmounts, 0);
  } finally { await f.unmount(); }
});

test('actual format hook selects a valid candidate and thermal FPS changes preserve the native Camera instance', async () => {
  const chosen = format(1280, 720);
  const device = { id: 'virtual-front', formats: [format(1920, 1080), format(640, 480), format(1280, 720, 30, 60), chosen] };
  const changes = [];
  const f = createCaptureCameraFixture({ device, experimentEnabled: true, onCaptureConfiguration: change => changes.push(change) });
  await f.mount();
  try {
    const identity = f.camera.props.identity;
    assert.strictEqual(f.camera.props.device, device, 'the candidate copy must never replace the native device');
    assert.strictEqual(f.camera.props.format, chosen);
    assert.equal(f.camera.props.fps, 30);
    await f.update({ loadMode: 'reduced' });
    assert.equal(f.camera.props.fps, 15);
    assert.strictEqual(f.camera.props.format, chosen);
    await f.update({ loadMode: 'normal' });
    assert.equal(f.camera.props.fps, 30);
    assert.strictEqual(f.camera.props.identity, identity);
    assert.equal(f.calls.mounts, 1);
    assert.equal(f.calls.unmounts, 0);
    assert.deepEqual(changes.map(change => change.configuration.fps), [30, 15, 30]);
    await f.update({ monitoring: false });
    assert.equal(changes.length, 3);
    await f.update({ monitoring: true });
    assert.equal(changes.length, 4, 'a preview retained into a new drive still records the selected capture');
  } finally { await f.unmount(); }
  assert.equal(f.calls.unmounts, 1);
});

test('an unsupported device uses unchanged capture defaults and reports no invented selected dimensions', async () => {
  for (const formats of [[], [format(640, 480)], [format(1280, 720, 30, 30)]]) {
    const changes = [];
    const device = { id: 'front', formats };
    const f = createCaptureCameraFixture({ device, experimentEnabled: true, onCaptureConfiguration: change => changes.push(change) });
    await f.mount();
    try {
      assert.strictEqual(f.camera.props.device, device);
      assert.equal(Object.hasOwn(f.camera.props, 'format'), false);
      assert.equal(Object.hasOwn(f.camera.props, 'fps'), false);
      assert.equal(changes.length, 1);
      assert.equal(changes[0].configuration, null);
    } finally { await f.unmount(); }
  }
});

test('capture diagnostics stay numeric, bounded in shape, copied, and compatible with interrupted-drive recovery', () => {
  const diagnostics = createCaptureLoadDiagnostics();
  assert.equal(diagnostics.snapshot(), undefined, 'flag-off/older sessions retain the original snapshot shape');
  diagnostics.record({ width: 1280, height: 720, fps: 30 });
  diagnostics.record({ width: 1280, height: 720, fps: 15 }, true);
  diagnostics.record({ width: 1280, height: 720, fps: 15 });
  assert.deepEqual(diagnostics.snapshot(), { available: 1, width: 1280, height: 720, fps: 15, changes: 1, unavailableConfigurations: 0, transitionGraceCount: 1 });
  const checkpoint = {
    sessionId: 'local-drive', startedAt: 1000, checkpointedAt: 5000,
    durationSec: 4, alertCount: 0, avgFatigue: 0, maxFatigue: 0, sensitivity: 'medium',
    monitorPerformance: { captureLoad: diagnostics.snapshot() },
  };
  assert.equal(isActiveSessionCheckpoint(checkpoint), true);
  assert.deepEqual(parseActiveSessionCheckpoint(JSON.stringify(checkpoint)), checkpoint);
  diagnostics.snapshot().width = 1;
  assert.equal(diagnostics.snapshot().width, 1280);
  diagnostics.record({ width: NaN, height: 720, fps: 30 });
  assert.equal(diagnostics.snapshot().width, 1280);
  diagnostics.record(null);
  assert.equal(diagnostics.snapshot().available, 0);
  assert.equal(diagnostics.snapshot().fps, 0, 'a fallback does not pretend to know native defaults');
  assert.equal(Object.values(diagnostics.snapshot()).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0), true);
  for (let index = 0; index < 1000; index++) diagnostics.record({ width: 1280, height: 720, fps: index % 2 ? 15 : 30 });
  assert.equal(Object.keys(diagnostics.snapshot()).length, 7);
  diagnostics.reset();
  assert.equal(diagnostics.snapshot(), undefined);
});

test('an actual FPS change immediately after a frame extends the stall deadline by only two seconds', async () => {
  const watchdog = createCaptureWatchdogFixture();
  const f = createCaptureCameraFixture({
    device: { id: 'front', formats: [format(1280, 720)] }, experimentEnabled: true,
    onCaptureConfiguration: change => watchdog.configure(change),
  });
  await f.mount();
  try {
    const identity = f.camera.props.identity;
    watchdog.setNow(1_001);
    await f.update({ loadMode: 'reduced' });
    await watchdog.tick(6_001);
    assert.equal(f.camera.props.fps, 15);
    assert.strictEqual(f.camera.props.identity, identity);
    assert.equal(watchdog.state.lastSampleAtRef.current, 1_000, 'configuration cannot fabricate a camera sample');
    assert.equal(watchdog.state.cameraRestartCountRef.current, 0);
    assert.equal(watchdog.tracker.snapshot().cameraStalls, 0);
    for (const at of [6_200, 6_400, 6_600, 6_800, 7_000, 7_200, 7_400, 7_600, 7_800]) {
      watchdog.setNow(at);
      await f.update({ loadMode: at % 400 ? 'normal' : 'reduced' });
      await watchdog.tick(at);
    }
    assert.equal(watchdog.state.cameraRestartCountRef.current, 0);
    assert.deepEqual(watchdog.events.epochs, []);
    assert.equal(watchdog.tracker.snapshot().captureLoad.transitionGraceCount, 1);
    await watchdog.tick(7_999);
    assert.equal(watchdog.state.cameraRestartCountRef.current, 0, 'the gap may exceed five seconds but never seven');
    await watchdog.tick(8_000);
    assert.equal(watchdog.state.cameraRestartCountRef.current, 1, 'the actual expired stall still gets the existing single recovery');
    assert.deepEqual(watchdog.events.epochs, [1]);
    assert.equal(watchdog.tracker.snapshot().cameraStalls, 1);
    await watchdog.tick(18_001);
    assert.equal(watchdog.state.cameraRestartCountRef.current, 1, 'a persistent stall cannot obtain another automatic recovery');
    assert.equal(watchdog.tracker.snapshot().cameraStalls, 2);
    assert.equal(watchdog.events.stops, 1);
    assert.equal(watchdog.events.cues, 1);
    assert.match(watchdog.events.faults[0], /camera analysis stalled/);
    assert.equal(f.calls.mounts, 1);
  } finally { await f.unmount(); watchdog.cleanup(); }
});

test('a frame after actual FPS reconfiguration clears grace and later real stalls remain protected', async () => {
  const watchdog = createCaptureWatchdogFixture();
  const f = createCaptureCameraFixture({
    device: { id: 'front', formats: [format(1280, 720)] }, experimentEnabled: true,
    onCaptureConfiguration: change => watchdog.configure(change),
  });
  await f.mount();
  try {
    watchdog.setNow(5_900);
    await f.update({ loadMode: 'reduced' });
    watchdog.sample(6_000);
    await watchdog.tick(6_100);
    assert.equal(watchdog.events.stops, 0);
    assert.equal(watchdog.state.cameraRestartCountRef.current, 0);
    assert.equal(watchdog.state.captureTransitionRef.current.shouldDefer(6_100, 6_000), false);
    await watchdog.tick(11_001);
    assert.equal(watchdog.state.cameraRestartCountRef.current, 1);
  } finally { await f.unmount(); watchdog.cleanup(); }
});

test('actual format changes preserve the Camera instance, record new dimensions, and cannot hide an existing stall', async () => {
  const watchdog = createCaptureWatchdogFixture();
  const f = createCaptureCameraFixture({
    device: { id: 'front', formats: [format(1280, 720)] }, experimentEnabled: true,
    onCaptureConfiguration: change => watchdog.configure(change),
  });
  await f.mount();
  try {
    const identity = f.camera.props.identity;
    const nextDevice = { id: 'front', formats: [format(1920, 1080)] };
    watchdog.setNow(6_001);
    await f.update({ device: nextDevice });
    assert.strictEqual(f.camera.props.device, nextDevice);
    assert.strictEqual(f.camera.props.identity, identity);
    assert.equal(f.camera.props.format.videoWidth, 1920);
    assert.equal(watchdog.tracker.snapshot().captureLoad.width, 1920);
    assert.equal(watchdog.tracker.snapshot().captureLoad.changes, 1);
    assert.equal(watchdog.tracker.snapshot().captureLoad.transitionGraceCount, 0);
    await watchdog.tick(6_001);
    assert.equal(watchdog.state.cameraRestartCountRef.current, 1, 'an overdue stream is protected immediately despite a new format request');
  } finally { await f.unmount(); watchdog.cleanup(); }
});
