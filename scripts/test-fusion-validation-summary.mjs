import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FUSION_VALIDATION_SESSION_TARGET,
  summarizeFusionValidation,
} from '../native-app/lib/fusionValidationSummary.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function snapshot(overrides = {}) {
  return {
    version: 1,
    mode: 'observation-only',
    durationSec: 120,
    camera: {
      samples: 100,
      trackedSamples: 90,
      watchSamples: 3,
      closedSamples: 2,
      peakFatigue: 60,
      headNods: 1,
    },
    headphone: { status: 'active', samples: 80, headNods: 1 },
    watch: { checked: true, moduleAvailable: true, paired: true, appInstalled: true, reachable: false },
    coincidences: { cameraHeadphoneNods: 1, elevatedCameraHeadphoneNods: 1 },
    ...overrides,
  };
}

test('fusion validation summarizes only complete local observations', () => {
  const summary = summarizeFusionValidation([
    { sensorFusion: snapshot() },
    {
      sensorFusion: snapshot({
        durationSec: 180,
        headphone: { status: 'unavailable', samples: 0, headNods: 0 },
        watch: { checked: true, moduleAvailable: true, paired: true, appInstalled: false, reachable: false },
        coincidences: { cameraHeadphoneNods: 0, elevatedCameraHeadphoneNods: 0 },
      }),
    },
    { sensorFusion: snapshot(), recoveredFromInterruption: true },
    { sensorFusion: { mode: 'observation-only' } },
    {},
  ], 2);

  assert.deepEqual(summary, {
    observedSessions: 2,
    recoveredSessionsExcluded: 1,
    observationDurationSec: 300,
    cameraSessions: 2,
    headphoneSessions: 1,
    watchCheckedSessions: 2,
    watchPairedSessions: 2,
    watchInstalledSessions: 1,
    watchReachableSessions: 0,
    overlapSessions: 1,
    cameraHeadphoneNodOverlaps: 1,
    elevatedCameraHeadphoneNodOverlaps: 1,
    sessionTarget: 2,
    insufficientData: false,
    missingCoverage: [],
  });
  assert.equal('score' in summary, false);
  assert.equal('rate' in summary, false);
  assert.equal('recommendation' in summary, false);
});

test('fusion validation names missing optional coverage without inventing evidence', () => {
  const summary = summarizeFusionValidation([
    {
      sensorFusion: snapshot({
        durationSec: Number.NaN,
        camera: { samples: 0 },
        headphone: { status: 'unavailable', samples: 0 },
        watch: { checked: false },
        coincidences: { cameraHeadphoneNods: -4, elevatedCameraHeadphoneNods: Number.POSITIVE_INFINITY },
      }),
    },
  ]);

  assert.equal(summary.sessionTarget, FUSION_VALIDATION_SESSION_TARGET);
  assert.equal(summary.observationDurationSec, 0);
  assert.equal(summary.insufficientData, true);
  assert.deepEqual(summary.missingCoverage, [
    '4 more complete fusion sessions',
    'camera observations',
    'compatible headphone motion',
    'Apple Watch availability checks',
  ]);
  assert.equal(summary.cameraHeadphoneNodOverlaps, 0);
  assert.equal(summary.elevatedCameraHeadphoneNodOverlaps, 0);
});

test('fusion validation dashboard remains local, aggregate, and observation-only', () => {
  const history = read('native-app/app/history.tsx');
  const cloudSync = read('native-app/lib/cloudSync.ts');
  const historyExport = read('native-app/lib/sessionHistoryExport.ts');
  const pilotExport = read('native-app/lib/pilotProgressExport.ts');
  const feedback = read('native-app/lib/feedback.ts');

  assert.match(history, /LOCAL FUSION VALIDATION/);
  assert.match(history, /No accuracy rate or safety score is produced/);
  assert.match(history, /excluded from sync, exports, and feedback/);
  assert.doesNotMatch(cloudSync, /summarizeFusionValidation/);
  assert.doesNotMatch(historyExport, /summarizeFusionValidation/);
  assert.doesNotMatch(pilotExport, /summarizeFusionValidation/);
  assert.doesNotMatch(feedback, /summarizeFusionValidation/);
});
