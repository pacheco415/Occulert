export type FrontCameraKind = 'outer' | 'inner' | 'standard' | 'unknown';

export interface FrontCameraIdentity {
  state: 'available' | 'notAvailable';
  deviceId: string | null;
  deviceType: string | null;
  isVirtual: boolean | null;
  constituentDeviceTypes: string[];
  streamingDeviceType: string | null;
  streamingUniqueId: string | null;
  streamingType: FrontCameraKind;
}

export interface FrontPhysicalCamera {
  uniqueId: string;
  deviceType: string;
  camera: FrontCameraKind;
}

export interface FrontCameraNativeModule {
  getFrontCameraIdentity?(deviceId: string): Promise<unknown>;
  getFrontPhysicalCameras?(): Promise<unknown>;
  startObservingFrontCamera?(deviceId: string, observationId: string): Promise<unknown>;
  stopObservingFrontCamera?(observationId: string): Promise<void>;
  addListener?(event: 'frontCameraChanged', listener: (value: unknown) => void): { remove(): void };
}

export function unknownFrontCameraIdentity(): FrontCameraIdentity {
  return { state: 'notAvailable', deviceId: null, deviceType: null, isVirtual: null,
    constituentDeviceTypes: [], streamingDeviceType: null, streamingUniqueId: null, streamingType: 'unknown' };
}

const validString = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 2048 && !value.includes('\0');
const object = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value);
const cameraKind = (value: unknown): FrontCameraKind => value === 'outer' || value === 'inner' || value === 'standard' ? value : 'unknown';

export function normalizeFrontCameraIdentity(value: unknown, requestedId: string): FrontCameraIdentity {
  if (!validString(requestedId) || !object(value) || value.state !== 'available'
    || value.deviceId !== requestedId || !validString(value.deviceType) || typeof value.isVirtual !== 'boolean'
    || !Array.isArray(value.constituentDeviceTypes) || value.constituentDeviceTypes.length > 32
    || !value.constituentDeviceTypes.every(validString)) return unknownFrontCameraIdentity();
  const streamingKnown = validString(value.streamingDeviceType) && validString(value.streamingUniqueId)
    && (value.isVirtual || value.streamingUniqueId === requestedId);
  return {
    state: 'available', deviceId: requestedId, deviceType: value.deviceType, isVirtual: value.isVirtual,
    constituentDeviceTypes: [...new Set(value.constituentDeviceTypes)].sort(),
    streamingDeviceType: streamingKnown ? value.streamingDeviceType as string : null,
    streamingUniqueId: streamingKnown ? value.streamingUniqueId as string : null,
    streamingType: streamingKnown ? cameraKind(value.streamingType) : 'unknown',
  };
}

export function normalizeFrontPhysicalCameras(value: unknown): FrontPhysicalCamera[] {
  if (!Array.isArray(value) || value.length > 64) return [];
  const cameras = new Map<string, FrontPhysicalCamera>();
  for (const entry of value) {
    if (!object(entry) || !validString(entry.uniqueId) || !validString(entry.deviceType)) continue;
    cameras.set(entry.uniqueId, { uniqueId: entry.uniqueId, deviceType: entry.deviceType, camera: cameraKind(entry.camera) });
  }
  return [...cameras.values()].sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));
}

let observationNumber = 0;
const latestOwner = new WeakMap<FrontCameraNativeModule, string>();

export interface FrontCameraObservation {
  ready: Promise<FrontCameraIdentity>;
  remove(): void;
}

/** One native camera owner; cleanup and late completions cannot affect its successor. */
export function createFrontCameraObservation(
  native: FrontCameraNativeModule | null,
  deviceId: string,
  listener: (identity: FrontCameraIdentity) => void,
): FrontCameraObservation {
  const owner = `front-camera-${Date.now().toString(36)}-${++observationNumber}-${Math.random().toString(36).slice(2)}`;
  let active = true;
  let subscription: { remove(): void } | undefined;
  let latest: FrontCameraIdentity | undefined;
  let sequence = 0;
  if (native) latestOwner.set(native, owner);
  const isCurrent = () => active && (!native || latestOwner.get(native) === owner);
  const stop = () => { if (native?.stopObservingFrontCamera) void Promise.resolve().then(() => native.stopObservingFrontCamera!(owner)).catch(() => {}); };
  const deliver = (identity: FrontCameraIdentity) => {
    if (!isCurrent()) return;
    latest = identity;
    listener(identity);
  };
  let start: Promise<unknown>;
  try {
    if (!native?.addListener || !native.startObservingFrontCamera || !native.stopObservingFrontCamera || !validString(deviceId)) {
      start = Promise.resolve(null);
    } else {
      subscription = native.addListener('frontCameraChanged', payload => {
        if (!isCurrent() || !object(payload) || payload.observationId !== owner || payload.deviceId !== deviceId
          || typeof payload.sequence !== 'number' || !Number.isSafeInteger(payload.sequence) || payload.sequence <= sequence) return;
        sequence = payload.sequence;
        deliver(normalizeFrontCameraIdentity(payload.identity, deviceId));
      });
      start = Promise.resolve(native.startObservingFrontCamera(deviceId, owner));
    }
  } catch { start = Promise.resolve(null); }
  const finish = (value: unknown) => {
    if (!isCurrent()) { stop(); return unknownFrontCameraIdentity(); }
    // A change event may arrive before the start promise; do not roll it back.
    if (!latest) deliver(normalizeFrontCameraIdentity(value, deviceId));
    return latest ?? unknownFrontCameraIdentity();
  };
  return {
    ready: start.then(finish, () => finish(null)),
    remove() {
      if (!active) return;
      active = false;
      if (native && latestOwner.get(native) === owner) latestOwner.delete(native);
      try { subscription?.remove(); } finally { stop(); }
    },
  };
}
