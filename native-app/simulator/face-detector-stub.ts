import { useMemo } from 'react';
import type { Frame } from 'react-native-vision-camera';
import type { Face, FrameFaceDetectionOptions } from 'react-native-vision-camera-face-detector/src/FaceDetector';
import { SIMULATOR_TRACE } from '../lib/simulatorTrace';
export type { FrameFaceDetectionOptions } from 'react-native-vision-camera-face-detector/src/FaceDetector';

if (!SIMULATOR_TRACE) throw new Error('A scripted detector must never enter a production app.');

// The simulator has no camera frames. The timed trace invokes the real monitor
// callback; this hook supplies only the absent ML Kit plugin's import surface.
export function useFaceDetector(options?: FrameFaceDetectionOptions) {
  return useMemo(() => ({
    detectFaces: (_frame: Frame): Face[] => { 'worklet'; return []; },
    stopListeners() {},
  }), [options]);
}
