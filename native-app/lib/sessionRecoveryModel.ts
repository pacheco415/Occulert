import type { SensitivityLevel } from '../constants/thresholds';
import type { MonitorPerformanceSnapshot } from './monitorPerformance';

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
  sensitivity: SensitivityLevel;
  appVersion?: string;
  appBuildNumber?: string;
}

export interface RecoveredSessionRecord extends Omit<ActiveSessionCheckpoint, 'startedAt' | 'checkpointedAt'> {
  savedAt: string;
  recoveredFromInterruption: true;
  recoveryNote: string;
}

export function isActiveSessionCheckpoint(value: unknown): value is ActiveSessionCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as Partial<ActiveSessionCheckpoint>;
  return typeof checkpoint.sessionId === 'string'
    && checkpoint.sessionId.length > 0
    && typeof checkpoint.startedAt === 'number'
    && Number.isFinite(checkpoint.startedAt)
    && typeof checkpoint.checkpointedAt === 'number'
    && Number.isFinite(checkpoint.checkpointedAt)
    && typeof checkpoint.durationSec === 'number'
    && checkpoint.durationSec >= 0
    && typeof checkpoint.alertCount === 'number'
    && checkpoint.alertCount >= 0
    && (checkpoint.sensitivity === 'low'
      || checkpoint.sensitivity === 'medium'
      || checkpoint.sensitivity === 'high')
    && Boolean(checkpoint.monitorPerformance)
    && typeof checkpoint.monitorPerformance === 'object';
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
