import type { SensorFusionObservationSnapshot } from './sensorFusionObservation';

export const FUSION_VALIDATION_SESSION_TARGET = 5;

export interface FusionValidationSession {
  sensorFusion?: SensorFusionObservationSnapshot;
  recoveredFromInterruption?: boolean;
}

export interface FusionValidationSummary {
  observedSessions: number;
  recoveredSessionsExcluded: number;
  observationDurationSec: number;
  cameraSessions: number;
  headphoneSessions: number;
  watchCheckedSessions: number;
  watchPairedSessions: number;
  watchInstalledSessions: number;
  watchReachableSessions: number;
  overlapSessions: number;
  cameraHeadphoneNodOverlaps: number;
  elevatedCameraHeadphoneNodOverlaps: number;
  sessionTarget: number;
  insufficientData: boolean;
  missingCoverage: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isObservationSnapshot(value: unknown): value is SensorFusionObservationSnapshot {
  if (!isObject(value) || value.mode !== 'observation-only') return false;
  return isObject(value.camera)
    && isObject(value.headphone)
    && isObject(value.watch)
    && isObject(value.coincidences);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * Summarizes local aggregate coverage for observation planning only.
 *
 * This deliberately produces no score, rate, recommendation, or alert input.
 * Recovered partial sessions and malformed snapshots are excluded.
 */
export function summarizeFusionValidation(
  sessions: FusionValidationSession[],
  sessionTarget = FUSION_VALIDATION_SESSION_TARGET,
): FusionValidationSummary {
  const target = Number.isFinite(sessionTarget) && sessionTarget > 0
    ? Math.floor(sessionTarget)
    : FUSION_VALIDATION_SESSION_TARGET;
  const recoveredSessionsExcluded = sessions.filter(session => (
    session.recoveredFromInterruption && isObservationSnapshot(session.sensorFusion)
  )).length;
  const snapshots = sessions
    .filter(session => !session.recoveredFromInterruption)
    .map(session => session.sensorFusion)
    .filter(isObservationSnapshot);

  const cameraSessions = snapshots.filter(snapshot => count(snapshot.camera.samples) > 0).length;
  const headphoneSessions = snapshots.filter(snapshot => (
    count(snapshot.headphone.samples) > 0 || snapshot.headphone.status === 'active'
  )).length;
  const watchCheckedSessions = snapshots.filter(snapshot => snapshot.watch.checked === true).length;
  const watchPairedSessions = snapshots.filter(snapshot => snapshot.watch.paired === true).length;
  const watchInstalledSessions = snapshots.filter(snapshot => snapshot.watch.appInstalled === true).length;
  const watchReachableSessions = snapshots.filter(snapshot => snapshot.watch.reachable === true).length;
  const overlapSessions = snapshots.filter(snapshot => (
    count(snapshot.coincidences.cameraHeadphoneNods) > 0
  )).length;
  const missingCoverage: string[] = [];

  if (snapshots.length < target) missingCoverage.push(`${target - snapshots.length} more complete fusion sessions`);
  if (cameraSessions === 0) missingCoverage.push('camera observations');
  if (headphoneSessions === 0) missingCoverage.push('compatible headphone motion');
  if (watchCheckedSessions === 0) missingCoverage.push('Apple Watch availability checks');

  return {
    observedSessions: snapshots.length,
    recoveredSessionsExcluded,
    observationDurationSec: snapshots.reduce((total, snapshot) => total + count(snapshot.durationSec), 0),
    cameraSessions,
    headphoneSessions,
    watchCheckedSessions,
    watchPairedSessions,
    watchInstalledSessions,
    watchReachableSessions,
    overlapSessions,
    cameraHeadphoneNodOverlaps: snapshots.reduce((total, snapshot) => (
      total + count(snapshot.coincidences.cameraHeadphoneNods)
    ), 0),
    elevatedCameraHeadphoneNodOverlaps: snapshots.reduce((total, snapshot) => (
      total + count(snapshot.coincidences.elevatedCameraHeadphoneNods)
    ), 0),
    sessionTarget: target,
    insufficientData: missingCoverage.length > 0,
    missingCoverage,
  };
}
