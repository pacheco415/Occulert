import { READINESS_MAX_AGE_MS, type DeviceReadinessSnapshot } from './deviceReadiness.ts';

export interface ReadinessViewState {
  snapshot: DeviceReadinessSnapshot | null;
  busy: boolean;
  now: number;
}

// Each focused screen owns one session. Invalidation also allows a fresh read
// immediately, even when a previous native bridge call has not resolved yet.
export function createReadinessSession(
  read: () => Promise<DeviceReadinessSnapshot>,
  publish: (state: ReadinessViewState) => void,
  now: () => number = Date.now,
) {
  let active = true;
  let generation = 0;
  let pending = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  const invalidate = () => {
    generation += 1;
    pending = false;
    clearTimeout(expiry);
    if (active) publish({ snapshot: null, busy: false, now: now() });
  };
  const refresh = async () => {
    if (!active || pending) return;
    pending = true;
    const request = ++generation;
    clearTimeout(expiry);
    publish({ snapshot: null, busy: true, now: now() });
    try {
      const snapshot = await read();
      if (!active || request !== generation) return;
      publish({ snapshot, busy: false, now: now() });
      expiry = setTimeout(() => {
        if (active && request === generation) publish({ snapshot, busy: false, now: now() });
      }, Math.max(0, READINESS_MAX_AGE_MS - (now() - snapshot.checkedAt)));
    } catch {
      if (active && request === generation) {
        publish({ snapshot: null, busy: false, now: now() });
      }
    } finally {
      if (request === generation) pending = false;
    }
  };
  const dispose = () => {
    active = false;
    invalidate();
  };
  return { refresh, invalidate, dispose };
}
