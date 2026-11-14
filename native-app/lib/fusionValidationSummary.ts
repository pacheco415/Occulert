import { strings, formatString } from './strings.ts';
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

export type FusionValidationPlanId =
  | 'camera-baseline'
  | 'camera-headphones'
  | 'camera-watch'
  | 'combined-accessories'
  | 'repeat-observation'
  | 'coverage-complete';

export interface FusionValidationSessionPlan {
  id: FusionValidationPlanId;
  title: string;
  detail: string;
  completedSetups: number;
  totalSetups: number;
  complete: boolean;
  checklist: readonly string[];
}

const SESSION_CHECKLIST = [
  strings.history.fusionPlan.setup,
  strings.history.fusionPlan.foreground,
  strings.history.fusionPlan.noStaging,
  strings.history.fusionPlan.review,
] as const;

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

function completeSnapshots(sessions: FusionValidationSession[]): SensorFusionObservationSnapshot[] {
  return sessions
    .filter(session => !session.recoveredFromInterruption)
    .map(session => session.sensorFusion)
    .filter(isObservationSnapshot);
}

function normalizedTarget(sessionTarget: number): number {
  return Number.isFinite(sessionTarget) && sessionTarget > 0
    ? Math.floor(sessionTarget)
    : FUSION_VALIDATION_SESSION_TARGET;
}

function hasCamera(snapshot: SensorFusionObservationSnapshot): boolean {
  return count(snapshot.camera.samples) > 0;
}

function hasHeadphoneMotion(snapshot: SensorFusionObservationSnapshot): boolean {
  return count(snapshot.headphone.samples) > 0 || snapshot.headphone.status === 'active';
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
  const target = normalizedTarget(sessionTarget);
  const recoveredSessionsExcluded = sessions.filter(session => (
    session.recoveredFromInterruption && isObservationSnapshot(session.sensorFusion)
  )).length;
  const snapshots = completeSnapshots(sessions);

  const cameraSessions = snapshots.filter(hasCamera).length;
  const headphoneSessions = snapshots.filter(hasHeadphoneMotion).length;
  const watchCheckedSessions = snapshots.filter(snapshot => snapshot.watch.checked === true).length;
  const watchPairedSessions = snapshots.filter(snapshot => snapshot.watch.paired === true).length;
  const watchInstalledSessions = snapshots.filter(snapshot => snapshot.watch.appInstalled === true).length;
  const watchReachableSessions = snapshots.filter(snapshot => snapshot.watch.reachable === true).length;
  const overlapSessions = snapshots.filter(snapshot => (
    count(snapshot.coincidences.cameraHeadphoneNods) > 0
  )).length;
  const missingCoverage: string[] = [];

  if (snapshots.length < target) missingCoverage.push(formatString(strings.history.fusionPlan.sessionsMissing, { count: target - snapshots.length }));
  if (cameraSessions === 0) missingCoverage.push(strings.history.fusionPlan.cameraMissing);
  if (headphoneSessions === 0) missingCoverage.push(strings.history.fusionPlan.headphoneMissing);
  if (watchCheckedSessions === 0) missingCoverage.push(strings.history.fusionPlan.watchMissing);

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

/**
 * Chooses the next missing observation setup without estimating safety,
 * accuracy, fatigue risk, or alert confidence. Optional accessories are never
 * required to use Occulert; this plan only organizes local validation coverage.
 */
export function planNextFusionValidationSession(
  sessions: FusionValidationSession[],
  sessionTarget = FUSION_VALIDATION_SESSION_TARGET,
): FusionValidationSessionPlan {
  const snapshots = completeSnapshots(sessions);
  const target = normalizedTarget(sessionTarget);
  const setupCoverage = [
    snapshots.some(hasCamera),
    snapshots.some(snapshot => hasCamera(snapshot) && hasHeadphoneMotion(snapshot)),
    snapshots.some(snapshot => hasCamera(snapshot) && snapshot.watch.checked === true),
    snapshots.some(snapshot => (
      hasCamera(snapshot)
      && hasHeadphoneMotion(snapshot)
      && snapshot.watch.checked === true
    )),
  ];
  const completedSetups = setupCoverage.filter(Boolean).length;
  const base = {
    completedSetups,
    totalSetups: setupCoverage.length,
    complete: false,
    checklist: SESSION_CHECKLIST,
  };

  if (!setupCoverage[0]) {
    return {
      ...base,
      id: 'camera-baseline',
      title: strings.history.fusionPlan.cameraTitle,
      detail: strings.history.fusionPlan.cameraDetail,
    };
  }
  if (!setupCoverage[1]) {
    return {
      ...base,
      id: 'camera-headphones',
      title: strings.history.fusionPlan.headphonesTitle,
      detail: strings.history.fusionPlan.headphonesDetail,
    };
  }
  if (!setupCoverage[2]) {
    return {
      ...base,
      id: 'camera-watch',
      title: strings.history.fusionPlan.watchTitle,
      detail: strings.history.fusionPlan.watchDetail,
    };
  }
  if (!setupCoverage[3]) {
    return {
      ...base,
      id: 'combined-accessories',
      title: strings.history.fusionPlan.combinedTitle,
      detail: strings.history.fusionPlan.combinedDetail,
    };
  }
  if (snapshots.length < target) {
    const remaining = target - snapshots.length;
    return {
      ...base,
      id: 'repeat-observation',
      title: strings.history.fusionPlan.repeatTitle,
      detail: formatString(strings.history.fusionPlan.repeatDetail, { count: remaining, sessions: remaining === 1 ? strings.history.fusionPlan.oneSession : strings.history.fusionPlan.sessions }),
    };
  }

  return {
    ...base,
    id: 'coverage-complete',
    title: strings.history.fusionPlan.completeTitle,
    detail: strings.history.fusionPlan.completeDetail,
    complete: true,
    checklist: [],
  };
}
