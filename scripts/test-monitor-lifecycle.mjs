import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  shouldStopMonitoringForAppState,
  stopBeforeNavigation,
} from '../native-app/lib/monitorLifecycle.ts';

test('monitoring stops whenever the app is no longer active', () => {
  assert.equal(shouldStopMonitoringForAppState(false, 'background'), false);
  assert.equal(shouldStopMonitoringForAppState(true, 'active'), false);
  for (const state of ['inactive', 'background', 'unknown', 'extension']) {
    assert.equal(shouldStopMonitoringForAppState(true, state), true, state);
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
  assert.match(monitor, /shouldStopMonitoringForAppState\(isRunningRef\.current, nextState\)/);
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
