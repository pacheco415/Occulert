import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createHealthReadinessSnapshot,
  isHealthReadinessSnapshot,
  totalAsleepMinutes,
} from '../native-app/lib/healthReadiness.ts';

const hour = 60 * 60 * 1_000;
const minute = 60 * 1_000;

test('sleep summary merges overlapping stages and ignores awake or in-bed samples', () => {
  const rangeStart = new Date('2026-08-01T00:00:00.000Z');
  const rangeEnd = new Date('2026-08-02T00:00:00.000Z');
  const total = totalAsleepMinutes([
    { startDate: new Date(rangeStart.getTime() + hour), endDate: new Date(rangeStart.getTime() + 3 * hour), value: 3 },
    { startDate: new Date(rangeStart.getTime() + 2 * hour), endDate: new Date(rangeStart.getTime() + 4 * hour), value: 5 },
    { startDate: new Date(rangeStart.getTime() + 4 * hour), endDate: new Date(rangeStart.getTime() + 5 * hour), value: 2 },
    { startDate: new Date(rangeStart.getTime()), endDate: new Date(rangeStart.getTime() + 6 * hour), value: 0 },
  ], rangeStart, rangeEnd);

  assert.equal(total, 180);
});

test('sleep summary clamps samples to the requested 24-hour window', () => {
  const rangeStart = new Date('2026-08-01T00:00:00.000Z');
  const rangeEnd = new Date('2026-08-02T00:00:00.000Z');
  const total = totalAsleepMinutes([
    {
      startDate: new Date(rangeStart.getTime() - hour),
      endDate: new Date(rangeStart.getTime() + 30 * minute),
      value: 1,
    },
    {
      startDate: new Date(rangeEnd.getTime() - 15 * minute),
      endDate: new Date(rangeEnd.getTime() + hour),
      value: 4,
    },
  ], rangeStart, rangeEnd);

  assert.equal(total, 45);
});

test('readiness snapshot preserves factual values without assigning a score', () => {
  const capturedAt = new Date('2026-08-02T12:00:00.000Z');
  const snapshot = createHealthReadinessSnapshot({
    capturedAt,
    sleepSamples: [{
      startDate: '2026-08-02T04:00:00.000Z',
      endDate: '2026-08-02T11:15:00.000Z',
      value: 3,
    }],
    latestHrvSample: {
      quantity: 42.26,
      startDate: '2026-08-02T10:00:00.000Z',
    },
  });

  assert.deepEqual(snapshot, {
    capturedAt: '2026-08-02T12:00:00.000Z',
    sleepMinutes24h: 435,
    latestHrvMs: 42.3,
    latestHrvAt: '2026-08-02T10:00:00.000Z',
  });
  assert.equal(isHealthReadinessSnapshot(snapshot), true);
  assert.equal(isHealthReadinessSnapshot({ ...snapshot, sleepMinutes24h: Number.NaN }), false);
  assert.equal(isHealthReadinessSnapshot({ ...snapshot, capturedAt: 'not-a-date' }), false);
  assert.equal('score' in snapshot, false);
});

test('HealthKit source is read-only, foreground-only, local-only, and disclosed', () => {
  const appConfig = JSON.parse(readFileSync(new URL('../native-app/app.json', import.meta.url), 'utf8'));
  const healthPlugin = appConfig.expo.plugins.find(item => Array.isArray(item)
    && item[0] === '@kingstinct/react-native-healthkit');
  assert.ok(healthPlugin, 'HealthKit Expo plugin must be configured');
  assert.equal(healthPlugin[1].NSHealthUpdateUsageDescription, false);
  assert.equal(healthPlugin[1].background, false);
  assert.match(healthPlugin[1].NSHealthShareUsageDescription, /stays on this iPhone/i);

  const healthSource = readFileSync(new URL('../native-app/lib/appleHealth.ts', import.meta.url), 'utf8');
  const preDrive = readFileSync(new URL('../native-app/app/pre-drive.tsx', import.meta.url), 'utf8');
  const cloudSync = readFileSync(new URL('../native-app/lib/cloudSync.ts', import.meta.url), 'utf8');

  assert.match(healthSource, /requestAuthorization\(\{\s*toRead:/);
  assert.doesNotMatch(healthSource, /toShare/);
  assert.match(healthSource, /SecureStore\.setItemAsync/);
  assert.match(healthSource, /SecureStore\.deleteItemAsync/);
  assert.match(preDrive, /Informational only/);
  assert.match(preDrive, /do not calculate medical or driving fitness/);
  assert.match(preDrive, /change fatigue scoring, or affect alerts/);
  assert.doesNotMatch(cloudSync, /sleepMinutes24h|latestHrvMs|apple-health/i);
});
