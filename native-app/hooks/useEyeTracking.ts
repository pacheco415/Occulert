import { useRef, useCallback } from 'react';
import {
  SENSITIVITY_PRESETS, DEFAULT_SENSITIVITY, PERCLOS_ALERT_THRESHOLD, PERCLOS_WINDOW_MS,
  type SensitivityLevel,
} from '../constants/thresholds';

// MediaPipe FaceMesh EAR sets, ordered [corner, top, top, corner, bottom, bottom]
const LEFT_EYE = [33,  160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

export interface EyeMetrics {
  ear: number;
  perclos: number;
  fatigueScore: number;
  state: 'open' | 'watch' | 'closed' | 'noFace';
}

function ear(lm: Array<{x:number;y:number}>, idx: number[]): number {
  const pts = idx.map(i => lm[i]);
  const d = (a:{x:number;y:number}, b:{x:number;y:number}) => Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
  const A = d(pts[1], pts[5]), B = d(pts[2], pts[4]), C = d(pts[0], pts[3]);
  return C > 0 ? (A + B) / (2 * C) : 0.3;
}

export function useEyeTracking(level: SensitivityLevel = DEFAULT_SENSITIVITY) {
  const win = useRef<Array<{ts:number;closed:boolean}>>([]);
  const lastEar = useRef(0.3);
  const preset = SENSITIVITY_PRESETS[level];

  const processLandmarks = useCallback(
    (lm: Array<{x:number;y:number}> | null): EyeMetrics => {
      const now = Date.now();
      if (!lm || lm.length < 468) return { ear: lastEar.current, perclos: 0, fatigueScore: 0, state: 'noFace' };

      const avgEar = (ear(lm, LEFT_EYE) + ear(lm, RIGHT_EYE)) / 2;
      lastEar.current = avgEar;

      const closed  = avgEar < preset.eyeClosedThreshold;
      const watching = !closed && avgEar < preset.eyeWatchThreshold;

      win.current.push({ ts: now, closed });
      win.current = win.current.filter(e => e.ts > now - PERCLOS_WINDOW_MS);

      const perclos = win.current.length > 0
        ? win.current.filter(e => e.closed).length / win.current.length : 0;

      const drop = Math.max(0, (preset.eyeWatchThreshold - avgEar) / preset.eyeWatchThreshold);
      // Normalize PERCLOS against its clinical alert threshold so the score reaches
      // ~100 when PERCLOS hits the alert threshold sustained with eyes drooping.
      const perclosRatio = Math.min(1, perclos / PERCLOS_ALERT_THRESHOLD);
      const fatigueScore = Math.min(100, Math.round(drop * 50 + perclosRatio * 50));

      return { ear: avgEar, perclos, fatigueScore, state: closed ? 'closed' : watching ? 'watch' : 'open' };
    },
    [preset],
  );

  const reset = useCallback(() => { win.current = []; lastEar.current = 0.3; }, []);

  return { processLandmarks, reset };
}
