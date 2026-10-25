import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import babel from '@babel/core';
import { monitorStyles, monitorGuidanceSource } from './monitor-presentation.mjs';

const require = createRequire(import.meta.url);
const nativeRoot = new URL('../../', import.meta.url).pathname;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Run actual alert TSX, policy, delivery and player-ownership hook with native bridges substituted. */
export function createAlertSystemFixture({ inline = true, state = 'closed', closedDurationMs = 700, withLayout = false, strictMode = false } = {}) {
  let dimensions = { width: 390, height: 844, fontScale: 1, scale: 3 };
  let insets = { top: 47, bottom: 34, left: 0, right: 0 };
  let headerHeight = null;
  let now = 1_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const players = [], watchAlerts = [], watchStatuses = [], timings = [], haptics = [], levelChanges = [], scrolls = [];
  const calls = { preferenceLoads: 0, audioMode: 0, playerDisposals: 0, cameraMounts: 0, cameraUnmounts: 0 };
  const preferences = { audioEnabled: true, hapticEnabled: true, inEarPattern: 'balanced', alertSound: 'standard' };
  class ClockDate extends Date { static now() { return now; } }
  class AnimatedValue {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
  }
  const animate = () => ({ start() {} });
  const schedule = (callback, delay, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay, interval: interval ? delay : 0 });
    return id;
  };
  const native = {
    View: 'View', Text: 'Text', StyleSheet: { create: value => value },
    Animated: { View: 'Animated.View', Value: AnimatedValue, timing: animate, sequence: animate },
    useWindowDimensions: () => dimensions,
    ScrollView: React.forwardRef((props, ref) => {
      const [offset, setOffset] = React.useState(0);
      React.useImperativeHandle(ref, () => ({ scrollTo: value => {
        scrolls.push(structuredClone(value));
        setOffset(value.y ?? 0);
      } }), []);
      return React.createElement('ScrollView', { ...props, contentOffset: { x: 0, y: offset }, onScrollFixture: setOffset });
    }),
  };
  function useAudioPlayer(source) {
    const player = React.useRef(null);
    if (!player.current) {
      const record = {
        source, plays: 0, pauses: 0, seeks: 0,
        pause() { this.pauses++; },
        play() { this.plays++; },
        async seekTo() { this.seeks++; },
      };
      player.current = record;
      players.push(record);
    }
    React.useEffect(() => () => { calls.playerDisposals++; }, []);
    return player.current;
  }
  const bridges = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => insets },
    'expo-audio': { useAudioPlayer },
    'expo-haptics': {
      NotificationFeedbackType: { Error: 'error', Warning: 'warning' },
      ImpactFeedbackStyle: { Medium: 'medium' },
      notificationAsync: async kind => { haptics.push(kind); },
      impactAsync: async kind => { haptics.push(kind); },
    },
  };
  const replaced = new Map([
    ['lib/watchBridge.ts', {
      sendAlertToWatch: async payload => { watchAlerts.push(payload); return { accepted: true, acknowledged: true, roundTripMs: 5 }; },
      sendMonitoringStatusToWatch: async payload => { watchStatuses.push(payload); },
    }],
    ['lib/audioSession.ts', { configureAlertAudioMode: async () => { calls.audioMode++; } }],
    ['lib/watchPreferences.ts', { getWatchAlertsEnabled: async () => true }],
    ['lib/alertPreferences.ts', {
      loadAlertPreferences: async () => { calls.preferenceLoads++; return preferences; },
      currentAlertPreferences: () => preferences,
    }],
    ['lib/alertSound.ts', { configureAlertSound() {} }],
    ['hooks/useAccessibilityPreferences.ts', { useAccessibilityPreferences: () => ({ reduceMotion: false }) }],
  ]);
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    const relative = path.relative(nativeRoot, filename);
    if (replaced.has(relative)) return replaced.get(relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith('.wav')) return filename;
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
    cache.set(filename, module);
    const localRequire = specifier => {
      if (Object.hasOwn(bridges, specifier)) return bridges[specifier];
      assert.ok(specifier.startsWith('.'), 'unexpected alert dependency: ' + specifier);
      const bare = path.resolve(path.dirname(filename), specifier);
      const resolved = [bare, bare + '.ts', bare + '.tsx'].find(candidate => existsSync(candidate));
      assert.ok(resolved, 'resolve actual alert source: ' + specifier);
      return load(resolved);
    };
    vm.runInNewContext(code, {
      module, exports: module.exports, require: localRequire, Date: ClockDate, console,
      setTimeout: (callback, delay) => schedule(callback, delay),
      clearTimeout: id => timers.delete(id),
      setInterval: (callback, delay) => schedule(callback, delay, true),
      clearInterval: id => timers.delete(id),
    }, { filename, timeout: 1000 });
    return module.exports;
  }
  const { AlertSystem } = load(path.join(nativeRoot, 'components/AlertSystem.tsx'));
  const { MonitorLayout, MonitorAlertPortal } = load(path.join(nativeRoot, 'components/MonitorLayout.tsx'));
  const guidanceModule = { exports: {} };
  const guidanceJsx = babel.transformSync(monitorGuidanceSource(), {
    filename: 'MonitorGuidanceFixture.tsx', babelrc: false, configFile: false,
    plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }]],
  }).code;
  const guidanceCode = ts.transpileModule(guidanceJsx, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(guidanceCode, {
    module: guidanceModule, exports: guidanceModule.exports, require: specifier => bridges[specifier],
    AlertSystem, View: native.View, Text: native.Text, s: monitorStyles,
    ...load(path.join(nativeRoot, 'lib/frontCameraSwitch.ts')),
  }, { filename: 'MonitorGuidanceFixture.tsx', timeout: 1000 });
  const { MonitorGuidance } = guidanceModule.exports;
  const onTimingEvent = event => timings.push(event);
  const onLevelChange = level => levelChanges.push(level);
  const overlayProbe = React.createElement('View', { testID: 'fixture-overlay-probe', style: { width: 1, height: 1 } });
  let props = {
    inline, isRunning: true, sessionStartedAt: now - 20_000, sessionEndedAt: null, onTimingEvent, onLevelChange,
    metrics: { state, closedDurationMs, perclos: 0, fatigueScore: 20 },
  };
  function CameraProbe() {
    const identity = React.useRef({});
    React.useEffect(() => {
      calls.cameraMounts++;
      return () => { calls.cameraUnmounts++; };
    }, []);
    return React.createElement('CameraFixture', {
      identity: identity.current, style: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    });
  }
  function ConnectedAlert({ alertProps }) {
    const [visibleLevel, setVisibleLevel] = React.useState('none');
    const reportLevel = React.useCallback(level => {
      levelChanges.push(level);
      setVisibleLevel(level);
    }, []);
    return React.createElement(MonitorLayout, {
      camera: React.createElement(CameraProbe),
      header: React.createElement('View', { style: headerHeight === null ? undefined : { height: headerHeight } },
        React.createElement('View', { style: monitorStyles.topBar },
        React.createElement('View', { style: monitorStyles.backBtn },
          React.createElement('View', { style: { width: 20, height: 20 } }),
          React.createElement('Text', { style: monitorStyles.backLbl }, 'Home')),
        React.createElement('View', { style: monitorStyles.settingsBtn }))),
      primaryAction: React.createElement('TouchableOpacity', {
        testID: 'fixture-stop', accessibilityRole: 'button', accessibilityLabel: 'Stop monitoring and save this drive',
        style: monitorStyles.stopBtn,
      }, React.createElement('Text', { style: monitorStyles.stopTxt }, 'STOP')),
      attentionKey: visibleLevel,
      reduceMotion: false,
    }, React.createElement(MonitorGuidance, { alertProps: { ...alertProps, onLevelChange: reportLevel } }),
    alertProps.overlayProbe && React.createElement(MonitorAlertPortal, null, overlayProbe),
    React.createElement('View', { style: { height: 1200 } }));
  }
  const element = () => {
    const content = withLayout
      ? React.createElement(ConnectedAlert, { alertProps: props })
      : React.createElement(AlertSystem, props);
    return strictMode ? React.createElement(React.StrictMode, null, content) : content;
  };
  let renderer;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const fixture = {
    players, watchAlerts, watchStatuses, timings, haptics, calls, levelChanges, scrolls,
    get root() { return renderer.root; },
    get tree() { return renderer.toJSON(); },
    get window() { return dimensions; },
    get safeArea() { return insets; },
    get cameraIdentity() { return renderer.root.findByType('CameraFixture').props.identity; },
    get banner() { return renderer.root.findByType('Animated.View'); },
    get playCount() { return players.reduce((sum, player) => sum + player.plays, 0); },
    text() { return JSON.stringify(renderer.toJSON()); },
    async mount() { await act(async () => { renderer = create(element()); await flush(); }); },
    async update({ metrics, window: nextWindow, safeArea: nextInsets, ...next } = {}) {
      dimensions = { ...dimensions, ...nextWindow };
      insets = { ...insets, ...nextInsets };
      props = { ...props, ...next, metrics: { ...props.metrics, ...metrics } };
      await act(async () => { renderer.update(element()); await flush(); });
    },
    async resizeHeader(height) {
      headerHeight = height;
      await act(async () => { renderer.update(element()); await flush(); });
    },
    async scrollDetails(y) {
      const details = renderer.root.find(node => typeof node.type === 'string' && node.props.testID === 'monitor-details');
      await act(async () => { details.props.onScrollFixture(y); await flush(); });
    },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(id);
        await act(async () => { timer.callback(); await flush(); });
      }
      now = end;
    },
    async unmount() { await act(async () => { renderer.unmount(); await flush(); }); },
  };
  return fixture;
}
