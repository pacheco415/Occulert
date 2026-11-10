import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonitorPresentationFixture } from './lib/monitor-presentation-test-harness.mjs';

test('actual monitor presentation keeps injected Start/Stop/navigation actions and the same camera through ordinary updates', async () => {
  const f = await createMonitorPresentationFixture();
  try {
    await f.press('Start fatigue monitoring'); assert.equal(f.events.at(-1).name, 'handleStart');
    await f.update({ isRunning: true, sessionStartedAt: 1_000 }); const camera = f.root.findByType('CameraFixture').props.identity;
    await f.update({ metrics: { state: 'watch' }, alertCount: 1 });
    assert.equal(f.root.findByType('CameraFixture').props.identity, camera); assert.equal(f.calls.cameraMounts, 1); assert.equal(f.calls.wakeStarts, 1);
    await f.press('Stop monitoring and save this drive'); assert.equal(f.events.at(-1).name, 'handleStop');
    await f.press('Return home and end monitoring'); assert.equal(f.events.at(-1).name, 'onHome');
    await f.press('Open settings and end monitoring'); assert.equal(f.events.at(-1).name, 'onSettings');
    await f.update({ isRunning: false }); assert.equal(f.calls.cameraUnmounts, 1); assert.equal(f.calls.wakeStops, 1);
  } finally { await f.close(); }
});

test('actual presentation retains stopped/recovery guidance, busy safe-stop controls and screen-owned action routing', async () => {
  const f = await createMonitorPresentationFixture();
  try {
    await f.update({ sensorFault: 'Monitoring did not start because recovery is required' });
    assert.ok(f.root.findByProps({ accessibilityLabel: 'Monitoring status: RECOVERY REQUIRED' }));
    await f.press('Return Home to recover the previous drive'); assert.equal(f.events.at(-1).name, 'onRecoveryHome');
    await f.update({ sensorFault: 'Camera unavailable', safeStopOpen: true, safeStopBusy: true });
    assert.ok(f.root.findByProps({ accessibilityLabel: 'Monitoring status: STOPPED · CHECK CAMERA' }));
    const cancel = f.root.findByProps({ accessibilityLabel: 'Ending and saving drive' }); assert.equal(cancel.props.disabled, true);
    await f.update({ safeStopBusy: false }); await f.press('Find rest area');
    assert.equal(f.events.at(-1).name, 'handleSafeStopChoice'); assert.equal(f.events.at(-1).args[0], 'rest-area');
  } finally { await f.close(); }
});

test('simulator presentation needs no camera and keeps explicit Start/Stop controls around the current trace phase', async () => {
  const f = await createMonitorPresentationFixture({ simulator: true });
  try {
    await f.update({ device: undefined });
    assert.match(JSON.stringify(f.tree), /SIMULATOR TRACE/);
    assert.match(JSON.stringify(f.tree), /Tap Start to run the scripted trace/);
    await f.press('Start fatigue monitoring'); assert.equal(f.events.at(-1).name, 'handleStart');
    await f.update({ isRunning: true, simulatorPhase: 'closed for 3 seconds' });
    assert.match(JSON.stringify(f.tree), /closed for 3 seconds/);
    assert.equal(f.calls.cameraMounts, 0); assert.equal(f.calls.wakeStarts, 1);
    await f.press('Stop monitoring and save this drive'); assert.equal(f.events.at(-1).name, 'handleStop');
    await f.update({ isRunning: false }); assert.equal(f.calls.wakeStops, 1);
    assert.match(JSON.stringify(f.tree), /Tap Start to run the scripted trace/);
  } finally { await f.close(); }
});
