import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createAppHarness } from './lib/app-page-harness.mjs';
import {
  MONITOR_UI_UPDATE_INTERVAL_MS,
  createMonitorPerformanceTracker,
  elapsedSessionSeconds,
  formatSessionTime,
  shouldRefreshMonitorMetrics,
} from '../native-app/lib/monitorPerformance.ts';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('native monitoring timing stays bounded and deterministic', () => {
  assert.equal(MONITOR_UI_UPDATE_INTERVAL_MS, 250);
  assert.equal(elapsedSessionSeconds(null, 90_000), 0);
  assert.equal(elapsedSessionSeconds(10_000, 71_500), 61);
  assert.equal(formatSessionTime(61), '01:01');

  const tracker = createMonitorPerformanceTracker(3);
  tracker.recordSample(100, 10);
  tracker.recordSample(200, 20);
  tracker.recordSample(300, 30);
  tracker.recordSample(400, 40);
  tracker.recordUiUpdate();
  tracker.recordUiUpdate();
  assert.deepEqual(tracker.snapshot(), {
    samples: 4,
    uiUpdates: 2,
    averageInferenceMs: 30,
    p95InferenceMs: 40,
    averageSampleIntervalMs: 100,
  });
});

test('native analysis remains 10 Hz while display-only work is throttled', () => {
  const monitor = read('native-app/app/monitor.tsx');
  const liveMetrics = read('native-app/components/LiveMetrics.tsx');
  assert.match(monitor, /now - lastSample\.value < 100/);
  assert.match(monitor, /recordSample\(now, inferenceMs\)/);
  assert.match(monitor, /deriveAlertLevel\(\{/);
  assert.match(monitor, /shouldRefreshMonitorMetrics\(\{/);
  assert.match(monitor, /displayedAlertLevelRef\.current = alertLevel/);
  assert.match(monitor, /performanceTrackerRef\.current\.recordUiUpdate\(\)/);
  assert.doesNotMatch(monitor, /setSessionTime|timerRef/);
  assert.match(liveMetrics, /memo\(function LiveMetrics/);
  assert.match(liveMetrics, /setInterval\(updateElapsed, 1_000\)/);

  assert.equal(shouldRefreshMonitorMetrics({
    previousState: 'closed',
    nextState: 'closed',
    previousAlertLevel: 'alert',
    nextAlertLevel: 'alert',
    now: 100,
    lastUpdatedAt: 0,
  }), false, 'routine numeric changes should remain display-throttled');
  assert.equal(shouldRefreshMonitorMetrics({
    previousState: 'closed',
    nextState: 'closed',
    previousAlertLevel: 'alert',
    nextAlertLevel: 'critical',
    now: 100,
    lastUpdatedAt: 0,
  }), true, 'critical threshold crossings must bypass the display throttle');
});

test('web monitoring defers MediaPipe and prevents overlapping inference', async () => {
  const app = read('app.html');
  const driver = read('driver-app.js');
  assert.doesNotMatch(app, /<script[^>]+@mediapipe\/face_mesh/);
  assert.match(app, /loading="lazy"/);
  assert.match(driver, /function loadFaceMeshScript\(\)/);
  assert.match(driver, /faceMeshScriptPromise=null;script\.remove\(\)/);
  assert.match(driver, /if\(processingFrame\)\{busyFrameSkips\+\+;return\}lastFrame=ts/);
  assert.match(driver, /await initModel\(\);\s*requireForegroundStart\(\);\s*stream=await navigator\.mediaDevices\.getUserMedia/s);
  assert.match(driver, /PERFORMANCE_WINDOW_SIZE=120/);
  assert.match(driver, /window\.OcculertPerformance=Object\.freeze/);

  const harness = createAppHarness();
  harness.run('resetFramePerformance(); recordFramePerformance(10); recordFramePerformance(20); recordFramePerformance(30)');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.get('window.OcculertPerformance.snapshot()'))), {
    processedFrames: 3,
    busyFrameSkips: 0,
    averageInferenceMs: 20,
    p95InferenceMs: 30,
  });

  harness.run("running=true; document.hidden=false; video.readyState=2; faceMesh={send:async()=>{}}; processingFrame=true; lastFrame=0; busyFrameSkips=0; processedFrames=0");
  await harness.run('loop(135)');
  assert.equal(harness.get('lastFrame'), 0, 'a skipped busy frame must not advance the cadence clock');
  assert.equal(harness.get('busyFrameSkips'), 1);
  harness.run('processingFrame=false');
  await harness.run('loop(136)');
  assert.equal(harness.get('lastFrame'), 136, 'the first available post-busy frame should run immediately');
  assert.equal(harness.get('processedFrames'), 1);
});

test('service-worker upgrade evicts the stale driver-script cache', async () => {
  const source = read('sw.js');
  assert.match(source, /const CACHE = 'occulert-v42'/);
  assert.doesNotMatch(source, /occulert-v41/);

  const listeners = {};
  const deleted = [];
  let claimed = false;
  const context = {
    URL,
    Promise,
    Set,
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    caches: {
      keys: async () => ['occulert-v41', 'occulert-v42'],
      delete: async key => { deleted.push(key); return true; },
      open: async () => ({ add: async () => {}, put: async () => {} }),
      match: async () => null,
    },
    clients: { matchAll: async () => [], openWindow: async () => {} },
    self: {
      location: { origin: 'https://www.occulert.com' },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => { claimed = true; } },
    },
  };
  runInNewContext(source, context);
  let activation;
  listeners.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['occulert-v41']);
  assert.equal(claimed, true);
});

test('fleet refreshes skip history events until the protected panel needs them', () => {
  const api = read('api/fleet-summary.js');
  const dashboard = read('fleet-dashboard.html');
  assert.match(api, /Promise\.all\(\[pgFetch\("drivers"/);
  assert.match(api, /if \(includeEvents && sessionIds\.length\)/);
  assert.match(api, /Server-Timing/);
  assert.match(dashboard, /getFleetSummary\(\{includeEvents\}\)/);
  assert.match(dashboard, /loadProtectedFleet\(\{includeEvents:true\}\)/);
  assert.match(dashboard, /includeEvents:protectedHistoryOpen\(\)/);
});
