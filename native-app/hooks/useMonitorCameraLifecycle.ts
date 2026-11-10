import React, { useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { type CameraRuntimeError } from 'react-native-vision-camera';
import { ParkedEyeBaseline } from '../lib/eyeBaselineModel';
import { type CaptureConfigurationChange } from '../components/MonitorCaptureCamera';
import { initialCameraSetupAssessment, type CameraSetupAssessment } from '../lib/cameraSetup';
import { canRestartStalledCamera, shouldRestartCamera, type DeviceThermalState } from '../lib/cameraResilience';
import { getDeviceCondition, getCameraInterruptionState, observeCameraInterruptions, MULTITASKING_CAMERA_MESSAGE, type CameraInterruptionState } from '../lib/deviceCondition';

const SENSOR_STARTUP_GRACE_MS = 10_000;
const SENSOR_STALL_MS = 5_000;
const DEVICE_CONDITION_INTERVAL_MS = 15_000;

interface Options {
  setThermalState: React.Dispatch<React.SetStateAction<DeviceThermalState>>;
  isRunning: boolean;
  setupPreviewActive: boolean;
  cameraScreenMountedRef: React.RefObject<boolean>;
  multitaskingCameraPausedRef: React.RefObject<boolean>;
  isRunningRef: React.RefObject<boolean>;
  setupPreviewActiveRef: React.RefObject<boolean>;
  startingRef: React.RefObject<boolean>;
  stoppingRef: React.RefObject<boolean>;
  cameraInterruptionGenerationRef: React.RefObject<number>;
  baselineGenerationRef: React.RefObject<number>;
  baselineCollectorRef: React.RefObject<ParkedEyeBaseline>;
  setSetupPreviewActive: React.Dispatch<React.SetStateAction<boolean>>;
  setCameraSetup: React.Dispatch<React.SetStateAction<CameraSetupAssessment>>;
  setSensorFault: React.Dispatch<React.SetStateAction<string | null>>;
  deliverMonitoringPausedCue: () => void;
  handleStopRef: React.RefObject<(options?: { deferCloudFinalization?: boolean }) => Promise<void>>;
  cameraIdentityActive: boolean;
  device: import("react-native-vision-camera").CameraDevice | undefined;
  cameraCallbackOwnerRef: React.RefObject<number>;
  cameraCallbackOwner: number;
  cameraDeviceIdRef: React.RefObject<string | undefined>;
  cameraEpochRef: React.RefObject<number>;
  cameraEpoch: number;
  captureTransitionRef: React.RefObject<{ observe({ key, at, lastSampleAt, hasSample, stallTimeoutMs }: { key: string; at: number; lastSampleAt: number; hasSample: boolean; stallTimeoutMs: number; }): boolean; shouldDefer(at: number, lastSampleAt: number): boolean; reset(): void; }>;
  lastSampleAtRef: React.RefObject<number>;
  hasCameraSampleRef: React.RefObject<boolean>;
  performanceTrackerRef: React.RefObject<import("../lib/monitorPerformance").MonitorPerformanceTracker>;
  cameraRestartCountRef: React.RefObject<number>;
  cameraRecoveringRef: React.RefObject<boolean>;
  setCameraRecovering: React.Dispatch<React.SetStateAction<boolean>>;
  setCameraEpoch: React.Dispatch<React.SetStateAction<number>>;
  cameraLoadPolicy: import("../lib/cameraResilience").CameraLoadPolicy;
}

export function useMonitorCameraLifecycle({
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
}: Options) {
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getDeviceCondition().then((condition) => {
        if (active) setThermalState(condition.thermalState);
      });
    };
    refresh();
    if (!isRunning && !setupPreviewActive) {
      return () => { active = false; };
    }
    const timer = setInterval(refresh, DEVICE_CONDITION_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isRunning, setupPreviewActive]);

  const handleCameraInterruption = useCallback((state: CameraInterruptionState) => {
    if (!cameraScreenMountedRef.current) return;
    if (state.interrupted !== true || state.reason !== 'multitasking' || multitaskingCameraPausedRef.current) return;
    const active = isRunningRef.current || setupPreviewActiveRef.current || startingRef.current;
    if (!active && !stoppingRef.current) return;
    // Latch until the next explicit parked start. An end notification cannot resume.
    multitaskingCameraPausedRef.current = true;
    cameraInterruptionGenerationRef.current += 1;
    baselineGenerationRef.current += 1;
    baselineCollectorRef.current.reset();
    setupPreviewActiveRef.current = false;
    setSetupPreviewActive(false);
    setCameraSetup(initialCameraSetupAssessment());
    setSensorFault(MULTITASKING_CAMERA_MESSAGE);
    if (active) deliverMonitoringPausedCue();
    if (isRunningRef.current || startingRef.current) {
      void handleStopRef.current({ deferCloudFinalization: true }).catch(() => {
        Alert.alert('Drive may not be fully saved', 'Camera monitoring is paused. Occulert could not finish saving this drive.');
      });
    }
  }, [deliverMonitoringPausedCue]);

  useEffect(() => {
    if (!cameraIdentityActive || !device?.id) return;
    let active = true;
    const subscription = observeCameraInterruptions(device.id, state => {
      if (active && cameraCallbackOwnerRef.current === cameraCallbackOwner
        && cameraDeviceIdRef.current === device.id && cameraEpochRef.current === cameraEpoch) handleCameraInterruption(state);
    });
    void subscription.ready.catch(() => {});
    return () => {
      active = false;
      cameraInterruptionGenerationRef.current += 1;
      subscription.remove();
    };
  }, [cameraIdentityActive, cameraEpoch, cameraCallbackOwner, device?.id, handleCameraInterruption]);

  const checkCameraInterruption = useCallback(async (epoch: number) => {
    const deviceId = device?.id;
    if (!cameraScreenMountedRef.current || deviceId !== cameraDeviceIdRef.current || multitaskingCameraPausedRef.current
      || stoppingRef.current || epoch !== cameraEpochRef.current) return 'paused';
    const generation = cameraInterruptionGenerationRef.current;
    const state = deviceId ? await getCameraInterruptionState(deviceId) : null;
    if (!cameraScreenMountedRef.current || deviceId !== cameraDeviceIdRef.current || generation !== cameraInterruptionGenerationRef.current || epoch !== cameraEpochRef.current
      || stoppingRef.current || multitaskingCameraPausedRef.current) return 'paused';
    if (state) handleCameraInterruption(state);
    if (multitaskingCameraPausedRef.current || stoppingRef.current
      || !(isRunningRef.current || setupPreviewActiveRef.current || startingRef.current)) return 'paused';
    return state?.state === 'queryFailed' ? 'queryFailed' : 'ready';
  }, [device?.id, handleCameraInterruption]);

  const handleCaptureConfiguration = useCallback(({ key, configuration }: CaptureConfigurationChange) => {
    if (!isRunningRef.current || stoppingRef.current) return;
    const graceGranted = captureTransitionRef.current.observe({
      key,
      at: Date.now(),
      lastSampleAt: lastSampleAtRef.current,
      hasSample: hasCameraSampleRef.current,
      stallTimeoutMs: SENSOR_STALL_MS,
    });
    performanceTrackerRef.current.recordCaptureLoad(configuration, graceGranted);
  }, []);

  const attemptCameraRecovery = useCallback(() => {
    if (
      stoppingRef.current
      || !cameraScreenMountedRef.current
      || multitaskingCameraPausedRef.current
      || !isRunningRef.current
      || !canRestartStalledCamera(cameraRestartCountRef.current)
    ) return false;
    cameraRestartCountRef.current += 1;
    performanceTrackerRef.current.recordCameraRestart();
    hasCameraSampleRef.current = false;
    lastSampleAtRef.current = Date.now();
    cameraRecoveringRef.current = true;
    setCameraRecovering(true);
    const nextEpoch = cameraEpochRef.current + 1;
    cameraEpochRef.current = nextEpoch;
    setCameraEpoch(nextEpoch);
    return true;
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const watchdog = setInterval(async () => {
      const timeoutMs = hasCameraSampleRef.current ? SENSOR_STALL_MS : SENSOR_STARTUP_GRACE_MS;
      const now = Date.now();
      if (stoppingRef.current || now - lastSampleAtRef.current <= timeoutMs) return;
      // Read native state before grace or restart reservation: its named event
      // may still be queued behind this watchdog/error on the JS thread.
      const epoch = cameraEpochRef.current;
      const generation = cameraInterruptionGenerationRef.current;
      const interruption = await checkCameraInterruption(epoch);
      if (interruption === 'paused') return;
      if (epoch !== cameraEpochRef.current || generation !== cameraInterruptionGenerationRef.current
        || stoppingRef.current || multitaskingCameraPausedRef.current) return;
      const checkedAt = Date.now();
      const checkedTimeout = hasCameraSampleRef.current ? SENSOR_STALL_MS : SENSOR_STARTUP_GRACE_MS;
      if (checkedAt - lastSampleAtRef.current <= checkedTimeout) return;
      if (interruption === 'ready' && captureTransitionRef.current.shouldDefer(checkedAt, lastSampleAtRef.current)) return;
      performanceTrackerRef.current.recordCameraStall();
      if (interruption === 'ready' && attemptCameraRecovery()) return;
      const message = 'Monitoring stopped: camera analysis stalled. Pull over safely before checking the phone or restarting.';
      setSensorFault(message);
      deliverMonitoringPausedCue();
      void handleStopRef.current();
    }, 500);
    return () => clearInterval(watchdog);
  }, [attemptCameraRecovery, checkCameraInterruption, deliverMonitoringPausedCue, isRunning]);

  const handleCameraError = useCallback(async (error: CameraRuntimeError, epoch: number, owner: number) => {
    if (!cameraScreenMountedRef.current || owner !== cameraCallbackOwnerRef.current || epoch !== cameraEpochRef.current) return;
    const generation = cameraInterruptionGenerationRef.current;
    const interruption = await checkCameraInterruption(epoch);
    if (interruption === 'paused') return;
    if (epoch !== cameraEpochRef.current || generation !== cameraInterruptionGenerationRef.current
      || stoppingRef.current || multitaskingCameraPausedRef.current) return;
    if (setupPreviewActiveRef.current && !isRunningRef.current) {
      baselineGenerationRef.current += 1;baselineCollectorRef.current.reset();
      setupPreviewActiveRef.current = false;
      setSetupPreviewActive(false);
      setSensorFault('Camera preview could not start. Close other camera apps and try the setup check again.');
      return;
    }
    if (!isRunningRef.current || stoppingRef.current) return;
    performanceTrackerRef.current.recordCameraStall();
    if (
      interruption === 'ready'
      && shouldRestartCamera(error.code, cameraRestartCountRef.current)
      && attemptCameraRecovery()
    ) return;
    setSensorFault(
      'Monitoring stopped: the camera became unavailable. Pull over safely before checking the phone or restarting.',
    );
    deliverMonitoringPausedCue();
    void handleStopRef.current();
  }, [attemptCameraRecovery, checkCameraInterruption, deliverMonitoringPausedCue]);

  useEffect(() => {
    if (!isRunning || cameraLoadPolicy.mode !== 'stop') return;
    setSensorFault(
      'Monitoring stopped because the iPhone became too hot. Pull over safely and let the phone cool before restarting.',
    );
    deliverMonitoringPausedCue();
    void handleStopRef.current();
  }, [cameraLoadPolicy.mode, deliverMonitoringPausedCue, isRunning]);

  return { handleCaptureConfiguration, handleCameraError };
}
