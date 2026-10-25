import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlertSystemFixture } from './lib/alert-system-test-harness.mjs';
import { flattenStyle } from './lib/monitor-layout-test-harness.mjs';
import { duoWindows } from './lib/duo-layout-fixtures.mjs';
import { assertVisible, measureLayout } from './lib/measure-layout.mjs';

test('actual inline warnings keep their full instructions in document flow without scale transforms', async () => {
  const f = createAlertSystemFixture({ state: 'watch' });
  await f.mount();
  try {
    const assertInline = (title, instruction) => {
      assert.equal(f.banner.props.accessibilityRole, 'alert');
      assert.equal(f.banner.props.accessibilityLabel, title);
      assert.match(f.text(), instruction);
      const style = flattenStyle(f.banner.props.style);
      assert.equal(style.position, undefined);
      assert.equal(style.top, undefined);
      assert.equal(style.transform, undefined);
    };
    assertInline('Eyes drooping', /Drowsiness may be starting\. Plan a safe stop\./);
    await f.update({ metrics: { state: 'closed', closedDurationMs: 700 } });
    assertInline('DROWSINESS DETECTED', /Pull over at the next safe place\./);
    await f.update({ metrics: { closedDurationMs: 1_500 } });
    assertInline('PULL OVER NOW', /High fatigue detected\. Pull over safely and rest now\./);
    await f.update({ metrics: { state: 'noFace', closedDurationMs: 0 } });
    await f.advance(3_000);
    assertInline('TRACKING LOST', /Pull over safely before adjusting the phone or camera\./);
  } finally { await f.unmount(); }
});

test('changing only banner placement preserves players, alert cooldown and the pending cue sequence', async () => {
  const f = createAlertSystemFixture({ inline: false });
  await f.mount();
  try {
    assert.equal(flattenStyle(f.banner.props.style).position, 'absolute');
    assert.ok(flattenStyle(f.banner.props.style).transform);
    assert.equal(f.players.length, 3);
    assert.equal(f.playCount, 1);
    assert.equal(f.watchAlerts.length, 1);
    const originalPlayers = [...f.players];
    const initialHaptics = f.haptics.length;
    await f.update({ inline: true });
    assert.equal(flattenStyle(f.banner.props.style).position, undefined);
    assert.equal(flattenStyle(f.banner.props.style).transform, undefined);
    assert.deepEqual(f.players, originalPlayers);
    assert.equal(f.playCount, 1);
    assert.equal(f.watchAlerts.length, 1);
    assert.equal(f.haptics.length, initialHaptics);
    assert.equal(f.timings.filter(event => event.kind === 'decision').length, 1);
    assert.equal(f.calls.preferenceLoads, 1);
    assert.equal(f.calls.audioMode, 1);
    assert.equal(f.calls.playerDisposals, 0);
    await f.advance(900);
    assert.equal(f.playCount, 2, 'the original delayed second cue still delivers exactly once');
    assert.equal(f.haptics.length, 2);
    await f.update({ inline: false });
    await f.update({ inline: true });
    assert.equal(f.playCount, 2);
    assert.equal(f.watchAlerts.length, 1);
    assert.equal(f.calls.playerDisposals, 0);
  } finally { await f.unmount(); }
  assert.equal(f.calls.playerDisposals, 3);
});

test('stopping an inline alert cancels delayed cues and ends the same Watch monitoring session', async () => {
  const f = createAlertSystemFixture({ closedDurationMs: 1_500 });
  await f.mount();
  try {
    assert.equal(f.playCount, 1);
    assert.equal(f.watchStatuses.at(-1).running, true);
    await f.update({ isRunning: false });
    assert.equal(f.root.findAllByType('Animated.View').length, 0);
    const stoppedHaptics = f.haptics.length;
    await f.advance(2_000);
    assert.equal(f.playCount, 1);
    assert.equal(f.haptics.length, stoppedHaptics);
    assert.equal(f.watchStatuses.at(-1).running, false);
    assert.equal(f.timings.filter(event => event.kind === 'decision').length, 1);
  } finally { await f.unmount(); }
});

test('same-state alert escalation publishes its visible level and scrolls the actual layout to the new warning', async () => {
  const f = createAlertSystemFixture({ withLayout: true });
  await f.mount();
  try {
    assert.deepEqual(f.levelChanges, ['alert']);
    const beforeEscalation = f.scrolls.length;
    await f.update({ metrics: { closedDurationMs: 1_500 } });
    assert.deepEqual(f.levelChanges, ['alert', 'critical']);
    assert.equal(f.banner.props.accessibilityLabel, 'PULL OVER NOW');
    assert.equal(f.scrolls.length, beforeEscalation + 1);
    assert.deepEqual(f.scrolls.at(-1), { y: 0, animated: true });
    assert.equal(f.calls.cameraMounts, 1);
    const decisions = f.timings.filter(event => event.kind === 'decision').length;
    const attentionScrolls = f.scrolls.length;
    await f.update({ metrics: { closedDurationMs: 1_600, fatigueScore: 80 } });
    assert.equal(f.scrolls.length, attentionScrolls);
    assert.deepEqual(f.levelChanges, ['alert', 'critical']);
    assert.equal(f.timings.filter(event => event.kind === 'decision').length, decisions);
    assert.equal(f.calls.cameraMounts, 1);
  } finally { await f.unmount(); }
});

test('tracking loss after its grace period publishes attention without requiring a new eye state', async () => {
  const f = createAlertSystemFixture({ withLayout: true, state: 'noFace', closedDurationMs: 0 });
  await f.mount();
  try {
    assert.deepEqual(f.levelChanges, ['none']);
    const beforeWarning = f.scrolls.length;
    await f.advance(2_999);
    assert.deepEqual(f.levelChanges, ['none']);
    assert.equal(f.scrolls.length, beforeWarning);
    await f.advance(1);
    assert.deepEqual(f.levelChanges, ['none', 'tracking']);
    assert.equal(f.banner.props.accessibilityLabel, 'TRACKING LOST');
    assert.equal(f.scrolls.length, beforeWarning + 1);
    assert.deepEqual(f.scrolls.at(-1), { y: 0, animated: true });
    assert.equal(f.calls.cameraMounts, 1);
    assert.equal(f.timings.filter(event => event.kind === 'decision').length, 1);
    await f.update({ metrics: { fatigueScore: 0 } });
    assert.equal(f.scrolls.length, beforeWarning + 1);
    assert.deepEqual(f.levelChanges, ['none', 'tracking']);
  } finally { await f.unmount(); }
});

test('floating banner follows safe areas and the measured header through resizing without replaying alerts', async () => {
  const f = createAlertSystemFixture({ withLayout: true, inline: false });
  await f.mount();
  try {
    const players = [...f.players];
    const camera = f.cameraIdentity;
    const initialDecisions = f.timings.filter(event => event.kind === 'decision').length;
    for (const [index, fixture] of duoWindows.entries()) {
      await f.update(fixture);
      const measuredHeaderHeight = index % 2 ? 94 : 70;
      await f.resizeHeader(measuredHeaderHeight);
      const frames = measureLayout(f.tree, f.window);
      const alert = frames.get('alert');
      assert.equal(flattenStyle(f.banner.props.style).transform, undefined, 'normal-flow dock does not scale beyond its reserved bounds');
      assertVisible(alert, `${fixture.name}: floating warning`);
      const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= .34, `${actual} follows viewport coordinate ${expected}`);
      const header = frames.get('monitor-header');
      close(header.height, measuredHeaderHeight);
      close(alert.y, header.y + header.height);
      close(alert.x, fixture.safeArea.left + 16);
      close(alert.x + alert.width, fixture.window.width - fixture.safeArea.right - 16);
      assert.equal(alert.clips.length, 1, 'header warning is outside the scrolling/clipping details');
      await f.scrollDetails(200);
      assert.deepEqual(measureLayout(f.tree, f.window).get('alert'), alert, 'details scrolling cannot move a viewport overlay');
      const host = f.root.find(node => typeof node.type === 'string' && node.props.testID === 'monitor-alert-overlay');
      assert.equal(host.props.pointerEvents, 'box-none');
      assert.equal(f.banner.props.pointerEvents, 'none', 'the informational overlay passes taps through');
      assert.deepEqual(f.players, players);
      assert.strictEqual(f.cameraIdentity, camera);
      assert.equal(f.timings.filter(event => event.kind === 'decision').length, initialDecisions);
    }
    assert.equal(f.calls.cameraMounts, 1);
    assert.equal(f.calls.cameraUnmounts, 0);
    assert.equal(f.playCount, 1, 'placement changes do not replay the immediate cue');
    await f.advance(900);
    assert.equal(f.playCount, 2, 'the original pending second cue still delivers');
  } finally { await f.unmount(); }
});

for (const inline of [true, false]) test(`Duo ${inline ? 'inline' : 'header'} warning and Stop fit every display and split allocation`, async () => {
  const f = createAlertSystemFixture({ withLayout: true, inline, closedDurationMs: 1_500 });
  await f.mount();
  try {
    const camera = f.cameraIdentity;
    for (const fixture of duoWindows) {
      for (const fontScale of [1, 1.6, 2]) {
        await f.update({ ...fixture, window: { ...fixture.window, fontScale } });
        const frames = measureLayout(f.tree, f.window);
        assertVisible(frames.get('fixture-stop'), `${fixture.name} font ${fontScale}: Stop`);
        assertVisible(frames.get('alert'), `${fixture.name} font ${fontScale}: complete warning`);
        assertVisible(frames.get('camera'), `${fixture.name} font ${fontScale}: camera`);
        const stop = frames.get('fixture-stop');
        const alert = frames.get('alert');
        const overlapWidth = Math.max(0, Math.min(alert.x + alert.width, stop.x + stop.width) - Math.max(alert.x, stop.x));
        const overlapHeight = Math.max(0, Math.min(alert.y + alert.height, stop.y + stop.height) - Math.max(alert.y, stop.y));
        assert.equal(overlapWidth * overlapHeight, 0, 'warning does not cover Stop');
        assert.strictEqual(f.cameraIdentity, camera);
        assert.equal(f.calls.cameraMounts, 1);
        assert.equal(f.calls.cameraUnmounts, 0);
      }
    }
    assert.equal(f.banner.props.accessibilityLabel, 'PULL OVER NOW');
    assert.match(f.text(), /High fatigue detected\. Pull over safely and rest now\./);
    assert.match(f.text(), /Inner camera - lower confidence/);
    assert.match(f.text(), /Monitoring status: DROWSINESS ALERT/);
  } finally { await f.unmount(); }
});

test('a disappearing portal cannot clear a newer owner and removes its host content on cleanup', async () => {
  const f = createAlertSystemFixture({ withLayout: true, inline: false });
  await f.mount();
  try {
    const camera = f.cameraIdentity;
    const players = [...f.players];
    await f.update({ overlayProbe: true });
    assert.equal(f.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'fixture-overlay-probe').length, 1);
    // The alert portal now unmounts while a newer owner occupies the same host.
    await f.update({ isRunning: false });
    assert.equal(f.root.findAllByType('Animated.View').length, 0);
    assert.equal(f.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'fixture-overlay-probe').length, 1);
    await f.update({ overlayProbe: false });
    const host = f.root.find(node => typeof node.type === 'string' && node.props.testID === 'monitor-alert-overlay');
    assert.equal(host.children.length, 0, 'current owner cleanup removes its content');
    assert.strictEqual(f.cameraIdentity, camera);
    assert.deepEqual(f.players, players);
    assert.equal(f.calls.playerDisposals, 0);
    const plays = f.playCount;
    await f.advance(2_000);
    assert.equal(f.playCount, plays, 'stopping still cancels delayed cues');
  } finally { await f.unmount(); }
  assert.equal(f.calls.playerDisposals, 3);
  assert.equal(f.calls.cameraUnmounts, 1);
});

test('header portal remains present through React Strict Mode effect replay and clears after stopping', async () => {
  const f = createAlertSystemFixture({ withLayout: true, inline: false, strictMode: true });
  await f.mount();
  try {
    assert.equal(f.root.findAllByType('Animated.View').length, 1);
    const frames = measureLayout(f.tree, f.window);
    const header = frames.get('monitor-header');
    assert.equal(frames.get('alert').y, header.y + header.height);
    await f.update({ isRunning: false });
    assert.equal(f.root.findAllByType('Animated.View').length, 0);
    const host = f.root.find(node => typeof node.type === 'string' && node.props.testID === 'monitor-alert-overlay');
    assert.equal(host.children.length, 0);
  } finally { await f.unmount(); }
});
