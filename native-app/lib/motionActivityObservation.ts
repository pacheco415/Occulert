import type { UnansweredAlertMotion } from './unansweredAlertPolicy';

// Conservative evaluation limits, not Apple guarantees or an escalation gate.
export const MOTION_ACTIVITY_EVIDENCE_TTL_MS = 10_000;
export const MOTION_ACTIVITY_BRIDGE_MAX_AGE_MS = 1_000;

export interface MotionActivityStatus {
  owner: string;
  state: 'starting' | 'active' | 'stopped' | 'unavailable' | 'denied' | 'error' | 'not-built';
  authorization: string;
  isAvailable: boolean;
  isActive: boolean;
}

export interface MotionActivitySample {
  owner: string;
  authorization: string;
  confidence: 'low' | 'medium' | 'high' | 'unknown';
  activityStartedAt: number;
  sourceUptimeMs: number;
  receivedUptimeMs: number;
  receivedAt: number;
  automotive: boolean;
  stationary: boolean;
  walking: boolean;
  running: boolean;
  cycling: boolean;
  unknown: boolean;
}

export interface MotionActivityBridge {
  start(owner: string): Promise<MotionActivityStatus>;
  stop(owner: string): Promise<unknown>;
  addActivityListener(listener: (sample: MotionActivitySample) => void): { remove(): void };
  addStatusListener(listener: (status: MotionActivityStatus) => void): { remove(): void };
}
export interface MotionActivityClocks { now(): number; wallNow(): number; }
export interface MotionActivityObservation { begin(): void; stop(): void; category(): UnansweredAlertMotion; }

const FLAGS = ['automotive', 'stationary', 'walking', 'running', 'cycling', 'unknown'] as const;
const STATES = ['starting', 'active', 'stopped', 'unavailable', 'denied', 'error', 'not-built'];
const object = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);
const finiteTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const denied = (authorization: unknown) => authorization === 'denied' || authorization === 'restricted';

/** Classify reported flags only. Freshness and native ownership are separate. */
export function classifyMotionActivitySample(value: unknown): UnansweredAlertMotion {
  if (!object(value)) return 'unknown';
  if (denied(value.authorization)) return 'denied';
  if (value.authorization !== 'authorized' || value.confidence !== 'high'
    || !FLAGS.every(key => typeof value[key] === 'boolean')) return 'unknown';
  const selected = FLAGS.filter(key => value[key] === true);
  if (selected.length !== 1) return 'unknown';
  if (selected[0] === 'automotive') return 'reported-activity';
  if (selected[0] === 'stationary') return 'not-moving';
  return 'unknown';
}

let nextOwnerOrdinal = 0;

/**
 * Foreground observation ownership, with one transient latest category only.
 * No bridge call occurs before explicit begin, or at all while disabled.
 * Old transition times intentionally expire even if Apple emits no new change.
 * Neither an activity category nor confidence establishes movement or speed.
 */
export function createMotionActivityObservation(
  enabled: boolean,
  bridge: MotionActivityBridge,
  clocks: MotionActivityClocks = {
    now: () => typeof performance === 'undefined' ? NaN : performance.now(),
    wallNow: () => Date.now(),
  },
): MotionActivityObservation {
  let owner: string | null = null;
  let subscriptions: { remove(): void }[] = [];
  let terminal: UnansweredAlertMotion = 'unknown';
  let latest: { category: UnansweredAlertMotion; age: number; at: number } | null = null;
  let previousClock: { at: number; wall: number } | null = null;
  let lastSourceAt: number | null = null;
  let lastActivityAt: number | null = null;
  let lastReceiptAt: number | null = null;
  let observedEvent = false;

  const end = (category: UnansweredAlertMotion = 'unknown') => {
    const stoppedOwner = owner, removing = subscriptions;
    owner = null;
    subscriptions = [];
    latest = null;
    terminal = category;
    for (const subscription of removing) {
      try { subscription.remove(); } catch { /* Ownership already invalidated. */ }
    }
    if (stoppedOwner !== null) {
      try { void Promise.resolve(bridge.stop(stoppedOwner)).catch(() => {}); } catch { /* Optional source only. */ }
    }
  };
  const clock = () => {
    try {
      const at = clocks.now(), wall = clocks.wallNow();
      if (!finiteTime(at) || !finiteTime(wall) || (previousClock !== null
        && (at < previousClock.at || wall < previousClock.wall
          || Math.abs((wall - previousClock.wall) - (at - previousClock.at)) > MOTION_ACTIVITY_BRIDGE_MAX_AGE_MS))) return null;
      previousClock = { at, wall };
      return previousClock;
    } catch { return null; }
  };
  const current = (value: unknown, expected: string): value is Record<string, unknown> => owner === expected
    && object(value) && value.owner === expected;
  const clearEvidence = (category: UnansweredAlertMotion = 'unknown') => { latest = null; terminal = category; };

  const status = (value: unknown, expected: string) => {
    if (!current(value, expected)) return;
    if (!clock()) { end(); return; }
    if (!STATES.includes(value.state as string) || typeof value.authorization !== 'string'
      || typeof value.isAvailable !== 'boolean' || typeof value.isActive !== 'boolean') {
      clearEvidence();
      return;
    }
    if (denied(value.authorization) || value.state === 'denied') { end('denied'); return; }
    if (value.state === 'error' || value.state === 'stopped') { end(); return; }
    if (!value.isAvailable || value.state === 'unavailable' || value.state === 'not-built') { end('unavailable'); return; }
    if (value.authorization !== 'authorized') { clearEvidence(); return; }
    if (value.state !== 'active' || !value.isActive) clearEvidence();
    // An active status is not a sample and must not erase or refresh evidence.
  };

  const activity = (value: unknown, expected: string) => {
    if (!current(value, expected)) return;
    const now = clock();
    if (!now) { end(); return; }
    if (denied(value.authorization)) { end('denied'); return; }
    if (value.authorization !== 'authorized' || !FLAGS.every(key => typeof value[key] === 'boolean')
      || !['low', 'medium', 'high', 'unknown'].includes(value.confidence as string)
      || !finiteTime(value.activityStartedAt) || !finiteTime(value.sourceUptimeMs)
      || !finiteTime(value.receivedUptimeMs) || !finiteTime(value.receivedAt)) { clearEvidence(); return; }
    const sourceAt = value.sourceUptimeMs, activityAt = value.activityStartedAt, receiptAt = value.receivedAt;
    if ((lastSourceAt !== null && sourceAt <= lastSourceAt)
      || (lastActivityAt !== null && activityAt < lastActivityAt)
      || (lastReceiptAt !== null && receiptAt < lastReceiptAt)) { clearEvidence(); return; }
    const sourceAge = value.receivedUptimeMs - sourceAt;
    const activityAge = receiptAt - activityAt;
    const bridgeAge = now.wall - receiptAt;
    if (sourceAge < 0 || activityAge < 0 || bridgeAge < 0) { clearEvidence(); return; }
    lastSourceAt = sourceAt;
    lastActivityAt = activityAt;
    lastReceiptAt = receiptAt;
    if (sourceAge > MOTION_ACTIVITY_EVIDENCE_TTL_MS || activityAge > MOTION_ACTIVITY_EVIDENCE_TTL_MS
      || bridgeAge > MOTION_ACTIVITY_BRIDGE_MAX_AGE_MS) { clearEvidence('stale'); return; }
    latest = {
      category: classifyMotionActivitySample(value),
      age: Math.max(sourceAge, activityAge) + bridgeAge,
      at: now.at,
    };
    terminal = 'unknown';
  };

  return {
    begin() {
      if (enabled !== true) return;
      end();
      previousClock = null;
      if (!clock() || nextOwnerOrdinal >= Number.MAX_SAFE_INTEGER) return;
      const startedOwner = `occulert-motion-activity-${++nextOwnerOrdinal}`;
      owner = startedOwner;
      lastSourceAt = lastActivityAt = lastReceiptAt = null;
      observedEvent = false;
      const subscribe = (add: () => { remove(): void }) => {
        const subscription = add();
        if (owner !== startedOwner) {
          try { subscription.remove(); } catch { /* A synchronous callback already ended ownership. */ }
          return false;
        }
        subscriptions.push(subscription);
        return true;
      };
      try {
        if (!subscribe(() => bridge.addActivityListener(value => {
          if (!current(value, startedOwner)) return;
          observedEvent = true;
          try { activity(value, startedOwner); } catch { clearEvidence(); }
        }))) return;
        if (!subscribe(() => bridge.addStatusListener(value => {
          if (!current(value, startedOwner)) return;
          observedEvent = true;
          try { status(value, startedOwner); } catch { clearEvidence(); }
        }))) return;
        void Promise.resolve(bridge.start(startedOwner)).then(value => {
          if (owner !== startedOwner || observedEvent) return;
          try { status(value, startedOwner); } catch { clearEvidence(); }
        }, () => { if (owner === startedOwner) end(); });
      } catch { end(); }
    },
    stop() { if (enabled === true) end(); },
    category() {
      if (enabled !== true || owner === null) return terminal;
      const now = clock();
      if (!now) { end(); return 'unknown'; }
      if (latest === null) return terminal;
      return latest.age + now.at - latest.at > MOTION_ACTIVITY_EVIDENCE_TTL_MS ? 'stale' : latest.category;
    },
  };
}
