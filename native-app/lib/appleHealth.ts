import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createAsyncMutationQueue } from './asyncMutationQueue';
import {
  createHealthReadinessSnapshot,
  isHealthReadinessSnapshot,
  type HealthReadinessSnapshot,
} from './healthReadiness';

const HEALTH_READINESS_KEY = 'occulert.apple-health.readiness.v1';
const SLEEP_TYPE = 'HKCategoryTypeIdentifierSleepAnalysis';
const HRV_TYPE = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'com.occulert.app.apple-health',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let summaryRevision = 0;
const summaryStorageQueue = createAsyncMutationQueue();

export type AppleHealthRefreshResult = {
  status: 'updated' | 'no_data';
  snapshot: HealthReadinessSnapshot;
};

export async function loadStoredHealthReadiness(): Promise<HealthReadinessSnapshot | null> {
  const readRevision = summaryRevision;
  try {
    const raw = await SecureStore.getItemAsync(HEALTH_READINESS_KEY, SECURE_OPTIONS);
    if (readRevision !== summaryRevision) return null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isHealthReadinessSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearStoredHealthReadiness(): Promise<void> {
  summaryRevision += 1;
  await summaryStorageQueue.run(() => SecureStore.deleteItemAsync(HEALTH_READINESS_KEY, SECURE_OPTIONS));
}

export async function isAppleHealthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const healthKit = await import('@kingstinct/react-native-healthkit');
    return healthKit.isHealthDataAvailable();
  } catch {
    return false;
  }
}

export async function refreshAppleHealthReadiness(
  capturedAt = new Date(),
): Promise<AppleHealthRefreshResult> {
  const refreshRevision = ++summaryRevision;
  if (Platform.OS !== 'ios') {
    throw new Error('Apple Health is available on iPhone only.');
  }

  const healthKit = await import('@kingstinct/react-native-healthkit');
  if (!healthKit.isHealthDataAvailable()) {
    throw new Error('Apple Health is unavailable on this device or build.');
  }

  const requestCompleted = await healthKit.requestAuthorization({
    toRead: [SLEEP_TYPE, HRV_TYPE],
  });
  if (!requestCompleted) {
    throw new Error('Apple Health access could not be requested.');
  }

  const sleepStart = new Date(capturedAt.getTime() - 24 * 60 * 60 * 1_000);
  const hrvStart = new Date(capturedAt.getTime() - 7 * 24 * 60 * 60 * 1_000);
  const [sleepSamples, hrvSamples] = await Promise.all([
    healthKit.queryCategorySamples(SLEEP_TYPE, {
      limit: 0,
      ascending: true,
      filter: { date: { startDate: sleepStart, endDate: capturedAt } },
    }),
    healthKit.queryQuantitySamples(HRV_TYPE, {
      limit: 1,
      ascending: false,
      unit: 'ms',
      filter: { date: { startDate: hrvStart, endDate: capturedAt } },
    }),
  ]);

  const snapshot = createHealthReadinessSnapshot({
    capturedAt,
    sleepSamples,
    latestHrvSample: hrvSamples[0] ?? null,
  });

  await summaryStorageQueue.run(async () => {
    if (refreshRevision !== summaryRevision) throw new Error('Apple Health refresh was superseded.');
    await SecureStore.setItemAsync(HEALTH_READINESS_KEY, JSON.stringify(snapshot), SECURE_OPTIONS);
    if (refreshRevision !== summaryRevision) throw new Error('Apple Health refresh was superseded.');
  });

  return {
    status: snapshot.sleepMinutes24h === null && snapshot.latestHrvMs === null
      ? 'no_data'
      : 'updated',
    snapshot,
  };
}
