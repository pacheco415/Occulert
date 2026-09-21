export type DeviceThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

export interface CameraLoadPolicyInput {
  thermalState: DeviceThermalState;
  lowPowerMode: boolean;
  batteryLevel: number;
  isCharging: boolean;
}

export interface CameraLoadPolicy {
  analysisIntervalMs: number;
  mode: 'normal' | 'reduced' | 'stop';
  reason: 'none' | 'low-power' | 'low-battery' | 'heat';
}

export const NORMAL_ANALYSIS_INTERVAL_MS = 100;
export const REDUCED_ANALYSIS_INTERVAL_MS = 200;
export const MAX_AUTOMATIC_CAMERA_RESTARTS = 1;

const RECOVERABLE_CAMERA_ERRORS = new Set([
  'device/configuration-error',
  'device/camera-already-in-use',
  'session/camera-not-ready',
  'unknown/unknown',
]);

export function deriveCameraLoadPolicy({
  thermalState,
  lowPowerMode,
  batteryLevel,
  isCharging,
}: CameraLoadPolicyInput): CameraLoadPolicy {
  if (thermalState === 'critical') {
    return { analysisIntervalMs: REDUCED_ANALYSIS_INTERVAL_MS, mode: 'stop', reason: 'heat' };
  }
  if (thermalState === 'serious') {
    return { analysisIntervalMs: REDUCED_ANALYSIS_INTERVAL_MS, mode: 'reduced', reason: 'heat' };
  }
  if (lowPowerMode) {
    return { analysisIntervalMs: REDUCED_ANALYSIS_INTERVAL_MS, mode: 'reduced', reason: 'low-power' };
  }
  if (batteryLevel >= 0 && batteryLevel <= 0.15 && !isCharging) {
    return { analysisIntervalMs: REDUCED_ANALYSIS_INTERVAL_MS, mode: 'reduced', reason: 'low-battery' };
  }
  return { analysisIntervalMs: NORMAL_ANALYSIS_INTERVAL_MS, mode: 'normal', reason: 'none' };
}

export function shouldRestartCamera(errorCode: string, restartCount: number): boolean {
  return restartCount < MAX_AUTOMATIC_CAMERA_RESTARTS
    && RECOVERABLE_CAMERA_ERRORS.has(errorCode);
}

export function canRestartStalledCamera(restartCount: number): boolean {
  return restartCount < MAX_AUTOMATIC_CAMERA_RESTARTS;
}
