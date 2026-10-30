import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import babel from '@babel/core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nativeRoot = new URL('../../', import.meta.url).pathname;
const HISTORY_KEY = 'occulert-session-history';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Real React, real TSX and pure/history storage modules; only platform bridges are substituted. */
export function createHistoryFixture({ sessions = [], sourceOverride = null, failReads = false } = {}) {
  const stored = new Map([[HISTORY_KEY, JSON.stringify(sessions)]]);
  const writes = [], alerts = [], shares = [], feedback = [], routes = [], scrolls = [];
  const cache = new Map();
  const now = new Date(2026, 9, 4, 12).getTime();
  class ClockDate extends Date {
    constructor(...args) { if (args.length === 0) super(now); else super(...args); }
    static now() { return now; }
  }
  let writeGate = null;
  let readFailure = failReads;
  let pendingCloud = { scope: null, count: 0, localIds: [] };
  let cloudCurrent = true;
  let cloudRetry = async () => {};
  const storage = {
    async getItem(key) {
      if (key === HISTORY_KEY && readFailure) throw Error('simulated storage read failure');
      return stored.get(key) ?? null;
    },
    async setItem(key, value) {
      if (key === HISTORY_KEY && writeGate) {
        const gate = writeGate;
        writeGate = null;
        await gate.promise;
      }
      writes.push({ key, value });
      stored.set(key, value);
    },
    async removeItem(key) { stored.delete(key); },
  };
  const router = { push: value => routes.push(value) };
  const native = {
    View: 'View', Text: 'Text', SafeAreaView: 'SafeAreaView', TouchableOpacity: 'TouchableOpacity',
    ActivityIndicator: 'ActivityIndicator', TextInput: 'TextInput',
    ScrollView: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ scrollTo: value => scrolls.push(value) }), []);
      return React.createElement('ScrollView', props);
    }),
    StyleSheet: { create: value => value },
    Alert: { alert: (...args) => alerts.push(args) },
    Share: { share: async payload => { shares.push(payload); return { action: 'sharedAction' }; } },
    Platform: { OS: 'ios' },
    Linking: { canOpenURL: async () => true, openURL: async value => { feedback.push(value); } },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  };
  const bridges = {
    react: React,
    'react-native': native,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    'expo-router': { useRouter: () => router, useFocusEffect: callback => React.useEffect(callback, [callback]) },
    'expo-constants': { __esModule: true, default: { expoConfig: { version: 'test' }, nativeAppVersion: 'test', nativeBuildVersion: 'fixture' } },
  };
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename === path.join(nativeRoot, 'components/GlassSurface.tsx')) return { AmbientBackground: 'AmbientBackground' };
    if (filename === path.join(nativeRoot, 'lib/cloudSync.ts')) return {
      getPendingCloudSummaryState: async () => pendingCloud,
      pendingCloudSummaryStateIsCurrent: state => cloudCurrent && state === pendingCloud,
      retryPendingCloudSessions: scope => cloudRetry(scope),
    };
    const source = filename === path.join(nativeRoot, 'app/history.tsx') && sourceOverride != null
      ? sourceOverride : readFileSync(filename, 'utf8');
    const jsx = babel.transformSync(source, {
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
      if (specifier === 'react/jsx-runtime') return require(specifier);
      if (Object.hasOwn(bridges, specifier)) return bridges[specifier];
      assert.ok(specifier.startsWith('.'), 'unexpected platform dependency: ' + specifier);
      const bare = path.resolve(path.dirname(filename), specifier);
      const resolved = [bare, bare + '.ts', bare + '.tsx', bare + '.js'].find(candidate => existsSync(candidate));
      assert.ok(resolved, 'resolve actual local source: ' + specifier);
      return load(resolved);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, Date: ClockDate, console, setTimeout, clearTimeout, URL, URLSearchParams }, { filename, timeout: 1000 });
    return module.exports;
  }
  const Screen = load(path.join(nativeRoot, 'app/history.tsx')).default;
  let renderer;
  const flush = async () => {
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
  };
  const api = {
    stored, writes, alerts, shares, feedback, routes, scrolls, load, flush,
    get root() { return renderer.root; },
    get renderer() { return renderer; },
    async mount() { await act(async () => { renderer = create(React.createElement(Screen)); }); await flush(); },
    async unmount() { await act(async () => { renderer.unmount(); }); },
    async invoke(node, name = 'onPress', ...args) {
      let result;
      await act(async () => { result = node.props[name](...args); for (let i = 0; i < 20; i++) await Promise.resolve(); });
      return { result };
    },
    button(label) { return renderer.root.findByProps({ accessibilityLabel: label }); },
    text() { return JSON.stringify(renderer.toJSON()); },
    records() {
      const value = JSON.parse(stored.get(HISTORY_KEY));
      return Array.isArray(value) ? value : value.sessions;
    },
    card(id) {
      const { HistorySessionCard } = load(path.join(nativeRoot, 'components/history/HistorySessionCard.tsx'));
      return renderer.root.findAllByType(HistorySessionCard).find(node => node.props.item.sessionId === id);
    },
    holdHistoryWrite() {
      assert.equal(writeGate, null);
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      writeGate = { promise };
      return { resolve, reject };
    },
    setReadFailure(value) { readFailure = value; },
    setPendingCloud(state, current = true) { pendingCloud = state; cloudCurrent = current; },
    setCloudCurrent(value) { cloudCurrent = value; },
    setCloudRetry(fn) { cloudRetry = fn; },
    replaceSavedSessions(value) { stored.set(HISTORY_KEY, JSON.stringify(value)); },
  };
  return api;
}

export const COMPLETE_REVIEW = Object.freeze({
  sensitivity: 'medium', alertAssessment: 'accurate',
  testConditions: { lighting: 'daylight', eyewear: 'none', phonePosition: 'center' },
  deviceImpact: { batteryImpact: 'low', phoneHeat: 'cool' },
});

export function mixedSessions() {
  return [
    { ...COMPLETE_REVIEW, sessionId: 'short', savedAt: new Date(2026, 9, 4, 8).toISOString(), durationSec: 90, alertCount: 0, avgFatigue: 0, privateNote: 'do-not-export' },
    { sensitivity: 'medium', sessionId: 'long', savedAt: new Date(2026, 9, 3, 8).toISOString(), durationSec: 300, alertCount: 3, avgFatigue: null, testConditions: { lighting: 'low_light' } },
    { ...COMPLETE_REVIEW, sessionId: 'recovered', savedAt: new Date(2026, 9, 2, 8).toISOString(), recoveredFromInterruption: true, durationSec: 20 },
  ];
}
