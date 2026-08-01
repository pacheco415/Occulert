export const HEALTH_READINESS_LOOKBACK_HOURS = 24;

const ASLEEP_VALUES = new Set([1, 3, 4, 5]);

export interface SleepSampleInput {
  startDate: Date | string;
  endDate: Date | string;
  value: number;
}

export interface HrvSampleInput {
  quantity: number;
  startDate: Date | string;
}

export interface HealthReadinessSnapshot {
  capturedAt: string;
  sleepMinutes24h: number | null;
  latestHrvMs: number | null;
  latestHrvAt: string | null;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function rounded(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * Returns unique time marked asleep within the requested window. Overlapping
 * stages and duplicate source samples are merged so the total is not inflated.
 */
export function totalAsleepMinutes(
  samples: readonly SleepSampleInput[],
  rangeStart: Date,
  rangeEnd: Date,
): number | null {
  const startBoundary = rangeStart.getTime();
  const endBoundary = rangeEnd.getTime();
  if (!Number.isFinite(startBoundary) || !Number.isFinite(endBoundary) || endBoundary <= startBoundary) {
    return null;
  }

  const intervals = samples
    .filter(sample => ASLEEP_VALUES.has(sample.value))
    .map(sample => ({
      start: Math.max(timestamp(sample.startDate), startBoundary),
      end: Math.min(timestamp(sample.endDate), endBoundary),
    }))
    .filter(interval => Number.isFinite(interval.start)
      && Number.isFinite(interval.end)
      && interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  if (intervals.length === 0) return null;

  let totalMilliseconds = 0;
  let currentStart = intervals[0].start;
  let currentEnd = intervals[0].end;

  for (const interval of intervals.slice(1)) {
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    totalMilliseconds += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  totalMilliseconds += currentEnd - currentStart;

  return Math.round(totalMilliseconds / 60_000);
}

export function createHealthReadinessSnapshot(input: {
  capturedAt: Date;
  sleepSamples: readonly SleepSampleInput[];
  latestHrvSample?: HrvSampleInput | null;
}): HealthReadinessSnapshot {
  const rangeEnd = input.capturedAt;
  const rangeStart = new Date(
    rangeEnd.getTime() - HEALTH_READINESS_LOOKBACK_HOURS * 60 * 60 * 1_000,
  );
  const hrv = input.latestHrvSample;
  const hrvAt = hrv ? timestamp(hrv.startDate) : Number.NaN;

  return {
    capturedAt: rangeEnd.toISOString(),
    sleepMinutes24h: totalAsleepMinutes(input.sleepSamples, rangeStart, rangeEnd),
    latestHrvMs: hrv && Number.isFinite(hrv.quantity) && hrv.quantity > 0
      ? rounded(hrv.quantity, 1)
      : null,
    latestHrvAt: Number.isFinite(hrvAt) ? new Date(hrvAt).toISOString() : null,
  };
}

export function isHealthReadinessSnapshot(value: unknown): value is HealthReadinessSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<HealthReadinessSnapshot>;
  const capturedAt = typeof snapshot.capturedAt === 'string'
    ? Date.parse(snapshot.capturedAt)
    : Number.NaN;
  const hrvAt = typeof snapshot.latestHrvAt === 'string'
    ? Date.parse(snapshot.latestHrvAt)
    : snapshot.latestHrvAt === null ? 0 : Number.NaN;
  const validSleep = snapshot.sleepMinutes24h === null
    || (typeof snapshot.sleepMinutes24h === 'number'
      && Number.isFinite(snapshot.sleepMinutes24h)
      && snapshot.sleepMinutes24h >= 0
      && snapshot.sleepMinutes24h <= HEALTH_READINESS_LOOKBACK_HOURS * 60);
  const validHrv = snapshot.latestHrvMs === null
    || (typeof snapshot.latestHrvMs === 'number'
      && Number.isFinite(snapshot.latestHrvMs)
      && snapshot.latestHrvMs > 0);

  return Number.isFinite(capturedAt) && Number.isFinite(hrvAt) && validSleep && validHrv;
}
