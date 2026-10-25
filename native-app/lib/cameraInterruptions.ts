export type CameraInterruptionReason = 'none' | 'background' | 'audioInUse' | 'videoInUse'
  | 'multitasking' | 'systemPressure' | 'unknown';

export interface CameraInterruptionState {
  state: 'available' | 'notAvailable' | 'queryFailed';
  deviceId: string;
  interrupted: boolean | null;
  reason: CameraInterruptionReason;
  rawReason: number | null;
  sequence: number;
}

export interface CameraInterruptionNativeModule {
  getCameraInterruptionState?(deviceId: string): Promise<unknown>;
  isMultitaskingCameraAccessSupported?(): Promise<unknown>;
  addListener?(event: 'cameraInterrupted', listener: (value: unknown) => void): { remove(): void };
}

export const MULTITASKING_CAMERA_MESSAGE = 'Camera paused because another app is sharing the screen. Make Occulert full screen, then restart when parked.';
export const CAMERA_INTERRUPTION_QUERY_TIMEOUT_MS = 500;

export function unknownCameraInterruption(deviceId: string): CameraInterruptionState {
  return { state: 'notAvailable', deviceId, interrupted: null, reason: 'unknown', rawReason: null, sequence: 0 };
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !value.includes('\0');
const reasons: Record<number, CameraInterruptionReason> = { 1: 'background', 2: 'audioInUse', 3: 'videoInUse', 4: 'multitasking', 5: 'systemPressure' };

/** Derive the reason from Apple's numeric enum; never trust a mismatched label. */
export function normalizeCameraInterruption(value: unknown, deviceId: string, event = false): CameraInterruptionState {
  if (!validId(deviceId) || !object(value) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) return unknownCameraInterruption(deviceId);
  if (event ? !Array.isArray(value.deviceIds) || value.deviceIds.length > 32 || !value.deviceIds.every(validId) || !value.deviceIds.includes(deviceId)
    : value.state !== 'available' || value.deviceId !== deviceId) return unknownCameraInterruption(deviceId);
  if (typeof value.interrupted !== 'boolean') return unknownCameraInterruption(deviceId);
  const rawReason = value.interrupted && Number.isSafeInteger(value.rawReason) && (value.rawReason as number) > 0 ? value.rawReason as number : null;
  return { state: 'available', deviceId, interrupted: value.interrupted,
    reason: value.interrupted ? reasons[rawReason ?? 0] ?? 'unknown' : 'none',
    rawReason, sequence: value.sequence as number };
}

export async function readCameraInterruption(native: CameraInterruptionNativeModule | null, deviceId: string): Promise<CameraInterruptionState> {
  if (!validId(deviceId) || !native?.getCameraInterruptionState) return unknownCameraInterruption(deviceId);
  const failed = (): CameraInterruptionState => ({ ...unknownCameraInterruption(deviceId), state: 'queryFailed' });
  const expired = Symbol('interruption-query-timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      native.getCameraInterruptionState(deviceId),
      new Promise(resolve => { timer = setTimeout(() => resolve(expired), CAMERA_INTERRUPTION_QUERY_TIMEOUT_MS); }),
    ]);
    if (value === expired) return failed();
    const state = normalizeCameraInterruption(value, deviceId);
    if (state.state === 'available') return state;
    // A functioning observer may not yet have seen a live session; this is
    // distinct from an invalid, rejected or stalled transport response.
    return object(value) && value.state === 'notAvailable' && value.deviceId === deviceId
      && value.interrupted === null ? state : failed();
  }
  catch { return failed(); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export interface CameraInterruptionObservation {
  ready: Promise<CameraInterruptionState>;
  remove(): void;
}

/** Listener first, then snapshot: a delayed initial read cannot undo a newer event. */
export function createCameraInterruptionObservation(
  native: CameraInterruptionNativeModule | null,
  deviceId: string,
  listener: (state: CameraInterruptionState) => void,
): CameraInterruptionObservation {
  let active = true;
  let latest: CameraInterruptionState | undefined;
  let subscription: { remove(): void } | undefined;
  const deliver = (state: CameraInterruptionState) => {
    if (!active || (latest && (state.state !== 'available' || state.sequence <= latest.sequence))) return;
    latest = state;
    listener(state);
  };
  try {
    if (validId(deviceId)) subscription = native?.addListener?.('cameraInterrupted', payload => {
      const state = normalizeCameraInterruption(payload, deviceId, true);
      if (state.state === 'available') deliver(state);
    });
  } catch { /* A missing optional native module remains explicitly unknown. */ }
  const ready = readCameraInterruption(native, deviceId).then(state => {
    deliver(state);
    return active ? latest ?? state : unknownCameraInterruption(deviceId);
  });
  return { ready, remove() { if (!active) return; active = false; subscription?.remove(); } };
}
