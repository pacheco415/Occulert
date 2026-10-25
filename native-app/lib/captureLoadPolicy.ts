import type { CameraLoadPolicy } from './cameraResilience';

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
