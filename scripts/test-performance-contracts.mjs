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

function markedBlock(source, name) {
  const startMarker = `/* ${name}:start */`;
  const endMarker = `/* ${name}:end */`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, `${name} block must be present`);
  return source.slice(start + startMarker.length, end);
}

test('native monitoring timing stays bounded and deterministic', () => {
  assert.equal(MONITOR_UI_UPDATE_INTERVAL_MS, 250);
  assert.equal(elapsedSessionSeconds(null, 90_000), 0);
  assert.equal(elapsedSessionSeconds(10_000, 71_500), 61);
  assert.equal(formatSessionTime(61), '01:01');

  const tracker = createMonitorPerformanceTracker(3);
  tracker.recordSessionStart(50);
  tracker.recordSample(100, 10);
  tracker.recordSample(200, 20);
  tracker.recordSample(300, 30);
  tracker.recordSample(400, 40);
  tracker.recordUiUpdate();
  tracker.recordUiUpdate();
  tracker.recordCameraStall();
  tracker.recordAlertDecision(500);
  tracker.recordPhoneDispatch(500, 506);
  tracker.recordWatchDelivery(500, { accepted: true, acknowledged: true, roundTripMs: 44 });
  tracker.recordWatchDelivery(600, { accepted: true, acknowledged: false, roundTripMs: null });
  assert.deepEqual(tracker.snapshot(1_050), {
    samples: 4,
    uiUpdates: 2,
    averageInferenceMs: 30,
    p95InferenceMs: 40,
    averageSampleIntervalMs: 100,
    timeToFirstSampleMs: 50,
    uiUpdatesPerSecond: 2,
    cameraStalls: 1,
    alertTiming: {
      alertsTriggered: 1,
      phoneDispatches: 1,
      averagePhoneDispatchMs: 6,
      maxPhoneDispatchMs: 6,
      watchResults: 2,
      watchLiveAcknowledgements: 1,
      averageWatchRoundTripMs: 44,
      maxWatchRoundTripMs: 44,
      watchQueuedFallbacks: 1,
    },
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
  assert.match(monitor, /performanceTrackerRef\.current\.recordSessionStart\(/);
  assert.match(monitor, /performanceTrackerRef\.current\.recordCameraStall\(\)/);
  assert.match(monitor, /monitorPerformance,/);
  assert.doesNotMatch(monitor, /setSessionTime|timerRef/);
  assert.doesNotMatch(monitor, /await startHeadphoneMotion\(\)/);
  assert.match(monitor, /const headphoneStart = startHeadphoneMotion\(\)/);
  assert.match(monitor, /await Promise\.all\(\[\s*loadAlertPreferences\(\),\s*getWatchAlertsEnabled\(\),/s);
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

test('Build 30 pins its iOS toolchain and exposes local aggregate diagnostics', () => {
  const eas = JSON.parse(read('native-app/eas.json'));
  const history = read('native-app/app/history.tsx');
  assert.equal(eas.build.production.ios.image, 'macos-tahoe-26.5-xcode-26.6');
  assert.match(history, /LOCAL PERFORMANCE DIAGNOSTICS/);
  assert.match(history, /First camera sample/);
  assert.match(history, /Inference p95/);
  assert.match(history, /Phone software dispatch/);
  assert.match(history, /Watch live acknowledgements/);
  assert.match(history, /not haptic onset/);
  assert.match(history, /No camera frames are saved/);
});

test('web monitoring defers MediaPipe and prevents overlapping inference', async () => {
  const app = read('app.html');
  const driver = read('driver-app.v48.js');
  assert.doesNotMatch(app, /<script[^>]+@mediapipe\/face_mesh/);
  assert.match(app, /loading="lazy"/);
  assert.match(driver, /function loadFaceMeshScript\(\)/);
  assert.match(driver, /FACE_MESH_VERSION='0\.4\.1633559619'/);
  assert.match(driver, /FACE_MESH_SCRIPT_INTEGRITY='sha384-/);
  assert.match(driver, /async function verifyDetectionRuntime\(\)/);
  assert.match(driver, /function withDetectionTimeout\(/);
  assert.match(driver, /DETECTION_STARTUP_TIMEOUT_MS=12000/);
  assert.match(driver, /WebAssembly\.compile/);
  assert.match(driver, /fetchDetectionAsset\(FACE_MESH_GRAPH_URL/);
  assert.match(driver, /function createLocalDriverId\(\)/);
  assert.match(driver, /function normalizeLocalDriverId\(value\)/);
  assert.match(driver, /function migrateLocalDriverIdentity\(value\)/);
  assert.match(driver, /async function verifyFirstInference\(timeoutMs=/);
  assert.match(driver, /function waitForDetectionResult\(/);
  assert.match(driver, /async function haltForDetectionFailure\(/);
  assert.match(driver, /function primeAlertAudio\(\)/);
  assert.doesNotMatch(driver, /Math\.floor\(Math\.random\(\)\*900\+100\)/);
  assert.equal((driver.match(/async function initModel\(/g) || []).length, 1);
  assert.equal((driver.match(/async function loop\(/g) || []).length, 1);
  assert.match(driver, /faceMeshScriptPromise=null;script\.remove\(\)/);
  assert.match(driver, /if\(processingFrame\)\{busyFrameSkips\+\+;return\}lastFrame=ts/);
  assert.match(driver, /await initModel\(\);\s*requireForegroundStart\(\);\s*stream=await openSelectedCamera\(\)/s);
  assert.match(driver, /await video\.play\(\);\s*requireForegroundStart\(\);\s*await verifyFirstInference\(\);\s*requireForegroundStart\(\)/s);
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

test('detector startup times out instead of leaving Start disabled forever', async () => {
  const harness = createAppHarness({
    sandboxOverrides: {
      AbortController,
      clearTimeout,
      fetch: () => new Promise(() => {}),
      setTimeout,
    },
  });
  await assert.rejects(
    harness.run("fetchDetectionAsset('https://example.test/stalled-model', 10)"),
    error => error && error.name === 'DetectionRuntimeError' && /timed out/.test(error.message),
  );
});

test('detector startup timeout covers a response body that never finishes', async () => {
  const harness = createAppHarness({
    sandboxOverrides: {
      AbortController,
      clearTimeout,
      fetch: async () => ({ ok: true, arrayBuffer: () => new Promise(() => {}) }),
      setTimeout,
    },
  });
  await assert.rejects(
    harness.run("fetchDetectionAsset('https://example.test/stalled-body', 10)"),
    error => error && error.name === 'DetectionRuntimeError' && /timed out/.test(error.message),
  );
});

test('a wedged detector close cannot block failure cleanup', async () => {
  const harness = createAppHarness({ sandboxOverrides: { clearTimeout, setTimeout } });
  harness.run('faceMesh={close:()=>new Promise(()=>{})}');
  await harness.run('discardFaceMesh(10)');
  assert.equal(harness.get('faceMesh'), null);
});

test('the first camera probe requires an actual detector result callback', async () => {
  const harness = createAppHarness({ sandboxOverrides: { clearTimeout, setTimeout } });
  harness.run('faceMesh={send:async()=>{}};lastDetectionResultAt=0');
  await assert.rejects(
    harness.run('verifyFirstInference(10)'),
    error => error && error.name === 'DetectionRuntimeError' && /first camera result/.test(error.message),
  );
  assert.equal(harness.get('lastDetectionResultAt'), 0);
});

test('repeated frame failures stop monitoring and invalidate the broken detector', async () => {
  const harness = createAppHarness();
  harness.startSession();
  harness.run("faceMesh={send:async()=>{throw new Error('inference failed')}};video.readyState=2;video.videoWidth=480;video.videoHeight=360;lastDetectionResultAt=Date.now()");
  await harness.run('loop(135)');
  await harness.run('loop(270)');
  await harness.run('loop(405)');
  assert.equal(harness.get('running'), false);
  assert.equal(harness.get('faceMesh'), null);
  assert.equal(harness.el('overlayTitle').textContent, 'AI Monitoring Unavailable');
});

test('missing detector callbacks trigger the result watchdog', async () => {
  const harness = createAppHarness();
  harness.startSession();
  harness.run('faceMesh={send:async()=>{}};video.readyState=2;lastDetectionResultAt=Date.now()');
  harness.clock.advance(6_001);
  await harness.run('loop(135)');
  assert.equal(harness.get('running'), false);
  assert.equal(harness.el('overlayTitle').textContent, 'AI Monitoring Unavailable');
});

test('detector failure recovery is not blocked by cloud finalization', async () => {
  const harness = createAppHarness();
  harness.startSession();
  harness.run(`
    cloudConsent.checked=true;cloudReady=true;
    backendSessionId='old-session';backendSessionPromise=Promise.resolve('old-session');backendEventQueue=Promise.resolve();
    window.OcculertBackend={endSession:()=>new Promise(()=>{})};
    faceMesh={close:async()=>{}};
  `);
  await harness.run("haltForDetectionFailure(detectionRuntimeError('detector failed'))");
  assert.equal(harness.get('detectorFailureStopping'), false);
  assert.equal(harness.get('startBtn.disabled'), false);
  assert.equal(harness.get('backendSessionId'), null);
  assert.equal(harness.get('backendSessionPromise'), null);
  assert.equal(harness.el('overlayTitle').textContent, 'AI Monitoring Unavailable');
});

test('legacy local driver identity migrates once across the driver app and account helper', () => {
  const legacyId = 'D-123';
  const harness = createAppHarness({
    initialStorage: {
      'occulert-driver-id': legacyId,
      'occulert-profile': JSON.stringify({ name: 'Local Driver', driverId: legacyId }),
      'occulert-live-session': JSON.stringify({ driverId: legacyId, status: 'SAFE' }),
      'occulert-session-history': JSON.stringify([{ driverId: legacyId, status: 'SAFE' }, { driverId: 'demo-other' }]),
      'occulert-drivers': JSON.stringify([{ driverId: legacyId, name: 'Local Driver' }]),
    },
  });
  const migratedId = harness.get("localStorage.getItem('occulert-driver-id')");
  assert.match(migratedId, /^local-/);
  for (const key of ['occulert-profile', 'occulert-live-session']) {
    assert.equal(harness.get(`JSON.parse(localStorage.getItem('${key}')).driverId`), migratedId);
  }
  assert.equal(harness.get("JSON.parse(localStorage.getItem('occulert-session-history'))[0].driverId"), migratedId);
  assert.equal(harness.get("JSON.parse(localStorage.getItem('occulert-session-history'))[1].driverId"), 'demo-other');
  assert.equal(harness.get("JSON.parse(localStorage.getItem('occulert-drivers'))[0].driverId"), migratedId);

  harness.run(read('auth-helper.v47.js'));
  harness.run('window.OcculertAuth.saveProfile(window.OcculertAuth.getProfile())');
  assert.equal(harness.get("localStorage.getItem('occulert-driver-id')"), migratedId);
  assert.equal(harness.get("JSON.parse(localStorage.getItem('occulert-profile')).driverId"), migratedId);
});

test('service-worker upgrade evicts stale website caches', async () => {
  const source = read('sw.js');
  assert.match(source, /const CACHE = 'occulert-v48'/);
  assert.match(source, /const NETWORK_FIRST_ASSETS = new Set\(\[/);
  assert.match(source, /'\/driver-app\.v48\.js'/);
  assert.match(source, /const NETWORK_FIRST_TIMEOUT_MS = 2500/);
  assert.match(source, /event\.waitUntil\(cacheUpdate\)/);

  const listeners = {};
  const deleted = [];
  let claimed = false;
  const context = {
    URL,
    Request,
    Promise,
    Set,
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    caches: {
      keys: async () => ['occulert-v41', 'occulert-v42', 'occulert-v43'],
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
  assert.deepEqual(deleted, ['occulert-v41', 'occulert-v42', 'occulert-v43']);
  assert.equal(claimed, true);
});

test('service-worker install cannot replace a usable cache without its detector', async () => {
  const source = read('sw.js');
  const listeners = {};
  const cached = new Set();
  const deleted = [];
  let skipped = false;
  const cache = {
    add: async url => {
      url = typeof url === 'string' ? url : new URL(url.url).pathname;
      if (url === '/driver-app.v48.js') throw new Error('transient detector download failure');
      cached.add(url);
    },
    match: async url => cached.has(url) ? { ok: true } : null,
  };
  const context = {
    URL,
    Request,
    Promise,
    Set,
    caches: {
      open: async () => cache,
      delete: async key => { deleted.push(key); return true; },
    },
    self: {
      location: { origin: 'https://www.occulert.com' },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => {} },
    },
  };
  runInNewContext(source, context);
  let installation;
  listeners.install({ waitUntil: promise => { installation = promise; } });
  await assert.rejects(installation, /Critical offline assets were not cached/);
  assert.equal(skipped, false);
  assert.deepEqual(deleted, ['occulert-v48']);
});

test('service-worker bounds network and cache writes while preserving a known-good detector', async () => {
  const source = read('sw.js');
  const listeners = {};
  const cachedResponse = { source: 'cache', ok: true };
  const freshResponse = { source: 'network', ok: true, clone: () => ({ source: 'copy' }) };
  let networkResponse = { source: 'server-error', ok: false, status: 503 };
  let cacheWriteMode = 'ok';
  const context = {
    AbortController,
    URL,
    Request,
    Promise,
    Response: { error: () => ({ source: 'network-error', ok: false }) },
    Set,
    clearTimeout,
    fetch: async () => networkResponse,
    setTimeout: (callback, timeoutMs) => setTimeout(callback, Math.min(timeoutMs, 10)),
    caches: {
      open: async () => ({
        put: async () => {
          if (cacheWriteMode === 'reject') throw new Error('quota exceeded');
          if (cacheWriteMode === 'hang') return new Promise(() => {});
        },
      }),
      match: async () => cachedResponse,
    },
    self: {
      location: { origin: 'https://www.occulert.com' },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  };
  runInNewContext(source, context);
  const request = { method: 'GET', mode: 'same-origin', url: 'https://www.occulert.com/driver-app.v48.js' };
  let responsePromise;
  let lifetimePromise;
  const dispatch = () => listeners.fetch({
    request,
    respondWith: promise => { responsePromise = promise; },
    waitUntil: promise => { lifetimePromise = promise; },
  });
  dispatch();
  assert.equal(await responsePromise, cachedResponse, 'a 503 must fall back to the known-good detector');
  await lifetimePromise;

  networkResponse = freshResponse;
  cacheWriteMode = 'reject';
  dispatch();
  assert.equal(await responsePromise, freshResponse, 'a cache quota error must not discard a good network response');
  await lifetimePromise;

  cacheWriteMode = 'hang';
  dispatch();
  assert.equal(await responsePromise, freshResponse, 'a stalled cache write must not delay a good network response');
  await lifetimePromise;

  networkResponse = new Promise(() => {});
  cacheWriteMode = 'ok';
  dispatch();
  assert.equal(await responsePromise, cachedResponse, 'a stalled network must reach the known-good cache after its deadline');
  await lifetimePromise;
});

test('fleet refreshes adapt to activity and throttle protected event queries', () => {
  const api = read('api/fleet-summary.js');
  const dashboard = read('fleet-dashboard.html');
  const policy = markedBlock(dashboard, 'fleet-refresh-policy');
  const context = {};
  runInNewContext(`${policy};globalThis.policyForTest={protectedRefreshDelay,shouldRefreshProtectedEvents}`, context);
  const { protectedRefreshDelay, shouldRefreshProtectedEvents } = context.policyForTest;

  assert.equal(protectedRefreshDelay({ hasActiveSession: true }), 30_000);
  assert.equal(protectedRefreshDelay(), 90_000);
  assert.equal(protectedRefreshDelay({ saveData: true }), 120_000);
  assert.equal(protectedRefreshDelay({ failureCount: 9 }), 300_000);
  assert.equal(shouldRefreshProtectedEvents({ historyOpen: false, lastLoadedAt: 0, now: 1 }), false);
  assert.equal(shouldRefreshProtectedEvents({ historyOpen: true, lastLoadedAt: 0, now: 1 }), true);
  assert.equal(shouldRefreshProtectedEvents({ historyOpen: true, lastLoadedAt: 1_000, now: 120_999 }), false);
  assert.equal(shouldRefreshProtectedEvents({ historyOpen: true, lastLoadedAt: 1_000, now: 121_000 }), true);

  assert.match(api, /Promise\.all\(\[pgFetch\("drivers"/);
  assert.match(api, /if \(includeEvents && sessionIds\.length\)/);
  assert.match(api, /Server-Timing/);
  assert.match(dashboard, /getFleetSummary\(\{includeEvents\}\)/);
  assert.match(dashboard, /shouldRefreshProtectedEvents\(\{historyOpen:protectedHistoryOpen\(\),lastLoadedAt:protectedEventsLoadedAt\}\)/);
  assert.match(dashboard, /setTimeout\(\(\)=>\{void pollProtectedFleet\(\)\},delay\)/);
});

test('fleet dashboard restarts its relative-time clock after returning to a visible tab', async () => {
  const dashboard = read('fleet-dashboard.html');
  const scheduling = markedBlock(dashboard, 'fleet-refresh-scheduling');
  let intervalCalls = 0;
  const context = {
    DASHBOARD_CLOCK_INTERVAL_MS: 15_000,
    cloudRows: [],
    dashboardRefreshTimer: 7,
    document: { hidden: true },
    fleetMode: true,
    navigator: { connection: {} },
    protectedEventsLoadedAt: 0,
    protectedRefreshFailures: 0,
    protectedRefreshTimer: 8,
    clearInterval: () => {},
    clearTimeout: () => {},
    loadProtectedFleet: async () => true,
    protectedHistoryOpen: () => false,
    protectedRefreshDelay: () => 90_000,
    refreshDashboardIfNeeded: () => {},
    setInterval: () => { intervalCalls += 1; return 11; },
    setTimeout: () => 12,
    shouldRefreshProtectedEvents: () => false,
  };
  runInNewContext(`${scheduling};globalThis.schedulingForTest={handleVisibilityChange}`, context);

  await context.schedulingForTest.handleVisibilityChange();
  assert.equal(intervalCalls, 0, 'hidden dashboards must keep timers stopped');
  context.document.hidden = false;
  await context.schedulingForTest.handleVisibilityChange();
  assert.equal(intervalCalls, 1, 'visible dashboards must restart the relative-time interval');
  assert.equal(context.dashboardRefreshTimer, 11);
});
