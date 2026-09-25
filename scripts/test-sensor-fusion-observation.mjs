import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SENSOR_FUSION_COINCIDENCE_WINDOW_MS,
  createSensorFusionObservationTracker,
} from '../native-app/lib/sensorFusionObservation.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('fusion observation stores bounded aggregates without producing a score', () => {
  const tracker = createSensorFusionObservationTracker();
  tracker.reset(10_000);
  tracker.recordCameraSample({ at: 9_999, state: 'closed', fatigueScore: 100 });
  tracker.recordCameraSample({ at: 10_100, state: 'noFace', fatigueScore: 0 });
  tracker.recordCameraSample({ at: 10_200, state: 'open', fatigueScore: 8 });
  tracker.recordCameraSample({ at: 10_300, state: 'watch', fatigueScore: 42 });
  tracker.recordCameraSample({ at: 10_400, state: 'closed', fatigueScore: 120 });
  tracker.recordHeadphoneSample(10_250);
  tracker.setHeadphoneStatus('active');
  tracker.setWatchStatus({
    moduleAvailable: true,
    paired: true,
    appInstalled: true,
    reachable: false,
  });

  const snapshot = tracker.snapshot(20_500);
  assert.equal(snapshot.mode, 'observation-only');
  assert.equal('score' in snapshot, false);
  assert.equal('recommendation' in snapshot, false);
  assert.deepEqual(snapshot.camera, {
    samples: 4,
    trackedSamples: 3,
    watchSamples: 1,
    closedSamples: 1,
    peakFatigue: 100,
    headNods: 0,
  });
  assert.deepEqual(snapshot.headphone, { status: 'active', samples: 1, headNods: 0 });
  assert.deepEqual(snapshot.watch, {
    checked: true,
    moduleAvailable: true,
    paired: true,
    appInstalled: true,
    reachable: false,
  });
  assert.equal(snapshot.durationSec, 10);
});

test('fusion observation counts one coincidence per headphone nod in either arrival order', () => {
  const tracker = createSensorFusionObservationTracker();
  tracker.reset(1_000);

  tracker.recordCameraHeadNod(2_000);
  tracker.recordCameraSample({ at: 2_100, state: 'watch', fatigueScore: 35 });
  tracker.recordHeadphoneHeadNod(2_300);
  tracker.recordCameraHeadNod(2_400);
  tracker.recordCameraSample({ at: 2_500, state: 'closed', fatigueScore: 70 });

  tracker.recordHeadphoneHeadNod(10_000);
  tracker.recordCameraHeadNod(10_100);
  tracker.recordCameraSample({ at: 10_200, state: 'watch', fatigueScore: 30 });

  const snapshot = tracker.snapshot(11_000);
  assert.equal(snapshot.camera.headNods, 3);
  assert.equal(snapshot.headphone.headNods, 2);
  assert.deepEqual(snapshot.coincidences, {
    cameraHeadphoneNods: 2,
    elevatedCameraHeadphoneNods: 2,
  });
});

test('fusion observation does not pair events outside its bounded window and reset clears state', () => {
  const tracker = createSensorFusionObservationTracker();
  tracker.reset(1_000);
  tracker.recordCameraHeadNod(2_000);
  tracker.recordCameraSample({ at: 2_000, state: 'closed', fatigueScore: 75 });
  tracker.recordHeadphoneHeadNod(2_000 + SENSOR_FUSION_COINCIDENCE_WINDOW_MS + 1);
  assert.deepEqual(tracker.snapshot(8_000).coincidences, {
    cameraHeadphoneNods: 0,
    elevatedCameraHeadphoneNods: 0,
  });

  tracker.reset(20_000);
  const snapshot = tracker.snapshot(20_000);
  assert.equal(snapshot.camera.samples, 0);
  assert.equal(snapshot.headphone.headNods, 0);
  assert.equal(snapshot.watch.checked, false);
});

test('native wiring keeps fusion diagnostics local and outside scoring and alerts', () => {
  const monitor = read('native-app/app/monitor.tsx');
  const alertPolicy = read('native-app/lib/alertPolicy.ts');
  const cloudSync = read('native-app/lib/cloudSync.ts');
  const historyExport = read('native-app/lib/sessionHistoryExport.ts');
  const feedback = read('native-app/lib/feedback.ts');
  const history = read('native-app/app/history.tsx');

  assert.match(monitor, /createSensorFusionObservationTracker/);
  assert.match(monitor, /sensorFusion: sensorFusionTrackerRef\.current\.snapshot/);
  assert.match(monitor, /Watch availability is optional observation context/);
  assert.doesNotMatch(alertPolicy, /sensorFusion/i);
  assert.doesNotMatch(cloudSync, /sensorFusion/i);
  assert.doesNotMatch(historyExport, /sensorFusion/i);
  assert.doesNotMatch(feedback, /sensorFusion/i);
  assert.match(history, /OBSERVATION-ONLY SENSOR FUSION/);
  assert.match(history, /does not change fatigue scores or alerts/);
});
