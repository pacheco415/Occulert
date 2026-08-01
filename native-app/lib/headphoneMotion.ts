import {
  NativeModule,
  requireOptionalNativeModule,
  type EventSubscription,
} from 'expo-modules-core';

export type HeadphoneMotionState =
  | 'active'
  | 'starting'
  | 'stopped'
  | 'unavailable'
  | 'denied'
  | 'error'
  | 'not-built';

export interface HeadphoneMotionStatus {
  state: HeadphoneMotionState;
  authorization: string;
  isAvailable: boolean;
  isActive: boolean;
  error?: string;
}

export interface HeadphoneMotionSample {
  timestampMs: number;
  pitchAngle: number;
  yawAngle: number;
  rollAngle: number;
  userAccelerationX: number;
  userAccelerationY: number;
  userAccelerationZ: number;
}

type HeadphoneMotionEvents = {
  onMotionSample(sample: HeadphoneMotionSample): void;
  onStatusChange(status: HeadphoneMotionStatus): void;
};

declare class HeadphoneMotionNativeModule extends NativeModule<HeadphoneMotionEvents> {
  getStatus(): Promise<HeadphoneMotionStatus>;
  start(): Promise<HeadphoneMotionStatus>;
  stop(): Promise<HeadphoneMotionStatus>;
}

const nativeModule = requireOptionalNativeModule<HeadphoneMotionNativeModule>(
  'OcculertHeadphoneMotion',
);

const NOT_BUILT_STATUS: HeadphoneMotionStatus = {
  state: 'not-built',
  authorization: 'unavailable',
  isAvailable: false,
  isActive: false,
};

const noOpSubscription = (): EventSubscription => ({ remove() {} });

export function addHeadphoneMotionSampleListener(
  listener: (sample: HeadphoneMotionSample) => void,
): EventSubscription {
  return nativeModule?.addListener('onMotionSample', listener) ?? noOpSubscription();
}

export function addHeadphoneMotionStatusListener(
  listener: (status: HeadphoneMotionStatus) => void,
): EventSubscription {
  return nativeModule?.addListener('onStatusChange', listener) ?? noOpSubscription();
}

export async function getHeadphoneMotionStatus(): Promise<HeadphoneMotionStatus> {
  if (!nativeModule) return NOT_BUILT_STATUS;
  try {
    return await nativeModule.getStatus();
  } catch (error) {
    return errorStatus(error);
  }
}

export async function startHeadphoneMotion(): Promise<HeadphoneMotionStatus> {
  if (!nativeModule) return NOT_BUILT_STATUS;
  try {
    return await nativeModule.start();
  } catch (error) {
    return errorStatus(error);
  }
}

export async function stopHeadphoneMotion(): Promise<void> {
  if (!nativeModule) return;
  try {
    await nativeModule.stop();
  } catch {
    // Monitoring teardown must continue even if the optional native sensor fails.
  }
}

function errorStatus(error: unknown): HeadphoneMotionStatus {
  return {
    state: 'error',
    authorization: 'unknown',
    isAvailable: false,
    isActive: false,
    error: error instanceof Error ? error.message : 'Headphone motion is unavailable.',
  };
}
