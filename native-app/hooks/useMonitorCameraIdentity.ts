import React, { useCallback, useEffect } from 'react';
import { EYE_BASELINE_EXPERIMENT, ParkedEyeBaseline } from '../lib/eyeBaselineModel';

import { type SensitivityLevel } from '../constants/thresholds';
import { initialCameraSetupAssessment, type CameraSetupAssessment } from '../lib/cameraSetup';
import { observeFrontCameraIdentity, type FrontCameraIdentity } from '../lib/deviceCondition';
import { frontCameraTransition } from '../lib/frontCameraSwitch';

interface Options {
  startingRef: React.RefObject<boolean>;
  stoppingRef: React.RefObject<boolean>;
  baselineBusyRef: React.RefObject<boolean>;
  cameraInterruptionGenerationRef: React.RefObject<number>;
  cameraCallbackOwnerRef: React.RefObject<number>;
  multitaskingCameraPausedRef: React.RefObject<boolean>;
  setSensorFault: React.Dispatch<React.SetStateAction<string | null>>;
  setSetupPreviewActive: React.Dispatch<React.SetStateAction<boolean>>;
  isRunningRef: React.RefObject<boolean>;
  setupPreviewActiveRef: React.RefObject<boolean>;
  frontCameraSwitchRef: React.RefObject<import("../lib/frontCameraSwitch").FrontCameraSwitchState>;
  frontCameraIdentityRef: React.RefObject<FrontCameraIdentity | null>;
  setFrontCameraIdentity: React.Dispatch<React.SetStateAction<FrontCameraIdentity | null>>;
  baselineGenerationRef: React.RefObject<number>;
  baselineCollectorRef: React.RefObject<ParkedEyeBaseline>;
  baselineFinishedRef: React.RefObject<boolean>;
  lastCameraSetupUiAtRef: React.RefObject<number>;
  setCameraSetup: React.Dispatch<React.SetStateAction<CameraSetupAssessment>>;
  cameraBaselineRevisionRef: React.RefObject<number>;
  sessionEyeBaselineRef: React.RefObject<number | null>;
  eyeBaselineRef: React.RefObject<number | null>;
  baselineCanSaveRef: React.RefObject<boolean>;
  setEyeBaseline: React.Dispatch<React.SetStateAction<number | null>>;
  setBaselineMessage: React.Dispatch<React.SetStateAction<string>>;
  clearDeviceEyeBaseline: () => Promise<void>;
  baselineMountedRef: React.RefObject<boolean>;
  performanceTrackerRef: React.RefObject<import("../lib/monitorPerformance").MonitorPerformanceTracker>;
  deliverMonitoringPausedCue: () => void;
  isRunning: boolean;
  setupPreviewActive: boolean;
  device: import("react-native-vision-camera").CameraDevice | undefined;
  loadDeviceEyeBaseline: () => Promise<number | null>;
  setBaselineLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  loadSavedSensitivity: () => Promise<SensitivityLevel>;
  setSensitivity: React.Dispatch<React.SetStateAction<SensitivityLevel>>;
  setSensitivityLoaded: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useMonitorCameraIdentity({
  startingRef, stoppingRef, baselineBusyRef, cameraInterruptionGenerationRef,
  cameraCallbackOwnerRef, multitaskingCameraPausedRef, setSensorFault,
  setSetupPreviewActive,
  isRunningRef, setupPreviewActiveRef, frontCameraSwitchRef,
  frontCameraIdentityRef, setFrontCameraIdentity, baselineGenerationRef,
  baselineCollectorRef, baselineFinishedRef, lastCameraSetupUiAtRef,
  setCameraSetup, cameraBaselineRevisionRef, sessionEyeBaselineRef,
  eyeBaselineRef, baselineCanSaveRef, setEyeBaseline,
  setBaselineMessage, clearDeviceEyeBaseline, baselineMountedRef,
  performanceTrackerRef, deliverMonitoringPausedCue, isRunning,
  setupPreviewActive, device, loadDeviceEyeBaseline,
  setBaselineLoaded, loadSavedSensitivity, setSensitivity,
  setSensitivityLoaded,
}: Options) {
  const handleFrontCameraIdentity = useCallback((identity: FrontCameraIdentity) => {
    if (!isRunningRef.current && !setupPreviewActiveRef.current) return;
    const running = isRunningRef.current;
    const transition = frontCameraTransition(frontCameraSwitchRef.current, identity, running);
    frontCameraSwitchRef.current = transition.state;
    frontCameraIdentityRef.current = identity;
    setFrontCameraIdentity(identity);
    if (transition.resetParkedSetup) {
      baselineGenerationRef.current += 1;
      baselineCollectorRef.current.reset();
      baselineFinishedRef.current = false;
      lastCameraSetupUiAtRef.current = 0;
      setCameraSetup(initialCameraSetupAssessment());
    }
    const baselineCleared = transition.clearEyeBaseline && EYE_BASELINE_EXPERIMENT;
    if (baselineCleared) {
      baselineGenerationRef.current += 1;
      const cameraRevision = ++cameraBaselineRevisionRef.current;
      baselineCollectorRef.current.reset();
      baselineFinishedRef.current = false;
      sessionEyeBaselineRef.current = null;
      eyeBaselineRef.current = null;
      baselineCanSaveRef.current = false;
      // This state is the real useEyeTracking input, not only the saved-session label.
      setEyeBaseline(null);
      setBaselineMessage(running
        ? 'Camera changed. Experimental eye baseline cleared; current presets apply.'
        : 'Camera changed. Parked setup and the experimental eye baseline were reset.');
      void clearDeviceEyeBaseline().then(() => {
        if (baselineMountedRef.current && cameraRevision === cameraBaselineRevisionRef.current) {
          baselineCanSaveRef.current = true;
        }
      }).catch(() => {
        if (!baselineMountedRef.current || cameraRevision !== cameraBaselineRevisionRef.current) return;
        baselineCanSaveRef.current = false;
        setBaselineMessage('Experimental baseline could not be cleared from storage. Current presets apply; reset it in Settings before another session.');
      });
    }
    if (running) performanceTrackerRef.current.recordFrontCamera(identity, Date.now(), baselineCleared);
    if (transition.playNotice) deliverMonitoringPausedCue();
  }, [deliverMonitoringPausedCue]);

  const cameraIdentityActive = isRunning || setupPreviewActive;
  useEffect(() => {
    if (!cameraIdentityActive || !device?.id) return;
    let active = true;
    const subscription = observeFrontCameraIdentity(device.id, identity => {
      if (active) handleFrontCameraIdentity(identity);
    });
    void subscription.ready.catch(() => {});
    return () => { active = false; subscription.remove(); };
  }, [cameraIdentityActive, device?.id, handleFrontCameraIdentity]);

  useEffect(() => {
    if (!EYE_BASELINE_EXPERIMENT) return;
    let active = true;baselineMountedRef.current=true;
    const cameraRevision = cameraBaselineRevisionRef.current;
    void loadDeviceEyeBaseline().then(value => {
      if (!active || cameraRevision !== cameraBaselineRevisionRef.current) return;
      baselineCanSaveRef.current = true;
      eyeBaselineRef.current = value;
      setEyeBaseline(value);
      setBaselineMessage(value === null ? 'While parked, open Setup check and look forward with eyes open for three seconds.' : 'Saved parked eye baseline · experimental local sessions only.');
    }).catch(() => {
      if (active && cameraRevision === cameraBaselineRevisionRef.current) setBaselineMessage('Saved baseline unavailable. Current presets apply; use Recalibrate in Settings to reset it.');
    }).finally(() => { if (active) setBaselineLoaded(true); });
    return () => { active = false; baselineMountedRef.current=false;baselineGenerationRef.current += 1; };
  }, []);

  useEffect(() => {
    loadSavedSensitivity()
      .then(setSensitivity)
      .finally(() => setSensitivityLoaded(true));
  }, []);

  const toggleSetupPreview = useCallback(() => {
    if (isRunningRef.current || startingRef.current || stoppingRef.current || baselineBusyRef.current) return;
    const next = !setupPreviewActiveRef.current;
    cameraInterruptionGenerationRef.current += 1;
    cameraCallbackOwnerRef.current += 1;
    if (next) multitaskingCameraPausedRef.current = false;
    setupPreviewActiveRef.current = next;
    baselineGenerationRef.current += 1;
    baselineCollectorRef.current.reset();
    baselineFinishedRef.current = false;
    lastCameraSetupUiAtRef.current = 0;
    setSetupPreviewActive(next);
    setCameraSetup(initialCameraSetupAssessment());
    setSensorFault(null);
  }, []);

  return toggleSetupPreview;

}
