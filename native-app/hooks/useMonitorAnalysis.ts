import React, { useCallback, useEffect } from 'react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core';
import { EYE_BASELINE_EXPERIMENT, ParkedEyeBaseline } from '../lib/eyeBaselineModel';
import { EyeMetrics } from '../hooks/useEyeTracking';
import { CRITICAL_CLOSED_ALERT_MS, EARLY_CLOSED_ALERT_MS, PERCLOS_ALERT_THRESHOLD } from '../constants/thresholds';
import { HeadNodDetector } from '../lib/headNodDetector';
import { elapsedSessionSeconds, shouldRefreshMonitorMetrics } from '../lib/monitorPerformance';
import { confirmedEyeStateForAlert, deriveAlertLevel, type AlertLevel } from '../lib/alertPolicy';
import { assessCameraSetup, type CameraSetupAssessment } from '../lib/cameraSetup';
import { useSimulatorTrace } from './useSimulatorTrace';
import { SIMULATOR_TRACE } from '../lib/simulatorTrace';

const CAMERA_SETUP_UI_INTERVAL_MS = 250;

interface Options {
  setupPreviewActiveRef: React.RefObject<boolean>;
  isRunningRef: React.RefObject<boolean>;
  baselineLoaded: boolean;
  eyeBaseline: number | null;
  baselineCanSaveRef: React.RefObject<boolean>;
  baselineFinishedRef: React.RefObject<boolean>;
  baselineCollectorRef: React.RefObject<ParkedEyeBaseline>;
  setBaselineMessage: React.Dispatch<React.SetStateAction<string>>;
  baselineGenerationRef: React.RefObject<number>;
  baselineBusyRef: React.RefObject<boolean>;
  setBaselineBusy: React.Dispatch<React.SetStateAction<boolean>>;
  saveDeviceEyeBaseline: (baseline: number, samples: number) => Promise<void>;
  eyeBaselineRef: React.RefObject<number | null>;
  setEyeBaseline: React.Dispatch<React.SetStateAction<number | null>>;
  baselineMountedRef: React.RefObject<boolean>;
  lastCameraSetupUiAtRef: React.RefObject<number>;
  setCameraSetup: React.Dispatch<React.SetStateAction<CameraSetupAssessment>>;
  stoppingRef: React.RefObject<boolean>;
  hasCameraSampleRef: React.RefObject<boolean>;
  lastSampleAtRef: React.RefObject<number>;
  cameraRecoveringRef: React.RefObject<boolean>;
  setCameraRecovering: React.Dispatch<React.SetStateAction<boolean>>;
  performanceTrackerRef: React.RefObject<import("../lib/monitorPerformance").MonitorPerformanceTracker>;
  headNodDetectorRef: React.RefObject<HeadNodDetector>;
  headNodObservationsRef: React.RefObject<number>;
  sensorFusionTrackerRef: React.RefObject<import("../lib/sensorFusionObservation").SensorFusionObservationTracker>;
  processEyeOpenness: (leftProb: number | null | undefined, rightProb: number | null | undefined) => EyeMetrics;
  processNoFace: () => EyeMetrics;
  closedSinceRef: React.RefObject<number | null>;
  sessionStartedAtRef: React.RefObject<number | null>;
  displayedMetricsStateRef: React.RefObject<"open" | "watch" | "closed" | "noFace">;
  displayedAlertLevelRef: React.RefObject<AlertLevel>;
  lastMetricsUiAtRef: React.RefObject<number>;
  setMetrics: React.Dispatch<React.SetStateAction<EyeMetrics>>;
  fatigueSumRef: React.RefObject<number>;
  fatigueSamplesRef: React.RefObject<number>;
  maxFatigueRef: React.RefObject<number>;
  cameraLoadPolicy: import("../lib/cameraResilience").CameraLoadPolicy;
  detectFaces: (frame: import("react-native-vision-camera").Frame) => import("react-native-vision-camera-face-detector").Face[];
  recordCloudAlertTransition: (result: EyeMetrics, now: number) => void;
  simulatorProofRef: React.RefObject<string>;
  isRunning: boolean;
  setupPreviewActive: boolean;
}

export function useMonitorAnalysis({
  setupPreviewActiveRef, isRunningRef, baselineLoaded,
  eyeBaseline, baselineCanSaveRef, baselineFinishedRef,
  baselineCollectorRef, setBaselineMessage, baselineGenerationRef,
  baselineBusyRef, setBaselineBusy, saveDeviceEyeBaseline,
  eyeBaselineRef, setEyeBaseline, baselineMountedRef,
  lastCameraSetupUiAtRef, setCameraSetup, stoppingRef,
  hasCameraSampleRef, lastSampleAtRef, cameraRecoveringRef,
  setCameraRecovering, performanceTrackerRef, headNodDetectorRef,
  headNodObservationsRef, sensorFusionTrackerRef, processEyeOpenness,
  processNoFace, closedSinceRef, sessionStartedAtRef,
  displayedMetricsStateRef, displayedAlertLevelRef, lastMetricsUiAtRef,
  setMetrics, fatigueSumRef, fatigueSamplesRef,
  maxFatigueRef, cameraLoadPolicy, detectFaces,
  recordCloudAlertTransition, simulatorProofRef, isRunning, setupPreviewActive,
}: Options) {
  const onEyeState = useCallback((
    leftProb: number,
    rightProb: number,
    faceFound: boolean,
    pitchAngle: number,
    yawAngle: number,
    rollAngle: number,
    inferenceMs: number,
    faceX: number,
    faceY: number,
    faceWidth: number,
    faceHeight: number,
    frameWidth: number,
    frameHeight: number,
  ) => {
    const now = Date.now();
    if (setupPreviewActiveRef.current && !isRunningRef.current) {
      if (EYE_BASELINE_EXPERIMENT && baselineLoaded && eyeBaseline === null && baselineCanSaveRef.current && !baselineFinishedRef.current) {
        const assessment = assessCameraSetup({faceFound,faceX,faceY,faceWidth,faceHeight,frameWidth,frameHeight,leftEyeOpenProbability:leftProb,rightEyeOpenProbability:rightProb,pitchAngle,yawAngle,rollAngle});
        const clock = typeof performance !== 'undefined' ? performance.now() : now;
        const result = baselineCollectorRef.current.add(clock,leftProb,rightProb,assessment.ready);
        setBaselineMessage(`Parked eyes-open baseline: ${Math.round(result.progress*100)}% · keep looking forward.`);
        if (result.done) {
          baselineFinishedRef.current = true;
          if (result.baseline === null) setBaselineMessage('Too few reliable eyes-open samples. Current presets apply; retry the parked Setup check.');
          else {
            const generation = baselineGenerationRef.current, value = result.baseline;
            baselineBusyRef.current = true;setBaselineBusy(true);
            void saveDeviceEyeBaseline(value,result.samples).then(() => {
              if (generation === baselineGenerationRef.current && setupPreviewActiveRef.current && !isRunningRef.current) {
                eyeBaselineRef.current = value;setEyeBaseline(value);setBaselineMessage('Parked baseline saved on this device · experimental local sessions only.');
              }
            }).catch(() => {
              if (generation === baselineGenerationRef.current) setBaselineMessage('Baseline was not saved. Current presets apply; retry the parked Setup check.');
            }).finally(() => { baselineBusyRef.current = false; if (baselineMountedRef.current) setBaselineBusy(false); });
          }
        }
      }
      if (now - lastCameraSetupUiAtRef.current >= CAMERA_SETUP_UI_INTERVAL_MS) {
        lastCameraSetupUiAtRef.current = now;
        const nextSetup = assessCameraSetup({
          faceFound,
          faceX,
          faceY,
          faceWidth,
          faceHeight,
          frameWidth,
          frameHeight,
          leftEyeOpenProbability: leftProb,
          rightEyeOpenProbability: rightProb,
          pitchAngle,
          yawAngle,
          rollAngle,
        });
        setCameraSetup(current => (
          current.state === nextSetup.state
          && current.title === nextSetup.title
          && current.faceCentered === nextSetup.faceCentered
          && current.faceSized === nextSetup.faceSized
          && current.eyesVisible === nextSetup.eyesVisible
          && current.facingCamera === nextSetup.facingCamera
            ? current
            : nextSetup
        ));
      }
      return;
    }
    // A frame already crossing the worklet bridge can arrive after Camera is
    // deactivated. It must not mutate a stopped or newly resetting session.
    if (!isRunningRef.current || stoppingRef.current) return;
    hasCameraSampleRef.current = true;
    lastSampleAtRef.current = now;
    if (cameraRecoveringRef.current) {
      cameraRecoveringRef.current = false;
      setCameraRecovering(false);
    }
    performanceTrackerRef.current.recordSample(now, inferenceMs);
    const headNodResult = headNodDetectorRef.current.update({
      at: now,
      faceFound,
      pitchAngle,
      yawAngle,
      rollAngle,
    });
    // Observation only: camera pose does not change scoring or alert delivery.
    if (headNodResult.observed) {
      headNodObservationsRef.current += 1;
      sensorFusionTrackerRef.current.recordCameraHeadNod(now);
    }

    const rawResult = faceFound
      ? processEyeOpenness(leftProb, rightProb)
      : processNoFace();

    if (rawResult.state === 'closed') {
      closedSinceRef.current ??= now;
    } else {
      closedSinceRef.current = null;
    }

    // Do not turn a blink or one noisy frame into a driver alert.
    const closedDurationMs = rawResult.state === 'closed'
      && closedSinceRef.current !== null
      ? now - closedSinceRef.current
      : 0;
    const result: EyeMetrics = {
      ...rawResult,
      closedDurationMs,
      state: confirmedEyeStateForAlert(
        rawResult.state,
        closedDurationMs,
        EARLY_CLOSED_ALERT_MS,
      ),
    };
    sensorFusionTrackerRef.current.recordCameraSample({
      at: now,
      state: result.state,
      fatigueScore: result.fatigueScore,
    });

    const alertLevel = deriveAlertLevel({
      isRunning: isRunningRef.current,
      metrics: result,
      sessionTime: elapsedSessionSeconds(sessionStartedAtRef.current, now),
      trackingLostForMs: 0,
      criticalPerclosThreshold: PERCLOS_ALERT_THRESHOLD,
      criticalClosedDurationMs: CRITICAL_CLOSED_ALERT_MS,
    });
    if (SIMULATOR_TRACE) {
      const key = result.state + ':' + (closedDurationMs >= 3_000);
      if (simulatorProofRef.current !== key) {
        simulatorProofRef.current = key;
        console.info('OCCULERT_SIMULATOR_SCORING ' + JSON.stringify({ elapsedMs: now - (sessionStartedAtRef.current || now),
          state: result.state, ear: result.ear, perclos: result.perclos, fatigueScore: result.fatigueScore,
          closedDurationMs, alertLevel }));
      }
    }
    const shouldRefreshDisplay = shouldRefreshMonitorMetrics({
      previousState: displayedMetricsStateRef.current,
      nextState: result.state,
      previousAlertLevel: displayedAlertLevelRef.current,
      nextAlertLevel: alertLevel,
      now,
      lastUpdatedAt: lastMetricsUiAtRef.current,
    });
    if (shouldRefreshDisplay) {
      displayedMetricsStateRef.current = result.state;
      displayedAlertLevelRef.current = alertLevel;
      lastMetricsUiAtRef.current = now;
      performanceTrackerRef.current.recordUiUpdate();
      setMetrics(result);
    }
    if (faceFound) {
      fatigueSumRef.current += result.fatigueScore;
      fatigueSamplesRef.current += 1;
      maxFatigueRef.current = Math.max(maxFatigueRef.current, result.fatigueScore);
    }

    recordCloudAlertTransition(result, now);
  }, [processEyeOpenness, processNoFace, baselineLoaded, eyeBaseline, recordCloudAlertTransition]);

  // These native worklet values must outlive ordinary React renders so the
  // frame-processor bridge stays stable throughout a drive.
  const onEyeStateJS = useRunOnJS(onEyeState, [onEyeState]);
  const simulatorPhase = useSimulatorTrace(SIMULATOR_TRACE && (isRunning || setupPreviewActive), onEyeState);
  const lastSample = useSharedValue(0);
  const analysisIntervalMs = useSharedValue(cameraLoadPolicy.analysisIntervalMs);

  useEffect(() => {
    analysisIntervalMs.value = cameraLoadPolicy.analysisIntervalMs;
  }, [analysisIntervalMs, cameraLoadPolicy.analysisIntervalMs]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const now = Date.now();
    if (now - lastSample.value < analysisIntervalMs.value) return;
    lastSample.value = now;

    const inferenceStartedAt = Date.now();
    const faces = detectFaces(frame);
    const inferenceMs = Date.now() - inferenceStartedAt;
    if (faces.length === 0) {
      onEyeStateJS(-1, -1, false, 0, 0, 0, inferenceMs, 0, 0, 0, 0, frame.width, frame.height);
      return;
    }

    let face = faces[0];
    for (let i = 1; i < faces.length; i += 1) {
      const candidate = faces[i].bounds;
      const current = face.bounds;
      if (candidate.width * candidate.height > current.width * current.height) {
        face = faces[i];
      }
    }

    onEyeStateJS(
      face.leftEyeOpenProbability ?? -1,
      face.rightEyeOpenProbability ?? -1,
      true,
      face.pitchAngle,
      face.yawAngle,
      face.rollAngle,
      inferenceMs,
      face.bounds.x,
      face.bounds.y,
      face.bounds.width,
      face.bounds.height,
      frame.width,
      frame.height,
    );
  }, [analysisIntervalMs, detectFaces, lastSample, onEyeStateJS]);

  return { onEyeState, frameProcessor, simulatorPhase };
}
