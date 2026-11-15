import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { parse } from 'acorn';
import { buildDriverArtifact } from './lib/driver-build.mjs';
import { createAppHarness } from './lib/app-page-harness.mjs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const source = read('src/metrics.js'), ast = parse(source, { ecmaVersion: 2022, sourceType: 'module' });
const functions = ['createEyeCoverageTracker', 'eyeCoveragePercentage'].map(name => {
  const node = ast.body.find(node => node.type === 'ExportNamedDeclaration' && node.declaration?.id?.name === name)?.declaration;
  assert.ok(node, 'Test the actual production ' + name);
  return source.slice(node.start, node.end);
}).join('\n');
const model = vm.runInNewContext(functions + ';({createEyeCoverageTracker,eyeCoveragePercentage})');
const plain = value => JSON.parse(JSON.stringify(value));
const tracker = () => model.createEyeCoverageTracker(0, 6000);
const compiled = await buildDriverArtifact({ sourceRoot: fileURLToPath(new URL('../src', import.meta.url)),
  contractPath: fileURLToPath(new URL('../source-driver-contract.json', import.meta.url)) });
const catalog = { module: { exports: {} } };
vm.runInNewContext(read('src/driver-i18n.js'), catalog);

test('no eligible duration is unknown, including all-calibration and zero-length sessions', () => {
  for (const at of [0, 3200, 60000]) {
    const c = tracker(); c.observe(0, true, true); c.observe(at, true, true);
    assert.deepEqual(plain(c.stop(at)), { detectedMs: 0, monitoredMs: 0, percent: null });
  }
  const c = tracker(); c.calibration(0, false); c.observe(0, true, false);
  assert.equal(c.stop(0).percent, null);
});

test('coverage weights elapsed intervals, not the number of positive frames', () => {
  for (const dense of [false, true]) {
    const c = tracker(); c.calibration(1000, false); c.observe(1000, true, false);
    if (dense) for (let at = 1100; at < 2000; at += 100) c.observe(at, true, false);
    c.observe(2000, false, false); c.observe(4000, true, false);
    assert.deepEqual(plain(c.stop(5000)), { detectedMs: 2000, monitoredMs: 4000, percent: 50 });
  }
});

test('a valid observation expires at the existing six-second boundary during callback gaps', () => {
  for (const [stopAt, detectedMs, percent] of [[5999, 5999, 100], [6000, 6000, 100], [6001, 6000, 100], [9000, 6000, 67]]) {
    const c = tracker(); c.calibration(0, false); c.observe(0, true, false);
    assert.deepEqual(plain(c.stop(stopAt)), { detectedMs, monitoredMs: stopAt, percent });
  }
  const c = tracker(); c.calibration(0, false); c.observe(0, true, false);
  c.observe(8000, false, false); c.observe(10000, true, false);
  assert.deepEqual(plain(c.stop(12000)), { detectedMs: 8000, monitoredMs: 12000, percent: 67 });
});

test('recalibration excludes its whole interval and clears the previous detected state', () => {
  const c = tracker(); c.observe(1000, true, true); c.calibration(2000, false);
  c.observe(2000, true, false); c.calibration(4000, true); c.observe(5000, true, true);
  c.calibration(8000, false); c.observe(9000, true, false);
  assert.deepEqual(plain(c.stop(10000)), { detectedMs: 3000, monitoredMs: 4000, percent: 75 });
});

test('stop freezes one snapshot and ignores later observations and calibration changes', () => {
  const c = tracker(); c.calibration(1000, false); c.observe(1000, true, false);
  const stopped = plain(c.stop(2500));
  c.observe(9000, false, false); c.calibration(10000, true);
  assert.deepEqual(plain(c.stop(20000)), stopped);
  const copy = c.snapshot(); copy.detectedMs = -1;
  assert.deepEqual(plain(c.snapshot()), stopped);
});

test('invalid and backwards timestamps cannot add duration or replace the current observation', () => {
  const c = tracker(); c.calibration(1000, false); c.observe(1000, true, false);
  for (const at of [999, -1, NaN, Infinity, '2000', Number.MAX_SAFE_INTEGER + 1]) c.observe(at, false, true);
  assert.deepEqual(plain(c.stop(2000)), { detectedMs: 1000, monitoredMs: 1000, percent: 100 });
  for (const at of [NaN, -1, Infinity]) assert.throws(() => model.createEyeCoverageTracker(at, 6000), /Invalid eye coverage clock/);
});

test('legacy missing and malformed percentages remain unknown while genuine zero is recorded', () => {
  for (const summary of [undefined, null, [], {}, { monitoredMs: 100 }, ...[null, undefined, '', ' ', false, true, [], [50], {}, NaN, Infinity, -1, 101, 'invalid'].map(percent => ({ percent }))])
    assert.equal(model.eyeCoveragePercentage(summary), null);
  for (const [percent, expected] of [[0, 0], ['0', 0], [50.4, 50], [' 50.6 ', 51], [100, 100]])
    assert.equal(model.eyeCoveragePercentage({ percent }), expected);
  const c = tracker(); c.calibration(0, false); c.observe(0, false, false);
  assert.deepEqual(plain(c.stop(1000)), { detectedMs: 0, monitoredMs: 1000, percent: 0 });
});

async function mounted({ initialStorage = {}, locale = 'en' } = {}) {
  let time = 0;
  const h = createAppHarness({ sourceOverride: compiled.code, initialStorage,
    sandboxOverrides: { performance: { now: () => time },
      OcculertDriverI18n: { get: (key, params) => catalog.module.exports.text(locale, key, params) } } });
  h.run(`navigator.mediaDevices = {getUserMedia: async () => { throw Error('Unexpected real camera request'); }};
    initModel = async () => {}; verifyFirstInference = async () => {};
    openSelectedCamera = async () => ({ getTracks: () => [] });
    initCloud = async () => {}; requestSessionWakeLock = async () => {}; loop = () => {};`);
  await h.run('start()');
  assert.equal(h.run('running'), true);
  return { h, at(value) { time = value; },
    rows: () => plain(h.run("JSON.parse(localStorage.getItem('occulert-session-history'))")),
    reportLine: () => h.el('report').children.at(-1).textContent };
}

test('actual start/result/stop path stores elapsed coverage locally and excludes fleet/cloud payloads', async () => {
  const f = await mounted({ locale: 'es' }), { h } = f;
  f.at(3200); h.clock.advance(3200);
  h.run('onResults(' + JSON.stringify({ multiFaceLandmarks: [h.landmarks()] }) + ')');
  assert.equal(h.run('calibrating'), false, 'The real result completes calibration before coverage starts');
  f.at(4200); h.clock.advance(1000); h.run('onResults({multiFaceLandmarks:[]})');
  f.at(6200); h.clock.advance(2000);
  h.run('onResults(' + JSON.stringify({ multiFaceLandmarks: [h.landmarks()] }) + ')');
  f.at(7200); h.clock.advance(1000); await h.run('stop()');
  assert.deepEqual(f.rows()[0].eyeCoverage, { detectedMs: 2000, monitoredMs: 4000, percent: 50 });
  assert.equal(f.reportLine(), 'Ojos detectados: 50% de la sesión');
  assert.equal(h.run("Object.hasOwn(JSON.parse(localStorage.getItem('occulert-live-session')), 'eyeCoverage')"), false);
  assert.equal(h.run("Object.hasOwn(fleetPayload(), 'eyeCoverage')"), false);
  await h.run(`cloudConsent.checked = true;
    getCloudSummaryOutbox = () => ({ enqueue: (_scope, entry) => { globalThis.savedCloudEntry = entry; return true; },
      flush: async () => new Set(['synthetic-session']) });
    finishBackendSession(JSON.parse(localStorage.getItem('occulert-session-history'))[0],
      {id:'synthetic-session',scope:{ownerId:'synthetic-owner'},consented:true,eventQueue:Promise.resolve()});`);
  assert.deepEqual(Object.keys(plain(h.run('savedCloudEntry.stats'))), ['average_fatigue', 'max_fatigue', 'safety_score', 'alert_count', 'head_nod_count']);
  assert.equal(h.run("JSON.stringify(savedCloudEntry).includes('eyeCoverage')"), false);
});

test('actual observer uses raw booleans even without a tracking badge or before delayed text appears', async () => {
  const f = await mounted(), { h } = f;
  f.at(1000); h.run('set_calibrating(false); updateTrackingState(true, true);');
  f.at(2000); h.run(`const originalGet = document.getElementById;
    document.getElementById = id => id === 'trackingBadge' ? null : originalGet(id);
    updateTrackingState(true, false);`);
  f.at(3000); await h.run('stop()');
  assert.deepEqual(f.rows()[0].eyeCoverage, { detectedMs: 1000, monitoredMs: 2000, percent: 50 });
});

test('actual stop and restart cannot inherit old detection time, and calibration-only remains unknown', async () => {
  const f = await mounted(), { h } = f;
  f.at(1000); h.run('set_calibrating(false); updateTrackingState(true, true);');
  f.at(2000); await h.run('stop()');
  const first = f.rows()[0];
  f.at(50000); await h.run('stop()');
  assert.deepEqual(f.rows()[0], first, 'Repeated stop preserves the first saved record');
  await h.run('start()');
  f.at(60000); await h.run('stop()');
  assert.equal(f.rows().length, 2);
  assert.deepEqual(f.rows()[0].eyeCoverage, { detectedMs: 0, monitoredMs: 0, percent: null });
  assert.equal(f.reportLine(), 'Eyes detected: Unknown');
});

test('foreground stop and detector pause freeze before later callbacks or asynchronous teardown', async () => {
  for (const pause of ['handleVisibilityChange(true)', 'set_running(false)']) {
    const f = await mounted(), { h } = f;
    f.at(1000); h.run('set_calibrating(false); updateTrackingState(true, true);');
    f.at(2500); await h.run(pause);
    f.at(20000); h.run('updateTrackingState(true, true);'); await h.run('stop()');
    assert.deepEqual(f.rows()[0].eyeCoverage, { detectedMs: 1500, monitoredMs: 1500, percent: 100 });
  }
});

test('wall-clock adjustments do not change actual coverage elapsed time', async () => {
  const f = await mounted(), { h } = f;
  f.at(1000); h.run('set_calibrating(false); updateTrackingState(true, true);');
  h.clock.advance(86400000); f.at(2000); h.run('updateTrackingState(false, false);');
  h.clock.advance(-172800000); f.at(4000); await h.run('stop()');
  assert.deepEqual(f.rows()[0].eyeCoverage, { detectedMs: 1000, monitoredMs: 3000, percent: 33 });
});

test('a legacy saved record stays byte-for-byte unchanged and its report is unknown, never zero', async () => {
  const legacy = { historyVersion: 1, localRecordId: 'legacy-record', id: 'legacy-session', sessionId: 'legacy-session',
    savedAt: '2026-11-01T12:00:00.000Z', unknown: { preserve: true } };
  const bytes = JSON.stringify([legacy]);
  const f = await mounted({ initialStorage: { 'occulert-session-history': bytes } }), { h } = f;
  h.run("localSessionId = 'legacy-session';");
  f.at(1000); h.run('set_calibrating(false); updateTrackingState(false, false);');
  f.at(2000); await h.run('stop()');
  assert.equal(h.run("localStorage.getItem('occulert-session-history')"), bytes);
  assert.equal(Object.hasOwn(f.rows()[0], 'eyeCoverage'), false);
  assert.equal(f.reportLine(), 'Eyes detected: Unknown');
});

test('all eight actual catalog entries format numeric and unknown eye-coverage lines', () => {
  const { locales, text } = catalog.module.exports;
  for (const locale of ['en', 'es', 'fr', 'pt', 'de', 'ar', 'zh', 'ja']) {
    assert.equal(text(locale, 'report.eyeCoverage', { percent: 42 }), locales[locale]['driver.report.eyeCoverage'].replace('{percent}', '42'));
    assert.equal(text(locale, 'report.eyeCoverageUnknown'), locales[locale]['driver.report.eyeCoverageUnknown']);
    assert.equal(text(locale, 'report.eyeCoverage', { percent: NaN }, 'Unknown'), 'Unknown');
  }
});
