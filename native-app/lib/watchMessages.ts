export type WatchMonitoringState = 'open' | 'watch' | 'closed' | 'noFace';

export interface WatchMonitoringPayload {
  running: boolean;
  state: WatchMonitoringState;
  fatigueScore: number;
  perclos: number;
  sessionTime: number;
  at: number;
}

export interface WatchMonitoringMessage {
  type: 'occulert-status';
  running: boolean;
  state: WatchMonitoringState | 'stopped';
  fatigueScore: number;
  perclos: number;
  sessionTime: number;
  at: number;
}

const VALID_STATES = new Set<WatchMonitoringState>([
  'open',
  'watch',
  'closed',
  'noFace',
]);

function finiteNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Build the privacy-safe, latest-state payload shown by the Watch companion.
 * No identifiers, media, location, raw sensor data, or cloud fields are sent.
 */
export function createWatchMonitoringMessage(
  payload: WatchMonitoringPayload,
): WatchMonitoringMessage {
  const running = payload.running === true;
  const state = running
    ? VALID_STATES.has(payload.state) ? payload.state : 'noFace'
    : 'stopped';

  return {
    type: 'occulert-status',
    running,
    state,
    fatigueScore: Math.round(clamp(finiteNumber(payload.fatigueScore), 0, 100)),
    perclos: Math.round(clamp(finiteNumber(payload.perclos), 0, 1) * 1_000) / 1_000,
    sessionTime: Math.floor(clamp(finiteNumber(payload.sessionTime), 0, 86_400)),
    at: Math.floor(Math.max(0, finiteNumber(payload.at))),
  };
}
