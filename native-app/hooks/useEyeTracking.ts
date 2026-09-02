import { useRef, useCallback } from 'react';
import {
  SENSITIVITY_PRESETS, DEFAULT_SENSITIVITY, PERCLOS_ALERT_THRESHOLD, PERCLOS_WINDOW_MS,
  type SensitivityLevel,
} from '../constants/thresholds';
import { RollingClosedFraction } from '../lib/rollingClosedFraction';

// MediaPipe FaceMesh EAR sets, ordered [corner, top, top, corner, bottom, bottom]
// (kept for compatibility with the web app / any future landmark-based pipeline)
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

// ML Kit reports eye-open probability 0..1. A fully open eye in the EAR model
// is ~0.3, so we map probability onto the same EAR scale the sensitivity
// presets were tuned against: pseudoEAR = probability * EAR_FULL_OPEN.
const EAR_FULL_OPEN = 0.3;

export interface EyeMetrics {
  ear: number;
  perclos: number;
  fatigueScore: number;
  closedDurationMs: number;
  state: 'open' | 'watch' | 'closed' | 'noFace';
}

function ear(lm: Array<{ x: number; y: number }>, idx: number[]): number {
  const pts = idx.map(i => lm[i]);
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const A = d(pts[1], pts[5]), B = d(pts[2], pts[4]), C = d(pts[0], pts[3]);
  return C > 0 ? (A + B) / (2 * C) : 0.3;
}

export function useEyeTracking(level: SensitivityLevel = DEFAULT_SENSITIVITY) {
  const win = useRef<RollingClosedFraction | null>(null);
  const perclosWindow = win.current ??= new RollingClosedFraction(PERCLOS_WINDOW_MS);
  const lastEar = useRef(0.3);
  const preset = SENSITIVITY_PRESETS[level];

  /** Shared scoring path: takes a pseudo/real EAR value, updates the PERCLOS
   *  rolling window, and derives the fatigue score. */
  const scoreFromEar = useCallback(
    (avgEar: number): EyeMetrics => {
      const now = Date.now();
      lastEar.current = avgEar;

      const closed = avgEar < preset.eyeClosedThreshold;
      const watching = !closed && avgEar < preset.eyeWatchThreshold;

      const perclos = perclosWindow.add(now, closed);

      const drop = Math.max(0, (preset.eyeWatchThreshold - avgEar) / preset.eyeWatchThreshold);
      // Normalize PERCLOS against its clinical alert threshold so the score reaches
      // ~100 when PERCLOS hits the alert threshold sustained with eyes drooping.
      const perclosRatio = Math.min(1, perclos / PERCLOS_ALERT_THRESHOLD);
      const fatigueScore = Math.min(100, Math.round(drop * 50 + perclosRatio * 50));

      return {
        ear: avgEar,
        perclos,
        fatigueScore,
        closedDurationMs: 0,
        state: closed ? 'closed' : watching ? 'watch' : 'open',
      };
    },
    [perclosWindow, preset],
  );

  /** Landmark path (468-point FaceMesh) — used by the web app and any future
   *  MediaPipe-based native pipeline. */
  const processLandmarks = useCallback(
    (lm: Array<{ x: number; y: number }> | null): EyeMetrics => {
      if (!lm || lm.length < 468) {
        return {
          ear: lastEar.current,
          perclos: 0,
          fatigueScore: 0,
          closedDurationMs: 0,
          state: 'noFace',
        };
      }
      const avgEar = (ear(lm, LEFT_EYE) + ear(lm, RIGHT_EYE)) / 2;
      return scoreFromEar(avgEar);
    },
    [scoreFromEar],
  );

  /** ML Kit path — takes leftEyeOpenProbability / rightEyeOpenProbability
   *  (0..1, or null/-1 when the classifier has no estimate) from
   *  react-native-vision-camera-face-detector and maps them onto the EAR
   *  scale so the existing sensitivity presets apply unchanged. */
  const processEyeOpenness = useCallback(
    (leftProb: number | null | undefined, rightProb: number | null | undefined): EyeMetrics => {
      const valid = (p: number | null | undefined): p is number =>
        typeof p === 'number' && p >= 0 && p <= 1;

      if (!valid(leftProb) && !valid(rightProb)) {
        return {
          ear: lastEar.current,
          perclos: 0,
          fatigueScore: 0,
          closedDurationMs: 0,
          state: 'noFace',
        };
      }
      const probs = [leftProb, rightProb].filter(valid);
      const avgProb = probs.reduce((a, b) => a + b, 0) / probs.length;
      return scoreFromEar(avgProb * EAR_FULL_OPEN);
    },
    [scoreFromEar],
  );

  /** Explicit no-face signal for frames where the detector finds no face. */
  const processNoFace = useCallback((): EyeMetrics => {
    return {
      ear: lastEar.current,
      perclos: 0,
      fatigueScore: 0,
      closedDurationMs: 0,
      state: 'noFace',
    };
  }, []);

  const reset = useCallback(() => { perclosWindow.reset(); lastEar.current = 0.3; }, [perclosWindow]);

  return { processLandmarks, processEyeOpenness, processNoFace, reset };
}
