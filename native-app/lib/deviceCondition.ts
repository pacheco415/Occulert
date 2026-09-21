import { requireOptionalNativeModule } from 'expo-modules-core';
import type { DeviceThermalState } from './cameraResilience';

export interface DeviceCondition {
  thermalState: DeviceThermalState;
  lowPowerMode: boolean;
  multiCamSupported: boolean | null;
  frontBackMultiCamSupported: boolean | null;
}

interface DeviceConditionNativeModule {
  getCondition(): Promise<DeviceCondition>;
}

const nativeModule = requireOptionalNativeModule<DeviceConditionNativeModule>(
  'OcculertDeviceCondition',
);

const UNKNOWN_CONDITION: DeviceCondition = {
  thermalState: 'unknown',
  lowPowerMode: false,
  multiCamSupported: null,
  frontBackMultiCamSupported: null,
};

export async function getDeviceCondition(): Promise<DeviceCondition> {
  if (!nativeModule) return UNKNOWN_CONDITION;
  try {
    const condition = await nativeModule.getCondition();
    return {
      ...condition,
      multiCamSupported: typeof condition.multiCamSupported === 'boolean'
        ? condition.multiCamSupported
        : null,
      frontBackMultiCamSupported: typeof condition.frontBackMultiCamSupported === 'boolean'
        ? condition.frontBackMultiCamSupported
        : null,
    };
  } catch {
    return UNKNOWN_CONDITION;
  }
}
