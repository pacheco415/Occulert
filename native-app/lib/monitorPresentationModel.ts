import type { EyeMetrics } from '../hooks/useEyeTracking';
import type { CameraSetupAssessment } from './cameraSetup';

export function deriveMonitorPresentation({ metrics, sensorFault, isStopping, isStarting, cameraRecovering, isRunning, setupPreviewActive, cameraSetup }: {
  metrics: EyeMetrics; sensorFault: string | null; isStopping: boolean; isStarting: boolean; cameraRecovering: boolean; isRunning: boolean; setupPreviewActive: boolean; cameraSetup: CameraSetupAssessment;
}) {
  const stateColor = {
    open: '#00ff88',
    watch: '#fbbf24',
    closed: '#ff3344',
    noFace: '#fbbf24',
  }[metrics.state];
  const recoveryRequired = Boolean(sensorFault?.startsWith('Monitoring did not start'));
  const monitorStatusLabel = sensorFault
    ? recoveryRequired ? 'RECOVERY REQUIRED' : 'STOPPED · CHECK CAMERA'
    : isStopping
      ? 'SAVING DRIVE'
      : isStarting
        ? 'STARTING'
        : cameraRecovering
          ? 'RECOVERING CAMERA'
        : isRunning
          ? ({
              open: 'TRACKING',
              watch: 'CHECKING EYES',
              closed: 'DROWSINESS ALERT',
              noFace: 'TRACKING UNAVAILABLE',
            } as const)[metrics.state]
          : setupPreviewActive
            ? cameraSetup.ready ? 'SETUP READY' : 'CHECKING SETUP'
            : 'NOT MONITORING';
  const monitorStatusColor = sensorFault
    ? '#ef4444'
    : cameraRecovering
      ? '#fbbf24'
    : isRunning
      ? stateColor
      : cameraSetup.ready
        ? '#30d158'
        : '#64d2ff';

  return { recoveryRequired, monitorStatusLabel, monitorStatusColor };
}
