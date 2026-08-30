import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AUDIO_ALERT_PREFERENCE_KEY,
  HAPTIC_ALERT_PREFERENCE_KEY,
  IN_EAR_ALERT_PREFERENCE_KEY,
  createAlertPreferenceStore,
} from './alertPreferenceStore';

const alertPreferences = createAlertPreferenceStore(AsyncStorage);

export {
  AUDIO_ALERT_PREFERENCE_KEY,
  HAPTIC_ALERT_PREFERENCE_KEY,
  IN_EAR_ALERT_PREFERENCE_KEY,
};
export type { AlertPreferenceSnapshot } from './alertPreferenceStore';

export const alertPreferenceStorage = alertPreferences.storage;

export function loadAlertPreferences(forceRefresh = false) {
  return alertPreferences.get(forceRefresh);
}

export function currentAlertPreferences() {
  return alertPreferences.current();
}
