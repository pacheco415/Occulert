import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  shouldAbortMonitoringStart,
  shouldStopMonitoringForAppState,
  stopBeforeNavigation,
} from '../native-app/lib/monitorLifecycle.ts';

test('monitoring stops whenever the app is no longer active', () => {
  assert.equal(shouldStopMonitoringForAppState(false, false, false, 'background'), false);
  assert.equal(shouldStopMonitoringForAppState(true, false, false, 'active'), false);
  for (const state of ['inactive', 'background', 'unknown', 'extension']) {
    assert.equal(shouldStopMonitoringForAppState(true, false, false, state), true, state);
    assert.equal(shouldStopMonitoringForAppState(false, true, false, state), true, state);
  }
});

test('the expected camera permission prompt does not cancel a pending start', () => {
  for (const state of ['inactive', 'background', 'unknown', 'extension']) {
    assert.equal(shouldStopMonitoringForAppState(false, true, true, state), false, state);
  }
  assert.equal(
    shouldStopMonitoringForAppState(true, true, true, 'background'),
    true,
    'an already-running session must still stop',
  );
  assert.equal(
    shouldAbortMonitoringStart(false, 'background'),
    true,
    'the post-permission guard still blocks startup while backgrounded',
  );
});

test('a pending start cannot finish after cancellation or foreground loss', () => {
  assert.equal(shouldAbortMonitoringStart(false, 'active'), false);
  assert.equal(shouldAbortMonitoringStart(true, 'active'), true);
  for (const state of ['inactive', 'background', 'unknown', 'extension']) {
    assert.equal(shouldAbortMonitoringStart(false, state), true, state);
  }
});

test('navigation waits for monitoring to stop', async () => {
  const events = [];
  let finishStop = () => {};
  const stopping = new Promise(resolve => { finishStop = resolve; });
  const leaving = stopBeforeNavigation(
    async () => {
      events.push('stop-started');
      await stopping;
      events.push('stop-finished');
    },
    () => events.push('navigated'),
  );

  assert.deepEqual(events, ['stop-started']);
  finishStop();
  await leaving;
  assert.deepEqual(events, ['stop-started', 'stop-finished', 'navigated']);
});

test('a save failure is disclosed without trapping the driver', async () => {
  const events = [];
  await stopBeforeNavigation(
    async () => {
      events.push('stop-started');
      throw new Error('storage unavailable');
    },
    () => events.push('navigated'),
    () => events.push('warned'),
  );
  assert.deepEqual(events, ['stop-started', 'warned', 'navigated']);
});

test('the monitor wires app-state and Settings navigation through the lifecycle guard', () => {
  const monitor = readFileSync(new URL('../native-app/app/monitor.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../native-app/app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(monitor, /AppState\.addEventListener\('change'/);
  assert.match(
    monitor,
    /shouldStopMonitoringForAppState\(\s*isRunningRef\.current,\s*startingRef\.current,\s*requestingCameraPermissionRef\.current,\s*nextState/,
  );
  assert.match(monitor, /requestingCameraPermissionRef\.current = true/);
  assert.match(monitor, /requestingCameraPermissionRef\.current = false/);
  assert.match(monitor, /startAttempt !== startAttemptRef\.current/);
  assert.match(monitor, /AppState\.currentState/);
  assert.match(monitor, /startAttemptRef\.current \+= 1/);
  assert.match(monitor, /handleStopRef\.current\(\)/);
  assert.match(monitor, /Monitoring stopped when Occulert left the foreground/);
  assert.match(monitor, /stopBeforeNavigation/);
  assert.equal(
    [...monitor.matchAll(/handleStopRef\.current\(\{ deferCloudFinalization: true \}\)/g)].length,
    2,
    'navigation and AppState shutdown must not wait for optional cloud finalization',
  );
  assert.match(monitor, /drive could not be saved/);
  assert.match(monitor, /leaveMonitor\(\(\) => router\.push\('\/settings'\)\)/);
  assert.match(monitor, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(monitor, /if \(stoppingRef\.current\) return Promise\.resolve\(\)/);
  assert.match(monitor, /accessibilityLabel="Open settings and end monitoring"/);
  assert.match(layout, /name="monitor"[\s\S]*gestureEnabled: false/);
});

test('monitor performance resources stay scoped and stable during a live session', () => {
  const monitor = readFileSync(new URL('../native-app/app/monitor.tsx', import.meta.url), 'utf8');
  assert.match(
    monitor,
    /function MonitoringWakeLock\(\) \{[\s\S]*useKeepAwake\('occulert-active-monitoring'\);[\s\S]*return null;/,
  );
  assert.match(monitor, /\{isRunning && <MonitoringWakeLock \/>\}/);
  assert.doesNotMatch(
    monitor,
    /export default function MonitorScreen\(\) \{\s*useKeepAwake\(/,
  );
  assert.match(monitor, /const onEyeStateJS = useRunOnJS\(onEyeState, \[onEyeState\]\);/);
  assert.match(monitor, /const lastSample = useSharedValue\(0\);/);
  assert.doesNotMatch(monitor, /Worklets\.create(?:RunOnJS|SharedValue)/);
});
