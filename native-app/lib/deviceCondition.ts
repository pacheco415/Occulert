import { requireOptionalNativeModule } from 'expo-modules-core';
import type { DeviceThermalState } from './cameraResilience';

export interface DeviceCondition {
  thermalState: DeviceThermalState;
  lowPowerMode: boolean;
  multiCamSupported: boolean | null;
  frontBackMultiCamSupported: boolean | null;
}

export type MultiCamProbeState =
  | 'notAvailable'
  | 'permissionRequired'
  | 'unsupported'
  | 'configurationFailed'
  | 'withinBudget'
  | 'overBudget';

export interface MultiCamConfigurationProbe {
  state: MultiCamProbeState;
  hardwareCost: number | null;
  systemPressureCost: number | null;
  frontDeviceType: string | null;
  backDeviceType: string | null;
}

interface DeviceConditionNativeModule {
  getCondition(): Promise<DeviceCondition>;
  probeMultiCamConfiguration(): Promise<MultiCamConfigurationProbe>;
}

const UNKNOWN_MULTI_CAM_PROBE: MultiCamConfigurationProbe = {
  state: 'notAvailable',
  hardwareCost: null,
  systemPressureCost: null,
  frontDeviceType: null,
  backDeviceType: null,
};

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

export async function probeMultiCamConfiguration(): Promise<MultiCamConfigurationProbe> {
  if (!nativeModule) return UNKNOWN_MULTI_CAM_PROBE;
  try {
    const probe = await nativeModule.probeMultiCamConfiguration();
    const validStates: MultiCamProbeState[] = [
      'permissionRequired', 'unsupported', 'configurationFailed', 'withinBudget', 'overBudget',
    ];
    return {
      state: validStates.includes(probe.state) ? probe.state : 'configurationFailed',
      hardwareCost: typeof probe.hardwareCost === 'number' && Number.isFinite(probe.hardwareCost)
        ? probe.hardwareCost
        : null,
      systemPressureCost: typeof probe.systemPressureCost === 'number' && Number.isFinite(probe.systemPressureCost)
        ? probe.systemPressureCost
        : null,
      frontDeviceType: typeof probe.frontDeviceType === 'string' ? probe.frontDeviceType : null,
      backDeviceType: typeof probe.backDeviceType === 'string' ? probe.backDeviceType : null,
    };
  } catch {
    return { ...UNKNOWN_MULTI_CAM_PROBE, state: 'configurationFailed' };
  }
}
