export const HAPTIC_ALERT_PREFERENCE_KEY = 'occulert-haptic';
export const AUDIO_ALERT_PREFERENCE_KEY = 'occulert-audio';
export const IN_EAR_ALERT_PREFERENCE_KEY = 'occulert-in-ear-alert-pattern';

export type AlertInEarPattern = 'balanced' | 'alternating';

export type AlertPreferenceKey =
  | typeof HAPTIC_ALERT_PREFERENCE_KEY
  | typeof AUDIO_ALERT_PREFERENCE_KEY
  | typeof IN_EAR_ALERT_PREFERENCE_KEY;

export interface AlertPreferenceSnapshot {
  hapticEnabled: boolean;
  audioEnabled: boolean;
  inEarPattern: AlertInEarPattern;
}

export interface AlertPreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface AlertPreferenceStore {
  get(forceRefresh?: boolean): Promise<AlertPreferenceSnapshot>;
  current(): AlertPreferenceSnapshot;
  storage: AlertPreferenceStorage;
}

const DEFAULT_PREFERENCES: AlertPreferenceSnapshot = {
  hapticEnabled: true,
  audioEnabled: true,
  inEarPattern: 'balanced',
};

function parseInEarAlertPattern(value: string | null | undefined): AlertInEarPattern {
  return value === 'alternating' ? 'alternating' : 'balanced';
}

function isPreferenceKey(key: string): key is AlertPreferenceKey {
  return key === HAPTIC_ALERT_PREFERENCE_KEY
    || key === AUDIO_ALERT_PREFERENCE_KEY
    || key === IN_EAR_ALERT_PREFERENCE_KEY;
}

function parseSnapshot(
  haptic: string | null,
  audio: string | null,
  inEarPattern: string | null,
): AlertPreferenceSnapshot {
  return {
    hapticEnabled: haptic == null ? DEFAULT_PREFERENCES.hapticEnabled : haptic === 'true',
    audioEnabled: audio == null ? DEFAULT_PREFERENCES.audioEnabled : audio === 'true',
    inEarPattern: parseInEarAlertPattern(inEarPattern),
  };
}

function serializedPreference(
  snapshot: AlertPreferenceSnapshot,
  key: AlertPreferenceKey,
): string {
  if (key === HAPTIC_ALERT_PREFERENCE_KEY) return String(snapshot.hapticEnabled);
  if (key === AUDIO_ALERT_PREFERENCE_KEY) return String(snapshot.audioEnabled);
  return snapshot.inEarPattern;
}

function withPreference(
  snapshot: AlertPreferenceSnapshot,
  key: AlertPreferenceKey,
  value: string,
): AlertPreferenceSnapshot {
  if (key === HAPTIC_ALERT_PREFERENCE_KEY) {
    return { ...snapshot, hapticEnabled: value === 'true' };
  }
  if (key === AUDIO_ALERT_PREFERENCE_KEY) {
    return { ...snapshot, audioEnabled: value === 'true' };
  }
  return { ...snapshot, inEarPattern: parseInEarAlertPattern(value) };
}

/**
 * Keep alert-output preferences ready in memory before monitoring begins.
 * Persistence remains ordered by the Settings persister; alert delivery only
 * reads the synchronous snapshot and never waits for the native storage bridge.
 */
export function createAlertPreferenceStore(
  backingStorage: AlertPreferenceStorage,
): AlertPreferenceStore {
  let cached: AlertPreferenceSnapshot | undefined;
  let pendingRead: Promise<AlertPreferenceSnapshot> | null = null;
  let mutationVersion = 0;

  const current = (): AlertPreferenceSnapshot => cached ?? DEFAULT_PREFERENCES;

  const get = (forceRefresh = false): Promise<AlertPreferenceSnapshot> => {
    if (!forceRefresh && cached) return Promise.resolve(cached);
    if (!forceRefresh && pendingRead) return pendingRead;

    const readVersion = mutationVersion;
    const read = Promise.all([
      backingStorage.getItem(HAPTIC_ALERT_PREFERENCE_KEY),
      backingStorage.getItem(AUDIO_ALERT_PREFERENCE_KEY),
      backingStorage.getItem(IN_EAR_ALERT_PREFERENCE_KEY),
    ])
      .then(([haptic, audio, inEarPattern]) => {
        if (readVersion !== mutationVersion) return current();
        cached = parseSnapshot(haptic, audio, inEarPattern);
        return cached;
      })
      .catch(() => current())
      .finally(() => {
        if (pendingRead === read) pendingRead = null;
      });
    pendingRead = read;
    return read;
  };

  const storage: AlertPreferenceStorage = {
    async getItem(key) {
      if (!isPreferenceKey(key)) return backingStorage.getItem(key);
      const snapshot = await get(true);
      return serializedPreference(snapshot, key);
    },
    async setItem(key, value) {
      if (!isPreferenceKey(key)) {
        await backingStorage.setItem(key, value);
        return;
      }
      const baseline = await get();
      mutationVersion += 1;
      await backingStorage.setItem(key, value);
      cached = withPreference(cached ?? baseline, key, value);
    },
  };

  return { get, current, storage };
}
