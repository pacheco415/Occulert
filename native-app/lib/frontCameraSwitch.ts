import type { FrontCameraIdentity, FrontCameraKind } from './deviceCondition';

export const INNER_CAMERA_SETUP_MESSAGE = 'Fold your iPhone Duo to drive. The outer camera sees your eyes better, especially at night.';
export const INNER_CAMERA_MONITOR_MESSAGE = 'Inner camera - lower confidence';

export interface FrontCameraSwitchState {
  lastKnownId: string | null;
  selectedDeviceId: string | null;
}

export function initialFrontCameraSwitchState(): FrontCameraSwitchState {
  return { lastKnownId: null, selectedDeviceId: null };
}

/** A temporary unknown constituent is not evidence that the physical camera switched. */
export function frontCameraTransition(
  previous: FrontCameraSwitchState,
  identity: FrontCameraIdentity,
  running: boolean,
) {
  const knownId = identity.state === 'available' ? identity.streamingUniqueId : null;
  const switched = knownId !== null && previous.lastKnownId !== null
    && knownId !== previous.lastKnownId;
  // Legacy device-wide saved baselines have no physical-camera identity.
  // On a Duo/virtual camera, first identification must discard that unbound value.
  const firstDuo = previous.lastKnownId === null && knownId !== null
    && (identity.isVirtual === true || identity.streamingType === 'inner' || identity.streamingType === 'outer');
  return {
    state: {
      lastKnownId: knownId ?? previous.lastKnownId,
      selectedDeviceId: identity.deviceId ?? previous.selectedDeviceId,
    },
    switched,
    resetParkedSetup: !running && (switched || firstDuo),
    clearEyeBaseline: switched || firstDuo,
    playNotice: running && switched,
  };
}

export interface FrontCameraDiagnostics {
  switches: number;
  baselineClears: number;
  lastSwitchAt: number;
  timeMs: Record<FrontCameraKind, number>;
  physicalCameraTimeMs: Record<string, number>;
  switchesToCamera: Record<string, number>;
}

/** Local, bounded numeric diagnostics also satisfy interrupted-session recovery validation. */
export function createFrontCameraDiagnostics() {
  const times = new Map<string, number>();
  const switchesTo = new Map<string, number>();
  let timeMs = { outer: 0, inner: 0, standard: 0, unknown: 0 };
  let activeKind: FrontCameraKind = 'unknown';
  let activeId: string | null = null;
  let lastKnownId: string | null = null;
  let lastAt = 0;
  let started = false;
  let recorded = false;
  let switches = 0;
  let baselineClears = 0;
  let lastSwitchAt = 0;
  const boundedId = (id: string | null) => {
    if (!id) return null;
    if (!times.has(id) && times.size < 16) times.set(id, 0);
    return times.has(id) ? id : null;
  };
  const addElapsed = (at: number) => {
    if (!started || !Number.isFinite(at) || at < lastAt) return false;
    const elapsed = at - lastAt;
    timeMs[activeKind] += elapsed;
    if (activeId) times.set(activeId, (times.get(activeId) ?? 0) + elapsed);
    lastAt = at;
    return true;
  };
  return {
    reset(at = 0) {
      times.clear(); switchesTo.clear();
      timeMs = { outer: 0, inner: 0, standard: 0, unknown: 0 };
      activeKind = 'unknown'; activeId = null; lastKnownId = null;
      lastAt = Number.isFinite(at) && at >= 0 ? at : 0;
      started = at > 0; recorded = false; switches = 0; baselineClears = 0; lastSwitchAt = 0;
    },
    record(identity: FrontCameraIdentity, at: number, baselineCleared = false) {
      if (!addElapsed(at)) return;
      recorded = true;
      const id = identity.state === 'available' ? identity.streamingUniqueId : null;
      if (id && lastKnownId && id !== lastKnownId) {
        switches += 1; lastSwitchAt = at;
        const key = boundedId(id);
        if (key) switchesTo.set(key, (switchesTo.get(key) ?? 0) + 1);
      }
      if (id) lastKnownId = id;
      if (baselineCleared) baselineClears += 1;
      activeKind = id ? identity.streamingType : 'unknown';
      activeId = boundedId(id);
    },
    snapshot(at: number): FrontCameraDiagnostics | null {
      if (!recorded) return null;
      const extra = started && Number.isFinite(at) ? Math.max(0, at - lastAt) : 0;
      const physicalCameraTimeMs = Object.fromEntries(times);
      if (activeId) physicalCameraTimeMs[activeId] += extra;
      return {
        switches, baselineClears, lastSwitchAt,
        timeMs: { ...timeMs, [activeKind]: timeMs[activeKind] + extra },
        physicalCameraTimeMs,
        switchesToCamera: Object.fromEntries(switchesTo),
      };
    },
  };
}
