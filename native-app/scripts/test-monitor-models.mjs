import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMonitorPresentation } from '../lib/monitorPresentationModel.ts';
import { buildMonitorCheckpoint } from '../lib/monitorCheckpointModel.ts';
import { isActiveSessionCheckpoint, parseActiveSessionCheckpoint, prependRecoveredSession, recoveredSessionFromCheckpoint } from '../lib/sessionRecoveryModel.ts';

test('monitor status keeps lifecycle guidance ahead of detector state and preserves every existing color', () => {
  const base = { metrics: { state: 'open' }, sensorFault: null, isStopping: false, isStarting: false, cameraRecovering: false,
    isRunning: false, setupPreviewActive: false, cameraSetup: { ready: false } };
  for (const [changes, label, color, recoveryRequired = false] of [
    [{}, 'NOT MONITORING', '#64d2ff'],
    [{ setupPreviewActive: true }, 'CHECKING SETUP', '#64d2ff'],
    [{ setupPreviewActive: true, cameraSetup: { ready: true } }, 'SETUP READY', '#30d158'],
    [{ isStarting: true }, 'STARTING', '#64d2ff'],
    [{ isStopping: true }, 'SAVING DRIVE', '#64d2ff'],
    [{ cameraRecovering: true }, 'RECOVERING CAMERA', '#fbbf24'],
    [{ isRunning: true }, 'TRACKING', '#00ff88'],
    [{ isRunning: true, metrics: { state: 'watch' } }, 'CHECKING EYES', '#fbbf24'],
    [{ isRunning: true, metrics: { state: 'closed' } }, 'DROWSINESS ALERT', '#ff3344'],
    [{ isRunning: true, metrics: { state: 'noFace' } }, 'TRACKING UNAVAILABLE', '#fbbf24'],
    [{ sensorFault: 'Camera unavailable', isStopping: true, cameraRecovering: true }, 'STOPPED · CHECK CAMERA', '#ef4444'],
    [{ sensorFault: 'Monitoring did not start because recovery is required', isStarting: true }, 'RECOVERY REQUIRED', '#ef4444', true],
  ]) assert.deepEqual(deriveMonitorPresentation({ ...base, ...changes }), { recoveryRequired, monitorStatusLabel: label, monitorStatusColor: color });
});

test('checkpoint model preserves local recovery identity, averaging and its bounded existing field set', () => {
  const input = { sessionId: 'local-original', startedAt: 1_000, checkpointedAt: 31_999, alertCount: 2,
    fatigueSum: 63, fatigueSamples: 2, maxFatigue: 80, headNodObservations: 3, headphoneHeadNodObservations: 4,
    headphoneMotionSamples: 5, headphoneMotionStatus: 'unavailable', monitorPerformance: { samples: 0, uiUpdates: 0 },
    sensitivity: 'medium', buildInfo: Object.freeze({ appVersion: 'fixture', appBuildNumber: 'fixture' }), latitude: 99 };
  const original = structuredClone(input); Object.freeze(input);
  const snapshot = buildMonitorCheckpoint(input);
  assert.deepEqual(input, original); assert.equal(snapshot.sessionId, 'local-original'); assert.equal(snapshot.durationSec, 30);
  assert.equal(snapshot.avgFatigue, 32); assert.equal(snapshot.cameraHeadNodObservations, 3); assert.equal(snapshot.headNodObservations, 3);
  assert.equal(Object.hasOwn(snapshot, 'fatigueSum'), false); assert.equal(Object.hasOwn(snapshot, 'latitude'), false);
  assert.equal(isActiveSessionCheckpoint(snapshot), true);
  assert.equal(buildMonitorCheckpoint({ ...input, fatigueSum: 0, fatigueSamples: 0 }).avgFatigue, 0);
  assert.equal(buildMonitorCheckpoint({ ...input, fatigueSum: 0, fatigueSamples: 1 }).avgFatigue, 0);
});

test('optional observation counts are copied into checkpoints and recovered History without a resumable window', () => {
  const diagnostics = { version: 1, mode: 'observation-only', evidence: 'software-output-accepted', candidates: 1,
    byMotion: { unknown: 1, unavailable: 0, denied: 0, stale: 0, 'not-moving': 0, 'reported-activity': 0 } };
  const input = { sessionId: 'observed', startedAt: 1_000, checkpointedAt: 31_000, alertCount: 2,
    fatigueSum: 20, fatigueSamples: 1, maxFatigue: 20, headNodObservations: 0, headphoneHeadNodObservations: 0,
    headphoneMotionSamples: 0, headphoneMotionStatus: 'unavailable', monitorPerformance: { samples: 1 },
    sensitivity: 'medium', buildInfo: {}, unansweredAlerts: diagnostics };
  const checkpoint = buildMonitorCheckpoint(input);
  assert.deepEqual(checkpoint.unansweredAlerts, diagnostics); assert.notEqual(checkpoint.unansweredAlerts.byMotion, diagnostics.byMotion);
  diagnostics.byMotion.unknown = 9;
  assert.equal(checkpoint.unansweredAlerts.byMotion.unknown, 1);
  const parsed = parseActiveSessionCheckpoint(JSON.stringify(checkpoint));
  const recovered = recoveredSessionFromCheckpoint(parsed, 32_000);
  assert.deepEqual(recovered.unansweredAlerts, checkpoint.unansweredAlerts);
  assert.notEqual(recovered.unansweredAlerts.byMotion, parsed.unansweredAlerts.byMotion);
  const inserted = prependRecoveredSession([], recovered).sessions[0];
  recovered.unansweredAlerts.byMotion.unknown = 9;
  assert.equal(inserted.unansweredAlerts.byMotion.unknown, 1);
  assert.deepEqual(Object.keys(inserted.unansweredAlerts).sort(), ['byMotion','candidates','evidence','mode','version']);
  const { unansweredAlerts: _diagnostics, ...withoutObservation } = input;
  assert.equal(Object.hasOwn(buildMonitorCheckpoint(withoutObservation), 'unansweredAlerts'), false);
  for (const malformed of [null, {}, { ...checkpoint.unansweredAlerts, armedAt: 1 }, { ...checkpoint.unansweredAlerts, candidates: 2 }]) {
    assert.equal(isActiveSessionCheckpoint({ ...checkpoint, unansweredAlerts: malformed }), false);
    assert.throws(() => parseActiveSessionCheckpoint(JSON.stringify({ ...checkpoint, unansweredAlerts: malformed })), /checkpoint could not be read/);
    assert.equal(recoveredSessionFromCheckpoint({ ...checkpoint, unansweredAlerts: malformed }, 32_000), null);
  }
});
