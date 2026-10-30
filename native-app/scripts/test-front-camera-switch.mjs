import { readNativeMonitorSourceOwners } from './lib/monitor-source-owners.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { frontCameraTransition, initialFrontCameraSwitchState, createFrontCameraDiagnostics } from '../lib/frontCameraSwitch.ts';
import { createMonitorPerformanceTracker } from '../lib/monitorPerformance.ts';
import { isActiveSessionCheckpoint } from '../lib/sessionRecoveryModel.ts';

const monitor = readNativeMonitorSourceOwners().identity;
const identity = (kind, id = kind) => ({
  state: 'available', deviceId: 'virtual-front', deviceType: 'virtual', isVirtual: true,
  constituentDeviceTypes: ['outer', 'inner'], streamingDeviceType: kind === 'unknown' ? null : kind,
  streamingUniqueId: kind === 'unknown' ? null : id, streamingType: kind,
});
function callbackFixture({ running = false, experiment = true } = {}) {
  const events = { setups: 0, resets: 0, notices: 0, clears: 0, baseline: .9, identities: [], records: [], messages: [] };
  const ref = current => ({ current });
  const context = {
    useCallback: fn => fn, frontCameraTransition, EYE_BASELINE_EXPERIMENT: experiment,
    isRunningRef: ref(running), setupPreviewActiveRef: ref(!running),
    frontCameraSwitchRef: ref(initialFrontCameraSwitchState()), frontCameraIdentityRef: ref(null),
    baselineGenerationRef: ref(0), cameraBaselineRevisionRef: ref(0), baselineFinishedRef: ref(true),
    baselineCollectorRef: ref({ reset() { events.resets += 1; } }), lastCameraSetupUiAtRef: ref(42),
    baselineMountedRef: ref(true), baselineCanSaveRef: ref(true), sessionEyeBaselineRef: ref(.9), eyeBaselineRef: ref(.9),
    setFrontCameraIdentity: value => events.identities.push(value),
    initialCameraSetupAssessment: () => ({ ready: false }), setCameraSetup: () => events.setups++,
    setEyeBaseline: value => { events.baseline = value; }, setBaselineMessage: value => events.messages.push(value),
    clearDeviceEyeBaseline: async () => { events.clears += 1; },
    performanceTrackerRef: ref({ recordFrontCamera: (...args) => events.records.push(args) }),
    deliverMonitoringPausedCue: () => events.notices++, Date: { now: () => 2000 },
  };
  const start = monitor.indexOf('  const handleFrontCameraIdentity = useCallback(');
  const end = monitor.indexOf('\n  const cameraIdentityActive', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(stripTypeScriptTypes(monitor.slice(start, end)) + '\nglobalThis.receive = handleFrontCameraIdentity;', context);
  return { context, events, receive: value => context.receive(value) };
}

test('parked switches reset real setup and baseline collection; an unknown gap does not invent a switch', async () => {
  const f = callbackFixture();
  f.receive(identity('outer'));
  assert.equal(f.events.setups, 1, 'legacy device-wide baseline has no verified constituent identity');
  f.receive(identity('unknown'));
  f.receive(identity('outer'));
  assert.equal(f.events.setups, 1);
  f.receive(identity('inner'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.setups, 2);
  assert.ok(f.events.resets > 0);
  assert.equal(f.events.baseline, null);
  assert.equal(f.context.sessionEyeBaselineRef.current, null);
  assert.equal(f.events.clears, 2);
  assert.equal(f.events.notices, 0);
  assert.equal(f.context.setupPreviewActiveRef.current, true);
});

test('running switches keep monitoring, clear the actual hook input, record locally, and cue once per switch', () => {
  const f = callbackFixture({ running: true });
  f.receive(identity('outer'));
  f.receive(identity('inner'));
  f.receive(identity('inner'));
  assert.equal(f.events.notices, 1);
  assert.equal(f.events.baseline, null);
  assert.equal(f.context.sessionEyeBaselineRef.current, null);
  assert.equal(f.context.isRunningRef.current, true);
  assert.equal(f.events.setups, 0);
  assert.equal(f.events.records[1][2], true);
  f.receive(identity('unknown'));
  f.receive(identity('inner'));
  assert.equal(f.events.notices, 1);
  f.receive(identity('outer'));
  assert.equal(f.events.notices, 2);
  assert.equal(f.context.isRunningRef.current, true);
});

test('first Duo identity discards unbound saved baselines, while standard phones preserve their baseline', () => {
  for (const kind of ['outer', 'inner']) {
    const first = frontCameraTransition(initialFrontCameraSwitchState(), identity(kind), true);
    assert.equal(first.clearEyeBaseline, true);
    assert.equal(first.playNotice, false);
  }
  const standard = { ...identity('standard'), isVirtual: false };
  assert.equal(frontCameraTransition(initialFrontCameraSwitchState(), standard, false).clearEyeBaseline, false);
  const f = callbackFixture({ experiment: false, running: true });
  f.receive(identity('outer')); f.receive(identity('inner'));
  assert.equal(f.events.baseline, .9);
  assert.equal(f.events.clears, 0);
  assert.equal(f.events.records[1][2], false);
  f.context.isRunningRef.current = false;
  const before = f.events.identities.length;
  f.receive(identity('outer'));
  assert.equal(f.events.identities.length, before, 'disposed preview/session cannot apply a late callback');
});

test('camera diagnostics account for actual physical identity and unknown intervals without double-counting snapshots', () => {
  const tracker = createFrontCameraDiagnostics();
  tracker.reset(1000);
  tracker.record(identity('outer'), 1100);
  tracker.record(identity('unknown'), 2100);
  tracker.record(identity('outer'), 2200);
  tracker.record(identity('inner'), 3000, true);
  const result = tracker.snapshot(4000);
  assert.equal(result.switches, 1);
  assert.equal(result.baselineClears, 1);
  assert.deepEqual(result.timeMs, { outer: 1800, inner: 1000, standard: 0, unknown: 200 });
  assert.deepEqual(result.physicalCameraTimeMs, { outer: 1800, inner: 1000 });
  assert.deepEqual(result.switchesToCamera, { inner: 1 });
  assert.deepEqual(tracker.snapshot(4000), result);
  tracker.record(identity('outer'), 2900);
  assert.deepEqual(tracker.snapshot(4000), result, 'reversed clocks cannot change identity or counters');
  tracker.reset(5000);
  assert.equal(tracker.snapshot(6000), null);
});

test('bounded diagnostics survive recovery validation and remain outside cloud completion fields', () => {
  const tracker = createMonitorPerformanceTracker();
  tracker.recordSessionStart(1000);
  for (let index = 0; index < 32; index++) tracker.recordFrontCamera(identity('standard', `front-${index}`), 1100 + index * 100);
  const performance = tracker.snapshot(5000);
  assert.equal(performance.frontCamera.switches, 31);
  assert.equal(Object.keys(performance.frontCamera.physicalCameraTimeMs).length, 16);
  assert.ok(isActiveSessionCheckpoint({ sessionId: 'local', startedAt: 1000, checkpointedAt: 5000,
    durationSec: 4, alertCount: 0, avgFatigue: 0, maxFatigue: 0, sensitivity: 'medium', monitorPerformance: performance }));
  const source = readFileSync(new URL('../lib/sessionCompletion.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source.slice(source.indexOf('export async function finalizeCompletedNativeSession')), /monitorPerformance|frontCamera|physicalCamera/);
  tracker.reset();
  assert.equal(tracker.snapshot(6000).frontCamera, undefined);
});

test('observer cleanup rejects stale deliveries and does not restart the camera when running replaces preview', () => {
  const start = monitor.indexOf('  const cameraIdentityActive =');
  const end = monitor.indexOf('\n  useEffect(() => {\n    if (!EYE_BASELINE_EXPERIMENT)', start);
  assert.ok(start >= 0 && end > start);
  let callback, cleanup, removed = 0, calls = 0;
  const context = { isRunning: true, setupPreviewActive: false, device: { id: 'virtual-front' },
    useEffect: effect => { cleanup = effect(); },
    observeFrontCameraIdentity: (id, listener) => { assert.equal(id, 'virtual-front'); callback = listener; return { ready: Promise.resolve(identity('outer')), remove: () => removed++ }; },
    handleFrontCameraIdentity: () => calls++,
  };
  vm.runInNewContext(stripTypeScriptTypes(monitor.slice(start, end)), context);
  callback(identity('outer')); assert.equal(calls, 1);
  cleanup(); callback(identity('inner')); assert.equal(calls, 1); assert.equal(removed, 1);
  assert.match(monitor.slice(start, end), /\[cameraIdentityActive, device\?\.id, handleFrontCameraIdentity\]/);
});

test('a queued camera clear follows an in-flight parked save and stale load cannot restore the old baseline', async () => {
  let raw = null, release;
  const pending = new Promise(resolve => { release = resolve; });
  const source = readFileSync(new URL('../lib/eyeBaselineStorage.ts', import.meta.url), 'utf8').replace(/^import[^;]*;\s*/gm, '').replace(/^export /gm, '');
  const context = { AsyncStorage: { getItem: async () => raw,
    setItem: async (_key, value) => { await pending; raw = value; }, removeItem: async () => { raw = null; } },
    validEyeProbability: value => typeof value === 'number' && value >= 0 && value <= 1, EYE_BASELINE_MIN_SAMPLES: 8 };
  vm.runInNewContext(stripTypeScriptTypes(source) + '\nglobalThis.api={saveDeviceEyeBaseline,clearDeviceEyeBaseline,loadDeviceEyeBaseline};', context);
  const saving = context.api.saveDeviceEyeBaseline(.9, 12);
  const clearing = context.api.clearDeviceEyeBaseline();
  release(); await saving; await clearing;
  assert.equal(await context.api.loadDeviceEyeBaseline(), null);

  let finishLoad, effectCleanup;
  const loaded = [];
  const revision = { current: 0 };
  const loadContext = { EYE_BASELINE_EXPERIMENT: true, useEffect: effect => { effectCleanup = effect(); },
    baselineMountedRef: { current: false }, baselineGenerationRef: { current: 0 }, cameraBaselineRevisionRef: revision,
    baselineCanSaveRef: { current: false }, eyeBaselineRef: { current: null }, loadDeviceEyeBaseline: () => new Promise(resolve => { finishLoad = resolve; }),
    setEyeBaseline: value => loaded.push(value), setBaselineMessage: () => {}, setBaselineLoaded: () => {} };
  const effectStart = monitor.indexOf('  useEffect(() => {\n    if (!EYE_BASELINE_EXPERIMENT)');
  const effectEnd = monitor.indexOf('\n  useEffect(() => {\n    loadSavedSensitivity()', effectStart);
  vm.runInNewContext(stripTypeScriptTypes(monitor.slice(effectStart, effectEnd)), loadContext);
  revision.current++; finishLoad(.9); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loaded, []);
  effectCleanup();
});
