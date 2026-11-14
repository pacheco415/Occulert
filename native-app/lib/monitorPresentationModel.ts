import { strings } from './strings.ts';
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
    ? recoveryRequired ? strings.monitor.status.recoveryRequired : strings.monitor.status.checkCamera
    : isStopping
      ? strings.monitor.status.saving
      : isStarting
        ? strings.monitor.status.starting
        : cameraRecovering
          ? strings.monitor.status.recovering
        : isRunning
          ? ({
              open: strings.monitor.status.tracking,
              watch: strings.monitor.status.checkingEyes,
              closed: strings.monitor.status.drowsinessAlert,
              noFace: strings.monitor.status.trackingUnavailable,
            } as const)[metrics.state]
          : setupPreviewActive
            ? cameraSetup.ready ? strings.monitor.status.setupReady : strings.monitor.status.checkingSetup
            : strings.monitor.status.stopped;
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
