import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assessCameraSetup,
  initialCameraSetupAssessment,
} from '../native-app/lib/cameraSetup.ts';
import {
  prependRecoveredSession,
  SESSION_RECOVERY_MAX_AGE_MS,
  recoveredSessionFromCheckpoint,
} from '../native-app/lib/sessionRecoveryModel.ts';
import {
  normalizeHistoryFilter,
  sortIndexedSessionsNewest,
} from '../native-app/lib/historyPreferences.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const READY_SAMPLE = {
  faceFound: true,
  faceX: 350,
  faceY: 280,
  faceWidth: 300,
  faceHeight: 400,
  frameWidth: 1_000,
  frameHeight: 1_000,
  leftEyeOpenProbability: 0.8,
  rightEyeOpenProbability: 0.82,
  pitchAngle: 2,
  yawAngle: -3,
  rollAngle: 1,
};

const PERFORMANCE = {
  samples: 120,
  uiUpdates: 30,
  averageInferenceMs: 12,
  p95InferenceMs: 18,
  averageSampleIntervalMs: 100,
  timeToFirstSampleMs: 450,
  uiUpdatesPerSecond: 4,
  cameraStalls: 0,
};

const CHECKPOINT = {
  sessionId: 'session-1000',
  startedAt: 1_000,
  checkpointedAt: 31_000,
  durationSec: 30,
  alertCount: 1,
  avgFatigue: 22,
  maxFatigue: 48,
  headNodObservations: 2,
  cameraHeadNodObservations: 2,
  headphoneHeadNodObservations: 0,
  headphoneMotionSamples: 0,
  headphoneMotionStatus: 'unavailable',
  monitorPerformance: PERFORMANCE,
  sensitivity: 'medium',
  appVersion: '1.0.0',
  appBuildNumber: '34',
};

test('camera setup starts in a parked, non-ready state', () => {
  const assessment = initialCameraSetupAssessment();
  assert.equal(assessment.state, 'waiting');
  assert.equal(assessment.ready, false);
  assert.match(assessment.detail, /parked/i);
});

test('camera setup gives specific positioning and visibility guidance', () => {
  assert.equal(assessCameraSetup({ ...READY_SAMPLE, faceFound: false }).state, 'no-face');
  assert.match(
    assessCameraSetup({ ...READY_SAMPLE, faceX: 850 }).title,
    /Reposition/,
  );
  assert.match(
    assessCameraSetup({ ...READY_SAMPLE, faceWidth: 80, faceHeight: 90 }).title,
    /closer/,
  );
  assert.equal(
    assessCameraSetup({ ...READY_SAMPLE, leftEyeOpenProbability: -1 }).state,
    'visibility',
  );
});

test('camera setup reports ready only when framing, pose, and eye visibility pass', () => {
  const assessment = assessCameraSetup(READY_SAMPLE);
  assert.equal(assessment.state, 'ready');
  assert.equal(assessment.ready, true);
  assert.equal(assessment.faceCentered, true);
  assert.equal(assessment.faceSized, true);
  assert.equal(assessment.facingCamera, true);
  assert.equal(assessment.eyesVisible, true);
});

test('a recent checkpoint becomes a clearly marked partial local session', () => {
  const recovered = recoveredSessionFromCheckpoint(CHECKPOINT, CHECKPOINT.checkpointedAt + 1_000);
  assert.ok(recovered);
  assert.equal(recovered.sessionId, CHECKPOINT.sessionId);
  assert.equal(recovered.recoveredFromInterruption, true);
  assert.equal(recovered.durationSec, 30);
  assert.match(recovered.recoveryNote, /local checkpoint/i);
  assert.equal(recovered.savedAt, new Date(CHECKPOINT.checkpointedAt).toISOString());
});

test('empty, future, and expired checkpoints are not presented as recovered drives', () => {
  assert.equal(recoveredSessionFromCheckpoint({ ...CHECKPOINT, durationSec: 0 }, 32_000), null);
  assert.equal(recoveredSessionFromCheckpoint(CHECKPOINT, CHECKPOINT.checkpointedAt - 1), null);
  assert.equal(
    recoveredSessionFromCheckpoint(
      CHECKPOINT,
      CHECKPOINT.checkpointedAt + SESSION_RECOVERY_MAX_AGE_MS + 1,
    ),
    null,
  );
});

test('recovery never replaces a complete record with an older partial copy', () => {
  const recovered = recoveredSessionFromCheckpoint(CHECKPOINT, CHECKPOINT.checkpointedAt + 1_000);
  assert.ok(recovered);
  const complete = { sessionId: CHECKPOINT.sessionId, savedAt: 'complete', cloudSynced: true };
  const duplicate = prependRecoveredSession([complete], recovered);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.sessions[0], complete);

  const inserted = prependRecoveredSession([{ sessionId: 'another-session' }], recovered);
  assert.equal(inserted.inserted, true);
  assert.equal(inserted.sessions[0].sessionId, CHECKPOINT.sessionId);
  assert.equal(inserted.sessions[0].recoveredFromInterruption, true);
});

test('session history restores only known filters and sorts newest without losing storage indexes', () => {
  assert.equal(normalizeHistoryFilter('reviewed'), 'reviewed');
  assert.equal(normalizeHistoryFilter('unexpected'), 'all');
  assert.equal(normalizeHistoryFilter(null), 'all');

  const original = [
    { sessionId: 'older', savedAt: '2026-01-01T12:00:00.000Z' },
    { sessionId: 'invalid', savedAt: 'not-a-date' },
    { sessionId: 'newer', savedAt: '2026-02-01T12:00:00.000Z' },
    { sessionId: 'updated', updatedAt: '2026-01-15T12:00:00.000Z' },
  ];
  const sorted = sortIndexedSessionsNewest(original);
  assert.deepEqual(sorted.map(entry => entry.item.sessionId), ['newer', 'updated', 'older', 'invalid']);
  assert.deepEqual(sorted.map(entry => entry.index), [2, 3, 0, 1]);
});

test('native screens wire setup preview and recovery without changing detection inputs', () => {
  const monitor = read('native-app/app/monitor.tsx');
  const home = read('native-app/app/index.tsx');
  const history = read('native-app/app/history.tsx');
  const historyPreferences = read('native-app/lib/historyPreferences.ts');
  const recovery = read('native-app/lib/sessionRecoveryModel.ts');

  assert.match(monitor, /isActive=\{isRunning \|\| setupPreviewActive\}/);
  assert.match(monitor, /setupPreviewActiveRef\.current && !isRunningRef\.current/);
  assert.match(monitor, /return;\s*}\s*\/\/ A frame already crossing/);
  assert.match(monitor, /SESSION_CHECKPOINT_INTERVAL_MS = 15_000/);
  assert.match(monitor, /clearActiveSessionCheckpoint\(activeSessionId\)/);
  assert.match(home, /recoveredSessionFromCheckpoint/);
  assert.match(home, /Previous drive recovered/);
  assert.match(home, /prependRecoveredSession\(sessions, recovered\)/);
  assert.match(home, /must never replace the complete record with an older partial copy/);
  assert.match(home, /setRecoveryState\('error'\)/, 'a failed recovery check must become visible');
  assert.match(home, /accessibilityLabel="Retry previous drive recovery"/, 'failed recovery must provide an accessible retry');
  assert.doesNotMatch(home, /recoverInterruptedDrive\(\)\.catch\(\(\) => \{\}\)/, 'recovery failures must not be silently swallowed');
  assert.match(history, /Recovered local checkpoint/);
  assert.match(history, /sessions\.filter\(item => !item\.recoveredFromInterruption\)/);
  assert.match(history, /Recovered partial sessions are excluded/);
  assert.match(historyPreferences, /type HistoryFilter = 'all' \| 'needs-review' \| 'reviewed' \| 'recovered'/);
  assert.match(history, /accessibilityState=\{\{ selected \}\}/, 'history filters must expose their selected state');
  assert.match(history, /filteredSessions\.map\(\(\{ item, index: i \}\)/, 'filtered edits must retain their original stored index');
  assert.match(history, /Showing \{filteredSessions\.length\} of \{sessions\.length\} sessions/);
  assert.match(history, /All caught up/);
  assert.match(history, /AsyncStorage\.setItem\(HISTORY_FILTER_KEY, filter\)/);
  assert.match(history, /sortIndexedSessionsNewest\(sessions\)/);
  assert.match(history, /filterRevisionRef\.current === filterRevision/, 'a late preference load must not replace a newer filter choice');
  assert.match(history, /filterButton: \{ minHeight: 44/);
  assert.doesNotMatch(recovery, /cameraFrame|video|audio|location|gps/i);
});

test('pre-drive and Settings explain required versus optional setup', () => {
  const preDrive = read('native-app/app/pre-drive.tsx');
  const settings = read('native-app/app/settings.tsx');
  assert.match(preDrive, /FINAL SAFETY CONFIRMATION/);
  assert.match(preDrive, /checked\.filter\(Boolean\)\.length/);
  assert.match(preDrive, /it never decides whether you are safe to drive/);
  assert.match(preDrive, /accessibilityLabel=\{healthSnapshot \?/);
  assert.match(preDrive, /accessibilityLabel="Continue to monitoring"/);
  assert.match(preDrive, /accessibilityHint=\{ready \?/);
  assert.match(preDrive, /healthMetrics: \{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.match(settings, /The iPhone camera and at least one phone alert are the primary setup/);
  assert.match(settings, /Watch, headphones, Health, and cloud sync are optional additions/);
});

test('safe-stop choices remain readable and accessible at larger text sizes', () => {
  const monitor = read('native-app/app/monitor.tsx');
  assert.match(monitor, /accessibilityLabel="Safe stop options"/);
  assert.match(monitor, /accessibilityViewIsModal/);
  assert.match(monitor, /accessibilityHint=\{`\$\{option\.detail\}/);
  assert.match(monitor, /safeStopOption: \{\s*minHeight: 64/);
  assert.match(monitor, /safeStopCancel: \{ minHeight: 44/);
});

test('connected-device readiness refresh remains single-flight', () => {
  const settings = read('native-app/app/settings.tsx');
  assert.match(settings, /deviceRefreshRunnerRef\.current\.run/);
  assert.match(settings, /REFRESH CONNECTIONS/);
  assert.match(settings, /Promise\.all\(\[\s*getWatchStatus\(\),\s*getWatchAlertsEnabled\(true\),\s*getHeadphoneMotionStatus\(\)/);
});

test('parked dual-camera probe measures an Apple capture graph without starting capture', () => {
  const nativeProbe = read(
    'native-app/modules/occulert-device-condition/ios/OcculertDeviceConditionModule.swift',
  );
  const sources = read('native-app/lib/deviceReadinessSources.ts');
  const probeStart = nativeProbe.indexOf('private static func probeMultiCamConfiguration');
  const probeEnd = nativeProbe.indexOf('private static func runMultiCamStabilityTest', probeStart);
  const probeFunction = nativeProbe.slice(probeStart, probeEnd);

  assert.ok(probeStart >= 0 && probeEnd > probeStart, 'configuration probe must be present');
  assert.match(probeFunction, /buildMultiCamGraph\(\)/);
  assert.match(probeFunction, /session\.hardwareCost/);
  assert.match(probeFunction, /session\.systemPressureCost/);
  assert.doesNotMatch(probeFunction, /startRunning\(\)/);
  assert.match(sources, /Camera\.getCameraPermissionStatus\(\) === 'granted'/);
  assert.match(sources, /await probeMultiCamConfiguration\(\)/);
});

test('live parked test is bounded, counts both streams, and protects the driver camera', () => {
  const nativeProbe = read(
    'native-app/modules/occulert-device-condition/ios/OcculertDeviceConditionModule.swift',
  );
  const readinessCard = read('native-app/components/ParkedReadinessCard.tsx');
  const start = nativeProbe.indexOf('private static func runMultiCamStabilityTest');
  const end = nativeProbe.indexOf('private static func buildMultiCamGraph', start);
  const stabilityFunction = nativeProbe.slice(start, end);

  assert.ok(start >= 0 && end > start, 'stability test must be present');
  assert.match(stabilityFunction, /min\(max\(requestedDurationMs, 3_000\), 10_000\)/);
  assert.match(stabilityFunction, /session\.startRunning\(\)/);
  assert.match(stabilityFunction, /session\.stopRunning\(\)/);
  assert.match(stabilityFunction, /backConnection\.isEnabled = false/);
  assert.match(stabilityFunction, /frontCounter\.count == 0/);
  assert.match(stabilityFunction, /roadStreamStayedEnabled/);
  assert.match(nativeProbe, /OcculertFrameCounter/);
  assert.match(readinessCard, /Run parked camera test/);
  assert.match(readinessCard, /No images or video are saved/);
  assert.match(readinessCard, /Testing for 5 seconds/);
});
