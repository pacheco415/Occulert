import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMonitorPresentation } from '../lib/monitorPresentationModel.ts';
import { buildMonitorCheckpoint } from '../lib/monitorCheckpointModel.ts';
import { isActiveSessionCheckpoint } from '../lib/sessionRecoveryModel.ts';

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
