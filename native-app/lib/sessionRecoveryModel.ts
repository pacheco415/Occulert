import type { SensitivityLevel } from '../constants/thresholds';
import type { MonitorPerformanceSnapshot } from './monitorPerformance';
import type { SensorFusionObservationSnapshot } from './sensorFusionObservation';

export const SESSION_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ActiveSessionCheckpoint {
  sessionId: string;
  startedAt: number;
  checkpointedAt: number;
  durationSec: number;
  alertCount: number;
  avgFatigue: number;
  maxFatigue: number;
  headNodObservations: number;
  cameraHeadNodObservations: number;
  headphoneHeadNodObservations: number;
  headphoneMotionSamples: number;
  headphoneMotionStatus: string;
  monitorPerformance: MonitorPerformanceSnapshot;
  sensorFusion?: SensorFusionObservationSnapshot;
  sensitivity: SensitivityLevel;
  appVersion?: string;
  appBuildNumber?: string;
}

export interface RecoveredSessionRecord extends Omit<ActiveSessionCheckpoint, 'startedAt' | 'checkpointedAt'> {
  savedAt: string;
  recoveredFromInterruption: true;
  recoveryNote: string;
}

export class ActiveSessionCheckpointUnreadableError extends Error {
  constructor() {
    super('The saved interrupted-drive checkpoint could not be read.');
    this.name = 'ActiveSessionCheckpointUnreadableError';
  }
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validTimestamp(value: unknown): value is number {
  return finiteNonnegative(value) && Number.isFinite(new Date(value).getTime());
}

// Older checkpoints omit newer counters. Validate every supplied metric without
// deleting an unreadable checkpoint or inventing missing historical evidence.
function validMetricObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (typeof item === 'number') return finiteNonnegative(item);
    if (item !== null && typeof item === 'object') return validMetricObject(item);
    return (item === null && key === 'timeToFirstSampleMs') || typeof item === 'string' || typeof item === 'boolean';
  });
}

export function isActiveSessionCheckpoint(value: unknown): value is ActiveSessionCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as Partial<ActiveSessionCheckpoint>;
  return typeof checkpoint.sessionId === 'string'
    && checkpoint.sessionId.length > 0
    && validTimestamp(checkpoint.startedAt)
    && validTimestamp(checkpoint.checkpointedAt)
    && checkpoint.checkpointedAt >= checkpoint.startedAt
    && finiteNonnegative(checkpoint.durationSec)
    && finiteNonnegative(checkpoint.alertCount)
    && Number.isSafeInteger(checkpoint.alertCount)
    && finiteNonnegative(checkpoint.avgFatigue) && checkpoint.avgFatigue <= 100
    && finiteNonnegative(checkpoint.maxFatigue) && checkpoint.maxFatigue <= 100
    && ['headNodObservations', 'cameraHeadNodObservations', 'headphoneHeadNodObservations', 'headphoneMotionSamples'].every(key => {
      const value = (checkpoint as unknown as Record<string, unknown>)[key];
      return value === undefined || (finiteNonnegative(value) && Number.isSafeInteger(value));
    })
    && (checkpoint.sensitivity === 'low'
      || checkpoint.sensitivity === 'medium'
      || checkpoint.sensitivity === 'high')
    && validMetricObject(checkpoint.monitorPerformance)
    && (checkpoint.sensorFusion === undefined || validMetricObject(checkpoint.sensorFusion));
}

/** Only a missing key means no checkpoint; malformed stored data must be preserved. */
export function parseActiveSessionCheckpoint(raw: string | null): ActiveSessionCheckpoint | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ActiveSessionCheckpointUnreadableError();
  }
  if (!isActiveSessionCheckpoint(parsed)) throw new ActiveSessionCheckpointUnreadableError();
  return parsed;
}

export function hasConflictingActiveSessionCheckpoint(
  value: unknown,
  nextSessionId: string,
): boolean {
  return isActiveSessionCheckpoint(value) && value.sessionId !== nextSessionId;
}

export function recoveredSessionFromCheckpoint(
  value: unknown,
  now = Date.now(),
): RecoveredSessionRecord | null {
  if (!isActiveSessionCheckpoint(value)) return null;
  if (value.durationSec <= 0) return null;
  if (now < value.checkpointedAt || now - value.checkpointedAt > SESSION_RECOVERY_MAX_AGE_MS) {
    return null;
  }

  const { startedAt: _startedAt, checkpointedAt, ...record } = value;
  return {
    ...record,
    savedAt: new Date(checkpointedAt).toISOString(),
    recoveredFromInterruption: true,
    recoveryNote: 'Recovered from the last local checkpoint after monitoring ended unexpectedly.',
  };
}

export function prependRecoveredSession(
  sessions: Array<Record<string, unknown>>,
  recovered: RecoveredSessionRecord,
  limit = 50,
): { sessions: Array<Record<string, unknown>>; inserted: boolean } {
  if (sessions.some(item => item?.sessionId === recovered.sessionId)) {
    return { sessions, inserted: false };
  }
  const recoveredRecord: Record<string, unknown> = { ...recovered };
  return {
    sessions: [recoveredRecord, ...sessions].slice(0, limit),
    inserted: true,
  };
}
