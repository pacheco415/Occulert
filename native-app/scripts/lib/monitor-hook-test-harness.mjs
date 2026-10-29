import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const nativeRoot = new URL('../../', import.meta.url).pathname;

/** Real React and actual hook/model sources. Only native bridges/actions are substituted. */
export function createMonitorHookFixture({ experiment = false, running = false, preview = false, simulator = false } = {}) {
  const intervals = new Map(), cache = new Map();
  const events = { counts: [], logs: [], checkpoints: [], faults: [], cues: 0, stops: [], identities: [], messages: [], metrics: [], proofs: [], clears: 0 };
  const observations = { camera: [], identity: [] };
  let clock = 1_000, timer = 0, renderer, latest;
  const ref = current => ({ current });
  const f = { events, observations, intervals, cloudWait: null, checkpointWait: null, clearWait: null, baselineWait: null, interruptionWait: null,
    authorized: true, faces: [], detections: 0 };
  class Clock extends Date { static now() { return clock; } }
  const bridges = {
    react: React,
    'react-native': { Alert: { alert: (...args) => events.faults.push(args) }, Platform: { OS: 'ios' } },
    'react-native-vision-camera': { useFrameProcessor: (callback, dependencies) => React.useCallback(callback, dependencies) },
    'react-native-worklets-core': { useRunOnJS: (callback, dependencies) => React.useMemo(() => callback, dependencies), useSharedValue: value => React.useRef({ value }).current },
    'expo-constants': { __esModule: true, default: { expoConfig: { version: 'fixture', extra: { simulatorTrace: simulator }, ios: { buildNumber: 'fixture', bundleIdentifier: simulator ? 'com.occulert.app.simulatortrace' : 'com.occulert.app' } } } },
  };
  const observe = (kind, id, listener) => {
    const entry = { id, listener, removed: false }; observations[kind].push(entry);
    return { ready: Promise.resolve(null), remove() { entry.removed = true; } };
  };
  const deviceCondition = {
    MULTITASKING_CAMERA_MESSAGE: 'Face monitoring paused because the camera is unavailable during multitasking.',
    getDeviceCondition: async () => ({ thermalState: 'nominal' }),
    observeFrontCameraIdentity: (id, listener) => observe('identity', id, listener),
    observeCameraInterruptions: (id, listener) => observe('camera', id, listener),
    getCameraInterruptionState: async id => { await f.interruptionWait; return { deviceId: id, state: 'notAvailable', interrupted: null, reason: 'unknown', sequence: 0 }; },
  };
  function load(filename) {
    filename = path.resolve(nativeRoot, filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename === path.join(nativeRoot, 'lib/deviceCondition.ts')) return deviceCondition;
    const module = { exports: {} }; cache.set(filename, module);
    const source = readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Date: Clock, performance: { now: () => clock }, console: { info: value => events.proofs.push(value) },
      process: { env: { EXPO_PUBLIC_EYE_BASELINE_EXPERIMENT: experiment ? '1' : undefined } },
      setInterval: (work, delay) => { intervals.set(++timer, { work, delay }); return timer; }, clearInterval: id => intervals.delete(id),
      require: name => {
        if (Object.hasOwn(bridges, name)) return bridges[name];
        assert.ok(name.startsWith('.'), 'Unexpected hook dependency: ' + name);
        const candidate = path.resolve(path.dirname(filename), name), resolved = [candidate, candidate + '.ts', candidate + '.tsx'].find(existsSync);
        assert.ok(resolved, 'Resolve actual hook/model source: ' + name);
        return load(resolved);
      },
    }, { filename, timeout: 1_000 });
    return module.exports;
  }
  const { createMonitorPerformanceTracker } = load('lib/monitorPerformance.ts');
  const { createSensorFusionObservationTracker } = load('lib/sensorFusionObservation.ts');
  const { createCaptureTransitionGuard } = load('lib/captureLoadPolicy.ts');
  const { ParkedEyeBaseline } = load('lib/eyeBaselineModel.ts');
  const { HeadNodDetector } = load('lib/headNodDetector.ts');
  const { initialFrontCameraSwitchState } = load('lib/frontCameraSwitch.ts');
  const { initialCameraSetupAssessment } = load('lib/cameraSetup.ts');
  const owner = {
    isRunning: running, setupPreviewActive: preview, device: { id: 'front' }, cameraEpoch: 0, cameraCallbackOwner: 0,
    cameraIdentityActive: running || preview, cameraLoadPolicy: { mode: 'normal', reason: 'none', analysisIntervalMs: 100 },
    isRunningRef: ref(running), startingRef: ref(false), stoppingRef: ref(false), setupPreviewActiveRef: ref(preview),
    cameraScreenMountedRef: ref(true), multitaskingCameraPausedRef: ref(false), cameraInterruptionGenerationRef: ref(0),
    cameraCallbackOwnerRef: ref(0), cameraDeviceIdRef: ref('front'), cameraEpochRef: ref(0), cameraRestartCountRef: ref(0), cameraRecoveringRef: ref(false),
    captureTransitionRef: ref(createCaptureTransitionGuard()), lastSampleAtRef: ref(clock), hasCameraSampleRef: ref(true),
    frontCameraSwitchRef: ref(initialFrontCameraSwitchState()), frontCameraIdentityRef: ref(null),
    baselineGenerationRef: ref(0), cameraBaselineRevisionRef: ref(0), baselineCollectorRef: ref(new ParkedEyeBaseline()), baselineFinishedRef: ref(false),
    baselineCanSaveRef: ref(false), baselineBusyRef: ref(false), baselineMountedRef: ref(true), baselineLoaded: true, eyeBaseline: null,
    eyeBaselineRef: ref(null), sessionEyeBaselineRef: ref(null), lastCameraSetupUiAtRef: ref(0),
    headNodDetectorRef: ref(new HeadNodDetector()), headNodObservationsRef: ref(0),
    fatigueSamplesRef: ref(0), fatigueSumRef: ref(0), maxFatigueRef: ref(0), closedSinceRef: ref(null),
    displayedMetricsStateRef: ref('noFace'), displayedAlertLevelRef: ref('none'), lastMetricsUiAtRef: ref(0),
    performanceTrackerRef: ref(createMonitorPerformanceTracker()), sensorFusionTrackerRef: ref(createSensorFusionObservationTracker()),
    activeSessionIdRef: ref('local-original'), sessionStartedAtRef: ref(clock), sessionSensitivityRef: ref('medium'), simulatorProofRef: ref(''),
    alertCountRef: ref(0), prevAlertingRef: ref(false), cloudSessionRef: ref(Promise.resolve('cloud-original')), cloudEventQueueRef: ref(Promise.resolve()),
    headphoneHeadNodObservationsRef: ref(0), headphoneMotionSamplesRef: ref(0), headphoneMotionStatusRef: ref('unavailable'),
    setThermalState() {}, setSetupPreviewActive() {}, setCameraSetup() {}, setSensorFault: value => events.faults.push(value),
    setCameraRecovering() {}, setCameraEpoch: value => { owner.cameraEpoch = value; },
    setFrontCameraIdentity: value => events.identities.push(value), setEyeBaseline: value => { owner.eyeBaseline = value; },
    setBaselineMessage: value => events.messages.push(value), setBaselineBusy() {}, setBaselineLoaded() {}, setSensitivity() {}, setSensitivityLoaded() {},
    setAlertCount: count => events.counts.push(count), setMetrics: value => events.metrics.push(value),
    deliverMonitoringPausedCue: () => events.cues++,
    handleStopRef: ref(async options => { events.stops.push(options); owner.isRunningRef.current = false; owner.startingRef.current = false; }),
    loadDeviceEyeBaseline: async () => { await f.baselineWait; return .9; },
    clearDeviceEyeBaseline: async () => { events.clears++; await f.clearWait; }, loadSavedSensitivity: async () => 'medium', saveDeviceEyeBaseline: async () => {},
    saveActiveSessionCheckpoint: async value => { events.checkpoints.push(value); await f.checkpointWait; },
    queueNativeCloudAlert: () => null,
    logCloudAlert: async (id, score, occurredAt) => { await f.cloudWait; if (f.authorized) events.logs.push({ id, score, occurredAt }); return f.authorized; },
    processEyeOpenness: () => ({ ear: .3, perclos: 0, fatigueScore: 0, closedDurationMs: 0, state: 'open' }),
    processNoFace: () => ({ ear: .3, perclos: 0, fatigueScore: 0, closedDurationMs: 0, state: 'noFace' }),
    detectFaces: () => { f.detections++; return f.faces; },
  };
  const { useMonitorCloudAlerts } = load('hooks/useMonitorCloudAlerts.ts');
  const { useMonitorCheckpoint } = load('hooks/useMonitorCheckpoint.ts');
  const { useMonitorCameraIdentity } = load('hooks/useMonitorCameraIdentity.ts');
  const { useMonitorCameraLifecycle } = load('hooks/useMonitorCameraLifecycle.ts');
  const { useMonitorAnalysis } = load('hooks/useMonitorAnalysis.ts');
  function Probe() {
    const cloud = useMonitorCloudAlerts(owner), checkpoint = useMonitorCheckpoint(owner);
    const togglePreview = useMonitorCameraIdentity(owner);
    const camera = useMonitorCameraLifecycle(owner);
    const analysis = useMonitorAnalysis({ ...owner, recordCloudAlertTransition: cloud });
    latest = { cloud, checkpoint, camera, analysis, togglePreview };
    return React.createElement('MonitorHookFixture');
  }
  return Object.defineProperties(Object.assign(f, { owner, load,
    async at(time, action = () => {}) { clock = time; await act(async () => { await action(); }); },
    async mount() { await act(async () => { renderer = create(React.createElement(Probe)); }); },
    async update(values = {}) { Object.assign(owner, values); await act(async () => { renderer.update(React.createElement(Probe)); }); },
    async run(action) { await act(async () => { await action(); }); },
    async tick(delay) { await act(async () => { for (const interval of [...intervals.values()]) if (interval.delay === delay) await interval.work(); }); },
    async unmount() { owner.cameraScreenMountedRef.current = false; await act(async () => renderer.unmount()); },
  }), { api: { get: () => latest }, now: { get: () => clock } });
}
