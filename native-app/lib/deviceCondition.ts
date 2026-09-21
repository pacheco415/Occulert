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

export type MultiCamStabilityState =
  | 'notAvailable'
  | 'permissionRequired'
  | 'unsupported'
  | 'configurationFailed'
  | 'overBudget'
  | 'sessionFailed'
  | 'driverStreamFailed'
  | 'driverOnlyFallback'
  | 'passed';

export interface MultiCamStabilityResult {
  state: MultiCamStabilityState;
  elapsedMs: number;
  frontFrames: number;
  roadFrames: number;
  hardwareCost: number | null;
  configuredPressureCost: number | null;
  maxPressureLevel: string;
  thermalState: DeviceThermalState;
  roadStreamStayedEnabled: boolean;
}

interface DeviceConditionNativeModule {
  getCondition(): Promise<DeviceCondition>;
  probeMultiCamConfiguration(): Promise<MultiCamConfigurationProbe>;
  runMultiCamStabilityTest(durationMs: number): Promise<MultiCamStabilityResult>;
}

const UNKNOWN_MULTI_CAM_PROBE: MultiCamConfigurationProbe = {
  state: 'notAvailable',
  hardwareCost: null,
  systemPressureCost: null,
  frontDeviceType: null,
  backDeviceType: null,
};

const UNKNOWN_STABILITY_RESULT: MultiCamStabilityResult = {
  state: 'notAvailable',
  elapsedMs: 0,
  frontFrames: 0,
  roadFrames: 0,
  hardwareCost: null,
  configuredPressureCost: null,
  maxPressureLevel: 'unknown',
  thermalState: 'unknown',
  roadStreamStayedEnabled: false,
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

export async function runMultiCamStabilityTest(
  durationMs = 5_000,
): Promise<MultiCamStabilityResult> {
  if (!nativeModule) return UNKNOWN_STABILITY_RESULT;
  try {
    const result = await nativeModule.runMultiCamStabilityTest(durationMs);
    const validStates: MultiCamStabilityState[] = [
      'permissionRequired', 'unsupported', 'configurationFailed', 'overBudget',
      'sessionFailed', 'driverStreamFailed', 'driverOnlyFallback', 'passed',
    ];
    const validThermalStates: DeviceThermalState[] = [
      'nominal', 'fair', 'serious', 'critical', 'unknown',
    ];
    const finiteNumber = (value: unknown, fallback: number) => (
      typeof value === 'number' && Number.isFinite(value) ? value : fallback
    );
    const nullableNumber = (value: unknown) => (
      typeof value === 'number' && Number.isFinite(value) ? value : null
    );
    return {
      state: validStates.includes(result.state) ? result.state : 'configurationFailed',
      elapsedMs: Math.max(0, finiteNumber(result.elapsedMs, 0)),
      frontFrames: Math.max(0, finiteNumber(result.frontFrames, 0)),
      roadFrames: Math.max(0, finiteNumber(result.roadFrames, 0)),
      hardwareCost: nullableNumber(result.hardwareCost),
      configuredPressureCost: nullableNumber(result.configuredPressureCost),
      maxPressureLevel: typeof result.maxPressureLevel === 'string'
        ? result.maxPressureLevel
        : 'unknown',
      thermalState: validThermalStates.includes(result.thermalState)
        ? result.thermalState
        : 'unknown',
      roadStreamStayedEnabled: result.roadStreamStayedEnabled === true,
    };
  } catch {
    return { ...UNKNOWN_STABILITY_RESULT, state: 'sessionFailed' };
  }
}
