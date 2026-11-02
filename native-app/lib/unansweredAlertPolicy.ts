export const UNANSWERED_ALERT_VERSION = 1;
// Provisional observation thresholds, not alert or escalation timing.
export const UNANSWERED_ALERT_WAIT_MS = 6_000;
export const UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS = 500;

const MAX_CANDIDATES = 1_000_000;
const MOTION_CATEGORIES = ['unknown', 'unavailable', 'denied', 'stale', 'not-moving', 'reported-activity'] as const;
export type UnansweredAlertMotion = typeof MOTION_CATEGORIES[number];
type MotionCounts = Record<UnansweredAlertMotion, number>;

export interface UnansweredAlertSnapshot {
  version: typeof UNANSWERED_ALERT_VERSION;
  mode: 'observation-only';
  evidence: 'software-output-accepted';
  candidates: number;
  byMotion: MotionCounts;
}

type EyeState = 'open' | 'watch' | 'closed' | 'noFace' | 'tracking';
interface Sample {
  generation: number;
  at: number;
  state: EyeState;
  motion?: UnansweredAlertMotion;
}
interface CriticalOutput {
  generation: number;
  decisionAt: number;
  at: number;
  decisionId: number;
}

export interface UnansweredAlertTracker {
  begin(generation: number): void;
  stop(): void;
  sample(sample: Sample): void;
  criticalOutput(output: CriticalOutput): void;
  snapshot(): UnansweredAlertSnapshot;
}

const emptyMotionCounts = (): MotionCounts => ({
  unknown: 0, unavailable: 0, denied: 0, stale: 0, 'not-moving': 0, 'reported-activity': 0,
});
const positiveOrdinal = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const counter = (value: unknown): value is number => Number.isSafeInteger(value)
  && (value as number) >= 0 && (value as number) <= MAX_CANDIDATES;

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every(key => typeof key === 'string' && expected.includes(key));
}

/** Validate the complete fixed aggregate shape; no event times, IDs or series. */
export function isUnansweredAlertSnapshot(value: unknown): value is UnansweredAlertSnapshot {
  try {
    if (!exactKeys(value, ['version', 'mode', 'evidence', 'candidates', 'byMotion'])
      || value.version !== UNANSWERED_ALERT_VERSION || value.mode !== 'observation-only'
      || value.evidence !== 'software-output-accepted' || !counter(value.candidates)
      || !exactKeys(value.byMotion, MOTION_CATEGORIES)) return false;
    const counts = value.byMotion;
    return MOTION_CATEGORIES.every(key => counter(counts[key]))
      && MOTION_CATEGORIES.reduce((total, key) => total + (counts[key] as number), 0) === value.candidates;
  } catch {
    return false;
  }
}

export function copyUnansweredAlertSnapshot(snapshot: UnansweredAlertSnapshot): UnansweredAlertSnapshot {
  if (!isUnansweredAlertSnapshot(snapshot)) throw new TypeError('Invalid unanswered-alert observation snapshot.');
  return {
    version: UNANSWERED_ALERT_VERSION, mode: 'observation-only', evidence: 'software-output-accepted',
    candidates: snapshot.candidates, byMotion: { ...snapshot.byMotion },
  };
}

/**
 * Pure local observation. The caller supplies monotonic times from one clock,
 * current-session samples and software-accepted critical output, never merely
 * a displayed alert level. This does not establish perception or vehicle motion.
 * Motion labels describe the candidate's final sample and authorize nothing.
 * Gaps/uncertainty disarm pending work; only explicit open or a newer generation
 * clears a counted closed-eye episode. No timer, raw timeline or send exists.
 */
export function createUnansweredAlertTracker(): UnansweredAlertTracker {
  let generation = 0;
  let active = false;
  let lastEventAt: number | null = null;
  let lastClosedAt: number | null = null;
  let closedSegmentStartedAt: number | null = null;
  let armedAt: number | null = null;
  let lastDecisionId = 0;
  let episodeCounted = false;
  let candidates = 0;
  let byMotion = emptyMotionCounts();

  const disarm = () => { armedAt = null; lastClosedAt = null; closedSegmentStartedAt = null; };
  const current = (value: number) => active && value === generation;
  const acceptClock = (at: number) => {
    if (!Number.isFinite(at) || at < 0 || (lastEventAt !== null && at < lastEventAt)) {
      disarm();
      return false;
    }
    lastEventAt = at;
    return true;
  };

  return {
    begin(nextGeneration) {
      if (!positiveOrdinal(nextGeneration) || nextGeneration <= generation) return;
      generation = nextGeneration;
      active = true;
      lastEventAt = null;
      lastDecisionId = 0;
      episodeCounted = false;
      candidates = 0;
      byMotion = emptyMotionCounts();
      disarm();
    },
    stop() {
      active = false;
      disarm();
    },
    sample({ generation: sampleGeneration, at, state, motion = 'unknown' }) {
      if (!current(sampleGeneration) || !acceptClock(at)) return;
      if (state !== 'closed') {
        disarm();
        if (state === 'open') episodeCounted = false;
        return;
      }
      if (lastClosedAt === null || at - lastClosedAt > UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS) {
        armedAt = null;
        closedSegmentStartedAt = at;
      }
      lastClosedAt = at;
      if (armedAt === null || episodeCounted || at - armedAt < UNANSWERED_ALERT_WAIT_MS) return;
      episodeCounted = true;
      armedAt = null;
      if (candidates >= MAX_CANDIDATES) return;
      const category = MOTION_CATEGORIES.includes(motion) ? motion : 'unknown';
      candidates += 1;
      byMotion[category] += 1;
    },
    criticalOutput({ generation: outputGeneration, at, decisionAt, decisionId }) {
      if (!current(outputGeneration) || !positiveOrdinal(decisionId) || decisionId <= lastDecisionId) return;
      // Consume even an ineligible decision: its later channel cannot arm after
      // tracking recovery, an open sample or a clock/gap reset.
      lastDecisionId = decisionId;
      if (!acceptClock(at)) return;
      if (lastClosedAt === null || at - lastClosedAt > UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS
        || !Number.isFinite(decisionAt) || closedSegmentStartedAt === null
        || decisionAt < closedSegmentStartedAt || decisionAt > at) {
        disarm();
        return;
      }
      if (!episodeCounted && armedAt === null) armedAt = at;
    },
    snapshot() {
      return {
        version: UNANSWERED_ALERT_VERSION, mode: 'observation-only', evidence: 'software-output-accepted',
        candidates, byMotion: { ...byMotion },
      };
    },
  };
}
