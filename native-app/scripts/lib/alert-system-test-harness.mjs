import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import babel from '@babel/core';

const require = createRequire(import.meta.url);
const nativeRoot = new URL('../../', import.meta.url).pathname;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Run actual alert TSX, policy, delivery and player-ownership hook with native bridges substituted. */
export function createAlertSystemFixture({ inline = true, state = 'closed', closedDurationMs = 700, withLayout = false } = {}) {
  let now = 1_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const players = [], watchAlerts = [], watchStatuses = [], timings = [], haptics = [], levelChanges = [], scrolls = [];
  const calls = { preferenceLoads: 0, audioMode: 0, playerDisposals: 0, cameraMounts: 0 };
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
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
    ScrollView: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ scrollTo: value => scrolls.push(structuredClone(value)) }), []);
      return React.createElement('ScrollView', props);
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
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
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
  const { MonitorLayout } = withLayout ? load(path.join(nativeRoot, 'components/MonitorLayout.tsx')) : {};
  const onTimingEvent = event => timings.push(event);
  const onLevelChange = level => levelChanges.push(level);
  let props = {
    inline, isRunning: true, sessionStartedAt: now - 20_000, sessionEndedAt: null, onTimingEvent, onLevelChange,
    metrics: { state, closedDurationMs, perclos: 0, fatigueScore: 20 },
  };
  function CameraProbe() {
    React.useEffect(() => { calls.cameraMounts++; }, []);
    return React.createElement('CameraFixture');
  }
  function ConnectedAlert({ alertProps }) {
    const [visibleLevel, setVisibleLevel] = React.useState('none');
    const reportLevel = React.useCallback(level => {
      levelChanges.push(level);
      setVisibleLevel(level);
    }, []);
    return React.createElement(MonitorLayout, {
      camera: React.createElement(CameraProbe),
      header: React.createElement('Text', null, 'Monitor navigation'),
      primaryAction: React.createElement('Text', null, 'Stop'),
      attentionKey: visibleLevel,
      reduceMotion: false,
    }, React.createElement(AlertSystem, { ...alertProps, onLevelChange: reportLevel }));
  }
  const element = () => withLayout
    ? React.createElement(ConnectedAlert, { alertProps: props })
    : React.createElement(AlertSystem, props);
  let renderer;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const fixture = {
    players, watchAlerts, watchStatuses, timings, haptics, calls, levelChanges, scrolls,
    get root() { return renderer.root; },
    get banner() { return renderer.root.findByType('Animated.View'); },
    get playCount() { return players.reduce((sum, player) => sum + player.plays, 0); },
    text() { return JSON.stringify(renderer.toJSON()); },
    async mount() { await act(async () => { renderer = create(element()); await flush(); }); },
    async update({ metrics, ...next } = {}) {
      props = { ...props, ...next, metrics: { ...props.metrics, ...metrics } };
      await act(async () => { renderer.update(element()); await flush(); });
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
