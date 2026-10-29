import { useMonitorCloudAlerts } from '../hooks/useMonitorCloudAlerts';
import { useMonitorCameraIdentity } from '../hooks/useMonitorCameraIdentity';
import { useMonitorCameraLifecycle } from '../hooks/useMonitorCameraLifecycle';
import { useMonitorCheckpoint } from '../hooks/useMonitorCheckpoint';
import { useMonitorAnalysis } from '../hooks/useMonitorAnalysis';
import { MonitorPresentation, MonitorPermissionState, MonitorCameraUnavailable } from '../components/monitor/MonitorPresentation';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Alert, AppState, BackHandler, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';

import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { useFaceDetector, type FrameFaceDetectionOptions } from 'react-native-vision-camera-face-detector';

import { useAlertAudioPlayer } from '../hooks/useAlertAudioPlayer';
import * as Haptics from 'expo-haptics';
import * as Battery from 'expo-battery';

import { EYE_BASELINE_EXPERIMENT, ParkedEyeBaseline } from '../lib/eyeBaselineModel';
import { clearDeviceEyeBaseline, loadDeviceEyeBaseline, saveDeviceEyeBaseline } from '../lib/eyeBaselineStorage';
import { useEyeTracking } from '../hooks/useEyeTracking';
import { deliverCueIfCurrent } from '../lib/alertDelivery';
import { type AlertTimingEvent } from '../components/AlertSystem';

import { loadSavedSensitivity } from '../components/SensitivitySlider';
import type { EyeMetrics } from '../hooks/useEyeTracking';
import { type SensitivityLevel } from '../constants/thresholds';
import { updateSessionHistory } from '../lib/sessionHistory';
import { saveCompletedNativeSession, markCompletedNativeSessionSynced, finalizeCompletedNativeSession, completeNativeSessionStop } from '../lib/sessionCompletion';
import { beginCloudSession, finishCloudSession, logCloudAlert } from '../lib/cloudSync';
import { consumePreDriveSafety } from '../lib/preDriveGate';
import { currentAppBuildInfo } from '../lib/appBuildInfo';
import { HeadNodDetector } from '../lib/headNodDetector';
import { addHeadphoneMotionSampleListener, addHeadphoneMotionStatusListener, startHeadphoneMotion, stopHeadphoneMotion, type HeadphoneMotionState } from '../lib/headphoneMotion';
import { buildSafeStopSearchUrls, safeStopSearchQuery, type SafeStopKind } from '../lib/safeStopLinks';
import { shouldAbortMonitoringStart, shouldStopMonitoringForAppState, stopBeforeNavigation } from '../lib/monitorLifecycle';
import { createMonitorPerformanceTracker, elapsedSessionSeconds, type MonitorPerformanceSnapshot } from '../lib/monitorPerformance';
import { type AlertLevel } from '../lib/alertPolicy';
import { currentAlertPreferences, loadAlertPreferences } from '../lib/alertPreferences';
import { getWatchAlertsEnabled } from '../lib/watchPreferences';
import { getWatchStatus } from '../lib/watchBridge';
import { initialCameraSetupAssessment, type CameraSetupAssessment } from '../lib/cameraSetup';
import { ActiveSessionCheckpointConflictError, clearActiveSessionCheckpoint, saveActiveSessionCheckpoint } from '../lib/sessionRecovery';
import { deriveCameraLoadPolicy, type DeviceThermalState } from '../lib/cameraResilience';
import { type FrontCameraIdentity } from '../lib/deviceCondition';
import { initialFrontCameraSwitchState } from '../lib/frontCameraSwitch';
import { useAccessibilityPreferences } from '../hooks/useAccessibilityPreferences';

import { createSensorFusionObservationTracker } from '../lib/sensorFusionObservation';
import { createCaptureTransitionGuard } from '../lib/captureLoadPolicy';

/**
 * MonitorScreen — full-screen camera + real on-device eye tracking.
 *
 * All frame processing stays on-device. No camera frames are stored or
 * uploaded. VisionCamera requires a development/TestFlight build; this screen
 * does not run in Expo Go.
 */

const FACE_DETECTOR_OPTIONS: FrameFaceDetectionOptions = {
  performanceMode: 'fast',
  classificationMode: 'all',
  landmarkMode: 'none',
  contourMode: 'none',
  trackingEnabled: false,
  cameraFacing: 'front',
};

const MONITORING_PAUSED_SOUND = require('../assets/monitoring-paused.wav');

type StopOptions = { deferCloudFinalization?: boolean };

export default function MonitorScreen() {
  const router = useRouter();
  const { reduceMotion } = useAccessibilityPreferences();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>('medium');
  const [sensitivityLoaded, setSensitivityLoaded] = useState(false);
  const [eyeBaseline, setEyeBaseline] = useState<number | null>(null);
  const eyeBaselineRef = useRef<number | null>(null);
  const [baselineLoaded, setBaselineLoaded] = useState(!EYE_BASELINE_EXPERIMENT);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineMessage, setBaselineMessage] = useState('Parked eye-baseline experiment · local sessions only.');
  const baselineCollectorRef = useRef(new ParkedEyeBaseline());
  const baselineGenerationRef = useRef(0);
  const cameraBaselineRevisionRef = useRef(0);
  const baselineFinishedRef = useRef(false);
  const baselineCanSaveRef = useRef(false);
  const baselineBusyRef = useRef(false);
  const baselineMountedRef = useRef(true);
  const sessionEyeBaselineRef = useRef<number | null>(null);
  const [frontCameraIdentity, setFrontCameraIdentity] = useState<FrontCameraIdentity | null>(null);
  const frontCameraIdentityRef = useRef<FrontCameraIdentity | null>(null);
  const frontCameraSwitchRef = useRef(initialFrontCameraSwitchState());
  const [sensorFault, setSensorFault] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionEndedAt, setSessionEndedAt] = useState<number | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [visibleAlertLevel, setVisibleAlertLevel] = useState<AlertLevel>('none');
  const [safeStopOpen, setSafeStopOpen] = useState(false);
  const [safeStopBusy, setSafeStopBusy] = useState(false);
  const [setupPreviewActive, setSetupPreviewActive] = useState(false);
  const [cameraSetup, setCameraSetup] = useState<CameraSetupAssessment>(
    initialCameraSetupAssessment,
  );
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const [cameraRecovering, setCameraRecovering] = useState(false);
  const [thermalState, setThermalState] = useState<DeviceThermalState>('unknown');
  const { batteryLevel, batteryState, lowPowerMode } = Battery.usePowerState();
  const cameraLoadPolicy = useMemo(() => deriveCameraLoadPolicy({
    thermalState,
    lowPowerMode,
    batteryLevel,
    isCharging: batteryState === Battery.BatteryState.CHARGING
      || batteryState === Battery.BatteryState.FULL,
  }), [batteryLevel, batteryState, lowPowerMode, thermalState]);

  const sessionStartedAtRef = useRef<number | null>(null);
  const prevAlertingRef = useRef(false);
  const fatigueSumRef = useRef(0);
  const fatigueSamplesRef = useRef(0);
  const maxFatigueRef = useRef(0);
  const closedSinceRef = useRef<number | null>(null);
  const sessionSensitivityRef = useRef<SensitivityLevel>('medium');
  const startAttemptRef = useRef(0);
  const requestingCameraPermissionRef = useRef(false);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const isRunningRef = useRef(false);
  const handleStopRef = useRef<(options?: StopOptions) => Promise<void>>(async () => {});
  const cloudSessionRef = useRef<Promise<string | null> | null>(null);
  const cloudEventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSampleAtRef = useRef(0);
  const captureTransitionRef = useRef(createCaptureTransitionGuard());
  const hasCameraSampleRef = useRef(false);
  const cameraEpochRef = useRef(0);
  const cameraRestartCountRef = useRef(0);
  const cameraDeviceIdRef = useRef(device?.id);
  cameraDeviceIdRef.current = device?.id;
  const cameraInterruptionGenerationRef = useRef(0);
  const cameraCallbackOwnerRef = useRef(0);
  const cameraCallbackOwner = cameraCallbackOwnerRef.current;
  const cameraScreenMountedRef = useRef(true);
  const multitaskingCameraPausedRef = useRef(false);

  useEffect(() => {
    cameraScreenMountedRef.current = true;
    return () => {
      cameraScreenMountedRef.current = false;
      cameraInterruptionGenerationRef.current += 1;
    };
  }, []);
  const cameraRecoveringRef = useRef(false);
  const headNodDetectorRef = useRef(new HeadNodDetector());
  const headNodObservationsRef = useRef(0);
  const monitoringActiveRef = useRef(false);
  const headphoneHeadNodDetectorRef = useRef(new HeadNodDetector());
  const headphoneHeadNodObservationsRef = useRef(0);
  const headphoneMotionSamplesRef = useRef(0);
  const headphoneMotionStatusRef = useRef<HeadphoneMotionState>('not-built');
  const lastMetricsUiAtRef = useRef(0);
  const displayedMetricsStateRef = useRef<EyeMetrics['state']>('noFace');
  const displayedAlertLevelRef = useRef<AlertLevel>('none');
  const performanceTrackerRef = useRef(createMonitorPerformanceTracker());
  const sensorFusionTrackerRef = useRef(createSensorFusionObservationTracker());
  const setupPreviewActiveRef = useRef(false);
  const lastCameraSetupUiAtRef = useRef(0);
  const activeSessionIdRef = useRef<string | null>(null);
  const alertCountRef = useRef(0);

  const [metrics, setMetrics] = useState<EyeMetrics>({
    ear: 0.3,
    perclos: 0,
    fatigueScore: 0,
    closedDurationMs: 0,
    state: 'noFace',
  });

  const {
    player: monitoringPausedPlayer,
    isCurrent: monitoringPausedPlayerIsCurrent,
  } = useAlertAudioPlayer(MONITORING_PAUSED_SOUND);

  const { processEyeOpenness, processNoFace, reset } = useEyeTracking(sensitivity, EYE_BASELINE_EXPERIMENT ? eyeBaseline : null);
  const { detectFaces } = useFaceDetector(FACE_DETECTOR_OPTIONS);

  const deliverMonitoringPausedCue = useCallback(() => {
    const preferences = currentAlertPreferences();
    if (preferences.hapticEnabled) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    if (!preferences.audioEnabled || !monitoringPausedPlayerIsCurrent()) return;
    try {
      monitoringPausedPlayer.pause();
      void deliverCueIfCurrent(
        () => monitoringPausedPlayer.seekTo(0),
        monitoringPausedPlayerIsCurrent,
        () => {
          monitoringPausedPlayer.volume = 1;
          monitoringPausedPlayer.play();
        },
      ).catch(() => {});
    } catch {}
  }, [monitoringPausedPlayer, monitoringPausedPlayerIsCurrent]);

  const recordAlertTiming = useCallback((event: AlertTimingEvent) => {
    if (event.kind === 'decision') {
      performanceTrackerRef.current.recordAlertDecision(event.at);
    } else if (event.kind === 'phone-dispatch') {
      performanceTrackerRef.current.recordPhoneDispatch(event.decisionAt, event.dispatchedAt);
    } else {
      performanceTrackerRef.current.recordWatchDelivery(event.decisionAt, event);
    }
  }, []);

  const toggleSetupPreview = useMonitorCameraIdentity({
    isRunningRef, setupPreviewActiveRef, frontCameraSwitchRef,
    frontCameraIdentityRef, setFrontCameraIdentity, baselineGenerationRef,
    baselineCollectorRef, baselineFinishedRef, lastCameraSetupUiAtRef,
    setCameraSetup, cameraBaselineRevisionRef, sessionEyeBaselineRef,
    eyeBaselineRef, baselineCanSaveRef, setEyeBaseline,
    setBaselineMessage, clearDeviceEyeBaseline, baselineMountedRef,
    performanceTrackerRef, deliverMonitoringPausedCue, isRunning,
    setupPreviewActive, device, loadDeviceEyeBaseline,
    setBaselineLoaded, loadSavedSensitivity, setSensitivity,
    setSensitivityLoaded, startingRef, stoppingRef,
    baselineBusyRef, cameraInterruptionGenerationRef, cameraCallbackOwnerRef,
    multitaskingCameraPausedRef, setSensorFault, setSetupPreviewActive,
  });

  useEffect(() => {
    const sampleSubscription = addHeadphoneMotionSampleListener((sample) => {
      if (!monitoringActiveRef.current) return;
      const observedAt = Date.now();
      headphoneMotionSamplesRef.current += 1;
      sensorFusionTrackerRef.current.recordHeadphoneSample(observedAt);
      const result = headphoneHeadNodDetectorRef.current.update({
        at: sample.timestampMs,
        faceFound: true,
        pitchAngle: sample.pitchAngle,
        yawAngle: sample.yawAngle,
        rollAngle: sample.rollAngle,
      });
      // Observation only: headphone motion never changes the fatigue score or alerts.
      if (result.observed) {
        headphoneHeadNodObservationsRef.current += 1;
        sensorFusionTrackerRef.current.recordHeadphoneHeadNod(observedAt);
      }
    });
    const statusSubscription = addHeadphoneMotionStatusListener((status) => {
      if (monitoringActiveRef.current) {
        headphoneMotionStatusRef.current = status.state;
        sensorFusionTrackerRef.current.setHeadphoneStatus(status.state);
      }
    });

    return () => {
      monitoringActiveRef.current = false;
      sampleSubscription.remove();
      statusSubscription.remove();
      void stopHeadphoneMotion();
    };
  }, []);

  useEffect(() => {
    if (!isRunning && !safeStopBusy) setSafeStopOpen(false);
  }, [isRunning, safeStopBusy]);

  const recordCloudAlertTransition = useMonitorCloudAlerts({
    prevAlertingRef, alertCountRef, setAlertCount,
    cloudSessionRef, cloudEventQueueRef, logCloudAlert,
  });

  const cameraIdentityActive = isRunning || setupPreviewActive;
  const { handleCaptureConfiguration, handleCameraError } = useMonitorCameraLifecycle({
    setThermalState, isRunning, setupPreviewActive,
    cameraScreenMountedRef, multitaskingCameraPausedRef, isRunningRef,
    setupPreviewActiveRef, startingRef, stoppingRef,
    cameraInterruptionGenerationRef, baselineGenerationRef, baselineCollectorRef,
    setSetupPreviewActive, setCameraSetup, setSensorFault,
    deliverMonitoringPausedCue, handleStopRef, cameraIdentityActive,
    device, cameraCallbackOwnerRef, cameraCallbackOwner,
    cameraDeviceIdRef, cameraEpochRef, cameraEpoch,
    captureTransitionRef, lastSampleAtRef, hasCameraSampleRef,
    performanceTrackerRef, cameraRestartCountRef, cameraRecoveringRef,
    setCameraRecovering, setCameraEpoch, cameraLoadPolicy,
  });

  const checkpointActiveSession = useMonitorCheckpoint({
    activeSessionIdRef, sessionStartedAtRef, isRunningRef,
    fatigueSamplesRef, fatigueSumRef, saveActiveSessionCheckpoint,
    alertCountRef, maxFatigueRef, headNodObservationsRef,
    headphoneHeadNodObservationsRef, headphoneMotionSamplesRef, headphoneMotionStatusRef,
    performanceTrackerRef, sensorFusionTrackerRef, sessionSensitivityRef,
    isRunning,
  });

  const handleStart = async () => {
    if (startingRef.current || isStopping || !sensitivityLoaded || !baselineLoaded || baselineBusyRef.current) return;
    cameraInterruptionGenerationRef.current += 1;
    cameraCallbackOwnerRef.current += 1;
    multitaskingCameraPausedRef.current = false;
    const startAttempt = startAttemptRef.current + 1;
    let reservedSessionId: string | null = null;
    let monitoringStarted = false;
    startAttemptRef.current = startAttempt;
    startingRef.current = true;
    setIsStarting(true);
    try {
      if (!hasPermission) {
        let granted = false;
        requestingCameraPermissionRef.current = true;
        try {
          granted = await requestPermission();
        } finally {
          requestingCameraPermissionRef.current = false;
        }
        if (!granted) return;
      }
      if (shouldAbortMonitoringStart(
        startAttempt !== startAttemptRef.current,
        AppState.currentState,
      )) return;
      if (!consumePreDriveSafety()) {
        router.replace('/pre-drive');
        return;
      }
      await Promise.all([
        loadAlertPreferences(),
        getWatchAlertsEnabled(),
      ]);
      if (shouldAbortMonitoringStart(
        startAttempt !== startAttemptRef.current,
        AppState.currentState,
      )) return;

      const nextSessionStartedAt = Date.now();
      const nextSessionId = `session-${nextSessionStartedAt}`;
      performanceTrackerRef.current.reset();
      sensorFusionTrackerRef.current.reset(nextSessionStartedAt);
      sensorFusionTrackerRef.current.setHeadphoneStatus('starting');
      try {
        await saveActiveSessionCheckpoint({
          sessionId: nextSessionId,
          startedAt: nextSessionStartedAt,
          checkpointedAt: nextSessionStartedAt,
          durationSec: 0,
          alertCount: 0,
          avgFatigue: 0,
          maxFatigue: 0,
          headNodObservations: 0,
          cameraHeadNodObservations: 0,
          headphoneHeadNodObservations: 0,
          headphoneMotionSamples: 0,
          headphoneMotionStatus: 'starting',
          monitorPerformance: performanceTrackerRef.current.snapshot(nextSessionStartedAt),
          sensorFusion: sensorFusionTrackerRef.current.snapshot(nextSessionStartedAt),
          sensitivity,
          ...currentAppBuildInfo(),
        });
        reservedSessionId = nextSessionId;
      } catch (error) {
        setSensorFault(error instanceof ActiveSessionCheckpointConflictError
          ? 'Monitoring did not start because a previous interrupted drive still needs recovery. Return Home and retry recovery before starting again.'
          : 'Monitoring did not start because local recovery storage could not be verified. Return Home and retry before starting again.');
        return;
      }
      if (shouldAbortMonitoringStart(
        startAttempt !== startAttemptRef.current,
        AppState.currentState,
      )) {
        await clearActiveSessionCheckpoint(nextSessionId).catch(() => {});
        reservedSessionId = null;
        return;
      }

      reset();
      sessionEyeBaselineRef.current = eyeBaselineRef.current;
      if(EYE_BASELINE_EXPERIMENT)setBaselineMessage(sessionEyeBaselineRef.current===null?'Experimental local session uses current presets; no personal baseline was saved.':'Experimental local session uses the saved parked baseline.');
      baselineGenerationRef.current += 1;
      setupPreviewActiveRef.current = false;
      setSetupPreviewActive(false);
      prevAlertingRef.current = false;
      fatigueSumRef.current = 0;
      fatigueSamplesRef.current = 0;
      maxFatigueRef.current = 0;
      closedSinceRef.current = null;
      headNodDetectorRef.current.reset();
      headNodObservationsRef.current = 0;
      headphoneHeadNodDetectorRef.current.reset();
      headphoneHeadNodObservationsRef.current = 0;
      headphoneMotionSamplesRef.current = 0;
      headphoneMotionStatusRef.current = 'starting';
      monitoringActiveRef.current = true;
      setSensorFault(null);
      setSafeStopOpen(false);
      setSafeStopBusy(false);
      sessionSensitivityRef.current = sensitivity;
      cloudEventQueueRef.current = Promise.resolve();
      lastMetricsUiAtRef.current = 0;
      displayedMetricsStateRef.current = 'noFace';
      displayedAlertLevelRef.current = 'none';
      cameraRestartCountRef.current = 0;
      captureTransitionRef.current.reset();
      cameraRecoveringRef.current = false;
      setCameraRecovering(false);

      // Headphone motion is optional observation-only input. Start it without
      // delaying core camera monitoring, and discard any late result after the
      // session is cancelled or replaced.
      const headphoneStart = startHeadphoneMotion();
      cloudSessionRef.current = EYE_BASELINE_EXPERIMENT ? Promise.resolve(null) : beginCloudSession();
      setAlertCount(0);
      alertCountRef.current = 0;
      hasCameraSampleRef.current = false;
      lastSampleAtRef.current = nextSessionStartedAt;
      sessionStartedAtRef.current = nextSessionStartedAt;
      activeSessionIdRef.current = nextSessionId;
      performanceTrackerRef.current.recordSessionStart(nextSessionStartedAt);
      if (frontCameraIdentityRef.current) {
        performanceTrackerRef.current.recordFrontCamera(frontCameraIdentityRef.current, nextSessionStartedAt);
      }
      setSessionStartedAt(nextSessionStartedAt);
      setSessionEndedAt(null);
      isRunningRef.current = true;
      setIsRunning(true);
      monitoringStarted = true;
      // Watch availability is optional observation context. It never delays
      // camera monitoring and never enters scoring or alert policy.
      void getWatchStatus().then((watchStatus) => {
        if (
          startAttempt === startAttemptRef.current
          && monitoringActiveRef.current
        ) sensorFusionTrackerRef.current.setWatchStatus(watchStatus);
      }).catch(() => {});
      void headphoneStart.then(async (headphoneStatus) => {
        const stale = startAttempt !== startAttemptRef.current
          || !monitoringActiveRef.current;
        if (stale) {
          if (!monitoringActiveRef.current) await stopHeadphoneMotion();
          return;
        }
        if (headphoneMotionStatusRef.current === 'starting') {
          headphoneMotionStatusRef.current = headphoneStatus.state;
          sensorFusionTrackerRef.current.setHeadphoneStatus(headphoneStatus.state);
        }
      }).catch(() => {
        if (
          startAttempt === startAttemptRef.current
          && monitoringActiveRef.current
        ) {
          headphoneMotionStatusRef.current = 'error';
          sensorFusionTrackerRef.current.setHeadphoneStatus('error');
        }
      });
      // A local recovery write is best-effort and never delays the camera or
      // optional headphone startup path.
      void checkpointActiveSession(nextSessionStartedAt).catch(() => {});
    } finally {
      if (reservedSessionId && !monitoringStarted) {
        await clearActiveSessionCheckpoint(reservedSessionId).catch(() => {});
      }
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  const saveSession = useCallback(async (
    sessionId: string,
    durationSec: number,
    alerts: number,
    monitorPerformance: MonitorPerformanceSnapshot,
    endedAt: number,
  ): Promise<string | null> => {
    if (durationSec <= 0) return null;
    return saveCompletedNativeSession({
      sessionId, durationSec, alerts,
      fatigueSum: fatigueSumRef.current,
      fatigueSamples: fatigueSamplesRef.current,
      headNodObservations: headNodObservationsRef.current,
      headphoneHeadNodObservations: headphoneHeadNodObservationsRef.current,
      headphoneMotionSamples: headphoneMotionSamplesRef.current,
      headphoneMotionStatus: headphoneMotionStatusRef.current,
      monitorPerformance,
      sensorFusion: sensorFusionTrackerRef.current.snapshot(endedAt),
      sensitivity: sessionSensitivityRef.current,
      extra: {
        ...(EYE_BASELINE_EXPERIMENT ? {eyeBaselineExperiment:{version:1,baseline:sessionEyeBaselineRef.current}} : {}),
        ...currentAppBuildInfo(),
      },
    }, updateSessionHistory);
  }, []);

  const markSessionSynced = useCallback(async (
    localSessionId: string,
    cloudSessionId: string,
  ) => {
    await markCompletedNativeSessionSynced(updateSessionHistory, localSessionId, cloudSessionId);
  }, []);

  const handleStop = useCallback(async (
    options: StopOptions = {},
  ) => {
    // Invalidate any sensor start that is awaiting permission or optional
    // headphone-motion setup before it can activate monitoring.
    startAttemptRef.current += 1;
    cameraInterruptionGenerationRef.current += 1;
    cameraCallbackOwnerRef.current += 1;
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setIsStopping(true);

    // The ref becomes authoritative before React commits the visible running
    // state, so AppState shutdown in that gap must still save and finalize.
    const wasRunning = isRunningRef.current;
    const stoppedAt = Date.now();
    setSessionEndedAt(stoppedAt);
    const durationSec = elapsedSessionSeconds(sessionStartedAtRef.current, stoppedAt);
    const alerts = alertCountRef.current;
    const activeSessionId = activeSessionIdRef.current;
    const averageFatigue = fatigueSamplesRef.current > 0
      ? Math.round(fatigueSumRef.current / fatigueSamplesRef.current)
      : null;
    const maxFatigue = fatigueSamplesRef.current > 0 ? maxFatigueRef.current : null;
    const cloudSession = cloudSessionRef.current;
    const pendingEvents = cloudEventQueueRef.current;
    const monitorPerformance = performanceTrackerRef.current.snapshot(stoppedAt);

    monitoringActiveRef.current = false;
    void stopHeadphoneMotion();
    cloudSessionRef.current = null;
    cloudEventQueueRef.current = Promise.resolve();
    isRunningRef.current = false;
    setIsRunning(false);
    captureTransitionRef.current.reset();
    cameraRecoveringRef.current = false;
    setCameraRecovering(false);
    reset();

    if (__DEV__ && wasRunning) {
      console.info('Occulert monitor performance', monitorPerformance);
    }

    const cloudEndedAt = new Date(stoppedAt).toISOString();
    const finalizeCloud = (localSessionId: string | null) => finalizeCompletedNativeSession({
      cloudSession, pendingEvents, averageFatigue, maxFatigue, alerts, endedAt: cloudEndedAt,
    }, localSessionId, { finish: finishCloudSession, markSynced: markSessionSynced });

    try {
      await completeNativeSessionStop({
        wasRunning, activeSessionId, deferCloudFinalization: Boolean(options.deferCloudFinalization),
      }, {
        save: id => saveSession(id, durationSec, alerts, monitorPerformance, stoppedAt),
        clearCheckpoint: clearActiveSessionCheckpoint,
        releaseIdentity: id => { if (activeSessionIdRef.current === id) activeSessionIdRef.current = null; },
        finalize: finalizeCloud,
      });
    } finally {
      stoppingRef.current = false;
      setIsStopping(false);
    }
  }, [markSessionSynced, reset, saveSession]);

  // App-state and hardware-back listeners stay registered across timer ticks,
  // while these refs always expose the latest session snapshot to them.
  isRunningRef.current = isRunning;
  handleStopRef.current = handleStop;

  const handleSafeStopChoice = useCallback(async (kind: SafeStopKind) => {
    if (safeStopBusy || stoppingRef.current) return;
    setSafeStopBusy(true);
    try {
      // Camera monitoring cannot continue reliably after Maps backgrounds the
      // app. End and save first so the UI never implies hidden protection.
      try {
        await handleStop({ deferCloudFinalization: true });
      } catch {
        // A local storage problem must not trap a fatigued driver inside
        // Occulert. Monitoring has already been disarmed before saving starts.
        Alert.alert(
          'Drive may not be fully saved',
          'Monitoring has stopped. Occulert will still open Maps so you can find a safer place to stop.',
        );
      }

      let opened = false;
      for (const url of buildSafeStopSearchUrls(Platform.OS, kind)) {
        try {
          await Linking.openURL(url);
          opened = true;
          break;
        } catch {
          // Try the portable web fallback next.
        }
      }
      if (!opened) {
        Alert.alert(
          'Unable to open Maps',
          `After you are safely parked, open your maps app and search for “${safeStopSearchQuery(kind)}”.`,
        );
      }
    } finally {
      setSafeStopOpen(false);
      setSafeStopBusy(false);
    }
  }, [handleStop, safeStopBusy]);

  const leaveMonitor = useCallback((navigate: () => void) => {
    if (stoppingRef.current) return Promise.resolve();
    return stopBeforeNavigation(
      () => handleStopRef.current({ deferCloudFinalization: true }),
      navigate,
      () => {
        Alert.alert(
          'Drive may not be fully saved',
          'Monitoring has stopped, but Occulert could not finish saving this drive.',
        );
      },
    );
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void leaveMonitor(() => router.back());
      return true;
    });
    return () => subscription.remove();
  }, [isRunning, leaveMonitor, router]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && setupPreviewActiveRef.current) {
        baselineGenerationRef.current += 1;baselineCollectorRef.current.reset();
        setupPreviewActiveRef.current = false;
        setSetupPreviewActive(false);
        setCameraSetup(initialCameraSetupAssessment());
      }
      if (!shouldStopMonitoringForAppState(
        isRunningRef.current,
        startingRef.current,
        requestingCameraPermissionRef.current,
        nextState,
      )) return;
      // iOS stops the camera when Occulert leaves the foreground. Deliver a
      // distinct local cue before teardown so the driver is never left with
      // the false impression that face monitoring continued behind another app.
      deliverMonitoringPausedCue();
      setSensorFault(
        'Face monitoring paused. Monitoring stopped when Occulert left the foreground. Restart only after you are safely parked.',
      );
      void handleStopRef.current({ deferCloudFinalization: true }).catch(() => {
        setSensorFault(
          'Face monitoring paused. Monitoring stopped when Occulert left the foreground, but this drive could not be saved.',
        );
      });
    });
    return () => subscription.remove();
  }, [deliverMonitoringPausedCue]);

  const analysis = useMonitorAnalysis({
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
    recordCloudAlertTransition,
  });

  const onEyeState = analysis.onEyeState;
  const frameProcessor = analysis.frameProcessor;

  if (!hasPermission) {
    return <MonitorPermissionState onRequestAccess={async () => {
      const granted = await requestPermission();
      if (!granted) Linking.openSettings();
    }} />;
  }
  if (device == null) return <MonitorCameraUnavailable />;
  return <MonitorPresentation
      device={device}
      frameProcessor={frameProcessor}
      cameraLoadPolicy={cameraLoadPolicy}
      cameraEpoch={cameraEpoch}
      cameraCallbackOwner={cameraCallbackOwner}
      handleCaptureConfiguration={handleCaptureConfiguration}
      handleCameraError={handleCameraError}
      metrics={metrics}
      alertCount={alertCount}
      frontCameraIdentity={frontCameraIdentity}
      isRunning={isRunning}
      isStarting={isStarting}
      isStopping={isStopping}
      sensitivityLoaded={sensitivityLoaded}
      baselineLoaded={baselineLoaded}
      baselineBusy={baselineBusy}
      cameraRecovering={cameraRecovering}
      setupPreviewActive={setupPreviewActive}
      cameraSetup={cameraSetup}
      sensorFault={sensorFault}
      sessionStartedAt={sessionStartedAt}
      sessionEndedAt={sessionEndedAt}
      baselineMessage={baselineMessage}
      reduceMotion={reduceMotion}
      visibleAlertLevel={visibleAlertLevel}
      setVisibleAlertLevel={setVisibleAlertLevel}
      recordAlertTiming={recordAlertTiming}
      safeStopOpen={safeStopOpen}
      safeStopBusy={safeStopBusy}
      setSafeStopOpen={setSafeStopOpen}
      handleSafeStopChoice={handleSafeStopChoice}
      handleStart={handleStart}
      handleStop={handleStop}
      toggleSetupPreview={toggleSetupPreview}
      onHome={() => { void leaveMonitor(() => router.back()); }}
      onSettings={() => { void leaveMonitor(() => router.push('/settings')); }}
      onRecoveryHome={() => {
        setupPreviewActiveRef.current = false;
        setSetupPreviewActive(false);
        router.replace('/');
      }}
    />;
}
