export const MONITOR_UI_UPDATE_INTERVAL_MS = 250;

export function shouldRefreshMonitorMetrics({
  previousState,
  nextState,
  previousAlertLevel,
  nextAlertLevel,
  now,
  lastUpdatedAt,
}: {
  previousState: string;
  nextState: string;
  previousAlertLevel: string;
  nextAlertLevel: string;
  now: number;
  lastUpdatedAt: number;
}): boolean {
  return nextState !== previousState
    || nextAlertLevel !== previousAlertLevel
    || now - lastUpdatedAt >= MONITOR_UI_UPDATE_INTERVAL_MS;
}

export const MONITOR_PERFORMANCE_WINDOW_SIZE = 120;

export interface MonitorPerformanceSnapshot {
  samples: number;
  uiUpdates: number;
  averageInferenceMs: number;
  p95InferenceMs: number;
  averageSampleIntervalMs: number;
  timeToFirstSampleMs: number | null;
  uiUpdatesPerSecond: number;
  cameraStalls: number;
}

export interface MonitorPerformanceTracker {
  recordSessionStart: (at: number) => void;
  recordSample: (at: number, inferenceMs: number) => void;
  recordUiUpdate: () => void;
  recordCameraStall: () => void;
  reset: () => void;
  snapshot: (at?: number) => MonitorPerformanceSnapshot;
}

function roundedAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[index] * 10) / 10;
}

function roundedRate(count: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.round((count / (durationMs / 1_000)) * 10) / 10;
}

export function elapsedSessionSeconds(startedAt: number | null, endedAt: number | null = null): number {
  if (startedAt === null) return 0;
  return Math.max(0, Math.floor(((endedAt ?? Date.now()) - startedAt) / 1_000));
}

export function formatSessionTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function createMonitorPerformanceTracker(
  windowSize = MONITOR_PERFORMANCE_WINDOW_SIZE,
): MonitorPerformanceTracker {
  const inferenceDurations: number[] = [];
  const sampleIntervals: number[] = [];
  let samples = 0;
  let uiUpdates = 0;
  let cameraStalls = 0;
  let sessionStartedAt = 0;
  let firstSampleAt: number | null = null;
  let lastSampleAt = 0;

  const appendBounded = (values: number[], value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    values.push(value);
    if (values.length > windowSize) values.shift();
  };

  return {
    recordSessionStart(at) {
      if (!Number.isFinite(at) || at < 0) return;
      sessionStartedAt = at;
      firstSampleAt = null;
    },
    recordSample(at, inferenceMs) {
      samples += 1;
      if (firstSampleAt === null && Number.isFinite(at) && at >= sessionStartedAt) {
        firstSampleAt = at;
      }
      appendBounded(inferenceDurations, inferenceMs);
      if (lastSampleAt > 0) appendBounded(sampleIntervals, at - lastSampleAt);
      lastSampleAt = at;
    },
    recordUiUpdate() {
      uiUpdates += 1;
    },
    recordCameraStall() {
      cameraStalls += 1;
    },
    reset() {
      inferenceDurations.length = 0;
      sampleIntervals.length = 0;
      samples = 0;
      uiUpdates = 0;
      cameraStalls = 0;
      sessionStartedAt = 0;
      firstSampleAt = null;
      lastSampleAt = 0;
    },
    snapshot(at = lastSampleAt) {
      const durationMs = sessionStartedAt > 0 && at >= sessionStartedAt
        ? at - sessionStartedAt
        : 0;
      return {
        samples,
        uiUpdates,
        averageInferenceMs: roundedAverage(inferenceDurations),
        p95InferenceMs: percentile95(inferenceDurations),
        averageSampleIntervalMs: roundedAverage(sampleIntervals),
        timeToFirstSampleMs: firstSampleAt === null || sessionStartedAt <= 0
          ? null
          : Math.round((firstSampleAt - sessionStartedAt) * 10) / 10,
        uiUpdatesPerSecond: roundedRate(uiUpdates, durationMs),
        cameraStalls,
      };
    },
  };
}
