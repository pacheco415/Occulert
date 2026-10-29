import assert from 'node:assert/strict';
import test from 'node:test';
import { scoringReplayFrame, scoringAlertReason, scoringTriggerEligible, scoringCalibrationThresholds } from '../src/scoring-core.js';
import { createReleasedScoringOracle, initialScoringState, syntheticScoringTrace, SCORING_EPOCH } from '../benchmark/released-scoring-oracle.mjs';
import { buildDriverArtifact } from './lib/driver-build.mjs';
import { fileURLToPath } from 'node:url';

const compiled = await buildDriverArtifact({ sourceRoot: fileURLToPath(new URL('../src', import.meta.url)),
    contractPath: fileURLToPath(new URL('../source-driver-contract.json', import.meta.url)) });

function pureParity(frames, { state = initialScoringState(), minimumSamples = 1, sensitivity = 'medium' } = {}) {
    const original = createReleasedScoringOracle({ state, minimumSamples, sensitivity });
    let actual = structuredClone(state);
    const alerts = [], options = { minimumSamples, sensitivityOffset: { low: -.03, medium: 0, high: .03 }[sensitivity] };
    for (const frame of frames) {
        const expected = original.step(frame), now = SCORING_EPOCH + frame.atMs;
        actual = scoringReplayFrame(actual, frame, now, options);
        const reason = frame.hasFace && scoringAlertReason(actual, now);
        if (reason && scoringTriggerEligible(actual, now)) { actual.lastAlert = now; alerts.push({ atMs: frame.atMs, reason }); }
        assert.deepEqual(actual, expected, 'frame at ' + frame.atMs);
    }
    assert.deepEqual(alerts, original.alerts);
    return { actual, alerts };
}

for (const fps of [3, 7, 15]) for (const sensitivity of ['low', 'medium', 'high']) test(`pure released scoring exactly matches immutable v97 at ${fps}fps/${sensitivity}`, () => {
    const original = createReleasedScoringOracle({ sensitivity });
    let state = initialScoringState();
    const actualAlerts = [], options = { minimumSamples: 1, sensitivityOffset: { low: -.03, medium: 0, high: .03 }[sensitivity] };
    for (const frame of syntheticScoringTrace(fps)) {
        const expected = original.step(frame), now = SCORING_EPOCH + frame.atMs;
        state = scoringReplayFrame(state, frame, now, options);
        const reason = frame.hasFace && scoringAlertReason(state, now);
        if (reason && scoringTriggerEligible(state, now)) { state.lastAlert = now; actualAlerts.push({ atMs: frame.atMs, reason }); }
        assert.deepEqual(state, expected, 'frame at ' + frame.atMs);
    }
    assert.ok(original.alerts.length >= 3, 'Golden traces must actually exercise alerts and cooldown');
    assert.deepEqual(actualAlerts, original.alerts);
});

test('pure calibration preserves one-sample released behavior and the separate parked minimum', () => {
    assert.deepEqual(scoringCalibrationThresholds([.17], 1), { baselineEAR: .17, baseClosedThreshold: .12, baseWatchThreshold: .145 });
    assert.equal(scoringCalibrationThresholds([.17], 12), null);
    const samples = [.30, .17, .28]; scoringCalibrationThresholds(samples, 1);
    assert.deepEqual(samples, [.30, .17, .28], 'Pure calibration must not mutate caller samples');
});

test('trigger eligibility retains exact cooldown, calibration and qualified-loss boundary rules', () => {
    const state = { lastAlert: 5000, confidence: 45, calibrating: false };
    assert.equal(scoringTriggerEligible(state, 16999), false);
    assert.equal(scoringTriggerEligible(state, 17000), true);
    assert.equal(scoringTriggerEligible({ ...state, confidence: 44 }, 17000), false);
    assert.equal(scoringTriggerEligible({ ...state, confidence: 44 }, 17000, true), true);
    assert.equal(scoringTriggerEligible({ ...state, calibrating: true }, 17000, true), false);
    assert.equal(scoringAlertReason({ ...state, fatigue: 80, turnedSince: 0 }, 17000), 'Fatigue');
    assert.equal(scoringAlertReason({ ...state, fatigue: 0, turnedSince: 10500 }, 17000), null);
    assert.equal(scoringAlertReason({ ...state, fatigue: 0, turnedSince: 10499 }, 17000), 'Distraction');
});

for (const fps of [3, 7, 15]) for (const clockStepMs of [0, 1]) test(`actual composed driver preserves v97 state, alerts and separate clock reads at ${fps}fps/${clockStepMs}ms clock steps`, () => {
    const previous = createReleasedScoringOracle({ clockStepMs });
    const current = createReleasedScoringOracle({ source: compiled.code, clockStepMs });
    for (const frame of syntheticScoringTrace(fps)) assert.deepEqual(current.step(frame), previous.step(frame), 'frame at ' + frame.atMs);
    assert.deepEqual(current.alerts, previous.alerts);
    assert.deepEqual(current.logs, previous.logs);
});

for (const minimumSamples of [1, 12]) for (const count of [0, 1, 11, 12]) test(`calibration ${count}/${minimumSamples} samples and a deadline interrupted by face loss match v97`, () => {
    const samples = Array.from({ length: count }, (_, index) => [.40, .17, .31, .23][index % 4]);
    const state = initialScoringState({ calibrationUntil: SCORING_EPOCH + 3200, calibrationSamples: samples });
    const result = pureParity([
        { atMs: 3200, hasFace: false, ear: 0, turned: false, nod: false },
        { atMs: 7000, hasFace: false, ear: 0, turned: false, nod: false },
        { atMs: 7001, hasFace: true, ear: .16, turned: false, nod: false },
        { atMs: 7200, hasFace: true, ear: .1, turned: false, nod: false },
    ], { state, minimumSamples });
    assert.equal(result.actual.calibrated, count >= minimumSamples);
    assert.equal(result.actual.calibrating, false);
});

test('strict eye/signal boundaries, microsleep timing and interrupted turns match v97', () => {
    const state = initialScoringState({ calibrating: false, calibrated: true, confidence: 45 });
    const frames = [.18 * .82, .18, .22, .18 * .82 - Number.EPSILON, .18 - Number.EPSILON, .22 - Number.EPSILON]
        .map((ear, index) => ({ atMs: index * 100, hasFace: true, ear, turned: false, nod: false }));
    for (const [atMs, hasFace, ear, turned] of [[1000, true, .1, false], [2500, true, .1, false], [2501, true, .1, false],
        [5501, true, .1, false], [5502, true, .1, false], [7000, true, .3, true], [13500, true, .3, true],
        [13501, true, .3, true], [14000, false, 0, false], [17500, false, 0, false], [17501, false, 0, false],
        [20000, true, .3, true], [26500, true, .3, true], [26501, true, .3, true]]) frames.push({ atMs, hasFace, ear, turned, nod: false });
    pureParity(frames, { state });
});
