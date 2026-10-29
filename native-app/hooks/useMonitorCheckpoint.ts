import React, { useCallback, useEffect } from 'react';
import { type SensitivityLevel } from '../constants/thresholds';
import { currentAppBuildInfo } from '../lib/appBuildInfo';
import { type HeadphoneMotionState } from '../lib/headphoneMotion';
import { buildMonitorCheckpoint } from '../lib/monitorCheckpointModel';

const SESSION_CHECKPOINT_INTERVAL_MS = 15_000;

interface Options {
  activeSessionIdRef: React.RefObject<string | null>;
  sessionStartedAtRef: React.RefObject<number | null>;
  isRunningRef: React.RefObject<boolean>;
  fatigueSamplesRef: React.RefObject<number>;
  fatigueSumRef: React.RefObject<number>;
  saveActiveSessionCheckpoint: (checkpoint: import("../lib/sessionRecoveryModel").ActiveSessionCheckpoint) => Promise<void>;
  alertCountRef: React.RefObject<number>;
  maxFatigueRef: React.RefObject<number>;
  headNodObservationsRef: React.RefObject<number>;
  headphoneHeadNodObservationsRef: React.RefObject<number>;
  headphoneMotionSamplesRef: React.RefObject<number>;
  headphoneMotionStatusRef: React.RefObject<HeadphoneMotionState>;
  performanceTrackerRef: React.RefObject<import("../lib/monitorPerformance").MonitorPerformanceTracker>;
  sensorFusionTrackerRef: React.RefObject<import("../lib/sensorFusionObservation").SensorFusionObservationTracker>;
  sessionSensitivityRef: React.RefObject<SensitivityLevel>;
  isRunning: boolean;
}

export function useMonitorCheckpoint({
  activeSessionIdRef, sessionStartedAtRef, isRunningRef,
  fatigueSamplesRef, fatigueSumRef, saveActiveSessionCheckpoint,
  alertCountRef, maxFatigueRef, headNodObservationsRef,
  headphoneHeadNodObservationsRef, headphoneMotionSamplesRef, headphoneMotionStatusRef,
  performanceTrackerRef, sensorFusionTrackerRef, sessionSensitivityRef,
  isRunning,
}: Options) {
  const checkpointActiveSession = useCallback((checkpointedAt = Date.now()) => {
    const sessionId = activeSessionIdRef.current;
    const startedAt = sessionStartedAtRef.current;
    if (!sessionId || startedAt === null || !isRunningRef.current) return Promise.resolve();
    return saveActiveSessionCheckpoint(buildMonitorCheckpoint({
      sessionId,
      startedAt,
      checkpointedAt,
      alertCount: alertCountRef.current,
      fatigueSum: fatigueSumRef.current,
      fatigueSamples: fatigueSamplesRef.current,
      maxFatigue: maxFatigueRef.current,
      headNodObservations: headNodObservationsRef.current,
      headphoneHeadNodObservations: headphoneHeadNodObservationsRef.current,
      headphoneMotionSamples: headphoneMotionSamplesRef.current,
      headphoneMotionStatus: headphoneMotionStatusRef.current,
      monitorPerformance: performanceTrackerRef.current.snapshot(checkpointedAt),
      sensorFusion: sensorFusionTrackerRef.current.snapshot(checkpointedAt),
      sensitivity: sessionSensitivityRef.current,
      buildInfo: currentAppBuildInfo(),
    }));
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      void checkpointActiveSession().catch(() => {});
    }, SESSION_CHECKPOINT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [checkpointActiveSession, isRunning]);

  return checkpointActiveSession;
}
