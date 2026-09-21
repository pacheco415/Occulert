import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera } from 'react-native-vision-camera';
import { AUDIO_ALERT_PREFERENCE_KEY, HAPTIC_ALERT_PREFERENCE_KEY } from './alertPreferenceStore';
import { WATCH_ALERTS_PREFERENCE_KEY } from './watchPreferences';
import { getWatchStatus } from './watchBridge';
import { getHeadphoneMotionStatus } from './headphoneMotion';
import type { ReadinessSources } from './deviceReadiness';
import { getDeviceCondition, probeMultiCamConfiguration } from './deviceCondition';

// Read persisted choices directly: a failed read must be "not confirmed", not
// the delivery layer's cached/default fallback presented as verified settings.
export const deviceReadinessSources: ReadinessSources = {
  async camera() {
    const devices = Camera.getAvailableCameraDevices();
    const condition = await getDeviceCondition();
    const backDevices = devices.filter(device => device.position === 'back');
    const multiCamProbe = Camera.getCameraPermissionStatus() === 'granted'
      && condition.frontBackMultiCamSupported
      ? await probeMultiCamConfiguration()
      : {
          state: Camera.getCameraPermissionStatus() === 'granted' ? 'notAvailable' : 'permissionRequired',
          hardwareCost: null,
          systemPressureCost: null,
          frontDeviceType: null,
          backDeviceType: null,
        } as const;
    return {
      permission: Camera.getCameraPermissionStatus(),
      frontAvailable: devices.some(device => device.position === 'front'),
      backAvailable: backDevices.length > 0,
      backPhysicalDevices: [...new Set(backDevices.flatMap(device => device.physicalDevices))].sort(),
      multiCamSupported: condition.multiCamSupported,
      frontBackMultiCamSupported: condition.frontBackMultiCamSupported,
      multiCamProbe,
    };
  },
  async outputs() {
    const entries = await AsyncStorage.multiGet([
      AUDIO_ALERT_PREFERENCE_KEY, HAPTIC_ALERT_PREFERENCE_KEY, WATCH_ALERTS_PREFERENCE_KEY,
    ]);
    const values = new Map(entries);
    const enabled = (key: string, fallback: boolean) => {
      const value = values.get(key);
      if (value == null) return fallback;
      if (value !== 'true' && value !== 'false') throw new Error('Invalid alert setting');
      return value === 'true';
    };
    return {
      audio: enabled(AUDIO_ALERT_PREFERENCE_KEY, true),
      haptic: enabled(HAPTIC_ALERT_PREFERENCE_KEY, true),
      watch: enabled(WATCH_ALERTS_PREFERENCE_KEY, false),
    };
  },
  watch: () => getWatchStatus(),
  motion: () => getHeadphoneMotionStatus(),
};
