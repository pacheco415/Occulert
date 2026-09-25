import type { EyeMetrics } from '../hooks/useEyeTracking';
import type { HeadphoneMotionState } from './headphoneMotion';
import type { WatchStatus } from './watchBridge';

export const SENSOR_FUSION_OBSERVATION_VERSION = 1;
export const SENSOR_FUSION_COINCIDENCE_WINDOW_MS = 5_000;

export interface SensorFusionObservationSnapshot {
  version: typeof SENSOR_FUSION_OBSERVATION_VERSION;
  mode: 'observation-only';
  durationSec: number;
  camera: {
    samples: number;
    trackedSamples: number;
    watchSamples: number;
    closedSamples: number;
    peakFatigue: number;
    headNods: number;
  };
  headphone: {
    status: HeadphoneMotionState;
    samples: number;
    headNods: number;
  };
  watch: {
    checked: boolean;
    moduleAvailable: boolean;
    paired: boolean;
    appInstalled: boolean;
    reachable: boolean;
  };
  coincidences: {
    cameraHeadphoneNods: number;
    elevatedCameraHeadphoneNods: number;
  };
}

export interface SensorFusionObservationTracker {
  reset(startedAt: number): void;
  recordCameraSample(sample: Pick<EyeMetrics, 'state' | 'fatigueScore'> & { at: number }): void;
  recordCameraHeadNod(at: number): void;
  recordHeadphoneSample(at: number): void;
  recordHeadphoneHeadNod(at: number): void;
  setHeadphoneStatus(status: HeadphoneMotionState): void;
  setWatchStatus(status: WatchStatus): void;
  snapshot(at?: number): SensorFusionObservationSnapshot;
}

function validAt(at: number, startedAt: number): boolean {
  return Number.isFinite(at) && at >= startedAt;
}

function withinCoincidenceWindow(left: number, right: number): boolean {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= SENSOR_FUSION_COINCIDENCE_WINDOW_MS;
}

/**
 * Tracks bounded, aggregate sensor co-occurrences for future validation.
 *
 * This tracker has no score or alert output. It stores no raw pose, motion,
 * biometric, media, or timestamp series and is never used by alert policy.
 */
export function createSensorFusionObservationTracker(): SensorFusionObservationTracker {
  let startedAt = 0;
  let cameraSamples = 0;
  let trackedCameraSamples = 0;
  let watchCameraSamples = 0;
  let closedCameraSamples = 0;
  let peakFatigue = 0;
  let cameraHeadNods = 0;
  let headphoneStatus: HeadphoneMotionState = 'not-built';
  let headphoneSamples = 0;
  let headphoneHeadNods = 0;
  let watchStatus: WatchStatus | null = null;
  let lastCameraHeadNodAt = Number.NEGATIVE_INFINITY;
  let lastElevatedCameraAt = Number.NEGATIVE_INFINITY;
  let lastHeadphoneHeadNodAt = Number.NEGATIVE_INFINITY;
  let cameraHeadphoneNodCoincidences = 0;
  let elevatedCameraHeadphoneNodCoincidences = 0;
  let lastCameraNodMatchAt = Number.NEGATIVE_INFINITY;
  let lastElevatedMatchAt = Number.NEGATIVE_INFINITY;

  const reset = (nextStartedAt: number) => {
    startedAt = Number.isFinite(nextStartedAt) && nextStartedAt >= 0 ? nextStartedAt : 0;
    cameraSamples = 0;
    trackedCameraSamples = 0;
    watchCameraSamples = 0;
    closedCameraSamples = 0;
    peakFatigue = 0;
    cameraHeadNods = 0;
    headphoneStatus = 'not-built';
    headphoneSamples = 0;
    headphoneHeadNods = 0;
    watchStatus = null;
    lastCameraHeadNodAt = Number.NEGATIVE_INFINITY;
    lastElevatedCameraAt = Number.NEGATIVE_INFINITY;
    lastHeadphoneHeadNodAt = Number.NEGATIVE_INFINITY;
    cameraHeadphoneNodCoincidences = 0;
    elevatedCameraHeadphoneNodCoincidences = 0;
    lastCameraNodMatchAt = Number.NEGATIVE_INFINITY;
    lastElevatedMatchAt = Number.NEGATIVE_INFINITY;
  };

  const matchHeadphoneNod = (headphoneNodAt: number) => {
    if (
      withinCoincidenceWindow(lastCameraHeadNodAt, headphoneNodAt)
      && lastCameraNodMatchAt !== headphoneNodAt
    ) {
      cameraHeadphoneNodCoincidences += 1;
      lastCameraNodMatchAt = headphoneNodAt;
    }
    if (
      withinCoincidenceWindow(lastElevatedCameraAt, headphoneNodAt)
      && lastElevatedMatchAt !== headphoneNodAt
    ) {
      elevatedCameraHeadphoneNodCoincidences += 1;
      lastElevatedMatchAt = headphoneNodAt;
    }
  };

  reset(0);
  return {
    reset,
    recordCameraSample(sample) {
      if (!validAt(sample.at, startedAt)) return;
      cameraSamples += 1;
      if (sample.state !== 'noFace') trackedCameraSamples += 1;
      if (sample.state === 'watch') watchCameraSamples += 1;
      if (sample.state === 'closed') closedCameraSamples += 1;
      if (Number.isFinite(sample.fatigueScore)) {
        peakFatigue = Math.max(peakFatigue, Math.min(100, Math.max(0, sample.fatigueScore)));
      }
      if (sample.state === 'watch' || sample.state === 'closed') {
        lastElevatedCameraAt = sample.at;
        matchHeadphoneNod(lastHeadphoneHeadNodAt);
      }
    },
    recordCameraHeadNod(at) {
      if (!validAt(at, startedAt)) return;
      cameraHeadNods += 1;
      lastCameraHeadNodAt = at;
      matchHeadphoneNod(lastHeadphoneHeadNodAt);
    },
    recordHeadphoneSample(at) {
      if (!validAt(at, startedAt)) return;
      headphoneSamples += 1;
    },
    recordHeadphoneHeadNod(at) {
      if (!validAt(at, startedAt)) return;
      headphoneHeadNods += 1;
      lastHeadphoneHeadNodAt = at;
      matchHeadphoneNod(at);
    },
    setHeadphoneStatus(status) {
      headphoneStatus = status;
    },
    setWatchStatus(status) {
      watchStatus = { ...status };
    },
    snapshot(at = startedAt) {
      const endedAt = validAt(at, startedAt) ? at : startedAt;
      return {
        version: SENSOR_FUSION_OBSERVATION_VERSION,
        mode: 'observation-only',
        durationSec: Math.max(0, Math.floor((endedAt - startedAt) / 1_000)),
        camera: {
          samples: cameraSamples,
          trackedSamples: trackedCameraSamples,
          watchSamples: watchCameraSamples,
          closedSamples: closedCameraSamples,
          peakFatigue: Math.round(peakFatigue),
          headNods: cameraHeadNods,
        },
        headphone: {
          status: headphoneStatus,
          samples: headphoneSamples,
          headNods: headphoneHeadNods,
        },
        watch: {
          checked: watchStatus !== null,
          moduleAvailable: watchStatus?.moduleAvailable ?? false,
          paired: watchStatus?.paired ?? false,
          appInstalled: watchStatus?.appInstalled ?? false,
          reachable: watchStatus?.reachable ?? false,
        },
        coincidences: {
          cameraHeadphoneNods: cameraHeadphoneNodCoincidences,
          elevatedCameraHeadphoneNods: elevatedCameraHeadphoneNodCoincidences,
        },
      };
    },
  };
}
