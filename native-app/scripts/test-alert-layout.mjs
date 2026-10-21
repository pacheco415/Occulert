import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlertSystemFixture } from './lib/alert-system-test-harness.mjs';
import { flattenStyle } from './lib/monitor-layout-test-harness.mjs';

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
