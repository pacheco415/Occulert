import AsyncStorage from '@react-native-async-storage/async-storage';

export const WATCH_ALERTS_PREFERENCE_KEY = 'occulert-watch';

let cachedWatchAlertsEnabled: boolean | undefined;
let pendingRead: Promise<boolean> | null = null;

/**
 * Read the Watch-alert preference without crossing the native storage bridge
 * on every monitoring heartbeat. Settings uses forceRefresh when it regains
 * focus, and all writes flow through setWatchAlertsEnabled so the cache stays
 * synchronized during the current app process.
 */
export async function getWatchAlertsEnabled(forceRefresh = false): Promise<boolean> {
  if (!forceRefresh && cachedWatchAlertsEnabled !== undefined) {
    return cachedWatchAlertsEnabled;
  }
  if (!forceRefresh && pendingRead) return pendingRead;

  const read = AsyncStorage.getItem(WATCH_ALERTS_PREFERENCE_KEY)
    .then((value) => {
      cachedWatchAlertsEnabled = value === 'true';
      return cachedWatchAlertsEnabled;
    })
    .catch(() => cachedWatchAlertsEnabled ?? false)
    .finally(() => {
      if (pendingRead === read) pendingRead = null;
    });
  pendingRead = read;
  return read;
}

export async function setWatchAlertsEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(WATCH_ALERTS_PREFERENCE_KEY, String(enabled));
  cachedWatchAlertsEnabled = enabled;
}
