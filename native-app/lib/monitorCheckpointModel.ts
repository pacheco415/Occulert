import type { ActiveSessionCheckpoint } from './sessionRecoveryModel';
import type { AppBuildInfo } from './appBuildInfo';
import { elapsedSessionSeconds } from './monitorPerformance.ts';

type Input = Omit<ActiveSessionCheckpoint, 'durationSec' | 'avgFatigue' | 'cameraHeadNodObservations' | 'appVersion' | 'appBuildNumber'> & {
  fatigueSum: number;
  fatigueSamples: number;
  buildInfo: AppBuildInfo;
};

/** Snapshot the existing local checkpoint fields without storage or policy. */
export function buildMonitorCheckpoint(input: Input): ActiveSessionCheckpoint {
  return {
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    checkpointedAt: input.checkpointedAt,
    durationSec: elapsedSessionSeconds(input.startedAt, input.checkpointedAt),
    alertCount: input.alertCount,
    avgFatigue: input.fatigueSamples ? Math.round(input.fatigueSum / input.fatigueSamples) : 0,
    maxFatigue: input.maxFatigue,
    headNodObservations: input.headNodObservations,
    cameraHeadNodObservations: input.headNodObservations,
    headphoneHeadNodObservations: input.headphoneHeadNodObservations,
    headphoneMotionSamples: input.headphoneMotionSamples,
    headphoneMotionStatus: input.headphoneMotionStatus,
    monitorPerformance: input.monitorPerformance,
    sensorFusion: input.sensorFusion,
    sensitivity: input.sensitivity,
    ...input.buildInfo,
  };
}
