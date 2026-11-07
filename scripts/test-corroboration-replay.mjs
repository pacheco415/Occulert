import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ACCESSORY_SOURCES,
  DEFAULT_POLICY,
  OBSERVATION_KINDS,
  accessoryKey,
  corroborateSession,
  replayCorroboration,
  resolvePolicy,
  validateTimeline,
} from '../benchmark/run-corroboration-replay.mjs';
import { scoreEvents } from '../benchmark/run-event-benchmark.mjs';
import { replayScoringCorroboration } from '../benchmark/corroboration-scoring-adapter.mjs';
import { replayScoring } from '../benchmark/replay-scoring.mjs';
import { recordScoringFixture } from './lib/scoring-replay-fixture.mjs';
import { syntheticScoringTrace } from '../benchmark/released-scoring-oracle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = join(root, 'benchmark/run-corroboration-replay.mjs');
const fixturePath = join(root, 'benchmark/fixtures/corroboration-synthetic.json');
const fixture = () => JSON.parse(readFileSync(fixturePath, 'utf8'));

// Independent hand-written sessions; no fixture values are reused below.
function session(overrides = {}) {
  return {
    sessionId: 's1', participant: 'p1', split: 'test', platform: 'ios', detectorVersion: 'd1',
    collection: 'parked', consentVersion: 'synthetic', durationMs: 100_000,
    tracking: [[0, 100_000]], accessories: { headphone: [[0, 100_000]] },
    observations: [], alerts: [], episodes: [],
    ...overrides,
  };
}
const timeline = (sessions, overrides = {}) => ({
  schema: 'occulert.corroboration-timeline', version: 1, kind: 'synthetic-fixture',
  dataset: { id: 'unit', version: '1', labelSource: 'synthetic' }, sessions, ...overrides,
});
const cam = (atMs, kind = 'elevated') => ({ atMs, source: 'camera', kind });
const nod = atMs => ({ atMs, source: 'headphone', kind: 'head_nod' });
const lane = atMs => ({ atMs, source: 'road', kind: 'lane_departure' });
const cueTimes = (s, policy) => corroborateSession(s, resolvePolicy(policy)).added.map(cue => cue.atMs);

test('defaults mirror the native coincidence window and released alert cooldown', () => {
  const fusion = readFileSync(join(root, 'native-app/lib/sensorFusionObservation.ts'), 'utf8');
  const thresholds = readFileSync(join(root, 'native-app/constants/thresholds.ts'), 'utf8');
  const constant = (text, name) => Number(text.match(new RegExp(`export const ${name} = ([0-9_]+);`))[1].replaceAll('_', ''));
  assert.equal(DEFAULT_POLICY.windowMs, constant(fusion, 'SENSOR_FUSION_COINCIDENCE_WINDOW_MS'));
  assert.equal(DEFAULT_POLICY.refractoryMs, constant(thresholds, 'ALERT_COOLDOWN_MS'));
  assert.equal(DEFAULT_POLICY.minSources, 1, 'camera plus one independent source is the two-sensor gate');
  assert.deepEqual(OBSERVATION_KINDS.watch, [], 'no Watch candidate exists until a reviewed definition is added');
});

test('checked-in synthetic fixture reproduces hand-computed test-split results', () => {
  const report = replayCorroboration(fixture(), { split: 'test' });
  const before = report.overall.cameraOnly.overall, after = report.overall.corroborated.overall;
  assert.equal(report.kind, 'synthetic-fixture');
  assert.equal(report.policy.continuity, 'same-usable-interval-through-cue');
  assert.equal(report.overall.sessions, 3);
  assert.equal(before.trackedHours, 0.3);
  assert.deepEqual([before.fullyTrackedEpisodes, before.insufficientTrackingEpisodes, before.detectedEpisodes, before.falseAlerts], [3, 1, 2, 2]);
  assert.deepEqual([before.medianAlertDelayMs, before.p95AlertDelayMs], [20_000, 29_000]);
  assert.deepEqual([after.detectedEpisodes, after.missedFullyTrackedEpisodes, after.falseAlerts], [3, 0, 3]);
  assert.deepEqual([after.medianAlertDelayMs, after.p95AlertDelayMs], [9_000, 11_700]);
  assert.deepEqual(report.overall.delta, {
    corroborationPairs: 5, addedCues: 4, droppedByRefractory: 1, addedCuesOutsideEpisodes: 1,
    newlyDetectedEpisodes: 1, earlierEpisodes: 2, medianEarlierByMs: 11_500,
  });
  assert.deepEqual(Object.keys(report.byAccessories), ['camera+headphone', 'camera+headphone+road', 'camera+watch']);
  assert.deepEqual(report.byAccessories['camera+watch'].delta.addedCues, 0, 'Watch coverage alone never corroborates');
  assert.equal(report.coverage.headphone.fullyCoveredEpisodes, 3);
  assert.equal(report.coverage.headphone.candidatesDuringCoverage, 4, 'a nod after headphone coverage ends is excluded');
  assert.ok(Math.abs(report.coverage.headphone.fractionOfTrackedTime - 750 / 1080) < 1e-12);
  assert.ok(Math.abs(report.coverage.watch.fractionOfTrackedTime - 180 / 1080) < 1e-12);
  assert.deepEqual(report.task43StartCondition, { evaluable: false, reason: 'Synthetic fixture: no accuracy evidence.', perDetector: null });
  assert.equal(replayCorroboration(fixture(), { split: 'train' }).overall.sessions, 1);
  assert.equal(replayCorroboration(fixture()).overall.sessions, 4);
});

test('coincidence window is inclusive, two-sided and fires when the later signal arrives', () => {
  assert.deepEqual(cueTimes(session({ observations: [cam(10_000), nod(15_000)] })), [15_000]);
  assert.deepEqual(cueTimes(session({ observations: [cam(10_000), nod(15_001)] })), []);
  assert.deepEqual(cueTimes(session({ observations: [nod(5_000), cam(10_000)] })), [10_000]);
  assert.deepEqual(cueTimes(session({ observations: [nod(4_999), cam(10_000)] })), []);
  assert.deepEqual(cueTimes(session({ observations: [cam(10_000), nod(12_000)] }), { windowMs: 1_000 }), []);
});

test('only usable signals corroborate, and the camera cannot corroborate itself', () => {
  const coverageEnds = session({ accessories: { headphone: [[0, 12_000]] }, observations: [cam(10_000), nod(12_000)] });
  assert.deepEqual(cueTimes(coverageEnds), [], 'coverage end is exclusive');
  const cameraLost = session({ tracking: [[0, 9_000], [11_000, 100_000]], observations: [cam(10_000), nod(10_500)] });
  assert.deepEqual(cueTimes(cameraLost), [], 'a camera candidate outside usable tracking is ignored');
  assert.deepEqual(cueTimes(session({ observations: [cam(10_000), cam(10_500, 'head_nod')] })), []);
  assert.deepEqual(cueTimes(session({ accessories: {}, observations: [cam(10_000), nod(10_500)] })), [], 'no declared coverage means no usable accessory');
});

test('minSources requires distinct independent sources and each candidate is used once', () => {
  const two = session({ accessories: { headphone: [[0, 100_000]], road: [[0, 100_000]] },
    observations: [cam(10_000), nod(11_000), nod(12_000), lane(13_000)] });
  assert.deepEqual(cueTimes(two, { minSources: 2 }), [13_000]);
  assert.deepEqual(cueTimes(session({ observations: [cam(10_000), nod(11_000), nod(12_000)] }), { minSources: 2 }), []);
  const reuse = session({ observations: [cam(10_000), cam(30_000), nod(32_000)] });
  assert.deepEqual(cueTimes(reuse), [32_000]);
  const once = corroborateSession(session({ observations: [cam(10_000), cam(11_000), nod(12_000)] }), resolvePolicy({ refractoryMs: 0 }));
  assert.deepEqual([once.pairs, once.added.length], [1, 1], 'one nod cannot corroborate two camera candidates');
});

test('replay cues cannot bridge tracking loss or accessory disconnection', () => {
  assert.deepEqual(cueTimes(session({ tracking: [[0, 11_000], [20_000, 100_000]],
    observations: [cam(10_000), nod(12_000)] })), [], 'camera tracking ends before the cue');
  assert.deepEqual(cueTimes(session({ tracking: [[0, 11_000], [12_000, 100_000]],
    observations: [cam(10_000), nod(13_000)] })), [], 'recovery does not revive a pre-gap camera candidate');
  assert.deepEqual(cueTimes(session({ accessories: { headphone: [[0, 9_000], [10_000, 100_000]] },
    observations: [nod(8_000), cam(11_000)] })), [], 'reconnection does not revive a pre-gap accessory candidate');
  assert.deepEqual(cueTimes(session({ tracking: [[0, 12_000]],
    observations: [cam(10_000), nod(12_000)] })), [], 'tracking end is exclusive at cue time');
  assert.deepEqual(cueTimes(session({ tracking: [[0, 11_000], [11_001, 100_000]],
    observations: [cam(10_000), nod(12_000)] })), [], 'even a one-millisecond unknown gap breaks continuity');
  assert.deepEqual(cueTimes(session({ accessories: { headphone: [[0, 10_000]] },
    observations: [nod(8_000), cam(10_000)] })), [], 'accessory coverage end is exclusive at cue time');
});

test('replay finds fresh evidence after reconnect and requires every source through the final cue', () => {
  const s = session({ accessories: { headphone: [[0, 9_000], [11_000, 100_000]], road: [[0, 100_000]] },
    observations: [nod(8_000), cam(10_000), lane(12_000), nod(13_000)],
    alerts: [{ atMs: 11_000, level: 'critical' }] });
  const result = corroborateSession(s, resolvePolicy({ minSources: 2, refractoryMs: 0 }));
  assert.deepEqual(result.added.map(cue => cue.atMs), [13_000], 'wait for fresh headphone evidence instead of pairing across its gap');
  assert.deepEqual(result.cameraAlerts, [11_000], 'original camera alerts are preserved during sensor gaps');
  assert.deepEqual(cueTimes(session({ accessories: { headphone: [[0, 12_000], [12_500, 100_000]], road: [[0, 100_000]] },
    observations: [cam(10_000), nod(11_000), lane(13_000), nod(13_500)] }), { minSources: 2, refractoryMs: 0 }),
  [13_500], 'a held source expires while awaiting a second source, then fresh evidence replaces it');
  assert.deepEqual(cueTimes(session({ accessories: { headphone: [[11_000, 100_000]] },
    observations: [cam(10_000), nod(12_000)] })), [12_000], 'an accessory may connect after the camera observation');
  assert.deepEqual(cueTimes(session({ tracking: [[0, 11_000], [11_000, 100_000]],
    observations: [cam(10_000), nod(12_000)] })), [12_000], 'adjacent intervals represent continuous coverage');
  assert.deepEqual(cueTimes(session({ tracking: [[0, 10_000], [12_000, 100_000]],
    observations: [cam(9_000), nod(12_500), cam(14_000)] })), [14_000], 'failed continuity never consumes the nod needed by a later camera candidate');
});

test('refractory drops redundant cues but never removes or moves a camera alert', () => {
  const s = session({ alerts: [{ atMs: 10_000, level: 'alert' }], observations: [cam(17_000), nod(17_999), cam(30_000), nod(30_000)] });
  const result = corroborateSession(s, resolvePolicy());
  assert.deepEqual(result.added.map(cue => cue.atMs), [30_000]);
  assert.equal(result.dropped, 1, 'a cue 7999 ms after a camera alert is inside the 8000 ms cooldown');
  assert.deepEqual(cueTimes(session({ alerts: [{ atMs: 10_000, level: 'alert' }], observations: [cam(18_000), nod(18_000)] })), [18_000]);
  assert.deepEqual(result.cameraAlerts, [10_000]);
  const sameInstant = session({ alerts: [{ atMs: 10_000, level: 'alert' }], observations: [cam(10_000), nod(10_000), cam(20_000), nod(20_000), cam(20_001), nod(20_001)] });
  assert.deepEqual(cueTimes(sameInstant, { refractoryMs: 0 }), [20_000, 20_001], 'with no cooldown, a cue on an existing alert instant is still not a second alert');
});

test('randomized timelines: corroboration is add-only and agrees with the event scorer', () => {
  let seed = 0x5eed;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  const pick = list => list[Math.floor(random() * list.length)];
  let totalAdded = 0, totalNewlyDetected = 0, totalDropped = 0;
  for (let round = 0; round < 200; round += 1) {
    const durationMs = 60_000 + Math.floor(random() * 120_000);
    const at = () => Math.floor(random() * durationMs);
    const gap = 1_000 + Math.floor(random() * (durationMs - 10_000));
    const tracking = random() < 0.5 ? [[0, durationMs]] : [[0, gap], [gap + 5_000, durationMs]];
    const episodes = [];
    for (let start = 0; start + 10_000 < durationMs; start += 40_000) {
      if (random() < 0.6) episodes.push({ startMs: start, endMs: Math.min(durationMs, start + 10_000 + Math.floor(random() * 20_000)), label: 'drowsy' });
    }
    const accessories = Object.fromEntries(ACCESSORY_SOURCES.filter(() => random() < 0.6).map(source => [source, [[Math.floor(random() * 10_000), durationMs]]]));
    const observations = Array.from({ length: Math.floor(random() * 30) }, () => {
      const source = pick(['camera', 'camera', 'headphone', 'road']);
      return { atMs: at(), source, kind: pick(OBSERVATION_KINDS[source]) };
    });
    const alerts = Array.from({ length: Math.floor(random() * 6) }, () => ({ atMs: at(), level: pick(['watch', 'alert', 'critical']) }));
    const s = session({ sessionId: `r${round}`, participant: `rp${round}`, durationMs, tracking, accessories, observations, alerts, episodes });
    const report = replayCorroboration(timeline([s]), { policy: { minSources: 1 + Math.floor(random() * 2), refractoryMs: pick([0, 8_000]) } });
    const before = report.overall.cameraOnly.overall, after = report.overall.corroborated.overall;
    assert.equal(report.cameraAlertsPreserved, true);
    for (const cue of corroborateSession(s, report.policy).added) {
      assert.ok(s.observations.some(camera => camera.source === 'camera' && camera.atMs <= cue.atMs
        && tracking.some(([start, end]) => start <= camera.atMs && cue.atMs < end)
        && cue.sources.every(source => s.observations.some(candidate => candidate.source === source
          && candidate.atMs <= cue.atMs && Math.abs(candidate.atMs - camera.atMs) <= report.policy.windowMs
          && accessories[source].some(([start, end]) => start <= candidate.atMs && cue.atMs < end)))),
      'every generated cue has a continuously usable camera and independent sources through its fire time');
    }
    totalAdded += report.overall.delta.addedCues;
    totalNewlyDetected += report.overall.delta.newlyDetectedEpisodes;
    totalDropped += report.overall.delta.droppedByRefractory;
    assert.ok(after.alerts >= before.alerts && after.detectedEpisodes >= before.detectedEpisodes && after.falseAlerts >= before.falseAlerts);
    assert.equal(after.detectedEpisodes - before.detectedEpisodes, report.overall.delta.newlyDetectedEpisodes);
    assert.equal(after.alerts - before.alerts, report.overall.delta.addedCues);
    if (before.medianAlertDelayMs !== null && after.medianAlertDelayMs !== null && after.detectedEpisodes === before.detectedEpisodes) {
      assert.ok(after.medianAlertDelayMs <= before.medianAlertDelayMs);
    }
    const tracked = scoreEvents({
      sessions: [{ session_id: s.sessionId, participant: s.participant, platform: s.platform, detector_version: s.detectorVersion, duration_ms: durationMs, split: 'test' }],
      tracking: tracking.map(([start_ms, end_ms]) => ({ session_id: s.sessionId, start_ms, end_ms })),
      episodes: episodes.map(e => ({ session_id: s.sessionId, start_ms: e.startMs, end_ms: e.endMs, label: e.label })),
      alerts: alerts.map(a => ({ session_id: s.sessionId, at_ms: a.atMs })),
    });
    assert.deepEqual(before, tracked, 'camera-only scoring is the unmodified event scorer');
  }
  assert.ok(totalAdded > 0 && totalNewlyDetected > 0 && totalDropped > 0, `generator exercised the policy (${totalAdded} added, ${totalNewlyDetected} newly detected, ${totalDropped} dropped)`);
});

test('separate detectors and platforms are never pooled', () => {
  const report = replayCorroboration(timeline([session(), session({ sessionId: 's2', participant: 'p2', detectorVersion: 'd2' })]));
  assert.equal(report.overall.cameraOnly.overall, null);
  assert.deepEqual(Object.keys(report.overall.corroborated.detectors), ['ios / d1', 'ios / d2']);
  assert.equal(accessoryKey(session({ accessories: { road: [[0, 1]], headphone: [] } })), 'camera+road');
});

test('Task 4.3 start condition is reported only for held-out independently labeled exports', () => {
  const labeled = sessions => timeline(sessions, { kind: 'labeled-export', dataset: { id: 'pilot', version: '1', labelSource: 'independent-annotation' } });
  const helped = session({ consentVersion: 'pilot-consent-1', episodes: [{ startMs: 10_000, endMs: 20_000, label: 'drowsy' }], observations: [cam(12_000), nod(13_000)] });
  const condition = replayCorroboration(labeled([helped]), { split: 'test' }).task43StartCondition;
  assert.equal(condition.evaluable, true);
  assert.deepEqual(condition.perDetector['ios / d1'], { fullyTrackedEpisodes: 1, fewerMissed: true, earlierMedian: false, noMoreFalseAlerts: true, meetsNecessaryCondition: true });
  const noisy = { ...helped, observations: [...helped.observations, cam(60_000), nod(60_000)] };
  assert.equal(replayCorroboration(labeled([noisy]), { split: 'test' }).task43StartCondition.perDetector['ios / d1'].meetsNecessaryCondition, false);
  assert.equal(replayCorroboration(labeled([helped]), { split: 'all' }).task43StartCondition.evaluable, false);
  assert.throws(() => validateTimeline(labeled([session()])), /consentVersion/, 'a labeled export cannot use synthetic consent');
  assert.throws(() => validateTimeline(timeline([session({ consentVersion: 'pilot-consent-1' })])), /consentVersion/);
  assert.throws(() => validateTimeline(timeline([session()], { kind: 'labeled-export' })), /labelSource/);
});

test('the timeline schema is minimal and refuses raw, identifying or unsafe data', () => {
  const rejects = (mutate, pattern) => {
    const input = timeline([session({ observations: [cam(10_000), nod(11_000)], alerts: [{ atMs: 1, level: 'alert' }], episodes: [{ startMs: 1, endMs: 2, label: 'drowsy' }] })]);
    mutate(input);
    assert.throws(() => validateTimeline(input), pattern);
  };
  rejects(t => { t.sessions[0].observations[1].heartRate = 72; }, /unknown field "heartRate"/);
  rejects(t => { t.sessions[0].observations[0].value = 0.4; }, /unknown field "value"/);
  rejects(t => { t.sessions[0].latitude = 37.6; }, /unknown field "latitude"/);
  rejects(t => { t.sessions[0].alerts[0].message = 'x'; }, /unknown field/);
  rejects(t => { t.sessions[0].episodes[0].notes = 'x'; }, /unknown field/);
  rejects(t => { t.dataset.license = 'x'; }, /unknown field/);
  rejects(t => { t.frames = []; }, /unknown field/);
  rejects(t => { t.sessions[0].participant = 'rich@example.com'; }, /pseudonymous/);
  rejects(t => { t.sessions[0].participant = 'Jane Doe'; }, /pseudonymous/);
  rejects(t => { t.sessions[0].collection = 'driving'; }, /collection/);
  rejects(t => { t.sessions[0].accessories.gps = [[0, 1]]; }, /accessories key/);
  rejects(t => { t.sessions[0].observations.push({ atMs: 1, source: 'watch', kind: 'heart_rate' }); }, /no watch candidate kind/);
  rejects(t => { t.sessions[0].observations.push({ atMs: 1, source: 'headphone', kind: 'pitch' }); }, /kind/);
  rejects(t => { t.sessions[0].observations[0].atMs = 100_001; }, /within the session/);
  rejects(t => { t.sessions[0].observations[0].atMs = 1.5; }, /integer/);
  rejects(t => { t.sessions[0].tracking = [[5, 5]]; }, /end after/);
  rejects(t => { t.sessions[0].episodes.push({ startMs: 1, endMs: 3, label: 'drowsy' }); }, /Overlapping episodes/);
  rejects(t => { t.sessions.push({ ...t.sessions[0], sessionId: 's2', split: 'train' }); }, /Participant leakage/);
  rejects(t => { t.sessions.push({ ...t.sessions[0] }); }, /Duplicate sessionId/);
  rejects(t => { t.sessions = []; }, /empty/);
  rejects(t => { t.version = 2; }, /version 1/);
  assert.throws(() => resolvePolicy({ minSources: 0 }), /minSources/);
  assert.throws(() => resolvePolicy({ windowMs: -1 }), /windowMs/);
  assert.equal(resolvePolicy().defaults, true);
  assert.equal(resolvePolicy({ windowMs: 2_000 }).defaults, false, 'non-default policies are labeled in the report');
});

test('CLI prints provenance with the input hash and refuses to overwrite a report', () => {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-corroboration-'));
  try {
    const out = join(directory, 'report.json');
    const run = extra => spawnSync(process.execPath, [runner, '--input', fixturePath, '--split', 'test', ...extra], { encoding: 'utf8', cwd: root });
    const first = run(['--json', out]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stderr, /establishes no accuracy result/);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(report.provenance.input.sha256, createHash('sha256').update(readFileSync(fixturePath)).digest('hex'));
    assert.ok(report.provenance.sourceHashes['benchmark/run-corroboration-replay.mjs']);
    assert.ok(report.provenance.sourceHashes['benchmark/run-event-benchmark.mjs']);
    assert.deepEqual(JSON.parse(first.stdout).overall, report.overall);
    writeFileSync(join(directory, 'keep.json'), 'keep');
    const second = run(['--json', join(directory, 'keep.json')]);
    assert.notEqual(second.status, 0);
    assert.equal(readFileSync(join(directory, 'keep.json'), 'utf8'), 'keep');
    const usage = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('actual recorded web scoring composes with the corroboration scorer without inventing accessory coverage', () => {
  const frames = syntheticScoringTrace(3).map(frame => ({ ...frame, atMs: Math.round(frame.atMs) }));
  const { trace } = recordScoringFixture({ frames });
  const input = timeline([session({ sessionId: trace.session.sessionId, platform: 'web',
    detectorVersion: trace.session.detectorVersion, durationMs: trace.session.durationMs,
    tracking: [], accessories: {}, alerts: [], observations: [], episodes: [],
  })]);
  const report = replayScoringCorroboration(trace, input, { split: 'test' });
  const released = replayScoring(trace).variants.find(row => row.name === 'released');
  assert.ok(released.alerts.length > 0, 'fixture exercises real camera decisions');
  assert.equal(report.overall.cameraOnly.overall.alerts, released.alerts.length);
  assert.deepEqual(report.overall.cameraOnly, report.overall.corroborated);
  assert.equal(report.cameraAlertsPreserved, true);
  assert.equal(report.overall.delta.addedCues, 0);
  assert.ok(Object.values(report.coverage).every(value => value.sessionsWithCoverage === 0));
  assert.equal(report.cameraBaseline.source, 'released-scoring-replay');
  assert.equal(report.cameraBaseline.labelsGenerated, false);
  assert.match(report.cameraBaseline.traceSha256, /^[a-f0-9]{64}$/);
  assert.ok(report.cameraBaseline.sourceHashes['benchmark/replay-scoring.mjs']);
  assert.deepEqual(input.sessions[0].alerts, [], 'caller input is not modified');
  const old = structuredClone(trace); old.version = 1; delete old.scoringReplay;
  assert.throws(() => replayScoringCorroboration(old, input), /unavailable/);
  const truncated = structuredClone(trace); truncated.scoringReplay.droppedFrames = 1;
  assert.throws(() => replayScoringCorroboration(truncated, input), /unavailable/);
  for (const changes of [{ platform: 'ios' }, { sessionId: 'other-session' },
    { detectorVersion: 'different-detector' }, { durationMs: trace.session.durationMs + 1 }]) {
    const wrong = structuredClone(input); Object.assign(wrong.sessions[0], changes);
    assert.throws(() => replayScoringCorroboration(trace, wrong), /must match/);
  }
  const ambiguous = structuredClone(input); ambiguous.sessions[0].alerts = [{ atMs: 1, level: 'alert' }];
  assert.throws(() => replayScoringCorroboration(trace, ambiguous), /Leave alerts and tracking empty/);
});
