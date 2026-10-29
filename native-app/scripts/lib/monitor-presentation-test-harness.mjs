import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url).pathname;
export async function createMonitorPresentationFixture({ sourceOverride = null } = {}) {
  const events = [], cache = new Map(), calls = { cameraMounts: 0, cameraUnmounts: 0, wakeStarts: 0, wakeStops: 0 };
  function CameraProbe(props) {
    const identity = React.useRef({});
    React.useEffect(() => { calls.cameraMounts++; return () => { calls.cameraUnmounts++; }; }, []);
    return React.createElement('CameraFixture', { ...props, identity: identity.current });
  }
  const bridges = {
    react: React,
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', Modal: 'Modal', ScrollView: 'ScrollView', StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-keep-awake': { useKeepAwake: tag => React.useEffect(() => { calls.wakeStarts++; events.push(tag); return () => { calls.wakeStops++; }; }, [tag]) },
  };
  const children = { AlertSystem: 'AlertSystem', CameraSetupGuide: 'CameraSetupGuide', LiveMetrics: 'LiveMetrics', GlassSurface: 'GlassSurface',
    MonitorCaptureCamera: CameraProbe, MonitorLayout: props => React.createElement('MonitorLayout', {}, props.camera, props.header, props.primaryAction, props.children) };
  function load(filename) {
    filename = path.resolve(root, filename);
    const name = path.basename(filename).replace(/\.tsx$/, '');
    if (Object.hasOwn(children, name)) return { [name]: children[name] };
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = ts.transpileModule(filename.endsWith('/components/monitor/MonitorPresentation.tsx') && sourceOverride !== null ? sourceOverride : readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, process: { env: {} }, require: specifier => {
      if (Object.hasOwn(bridges, specifier)) return bridges[specifier];
      assert.ok(specifier.startsWith('.'), 'Unexpected presentation dependency: ' + specifier);
      const base = path.resolve(path.dirname(filename), specifier), resolved = [base, base + '.ts', base + '.tsx'].find(existsSync);
      assert.ok(resolved); return load(resolved);
    } }, { filename, timeout: 1_000 });
    return module.exports;
  }
  const { MonitorPresentation } = load('components/monitor/MonitorPresentation.tsx');
  let props = { device: { id: 'front' }, frameProcessor() {}, cameraLoadPolicy: { mode: 'normal', analysisIntervalMs: 100 }, cameraEpoch: 0, cameraCallbackOwner: 0,
    metrics: { state: 'open', fatigueScore: 0 }, alertCount: 0, frontCameraIdentity: null, isRunning: false, isStarting: false, isStopping: false,
    sensitivityLoaded: true, baselineLoaded: true, baselineBusy: false, cameraRecovering: false, setupPreviewActive: false,
    cameraSetup: { ready: false }, sensorFault: null, sessionStartedAt: null, sessionEndedAt: null, baselineMessage: '', reduceMotion: true,
    visibleAlertLevel: 'none', safeStopOpen: false, safeStopBusy: false,
    ...Object.fromEntries(['handleCaptureConfiguration', 'handleCameraError', 'setVisibleAlertLevel', 'recordAlertTiming', 'setSafeStopOpen', 'handleSafeStopChoice',
      'handleStart', 'handleStop', 'toggleSetupPreview', 'onHome', 'onSettings', 'onRecoveryHome'].map(name => [name, (...args) => { events.push({ name, args }); }])),
  };
  let renderer; await act(async () => { renderer = create(React.createElement(MonitorPresentation, props)); });
  return { calls, events, get root() { return renderer.root; },
    get tree() { return renderer.toJSON(); },
    async update(next) { props = { ...props, ...next }; await act(async () => renderer.update(React.createElement(MonitorPresentation, props))); },
    async press(label) { await act(async () => renderer.root.findByProps({ accessibilityLabel: label }).props.onPress()); },
    async close() { await act(async () => renderer.unmount()); },
  };
}

