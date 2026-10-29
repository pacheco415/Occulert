export const SIMULATOR_TRACE_BUNDLE_ID = 'com.occulert.app.simulatortrace';
export const SIMULATOR_TRACE_INTERVAL_MS = 100;
export const SIMULATOR_TRACE_PERIOD_MS = 11_000;
export type SimulatorTracePhase = 'open' | 'slow blink' | 'closed for 3 seconds' | 'face lost';

export function isSimulatorTraceConfiguration(platform: unknown, enabled: unknown, bundleId: unknown): boolean {
  return platform === 'ios' && enabled === true && bundleId === SIMULATOR_TRACE_BUNDLE_ID;
}

/** Synthetic probabilities enter the same pseudo-EAR path as ML Kit. */
export function simulatorTraceSample(elapsedMs: number) {
  const at = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) % SIMULATOR_TRACE_PERIOD_MS;
  const phase: SimulatorTracePhase = at >= 7_100 && at < 9_100 ? 'face lost'
    : at >= 4_000 && at < 7_100 ? 'closed for 3 seconds'
    : at >= 2_000 && at < 2_500 ? 'slow blink' : 'open';
  return { phase, faceFound: phase !== 'face lost', eyeProbability: phase === 'face lost' ? -1 : phase === 'open' ? 1 : 0.05 };
}
