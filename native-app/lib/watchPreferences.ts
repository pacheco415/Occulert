import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCachedBooleanPreference } from './cachedBooleanPreference';

export const WATCH_ALERTS_PREFERENCE_KEY = 'occulert-watch';

const watchAlertsPreference = createCachedBooleanPreference(
  AsyncStorage,
  WATCH_ALERTS_PREFERENCE_KEY,
);

/**
 * Read the Watch-alert preference without crossing the native storage bridge
 * on every monitoring heartbeat. Settings uses forceRefresh when it regains
 * focus, and all writes flow through setWatchAlertsEnabled so the cache stays
 * synchronized during the current app process.
 */
export async function getWatchAlertsEnabled(forceRefresh = false): Promise<boolean> {
  return watchAlertsPreference.get(forceRefresh);
}

export async function setWatchAlertsEnabled(enabled: boolean): Promise<void> {
  await watchAlertsPreference.set(enabled);
}
