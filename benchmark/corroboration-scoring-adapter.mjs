// Local composition only. A browser trace supplies camera decisions/tracking;
// accessory observations and independent labels must be supplied separately.
import { readFileSync } from 'node:fs';
import { replayScoring } from './replay-scoring.mjs';
import { adaptTrace } from './parked-detection-trace.mjs';
import { replayCorroboration, validateTimeline } from './run-corroboration-replay.mjs';
import { contentSha256, sourceSnapshot } from './provenance.mjs';

export function replayScoringCorroboration(trace, input, options = {}) {
  validateTimeline(input);
  if (input.sessions.length !== 1) throw Error('Scoring adapter requires exactly one matched web session');
  const session = input.sessions[0];
  if (session.platform !== 'web' || session.sessionId !== trace?.session?.sessionId ||
      session.durationMs !== trace.session.durationMs || session.detectorVersion !== trace.session.detectorVersion) {
    throw Error('Scoring trace and timeline session identity, platform, duration and detector must match');
  }
  if (session.alerts.length || session.tracking.length) throw Error('Leave alerts and tracking empty: the scoring adapter derives both from the trace');
  const replay = replayScoring(trace), released = replay.variants.find(row => row.name === 'released');
  if (released?.status !== 'available') throw Error('Released scoring replay unavailable; no camera baseline is fabricated');
  const adapted = adaptTrace(trace, { participant: session.participant, split: session.split,
    episodes: session.episodes.map(({ startMs, endMs, label }) => ({
      session_id: session.sessionId, start_ms: startMs, end_ms: endMs, label,
    })) });
  const composed = { ...input, sessions: [{ ...session,
    tracking: adapted.tracking.map(({ start_ms, end_ms }) => [start_ms, end_ms]),
    // Web trigger() has one generic alert onset, not the native alert ladder.
    alerts: released.alerts.map(({ at_ms }) => ({ atMs: at_ms, level: 'alert' })),
  }] };
  // The timeline's integer clock contract remains strict; fractional offsets
  // are rejected rather than silently rounded or interpolated.
  const report = replayCorroboration(composed, options);
  return { ...report, cameraBaseline: {
    source: 'released-scoring-replay', labelsGenerated: false, trackingConvention: adapted.summary.trackingConvention,
    traceSha256: contentSha256(JSON.stringify(trace)), traceHashEncoding: 'JSON.stringify parsed trace',
    helper: replay.helper, clockFallbacks: released.clockFallbacks,
    scoringCoreSha256: contentSha256(readFileSync(new URL('../src/scoring-core.js', import.meta.url))),
    ...sourceSnapshot(['corroboration-scoring-adapter.mjs', 'run-corroboration-replay.mjs',
      'run-event-benchmark.mjs', 'replay-scoring.mjs', 'scoring-step.mjs', 'parked-detection-trace.mjs']),
  } };
}
