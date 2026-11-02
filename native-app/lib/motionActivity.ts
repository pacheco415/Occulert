import { requireOptionalNativeModule } from 'expo-modules-core';
import type { MotionActivityBridge, MotionActivitySample, MotionActivityStatus } from './motionActivityObservation';

export const MOTION_ACTIVITY_OBSERVATION_ENABLED = process.env.EXPO_PUBLIC_MOTION_ACTIVITY_OBSERVATION === '1';

interface MotionActivityNativeModule {
  start(owner: string): Promise<MotionActivityStatus>;
  stop(owner: string): Promise<unknown>;
  addListener(event: 'onActivity', listener: (sample: MotionActivitySample) => void): { remove(): void };
  addListener(event: 'onStatusChange', listener: (status: MotionActivityStatus) => void): { remove(): void };
}

const unavailable = (owner: string, state: 'not-built' | 'error'): MotionActivityStatus => ({
  owner, state, authorization: state === 'not-built' ? 'unavailable' : 'unknown', isAvailable: false, isActive: false,
});
const noListener = () => ({ remove() {} });

/** Native lookup happens only for the explicitly selected development observer. */
export function createMotionActivityBridge(): MotionActivityBridge {
  let native: MotionActivityNativeModule | null = null;
  try { native = requireOptionalNativeModule<MotionActivityNativeModule>('OcculertMotionActivity'); } catch {}
  return {
    async start(owner) {
      if (!native) return unavailable(owner, 'not-built');
      try { return await native.start(owner); } catch { return unavailable(owner, 'error'); }
    },
    async stop(owner) {
      if (!native) return;
      try { await native.stop(owner); } catch { /* Optional teardown must not block camera Stop. */ }
    },
    addActivityListener(listener) {
      if (!native) return noListener();
      try { return native.addListener('onActivity', listener); } catch { return noListener(); }
    },
    addStatusListener(listener) {
      if (!native) return noListener();
      try { return native.addListener('onStatusChange', listener); } catch { return noListener(); }
    },
  };
}
