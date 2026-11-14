import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { strings, formatString } from '../lib/strings.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

function load(source, names, bindings) {
  const body = source.replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export /gm, '');
  const exports = {};
  vm.runInNewContext(`${stripTypeScriptTypes(body, { mode: 'transform' })}\nObject.assign(exports, {${names.join(',')}});`,
    { exports, ...React, ...bindings, strings, formatString }, { timeout: 1000 });
  return exports;
}

// Run real React and Expo's installed shared-object/useAudioPlayer hooks. Only
// the native AudioPlayer/AVAudioSession bridge is substituted: its inactivity
// check follows expo-audio58's registry-wide guard, not a per-component timer.
function fixture({ seekTo = () => Promise.resolve(), beforePlay = () => {} } = {}) {
  const log = [], players = [], pendingRelease = [];
  let sessionActive = false;
  function requestRelease() {
    pendingRelease.push(() => {
      if (players.some(player => !player.released && player.playing)) return;
      sessionActive = false;
      log.push('session-inactive');
    });
  }
  class Player {
    constructor(source, _interval, keepActive) {
      Object.assign(this, { source, keepActive, playing: false, released: false });
      players.push(this);
    }
    pause() {
      assert.equal(this.released, false, 'pause must run before the SharedObject is released');
      this.playing = false;
      log.push(`pause:${this.source}`);
      if (!this.keepActive) requestRelease();
    }
    play() {
      assert.equal(this.released, false);
      beforePlay(this);
      sessionActive = true;
      this.playing = true;
      log.push(`play:${this.source}`);
    }
    finish() {
      this.playing = false;
      if (!this.keepActive) requestRelease();
    }
    release() {
      this.released = true;
      this.playing = false;
      log.push(`release:${this.source}`);
      // Expo's SharedObject teardown removes/pauses without deactivating.
    }
    seekTo() { return seekTo(this); }
    setPlaybackRate(rate) { this.playbackRate = rate; }
  }
  const { useReleasingSharedObjectWithLifecycle } = load(
    read('../node_modules/expo-modules-core/src/hooks/useReleasingSharedObjectWithLifecycle.ts'),
    ['useReleasingSharedObjectWithLifecycle'], {},
  );
  const { useReleasingSharedObject } = load(
    read('../node_modules/expo-modules-core/src/hooks/useReleasingSharedObject.ts'),
    ['useReleasingSharedObject'], { useReleasingSharedObjectWithLifecycle },
  );
  const expoSource = read('../node_modules/expo-audio/src/ExpoAudio.ts');
  const start = expoSource.indexOf('export function useAudioPlayer(');
  const end = expoSource.indexOf('\n/**', start);
  assert.ok(start > 0 && end > start, 'load the installed production player hook');
  const { useAudioPlayer } = load(expoSource.slice(start, end), ['useAudioPlayer'], {
    AudioModule: { AudioPlayer: Player }, useReleasingSharedObject,
    resolveSource: source => source,
  });
  const { useAlertAudioPlayer } = load(read('../hooks/useAlertAudioPlayer.ts'),
    ['useAlertAudioPlayer'], { useAudioPlayer });
  return {
    useAlertAudioPlayer, log, players,
    get sessionActive() { return sessionActive; },
    settleNativeRelease() { pendingRelease.splice(0).forEach(finish => finish()); },
  };
}

async function mount(f, sources) {
  const handles = new Map();
  function Cue({ source }) {
    handles.set(source, f.useAlertAudioPlayer(source));
    return null;
  }
  const element = values => React.createElement(React.Fragment, null,
    ...values.map(source => React.createElement(Cue, { key: source, source })));
  let renderer;
  await act(() => { renderer = create(element(sources)); });
  return {
    handles,
    async update(next) { await act(() => renderer.update(element(next))); },
    async unmount() { await act(() => renderer.unmount()); },
  };
}

test('layout cleanup pauses all owned alert players before real Expo passive disposal', async () => {
  const f = fixture(), sources = ['balanced', 'left', 'right', 'monitoring-paused', 'parked-test'];
  const view = await mount(f, sources);
  assert.ok(f.players.every(player => player.keepActive === false));
  for (const source of sources) view.handles.get(source).player.play();
  await view.unmount();
  for (const source of sources) {
    const pausedAt = f.log.indexOf(`pause:${source}`), releasedAt = f.log.indexOf(`release:${source}`);
    assert.ok(pausedAt >= 0 && releasedAt >= 0 && pausedAt < releasedAt, source);
    assert.equal(view.handles.get(source).isCurrent(), false);
  }
  f.settleNativeRelease();
  assert.equal(f.sessionActive, false);
});

test('an old screen cleanup cannot release a newer audible cue', async () => {
  const f = fixture(), view = await mount(f, ['old']);
  view.handles.get('old').player.play();
  await view.update(['new']);
  const newest = view.handles.get('new');
  newest.player.play();
  f.settleNativeRelease();
  assert.equal(f.sessionActive, true);
  assert.equal(newest.player.playing, true);
  newest.player.finish();
  f.settleNativeRelease();
  assert.equal(f.sessionActive, false);
  await view.unmount();
});

test('overlapping directional and paused warnings retain audio only while a cue is playing', async () => {
  const f = fixture(), view = await mount(f, ['left', 'right', 'monitoring-paused']);
  const left = view.handles.get('left').player;
  const right = view.handles.get('right').player;
  const paused = view.handles.get('monitoring-paused').player;
  left.play();
  right.play();
  left.pause();
  f.settleNativeRelease();
  assert.equal(f.sessionActive, true);
  paused.play();
  right.finish();
  f.settleNativeRelease();
  assert.equal(paused.playing, true, 'background loss must not cut off its audible warning');
  paused.finish();
  f.settleNativeRelease();
  assert.equal(f.sessionActive, false);
  right.play();
  assert.equal(f.sessionActive, true, 'a later cue must reactivate after idle release');
  await view.unmount();
});

test('a pending monitoring-paused seek cannot play after unmount', async () => {
  const f = fixture(), view = await mount(f, ['monitoring-paused']);
  const { player: monitoringPausedPlayer, isCurrent: monitoringPausedPlayerIsCurrent } = view.handles.get('monitoring-paused');
  let finishSeek;
  monitoringPausedPlayer.seekTo = () => new Promise(resolve => { finishSeek = resolve; });
  const monitor = read('../app/monitor.tsx');
  const start = monitor.indexOf('  const deliverMonitoringPausedCue =');
  const end = monitor.indexOf('\n  const recordAlertTiming', start);
  assert.ok(start > 0 && end > start);
  const { deliverCueIfCurrent } = load(read('../lib/alertDelivery.ts'),
    ['deliverCueIfCurrent'], {});
  let deliver;
  function Callback() {
    const loaded = load(monitor.slice(start, end), ['deliverMonitoringPausedCue'], {
      currentAlertPreferences: () => ({ audioEnabled: true, hapticEnabled: false }),
      monitoringPausedPlayer, monitoringPausedPlayerIsCurrent, deliverCueIfCurrent,
    });
    deliver = loaded.deliverMonitoringPausedCue;
    return null;
  }
  let callbackView;
  await act(() => { callbackView = create(React.createElement(Callback)); });
  deliver();
  assert.equal(typeof finishSeek, 'function');
  await view.unmount();
  finishSeek();
  await act(async () => {});
  assert.equal(f.log.includes('play:monitoring-paused'), false);
  f.settleNativeRelease();
  assert.equal(f.sessionActive, false);
  await act(() => callbackView.unmount());
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Mount the actual AlertSystem TSX with its real policy, delivery, sound and
// installed Expo player hooks. Only native bridges and the clock are fixtures.
async function alertSystemFixture({
  preferences = {}, notification = () => Promise.resolve(), seekTo,
  beforePlay, watchEnabled = false, onOutput, observe = true, metrics = {},
} = {}) {
  const f = fixture({ seekTo, beforePlay });
  const accepted = [], haptics = [], watchAlerts = [], timings = [];
  let now = 20_000, timerId = 0;
  const timers = new Map();
  const timeout = (callback, delay, repeat = 0) => {
    const id = ++timerId;
    timers.set(id, { callback, at: now + delay, repeat });
    return id;
  };
  const settings = { audioEnabled: true, hapticEnabled: true,
    inEarPattern: 'balanced', alertSound: 'classic', ...preferences };
  const { deriveAlertLevel, shouldDeliverAlert, SENSOR_LOSS_GRACE_MS } = load(
    read('../lib/alertPolicy.ts'), ['deriveAlertLevel', 'shouldDeliverAlert', 'SENSOR_LOSS_GRACE_MS'], {});
  const { alertDeliveryPlan, deliverCueIfCurrent } = load(
    read('../lib/alertDelivery.ts'), ['alertDeliveryPlan', 'deliverCueIfCurrent'], {});
  const { nextAlertAudioChannel } = load(read('../lib/inEarAlerts.ts'), ['nextAlertAudioChannel'], {});
  const { configureAlertSound } = load(read('../lib/alertSound.ts'),
    ['configureAlertSound'], {});
  const thresholds = load(read('../constants/thresholds.ts'),
    ['ALERT_COOLDOWN_MS', 'CRITICAL_CLOSED_ALERT_MS', 'PERCLOS_ALERT_THRESHOLD'], {});
  class AnimatedValue { stopAnimation() {} setValue() {} }
  const bridges = {
    react: React,
    '../lib/strings.ts': { strings, formatString },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: value => value },
      Animated: { Value: AnimatedValue, View: 'AnimatedView',
        timing: () => ({}), sequence: () => ({ start() {} }) } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0 }) },
    'expo-haptics': {
      NotificationFeedbackType: { Error: 'critical', Warning: 'warning' },
      ImpactFeedbackStyle: { Medium: 'medium' },
      notificationAsync: level => { haptics.push({ level, at: now }); return notification(level); },
      impactAsync: level => { haptics.push({ level, at: now }); return Promise.resolve(); },
    },
    '../hooks/useAlertAudioPlayer': { useAlertAudioPlayer: f.useAlertAudioPlayer },
    '../lib/watchBridge': {
      sendAlertToWatch: event => { watchAlerts.push(event); return Promise.resolve({ accepted: true, acknowledged: true, roundTripMs: 1 }); },
      sendMonitoringStatusToWatch: () => Promise.resolve(),
    },
    '../lib/audioSession': { configureAlertAudioMode: () => Promise.resolve() },
    '../lib/watchPreferences': { getWatchAlertsEnabled: () => Promise.resolve(watchEnabled) },
    '../lib/inEarAlerts': { nextAlertAudioChannel },
    '../lib/alertPreferences': { currentAlertPreferences: () => settings, loadAlertPreferences: () => Promise.resolve() },
    '../lib/alertSound': { configureAlertSound },
    '../constants/thresholds': thresholds,
    '../lib/alertPolicy': { deriveAlertLevel, shouldDeliverAlert, SENSOR_LOSS_GRACE_MS },
    '../lib/alertDelivery': { alertDeliveryPlan, deliverCueIfCurrent },
    '../hooks/useAccessibilityPreferences': { useAccessibilityPreferences: () => ({ reduceMotion: true }) },
    './MonitorLayout': { MonitorAlertPortal: ({ children }) => children, useMonitorAlertDock: () => false },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(read('../components/AlertSystem.tsx'), {
    fileName: 'AlertSystem.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date: { now: () => now },
    setTimeout: (callback, delay) => timeout(callback, delay), clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => timeout(callback, delay, delay), clearInterval: id => timers.delete(id),
    require: name => {
      if (name.startsWith('../assets/')) return name;
      assert.ok(Object.hasOwn(bridges, name), 'Unexpected AlertSystem dependency: ' + name);
      return bridges[name];
    },
  }, { timeout: 1_000 });
  const { AlertSystem } = module.exports;
  let props = { inline: true, metrics: { state: 'closed', perclos: 0.2,
    fatigueScore: 90, closedDurationMs: 1_500, ...metrics }, isRunning: true,
    sessionStartedAt: 1_000, sessionEndedAt: null,
    onTimingEvent: event => timings.push(event),
    ...(observe ? { onCriticalOutputAccepted: event => {
      accepted.push(JSON.parse(JSON.stringify(event)));
      onOutput?.(event);
    } } : {}),
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AlertSystem, props)); });
  return {
    ...f, accepted, haptics, watchAlerts, timings,
    setNow(value) { now = value; },
    async update(next) {
      props = { ...props, ...next, metrics: { ...props.metrics, ...next.metrics } };
      await act(async () => renderer.update(React.createElement(AlertSystem, props)));
    },
    async advance(to) {
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= to)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at;
        if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
        await act(async () => { timer.callback(); });
      }
      now = to;
    },
    async unmount() { await act(async () => renderer.unmount()); },
  };
}

test('actual critical phone outputs report successful software acceptance with one decision identity across repeats', async () => {
  const f = await alertSystemFixture();
  try {
    await f.advance(21_800);
    assert.equal(f.accepted.length, 6);
    assert.equal(new Set(f.accepted.map(event => event.decisionId)).size, 1);
    assert.ok(f.accepted[0].decisionId > 0);
    assert.ok(f.accepted.every(event => event.level === 'critical' && event.decisionAt === 20_000));
    assert.deepEqual(f.accepted.filter(event => event.channel === 'phone-haptic').map(event => event.acceptedAt), [20_000, 20_350, 20_700]);
    assert.deepEqual(f.accepted.filter(event => event.channel === 'phone-audio').map(event => event.acceptedAt), [20_000, 20_900, 21_800]);
    assert.equal(f.log.filter(item => item.startsWith('play:')).length, 3);
    assert.equal(f.haptics.length, 3);
  } finally { await f.unmount(); }
});

test('actual lower-level phone cues and Watch-only acceptance never report a critical phone output', async () => {
  for (const metrics of [{ state: 'watch' }, { state: 'closed', perclos: 0, closedDurationMs: 600 }, { state: 'noFace' }]) {
    const f = await alertSystemFixture({ metrics });
    try {
      await f.advance(23_000);
      assert.ok(f.haptics.length > 0);
      assert.equal(f.accepted.length, 0);
    } finally { await f.unmount(); }
  }
  const f = await alertSystemFixture({ preferences: { audioEnabled: false, hapticEnabled: false }, watchEnabled: true });
  try {
    assert.equal(f.watchAlerts.length, 1);
    assert.equal(f.accepted.length, 0);
    assert.equal(f.haptics.length, 0);
    assert.equal(f.log.some(item => item.startsWith('play:')), false);
  } finally { await f.unmount(); }
});

test('failed haptics, seek rejection and throwing play never report accepted output', async () => {
  for (const options of [
    { preferences: { audioEnabled: false }, notification: () => Promise.reject(new Error('native haptic rejected')) },
    { preferences: { hapticEnabled: false }, seekTo: () => Promise.reject(new Error('seek rejected')) },
    { preferences: { hapticEnabled: false }, beforePlay: () => { throw new Error('native play threw'); } },
  ]) {
    const f = await alertSystemFixture(options);
    try { await f.advance(21_800); assert.equal(f.accepted.length, 0); }
    finally { await f.unmount(); }
  }
});

test('pending critical haptic success cannot report after Stop, a new session or unmount', async () => {
  for (const boundary of ['stop', 'session', 'unmount']) {
    const pending = deferred();
    const f = await alertSystemFixture({ preferences: { audioEnabled: false }, notification: () => pending.promise });
    if (boundary === 'stop') await f.update({ isRunning: false });
    else if (boundary === 'session') await f.update({ sessionStartedAt: 2_000 });
    else await f.unmount();
    pending.resolve(); await act(async () => {});
    assert.equal(f.accepted.length, 0, boundary);
    if (boundary !== 'unmount') await f.unmount();
  }
});

test('pending critical audio seek cannot report after Stop, a new session or unmount', async () => {
  for (const boundary of ['stop', 'session', 'unmount']) {
    const pending = deferred();
    const f = await alertSystemFixture({ preferences: { hapticEnabled: false }, seekTo: () => pending.promise });
    if (boundary === 'stop') await f.update({ isRunning: false });
    else if (boundary === 'session') await f.update({ sessionStartedAt: 2_000 });
    else await f.unmount();
    pending.resolve(); await act(async () => {});
    assert.equal(f.accepted.length, 0, boundary);
    if (boundary !== 'session') assert.equal(f.log.some(item => item.startsWith('play:')), false, boundary);
    if (boundary !== 'unmount') await f.unmount();
  }
});

test('a newer actual cue decision rejects older pending haptic and audio success', async () => {
  const haptics = [], seeks = [];
  const f = await alertSystemFixture({
    notification: () => { const pending = deferred(); haptics.push(pending); return pending.promise; },
    seekTo: () => { const pending = deferred(); seeks.push(pending); return pending.promise; },
  });
  try {
    f.setNow(28_001);
    await f.update({ metrics: { perclos: 0.21 } });
    assert.equal(haptics.length, 2); assert.equal(seeks.length, 2);
    haptics[0].resolve(); seeks[0].resolve(); await act(async () => {});
    assert.equal(f.accepted.length, 0);
    haptics[1].resolve(); seeks[1].resolve(); await act(async () => {});
    assert.equal(f.accepted.length, 2);
    assert.ok(f.accepted.every(event => event.decisionAt === 28_001));
    assert.equal(new Set(f.accepted.map(event => event.decisionId)).size, 1);
    assert.equal(f.log.filter(item => item.startsWith('play:')).length, 1);
  } finally { await f.unmount(); }
});

test('an absent or throwing observer cannot change actual critical phone output sequencing', async () => {
  for (const options of [{ observe: false }, { onOutput: () => { throw new Error('observer rejected'); } }]) {
    const f = await alertSystemFixture(options);
    try {
      await f.advance(21_800);
      assert.equal(f.haptics.length, 3);
      assert.equal(f.log.filter(item => item.startsWith('play:')).length, 3);
      assert.equal(f.accepted.length, options.observe === false ? 0 : 6);
    } finally { await f.unmount(); }
  }
});
