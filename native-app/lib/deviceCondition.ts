import { requireOptionalNativeModule } from 'expo-modules-core';
import type { DeviceThermalState } from './cameraResilience';

export interface DeviceCondition {
  thermalState: DeviceThermalState;
  lowPowerMode: boolean;
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
};

export async function getDeviceCondition(): Promise<DeviceCondition> {
  if (!nativeModule) return UNKNOWN_CONDITION;
  try {
    return await nativeModule.getCondition();
  } catch {
    return UNKNOWN_CONDITION;
  }
}
