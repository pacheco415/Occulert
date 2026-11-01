import type { CameraLoadPolicy, DeviceThermalState } from './cameraResilience';

export const CAPTURE_LOAD_EXPERIMENT = process.env.EXPO_PUBLIC_CAPTURE_LOAD_EXPERIMENT === '1';
export const CAPTURE_TRANSITION_GRACE_MS = 2_000;

export interface CaptureFormatCandidate {
  videoWidth: number;
  videoHeight: number;
  minFps: number;
  maxFps: number;
}

export interface CaptureLoadConfiguration {
  width: number;
  height: number;
  fps: 15 | 30;
}

/** Hook filters are preferences; exclude unsafe resolution/rate ranges first. */
export function selectCaptureLoadFormat<T extends CaptureFormatCandidate>(formats: readonly T[]): T | undefined {
  return formats.filter(format => {
    const { videoWidth: width, videoHeight: height, minFps, maxFps } = format;
    return [width, height, minFps, maxFps].every(Number.isFinite)
      && Math.max(width, height) >= 1_280 && Math.min(width, height) >= 720
      && minFps >= 0 && minFps <= 15 && maxFps >= 30;
  }).sort((left, right) =>
    left.videoWidth * left.videoHeight - right.videoWidth * right.videoHeight
    || Math.max(left.videoWidth, left.videoHeight) - Math.max(right.videoWidth, right.videoHeight)
    || left.videoWidth - right.videoWidth
    || left.minFps - right.minFps
    || left.maxFps - right.maxFps,
  )[0];
}

export function captureLoadConfiguration(
  enabled: boolean,
  format: CaptureFormatCandidate | undefined,
  mode: CameraLoadPolicy['mode'],
): CaptureLoadConfiguration | null {
  if (!enabled || !format) return null;
  return {
    width: format.videoWidth,
    height: format.videoHeight,
    fps: mode === 'normal' ? 30 : 15,
  };
}

/**
 * A native reconfiguration may briefly pause frames. Never refresh the frame
 * clock or restart budget here. One frame gap receives at most two seconds of
 * additional grace beyond the normal stall deadline; repeated settings changes
 * cannot renew it until a new sample arrives.
 */
export function createCaptureTransitionGuard() {
  let previousKey: string | null = null;
  let initialized = false;
  let sampleAtTransition = 0;
  let graceUntil = 0;
  return {
    observe({ key, at, lastSampleAt, hasSample, stallTimeoutMs }: {
      key: string;
      at: number;
      lastSampleAt: number;
      hasSample: boolean;
      stallTimeoutMs: number;
    }): boolean {
      const changed = initialized && key !== previousKey;
      initialized = true;
      previousKey = key;
      if (!changed) return false;
      if (graceUntil > 0 && lastSampleAt <= sampleAtTransition) return false;
      if (!hasSample || !Number.isFinite(at) || !Number.isFinite(lastSampleAt)
        || lastSampleAt <= 0 || at < lastSampleAt || at - lastSampleAt > stallTimeoutMs) return false;
      sampleAtTransition = lastSampleAt;
      graceUntil = Math.max(at, lastSampleAt + stallTimeoutMs) + CAPTURE_TRANSITION_GRACE_MS;
      return true;
    },
    shouldDefer(at: number, lastSampleAt: number): boolean {
      if (lastSampleAt > sampleAtTransition) graceUntil = 0;
      return Number.isFinite(at) && at < graceUntil;
    },
    reset() {
      previousKey = null;
      initialized = false;
      sampleAtTransition = 0;
      graceUntil = 0;
    },
  };
}

/** Evaluation candidate only; no running camera consumes this policy. */
export const ROAD_STREAM_EVALUATION_FPS = 5;

export type RoadStreamPressureLevel =
  | 'nominal' | 'fair' | 'serious' | 'critical' | 'shutdown' | 'unknown';

export interface RoadStreamLoadPolicyInput {
  evaluationRequested?: boolean;
  thermalState: DeviceThermalState;
  pressureLevel: RoadStreamPressureLevel;
  fallbackLatched?: boolean;
}

export type RoadStreamLoadPolicy =
  | { mode: 'disabled'; requestedRoadFps: 0; reason: 'not-requested' }
  | { mode: 'evaluation'; requestedRoadFps: 5; reason: 'none' }
  | { mode: 'driverOnlyFallback'; requestedRoadFps: 0; reason: 'latched' | 'heat' | 'pressure' | 'unknown' };

/**
 * Pure, unused road-load recommendation, not capture admission or driver health.
 * A future owner must first establish support, identity, consent and fresh
 * same-session conditions. It must actually disable rear streaming on fallback,
 * retain that fallback until the next parked session via fallbackLatched, and
 * preserve the driver's existing cadence, watchdog and critical-heat stop.
 */
export function deriveRoadStreamLoadPolicy({
  evaluationRequested = false,
  thermalState,
  pressureLevel,
  fallbackLatched = false,
}: RoadStreamLoadPolicyInput): RoadStreamLoadPolicy {
  if (evaluationRequested !== true) {
    return { mode: 'disabled', requestedRoadFps: 0, reason: 'not-requested' };
  }
  if (fallbackLatched === true) {
    return { mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'latched' };
  }
  if (fallbackLatched !== false) {
    return { mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'unknown' };
  }
  if (thermalState === 'serious' || thermalState === 'critical') {
    return { mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'heat' };
  }
  if (pressureLevel === 'serious' || pressureLevel === 'critical' || pressureLevel === 'shutdown') {
    return { mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'pressure' };
  }
  if ((thermalState !== 'nominal' && thermalState !== 'fair')
    || (pressureLevel !== 'nominal' && pressureLevel !== 'fair')) {
    return { mode: 'driverOnlyFallback', requestedRoadFps: 0, reason: 'unknown' };
  }
  return { mode: 'evaluation', requestedRoadFps: ROAD_STREAM_EVALUATION_FPS, reason: 'none' };
}
