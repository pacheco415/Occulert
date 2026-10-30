import assert from 'node:assert/strict';
import { readNativeMonitorSourceOwners } from './monitor-source-owners.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import babel from '@babel/core';
import * as capturePolicy from '../../lib/captureLoadPolicy.ts';
import { canRestartStalledCamera, shouldRestartCamera } from '../../lib/cameraResilience.ts';
import { MULTITASKING_CAMERA_MESSAGE, unknownCameraInterruption } from '../../lib/cameraInterruptions.ts';
import { createMonitorPerformanceTracker } from '../../lib/monitorPerformance.ts';

const require = createRequire(import.meta.url);
const cameraRoot = path.dirname(require.resolve('react-native-vision-camera/package.json'));
const { useCameraFormat } = require(path.join(cameraRoot, 'lib/commonjs/hooks/useCameraFormat.js'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Actual capture TSX and the installed VisionCamera format hook; native view substituted. */
export function createCaptureCameraFixture({ device, onCaptureConfiguration = () => {}, ...initial }) {
  const calls = { mounts: 0, unmounts: 0 };
  function CameraProbe(props) {
    const identity = React.useRef({});
    React.useEffect(() => {
      calls.mounts++;
      return () => { calls.unmounts++; };
    }, []);
    return React.createElement('CameraFixture', { ...props, identity: identity.current });
  }
  const filename = new URL('../../components/MonitorCaptureCamera.tsx', import.meta.url).pathname;
  const jsx = babel.transformSync(readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }]],
  }).code;
  const code = ts.transpileModule(jsx, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const bridges = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native-vision-camera': { Camera: CameraProbe, useCameraFormat },
    '../lib/captureLoadPolicy': capturePolicy,
  };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: specifier => {
      assert.ok(Object.hasOwn(bridges, specifier), 'unexpected capture dependency: ' + specifier);
      return bridges[specifier];
    },
  }, { filename, timeout: 1000 });
  const { MonitorCaptureCamera } = module.exports;
  let props = {
    device, isActive: true, pixelFormat: 'yuv', resizeMode: 'contain',
    loadMode: 'normal', monitoring: true, experimentEnabled: false,
    onCaptureConfiguration, ...initial,
  };
  let renderer;
  const element = () => React.createElement(MonitorCaptureCamera, props);
  return {
    calls,
    get camera() { return renderer.root.findByType('CameraFixture'); },
    async mount() { await act(async () => { renderer = create(element()); }); },
    async update(next) { props = { ...props, ...next }; await act(async () => { renderer.update(element()); }); },
    async unmount() { await act(async () => { renderer.unmount(); }); },
  };
}

/** Execute the actual screen's configuration callback, recovery and watchdog. */
export function createCaptureWatchdogFixture({ readInterruption = async () => unknownCameraInterruption('front') } = {}) {
  const owners = readNativeMonitorSourceOwners();
  const callbacks = new Map(), sourceByNode = new WeakMap();
  let watchdogEffect;
  let lifetimeEffect;
  function visit(node, source) {
    if (!node || typeof node !== 'object') return;
    sourceByNode.set(node, source);
    if (node.type === 'VariableDeclarator' && node.init?.callee?.name === 'useCallback') callbacks.set(node.id.name, node.init.arguments[0]);
    if (node.type === 'CallExpression' && node.callee?.name === 'useEffect') {
      const callback = node.arguments[0];
      if (callback?.body?.body?.some(statement => statement.declarations?.some(declaration => declaration.id.name === 'watchdog'))) watchdogEffect = callback;
      if (callback?.body?.body?.some(statement => statement.expression?.left?.object?.name === 'cameraScreenMountedRef')) lifetimeEffect = callback;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(item => visit(item, source));
      else if (value && typeof value === 'object') visit(value, source);
    }
  }
  for (const { filename, source } of owners.cameraCallbacks) {
    const ast = babel.parseSync(source, { filename, babelrc: false, configFile: false, parserOpts: { plugins: ['typescript', 'jsx'] } });
    visit(ast, source);
  }
  let now = 1_000, tick;
  const tracker = createMonitorPerformanceTracker();
  tracker.recordSessionStart(now);
  const events = { epochs: [], faults: [], cues: 0, stops: 0, stopOptions: [] };
  const state = {
    stoppingRef: { current: false }, isRunningRef: { current: true },
    hasCameraSampleRef: { current: true }, lastSampleAtRef: { current: now },
    cameraRestartCountRef: { current: 0 }, cameraEpochRef: { current: 0 },
    cameraRecoveringRef: { current: false },
    cameraInterruptionGenerationRef: { current: 0 }, multitaskingCameraPausedRef: { current: false },
    cameraCallbackOwnerRef: { current: 0 },
    cameraScreenMountedRef: { current: true },
    cameraDeviceIdRef: { current: 'front' },
    setupPreviewActiveRef: { current: false }, startingRef: { current: false },
    baselineGenerationRef: { current: 0 }, baselineCollectorRef: { current: { reset() {} } },
    captureTransitionRef: { current: capturePolicy.createCaptureTransitionGuard() },
    performanceTrackerRef: { current: tracker },
  };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    ...state, exports: {}, Date: Clock, isRunning: true, canRestartStalledCamera, shouldRestartCamera,
    device: { id: 'front' }, getCameraInterruptionState: readInterruption, MULTITASKING_CAMERA_MESSAGE,
    setSetupPreviewActive() {}, setCameraSetup() {}, initialCameraSetupAssessment: () => ({}),
    Alert: { alert() {} },
    SENSOR_STALL_MS: 5_000, SENSOR_STARTUP_GRACE_MS: 10_000,
    setCameraRecovering() {}, setCameraEpoch: epoch => events.epochs.push(epoch),
    setSensorFault: message => events.faults.push(message),
    deliverMonitoringPausedCue: () => events.cues++,
    handleStopRef: { current: async options => {
      events.stops++;
      events.stopOptions.push(options);
      state.stoppingRef.current = true;
      state.isRunningRef.current = false;
      state.cameraInterruptionGenerationRef.current++;
      state.cameraCallbackOwnerRef.current++;
      state.captureTransitionRef.current.reset();
    } },
    setInterval: (callback, interval) => { assert.equal(interval, 500); tick = callback; return 1; },
    clearInterval: () => { tick = undefined; },
  });
  const loadCallback = node => {
    assert.ok(node, 'the actual MonitorScreen callback exists');
    const code = ts.transpileModule('exports.callback = ' + sourceByNode.get(node).slice(node.start, node.end), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInContext(code, context, { timeout: 1000 });
    return context.exports.callback;
  };
  const configure = loadCallback(callbacks.get('handleCaptureConfiguration'));
  context.handleCameraInterruption = loadCallback(callbacks.get('handleCameraInterruption'));
  context.checkCameraInterruption = loadCallback(callbacks.get('checkCameraInterruption'));
  context.attemptCameraRecovery = loadCallback(callbacks.get('attemptCameraRecovery'));
  const cameraError = loadCallback(callbacks.get('handleCameraError'));
  let disposeLifetime = loadCallback(lifetimeEffect)();
  const disposeWatchdog = loadCallback(watchdogEffect)();
  return {
    events, state, tracker,
    get now() { return now; },
    setNow(at) { now = at; },
    configure(change) { configure(change); },
    sample(at) { now = at; state.lastSampleAtRef.current = at; state.hasCameraSampleRef.current = true; tracker.recordSample(at, 1); },
    tick(at) { now = at; assert.ok(tick); return tick(); },
    error(code = 'unknown/unknown', epoch = state.cameraEpochRef.current, owner = state.cameraCallbackOwnerRef.current) { return cameraError({ code }, epoch, owner); },
    interrupt(value) { context.handleCameraInterruption(value); },
    replayLifetime() { disposeLifetime?.(); disposeLifetime = loadCallback(lifetimeEffect)(); },
    cleanup() { disposeWatchdog?.(); disposeLifetime?.(); },
  };
}
