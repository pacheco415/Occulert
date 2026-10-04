import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

function load(source, names, bindings) {
  const body = source.replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export /gm, '');
  const exports = {};
  vm.runInNewContext(`${stripTypeScriptTypes(body)}\nObject.assign(exports, {${names.join(',')}});`,
    { exports, ...React, ...bindings }, { timeout: 1000 });
  return exports;
}

// Run real React and Expo's installed shared-object/useAudioPlayer hooks. Only
// the native AudioPlayer/AVAudioSession bridge is substituted: its inactivity
// check follows expo-audio57's registry-wide guard, not a per-component timer.
function fixture() {
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
    seekTo() { return Promise.resolve(); }
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
