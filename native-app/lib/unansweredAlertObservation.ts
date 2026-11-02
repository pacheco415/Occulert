import type { CriticalOutputAcceptedEvent } from '../components/AlertSystem';
import {
  createUnansweredAlertTracker,
  UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS,
  type UnansweredAlertSnapshot,
} from './unansweredAlertPolicy.ts';

export const UNANSWERED_ALERT_OBSERVATION_ENABLED = process.env.EXPO_PUBLIC_UNANSWERED_ALERT_OBSERVATION === '1';

type EyeState = 'open' | 'watch' | 'closed' | 'noFace' | 'tracking';
interface Clocks { now(): number; wallNow(): number; }
export interface UnansweredEyeSample { generation: number; sampledAt: number; sourceAt: number; state: EyeState; }

export interface UnansweredAlertObservation {
  readonly generation: number;
  begin(): number;
  stop(): void;
  sample(sample: UnansweredEyeSample): void;
  criticalOutput(generation: number, event: CriticalOutputAcceptedEvent): void;
  snapshot(): UnansweredAlertSnapshot | undefined;
}

/**
 * Convert fresh worklet wall timestamps to the receiver's monotonic clock.
 * This adapter collects nothing when disabled and never requests motion data.
 * Phone software acceptance is not proof of perception or vehicle movement.
 */
export function createUnansweredAlertObservation(
  enabled = UNANSWERED_ALERT_OBSERVATION_ENABLED,
  clocks: Clocks = {
    now: () => typeof performance === 'undefined' ? NaN : performance.now(),
    wallNow: () => Date.now(),
  },
): UnansweredAlertObservation {
  const tracker = enabled ? createUnansweredAlertTracker() : null;
  let generation = 0;
  let active = false;
  let hasSession = false;
  let sourceAnchor: { source: number; at: number } | null = null;
  let lastSourceAt: number | null = null;
  const time = () => {
    try {
      const at = clocks.now(), wall = clocks.wallNow();
      return Number.isFinite(at) && at >= 0 && Number.isFinite(wall) && wall >= 0 ? { at, wall } : null;
    } catch { return null; }
  };
  const stop = () => {
    active = false;
    if (tracker && generation < Number.MAX_SAFE_INTEGER) generation += 1;
    tracker?.stop();
  };
  const freshAge = (wall: number, sampledAt: number) => {
    const age = wall - sampledAt;
    return Number.isFinite(sampledAt) && Number.isFinite(age)
      && age >= 0 && age <= UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS ? age : null;
  };
  return {
    get generation() { return generation; },
    begin() {
      if (!tracker || generation >= Number.MAX_SAFE_INTEGER) return 0;
      generation += 1;
      tracker.begin(generation);
      sourceAnchor = null;
      lastSourceAt = null;
      active = time() !== null;
      hasSession = active;
      if (!active) tracker.stop();
      return generation;
    },
    stop,
    sample({ generation: owner, sampledAt, sourceAt, state }) {
      if (!tracker || !active || owner !== generation) return;
      const clock = time();
      if (!clock) { stop(); return; }
      const age = freshAge(clock.wall, sampledAt);
      if (age === null) {
        tracker.sample({ generation, at: clock.at, state: 'tracking' });
        sourceAnchor = null;
        lastSourceAt = null;
        return;
      }
      const at = clock.at - age;
      if (!Number.isFinite(sourceAt) || sourceAt < 0) {
        tracker.sample({ generation, at, state: 'tracking' });
        sourceAnchor = null;
        lastSourceAt = null;
        return;
      }
      const discontinuity = lastSourceAt !== null
        && (sourceAt <= lastSourceAt || sourceAt - lastSourceAt > UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS);
      const drift = sourceAnchor !== null
        && Math.abs((sourceAt - sourceAnchor.source) - (at - sourceAnchor.at)) > UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS;
      if (discontinuity || drift) {
        tracker.sample({ generation, at, state: 'tracking' });
        sourceAnchor = { source: sourceAt, at };
        lastSourceAt = sourceAt;
        return;
      }
      sourceAnchor ??= { source: sourceAt, at };
      lastSourceAt = sourceAt;
      tracker.sample({ generation, at, state, motion: 'unknown' });
    },
    criticalOutput(owner, event) {
      if (!tracker || !active || owner !== generation || !event || event.level !== 'critical') return;
      const clock = time();
      if (!clock) { stop(); return; }
      const age = freshAge(clock.wall, event.acceptedAt);
      const valid = age !== null && Number.isFinite(event.decisionAt)
        && event.decisionAt <= event.acceptedAt
        && (event.channel === 'phone-haptic' || event.channel === 'phone-audio');
      tracker.criticalOutput({ generation, at: valid ? clock.at - age! : NaN,
        decisionAt: valid ? clock.at - (clock.wall - event.decisionAt) : NaN, decisionId: event.decisionId });
      if (!valid) tracker.sample({ generation, at: clock.at, state: 'tracking' });
    },
    snapshot() { return tracker && hasSession ? tracker.snapshot() : undefined; },
  };
}
