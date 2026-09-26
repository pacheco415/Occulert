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
import {
  canRestartStalledCamera,
  deriveCameraLoadPolicy,
  shouldRestartCamera,
} from '../native-app/lib/cameraResilience.ts';

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
  tracker.recordCameraRestart();
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
    cameraRestarts: 1,
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

test('native analysis remains 10 Hz normally while display-only work is throttled', () => {
  const monitor = read('native-app/app/monitor.tsx');
  const liveMetrics = read('native-app/components/LiveMetrics.tsx');
  assert.match(monitor, /now - lastSample\.value < analysisIntervalMs\.value/);
  assert.match(monitor, /recordSample\(now, inferenceMs\)/);
  assert.match(monitor, /deriveAlertLevel\(\{/);
  assert.match(monitor, /shouldRefreshMonitorMetrics\(\{/);
  assert.match(monitor, /displayedAlertLevelRef\.current = alertLevel/);
  assert.match(monitor, /performanceTrackerRef\.current\.recordUiUpdate\(\)/);
  assert.match(monitor, /performanceTrackerRef\.current\.recordSessionStart\(/);
  assert.match(monitor, /performanceTrackerRef\.current\.recordCameraStall\(\)/);
  assert.match(monitor, /performanceTrackerRef\.current\.recordCameraRestart\(\)/);
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

test('camera resilience reduces load and permits only one safe restart', () => {
  assert.deepEqual(deriveCameraLoadPolicy({
    thermalState: 'nominal',
    lowPowerMode: false,
    batteryLevel: 0.8,
    isCharging: false,
  }), {
    analysisIntervalMs: 100,
    mode: 'normal',
    reason: 'none',
  });
  assert.equal(deriveCameraLoadPolicy({
    thermalState: 'serious',
    lowPowerMode: false,
    batteryLevel: 0.8,
    isCharging: false,
  }).mode, 'reduced');
  assert.equal(deriveCameraLoadPolicy({
    thermalState: 'critical',
    lowPowerMode: false,
    batteryLevel: 0.8,
    isCharging: false,
  }).mode, 'stop');
  assert.equal(deriveCameraLoadPolicy({
    thermalState: 'nominal',
    lowPowerMode: false,
    batteryLevel: 0.1,
    isCharging: true,
  }).mode, 'normal');
  assert.equal(canRestartStalledCamera(0), true);
  assert.equal(canRestartStalledCamera(1), false);
  assert.equal(shouldRestartCamera('session/camera-not-ready', 0), true);
  assert.equal(shouldRestartCamera('system/max-cameras-in-use', 0), false);
  assert.equal(shouldRestartCamera('session/camera-not-ready', 1), false);
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
  const driver = read('driver-app.v57.js');
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

  harness.run(read('auth-helper.v49.js'));
  harness.run('window.OcculertAuth.saveProfile(window.OcculertAuth.getProfile())');
  assert.equal(harness.get("localStorage.getItem('occulert-driver-id')"), migratedId);
  assert.equal(harness.get("JSON.parse(localStorage.getItem('occulert-profile')).driverId"), migratedId);
});

test('completed browser sessions survive app reopening without cloud consent or duplicate latest rows', async () => {
  const harness = createAppHarness();
  harness.startSession();
  harness.run('alerts=2;maxFatigue=50');
  harness.clock.advance(10_000);
  await harness.run('stop()');
  const firstEnd = harness.get("JSON.parse(localStorage.getItem('occulert-session-history'))[0].endedAt");
  harness.clock.advance(1_000);
  await harness.run('stop()');
  assert.equal(harness.get("JSON.parse(localStorage.getItem('occulert-session-history')).length"), 1);
  assert.equal(harness.get("JSON.parse(localStorage.getItem('occulert-session-history'))[0].endedAt"), firstEnd,
    'an extra stop must not extend the completed session');
  harness.startSession();
  harness.run('alerts=3;maxFatigue=80');
  harness.clock.advance(20_000);
  await harness.run('stop()');
  const records = JSON.parse(harness.get("localStorage.getItem('occulert-session-history')"));
  assert.equal(records.length, 2);
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(records[0].alerts, 3);
  assert.equal(records[1].alerts, 2);
  assert.equal(records[0].cloudConsent, false);
  assert.equal(Date.parse(records[0].endedAt) - Date.parse(records[0].startedAt), 20_000);
  assert.equal(Date.parse(records[1].endedAt) - Date.parse(records[1].startedAt), 10_000);
  for (const record of records) {
    assert.equal(record.location, null);
    assert.deepEqual(record.route, []);
    assert.ok(!('audio' in record) && !('landmarks' in record) && !('rawMotion' in record));
  }
  const keys = ['occulert-driver-id', 'occulert-session-history', 'occulert-live-session'];
  const initialStorage = Object.fromEntries(keys.map(key => [key, harness.get(`localStorage.getItem('${key}')`)]));
  const reopened = createAppHarness({ initialStorage });
  assert.equal(reopened.get("localStorage.getItem('occulert-live-session')"), initialStorage['occulert-live-session'],
    'idle app loading must not replace the last completed record with a perfect empty score');
  reopened.run(read('session-history-page-2.v57.js'));
  assert.equal(reopened.get('getHistory().length'), 2, 'latest saved snapshot must not duplicate its history record');
  assert.equal(reopened.el('sessions').textContent, 2);
});

test('stopping before monitoring creates no history and blocked storage cannot prevent local cleanup', async () => {
  const harness = createAppHarness();
  await harness.run('stop()');
  assert.equal(harness.get("localStorage.getItem('occulert-session-history')"), null);
  assert.equal(harness.get("localStorage.getItem('occulert-live-session')"), null);
  harness.startSession();
  harness.run("localStorage.setItem=()=>{throw new Error('storage blocked')}");
  await harness.run('stop()');
  await Promise.resolve();
  assert.equal(harness.get('running'), false);
  assert.equal(harness.el('report').style.display, 'block');
  assert.match(harness.el('report').textContent, /Local history: Not saved/);
  assert.equal(harness.el('startBtn').textContent, 'START MONITORING');
  assert.ok(harness.el('log').children.some(entry => /Local history could not be saved/.test(entry.textContent)));
  assert.ok(harness.el('log').children.some(entry => /Local session snapshot could not be saved/.test(entry.textContent)));
});

test('browser local history retains the latest 50 and reports a failed save without clearing existing records', async () => {
  const harness = createAppHarness();
  for (let index = 0; index < 51; index += 1) {
    harness.startSession();
    harness.run(`alerts=${index}`);
    harness.clock.advance(1_000);
    await harness.run('stop()');
  }
  const records = JSON.parse(harness.get("localStorage.getItem('occulert-session-history')"));
  assert.equal(records.length, 50);
  assert.equal(records[0].alerts, 50);
  assert.equal(records.at(-1).alerts, 1);
  const saved = harness.get("localStorage.getItem('occulert-session-history')");
  harness.startSession();
  harness.run(`const originalSetItem=localStorage.setItem;
    localStorage.setItem=(key,value)=>{if(key==='occulert-session-history')throw new Error('quota exceeded');originalSetItem(key,value)};`);
  await harness.run('stop()');
  assert.equal(harness.get("localStorage.getItem('occulert-session-history')"), saved);
  assert.ok(harness.el('log').children.some(entry => /Local history could not be saved/.test(entry.textContent)));
});

function wakeLockHarness() {
  const harness = createAppHarness();
  harness.run(`navigator.mediaDevices={getUserMedia:async()=>null};
    globalThis.wakeRequests=[];globalThis.gpsStarts=0;
    navigator.wakeLock={request:()=>new Promise(resolve=>{wakeRequests.push(resolve)})};
    initModel=async()=>{};
    openSelectedCamera=async()=>({getTracks:()=>[{stop(){}}],getVideoTracks:()=>[]});
    verifyFirstInference=async()=>{};
    startGPS=()=>{gpsStarts++};`);
  return harness;
}

test('a pending optional wake lock cannot stall startup or restart GPS after foreground stop', async () => {
  const harness = wakeLockHarness();
  await harness.run('start()');
  assert.equal(harness.get('running'), true);
  assert.equal(harness.get('starting'), false, 'camera monitoring must not wait for the optional wake lock');
  assert.equal(harness.get('gpsStarts'), 1);
  harness.run('document.hidden=true');
  await harness.run('handleVisibilityChange(true)');
  harness.run('wakeRequests[0]({release:async()=>{globalThis.released=true}})');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.get('running'), false);
  assert.equal(harness.get('wakeLock'), null);
  assert.equal(harness.get('released'), true);
  assert.equal(harness.get('gpsStarts'), 1, 'late resolution must not reopen optional location monitoring');
  assert.equal(harness.el('startBtn').textContent, 'START MONITORING');
});

test('a previous session wake lock cannot replace the current session lock', async () => {
  const harness = wakeLockHarness();
  await harness.run('start()');
  await harness.run('stop()');
  harness.clock.advance(1_000);
  await harness.run('start()');
  harness.run("wakeRequests[1]({session:'current',release:async()=>{globalThis.currentReleased=true}})");
  await Promise.resolve(); await Promise.resolve();
  harness.run("wakeRequests[0]({session:'previous',release:async()=>{globalThis.previousReleased=true}})");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(harness.get('wakeLock.session'), 'current');
  assert.equal(harness.get('previousReleased'), true);
  assert.equal(harness.get('globalThis.currentReleased || false'), false);
  await harness.run('stop()');
  assert.equal(harness.get('currentReleased'), true);
});

test('service-worker upgrade evicts stale website caches', async () => {
  const source = read('sw.js');
  assert.match(source, /const CACHE = 'occulert-v51'/);
  assert.match(source, /const NETWORK_FIRST_ASSETS = new Set\(\[/);
  assert.match(source, /'\/driver-app\.v57\.js'/);
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
      if (url === '/driver-app.v57.js') throw new Error('transient detector download failure');
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
  assert.deepEqual(deleted, ['occulert-v51']);
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
  const request = { method: 'GET', mode: 'same-origin', url: 'https://www.occulert.com/driver-app.v57.js' };
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

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const drainTasks = () => new Promise(done => setImmediate(done));
function dashboardRefreshHarness({ empty = false } = {}) {
  const source = read('fleet-dashboard.html'), timers = new Map(), elements = new Map(), requests = [], views = [];
  const now = Date.parse('2026-09-26T12:00:00Z');
  let user = { id: 'owner' }, timerId = 0, sessionImpl = async () => ({ user }), summaryImpl = async () => summary('Recovered fleet');
  function summary(name) { return { ok: true, body: { fleet: { company_name: name }, drivers: [{ id: name, name, active: true }],
    sessions: [], events: [], events_included: true, telemetry_trust: 'unverified_client_report',
    privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false } } }; }
  function element(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false, attributes: {}, hidden: false,
      classList: { toggle(name, value) { elements.get(id).hidden = name === 'hidden' && value; } },
      setAttribute(name, value) { this.attributes[name] = value; } });
    return elements.get(id);
  }
  class ClockDate extends Date { static now() { return now; } }
  let context;
  const window = { OcculertBackend: { currentUser: () => user, getSession: () => { requests.push('session'); return sessionImpl(); },
    getFleetSummary: options => { requests.push({ summary: options }); return summaryImpl(); }, signOut: () => { requests.push('signOut'); user = null; } },
    OcculertFollowups: { reset() {}, show() {} }, OcculertPilotReport: { reset() {}, update() {} } };
  context = { Date: ClockDate, window, document: { hidden: false, getElementById: element }, navigator: { connection: {} },
    syncProtectedControls() {}, render: () => views.push(context.state().protectedFleetName),
    refreshDashboardIfNeeded: () => views.push(context.state().protectedFleetName), protectedHistoryOpen: () => false,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {},
  };
  const globals = source.slice(source.indexOf('let cloudRows='), source.indexOf('function esc('));
  const auth = source.slice(source.indexOf('async function handleAuthStorageChange('), source.indexOf('async function boot('));
  runInNewContext(globals + markedBlock(source, 'fleet-refresh-policy') + markedBlock(source, 'fleet-summary-projection') +
    markedBlock(source, 'fleet-refresh-request') + markedBlock(source, 'fleet-refresh-scheduling') + auth + `
      globalThis.state=()=>({fleetMode,protectedUserId,protectedFleetName,protectedDrivers,protectedSessions,protectedEvents,
        protectedLastSuccessfulAt,protectedRefreshFailures,protectedFleetLoading,protectedFleetGeneration,
        protectedTelemetryTrust,protectedReportPrivacy,protectedReportShape});
      globalThis.seed=input=>{({fleetMode,protectedUserId,protectedFleetName,protectedDrivers,protectedSessions,
        protectedEvents,protectedLastSuccessfulAt,protectedRefreshFailures,protectedTelemetryTrust,
        protectedReportPrivacy,protectedReportShape}=input)};`, context);
  context.seed({ ...context.state(), ...(empty ? {} : { fleetMode: true, protectedUserId: 'owner', protectedFleetName: 'Cached private fleet',
    protectedDrivers: [{ id: 'driver', name: 'Private Driver' }], protectedSessions: [{ id: 'private-session' }], protectedEvents: [{ id: 'private-event' }],
    protectedLastSuccessfulAt: now, protectedRefreshFailures: 0, protectedTelemetryTrust: 'unverified_client_report',
    protectedReportPrivacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false }, protectedReportShape: true }) });
  return { context, timers, elements, requests, views, summary, state: context.state, user: value => { user = value; },
    auth: fn => { sessionImpl = fn; }, fetch: fn => { summaryImpl = fn; },
    expire: delay => { const entry = Array.from(timers.entries()).find(([, timer]) => timer.delay === delay); assert.ok(entry, `timer ${delay} must exist`);
      timers.delete(entry[0]); entry[1].callback(); },
  };
}

test('hung dashboard account checks release controls, preserve same-owner stale data, and recover manually', async () => {
  const app = dashboardRefreshHarness(), old = deferred();
  app.auth(() => old.promise);
  const attempt = app.context.refreshProtectedFleetNow();
  await drainTasks();
  assert.equal(app.elements.get('refreshNow').disabled, true);
  app.expire(8000);
  await attempt;
  assert.equal(app.state().protectedFleetLoading, false);
  assert.equal(app.elements.get('refreshNow').disabled, false);
  assert.equal(app.elements.get('refreshNow').textContent, 'Refresh now');
  assert.match(app.elements.get('cloudStatus').textContent, /Account check unavailable or timed out\. Sign-out was not confirmed/);
  assert.equal(app.state().fleetMode, true);
  assert.equal(app.state().protectedFleetName, 'Cached private fleet');
  assert.equal(app.state().protectedRefreshFailures, 1, 'stale protected exports must remain withheld');
  assert.equal(app.requests.filter(request => typeof request === 'object').length, 0, 'unconfirmed auth cannot fetch protected summary');
  assert.ok(Array.from(app.timers.values()).some(timer => timer.delay === 180000), 'existing backoff starts after the failure');
  old.resolve({ user: { id: 'owner' } });
  await drainTasks();
  assert.equal(app.requests.filter(request => typeof request === 'object').length, 0, 'late auth must not resume the expired request');
  app.auth(async () => ({ user: { id: 'owner' } }));
  await app.context.refreshProtectedFleetNow();
  assert.equal(app.state().protectedFleetName, 'Recovered fleet');
  assert.equal(app.state().protectedRefreshFailures, 0);
  assert.equal(app.elements.get('refreshNow').disabled, false);
  assert.ok(Array.from(app.timers.values()).some(timer => timer.delay === 90000));
});

test('startup account timeout exposes retry without substituting local/demo data or confirming sign-out', async () => {
  const app = dashboardRefreshHarness({ empty: true });
  app.auth(() => new Promise(() => {}));
  const attempt = app.context.refreshProtectedFleetNow();
  await drainTasks(); app.expire(8000); await attempt;
  assert.equal(app.state().fleetMode, true);
  assert.equal(app.state().protectedUserId, 'owner');
  assert.equal(app.state().protectedFleetName, '');
  assert.equal(app.state().protectedReportShape, false);
  assert.equal(app.elements.get('refreshNow').hidden, false);
  assert.equal(app.elements.get('refreshNow').disabled, false);
  app.auth(async () => ({ user: { id: 'owner' } }));
  await app.context.refreshProtectedFleetNow();
  assert.equal(app.state().protectedFleetName, 'Recovered fleet');
});

test('hung dashboard summaries recover without a late response or late 401 replacing fresh data', async () => {
  for (const late of ['success', '401']) {
    const app = dashboardRefreshHarness(), old = deferred();
    app.fetch(() => old.promise);
    const attempt = app.context.refreshProtectedFleetNow();
    await drainTasks(); app.expire(8000); await attempt;
    assert.equal(app.state().protectedFleetName, 'Cached private fleet');
    assert.equal(app.state().protectedRefreshFailures, 1);
    assert.equal(app.elements.get('refreshNow').disabled, false);
    assert.match(app.elements.get('cloudStatus').textContent, /timed out/);
    app.fetch(async () => app.summary('Fresh fleet'));
    await app.context.refreshProtectedFleetNow();
    old.resolve(late === 'success' ? app.summary('Expired private fleet') : { ok: false, status: 401, body: {} });
    await drainTasks();
    assert.equal(app.state().protectedFleetName, 'Fresh fleet');
    assert.equal(app.state().protectedRefreshFailures, 0);
    assert.equal(app.state().fleetMode, true, 'late 401 cannot sign out a recovered request');
    assert.ok(!app.views.includes('Expired private fleet'));
  }
});

test('dashboard account events cancel hung work immediately and discard old owner outcomes', async () => {
  for (const stage of ['auth', 'summary']) {
    const app = dashboardRefreshHarness(), old = deferred();
    if (stage === 'auth') app.auth(() => old.promise); else app.fetch(() => old.promise);
    const attempt = app.context.refreshProtectedFleetNow();
    await drainTasks();
    app.user({ id: 'new-owner' });
    app.auth(async () => ({ user: { id: 'new-owner' } }));
    app.fetch(async () => app.summary('New owner fleet'));
    await app.context.handleAuthStorageChange({ key: 'occulert-auth' });
    assert.equal(app.state().protectedFleetName, '', 'old private data clears before new protected fetch');
    assert.equal(app.state().protectedReportShape, false);
    await attempt; await drainTasks();
    assert.equal(app.state().protectedUserId, 'new-owner');
    assert.equal(app.state().protectedFleetName, 'New owner fleet');
    old.resolve(stage === 'auth' ? { user: { id: 'owner' } } : app.summary('Old owner private fleet'));
    await drainTasks();
    assert.equal(app.state().protectedFleetName, 'New owner fleet');
    assert.equal(app.state().protectedFleetLoading, false);
    assert.ok(!app.views.includes('Old owner private fleet'));
    assert.ok(!Array.from(app.timers.values()).some(timer => timer.delay === 8000), 'cancelled deadline timers are cleared');
  }
});

test('same-owner credential replacement cancels an old summary and cannot sign out refreshed credentials', async () => {
  for (const late of ['success', '401']) {
    const app = dashboardRefreshHarness(), old = deferred();
    app.fetch(() => old.promise);
    const attempt = app.context.refreshProtectedFleetNow();
    await drainTasks();
    const generation = app.state().protectedFleetGeneration;
    app.fetch(async () => app.summary('Fresh credential fleet'));
    await app.context.handleAuthStorageChange({ key: 'occulert-auth' });
    assert.ok(app.state().protectedFleetGeneration > generation);
    assert.equal(app.state().protectedFleetName, 'Cached private fleet', 'same-owner cache need not disappear during credential recheck');
    await attempt; await drainTasks();
    assert.equal(app.state().protectedFleetName, 'Fresh credential fleet');
    old.resolve(late === 'success' ? app.summary('Expired credential fleet') : { ok: false, status: 401, body: {} });
    await drainTasks();
    assert.equal(app.state().protectedFleetName, 'Fresh credential fleet');
    assert.equal(app.state().protectedFleetLoading, false);
    assert.ok(!app.requests.includes('signOut'), 'expired credentials cannot sign out a newer session');
  }
});

test('uncertain account failures retry automatically while confirmed empty auth clears protected data', async () => {
  for (const auth of [() => Promise.reject(new Error('Account service unreachable')), async () => null]) {
    const app = dashboardRefreshHarness();
    app.auth(auth);
    await app.context.refreshProtectedFleetNow();
    assert.equal(app.state().protectedFleetName, 'Cached private fleet');
    assert.equal(app.state().protectedRefreshFailures, 1);
    assert.equal(app.elements.get('refreshNow').disabled, false);
    app.auth(async () => ({ user: { id: 'owner' } }));
    app.expire(180000); await drainTasks();
    assert.equal(app.state().protectedFleetName, 'Recovered fleet', 'the scheduled retry executes after uncertainty');
    assert.equal(app.state().protectedRefreshFailures, 0);
  }
  const signedOut = dashboardRefreshHarness();
  signedOut.auth(async () => { signedOut.user(null); return null; });
  await signedOut.context.refreshProtectedFleetNow();
  assert.equal(signedOut.state().fleetMode, false);
  assert.equal(signedOut.state().protectedFleetName, '');
  assert.equal(signedOut.state().protectedReportShape, false);
  assert.match(signedOut.elements.get('cloudStatus').textContent, /Not signed in/);
});

test('same-tab account changes and sign-out are rechecked on timeout before retaining cached records', async () => {
  for (const user of [null, { id: 'new-owner' }]) {
    const app = dashboardRefreshHarness(), old = deferred();
    app.fetch(() => old.promise);
    const attempt = app.context.refreshProtectedFleetNow();
    await drainTasks(); app.user(user);
    app.auth(async () => ({ user })); app.fetch(async () => app.summary('New owner fleet'));
    app.expire(8000); await attempt; await drainTasks();
    assert.equal(app.state().protectedUserId, user?.id || '');
    assert.equal(app.state().protectedFleetName, user ? 'New owner fleet' : '');
    assert.equal(app.state().fleetMode, Boolean(user));
    assert.equal(app.state().protectedFleetLoading, false);
    assert.equal(app.elements.get('refreshNow').disabled, false);
    old.resolve(app.summary('Expired owner fleet')); await drainTasks();
    assert.notEqual(app.state().protectedFleetName, 'Expired owner fleet');
  }
});


test('service-worker navigation falls back on a stalled connection and preserves fresh responses through failed cache writes', async () => {
  const listeners = {};
  const cachedPage = { source: 'cached-page', ok: true };
  const homePage = { source: 'cached-home', ok: true };
  const freshPage = { source: 'fresh-page', ok: true, clone: () => ({}) };
  let networkMode = 'hang', cacheMode = 'page', writeMode = 'ok', networkSignal;
  const context = {
    AbortController, URL, Request, Promise, Set, clearTimeout,
    Response: { error: () => ({ source: 'network-error', ok: false }) },
    setTimeout: (callback, timeout) => setTimeout(callback, Math.min(timeout, 10)),
    fetch: (_request, options) => {
      networkSignal = options.signal;
      return networkMode === 'hang' ? new Promise(() => {}) : Promise.resolve(
        networkMode === 'fresh' ? freshPage : { source: 'error-page', ok: false, status: 503 });
    },
    caches: {
      match: async request => cacheMode === 'page' ? cachedPage : request === '/index.html' ? homePage : null,
      open: async () => ({ put: async () => {
        if (writeMode === 'reject') throw new Error('quota exceeded');
        if (writeMode === 'hang') return new Promise(() => {});
      } }),
    },
    self: { location: { origin: 'https://www.occulert.com' }, addEventListener: (name, handler) => { listeners[name] = handler; } },
  };
  runInNewContext(read('sw.js'), context);
  let responsePromise, lifetimePromise;
  const dispatch = () => listeners.fetch({
    request: { method: 'GET', mode: 'navigate', url: 'https://www.occulert.com/app.html' },
    respondWith: promise => { responsePromise = promise; },
    waitUntil: promise => { lifetimePromise = promise; },
  });
  dispatch();
  assert.equal(await responsePromise, cachedPage, 'an unanswered connection must use the installed app shell');
  assert.equal(networkSignal.aborted, true);
  await lifetimePromise;
  networkMode = 'error';
  dispatch();
  assert.equal(await responsePromise, cachedPage, 'a 503 must not discard the cached page');
  await lifetimePromise;
  cacheMode = 'home';
  dispatch();
  assert.equal(await responsePromise, homePage, 'the existing homepage fallback remains available');
  await lifetimePromise;
  networkMode = 'fresh';
  for (writeMode of ['reject', 'hang']) {
    dispatch();
    assert.equal(await responsePromise, freshPage, 'cache failure must not delay or discard a fresh page');
    await lifetimePromise;
  }
});
