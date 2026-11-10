import assert from 'node:assert/strict';
import test from 'node:test';
import { scoringTriggerEligible, scoringCalibrationThresholds, scoringTrackedFrame, scoringYawn, scoringAlertCandidate, scoringEyeMetrics } from '../src/scoring-core.js';
import { scoringReplayFrame, scoringAlertReason } from '../benchmark/scoring-step.mjs';
import { createReleasedScoringOracle, initialScoringState, syntheticScoringTrace, SCORING_EPOCH } from '../benchmark/released-scoring-oracle.mjs';
import { buildDriverArtifact } from './lib/driver-build.mjs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { landmarks } from '../tests/helpers/scoring-replay-geometry.mjs';

const compiled = await buildDriverArtifact({ sourceRoot: fileURLToPath(new URL('../src', import.meta.url)),
    contractPath: fileURLToPath(new URL('../source-driver-contract.json', import.meta.url)) });

test('turn exclusion preserves flag-off eye-state bytes, expires the window and breaks closed-eye continuity', () => {
    const initial = initialScoringState({calibrating:false,calibrated:true,confidence:100});
    let state = structuredClone(initial);
    for (const [elapsed,ear,turned] of [[0,.3,false],[100,.08,false],[1000,.08,true],[1601,.08,true],[60000,.08,true],[60100,.08,true]]) {
        const at=SCORING_EPOCH+elapsed, before=structuredClone(state);
        assert.equal(JSON.stringify(scoringEyeMetrics(state,ear,turned,at,false)),JSON.stringify(scoringEyeMetrics(state,ear,turned,at)));
        const result=scoringEyeMetrics(state,ear,turned,at,true);
        assert.deepEqual(state,before,'The input state and window are not modified');state=result.state;
        if(turned){assert.equal(state.eyesClosedSince,0);assert.equal(result.microsleep,false);}
    }
    assert.deepEqual(state.perclosWindow,[],'Old evidence expires during excluded observations');
    assert.equal(state.microsleeps,0);
    assert.equal(state.lastMicro,0);
    const resumed=SCORING_EPOCH+60200;
    state=scoringEyeMetrics(state,.08,false,resumed,true).state;
    assert.equal(state.eyesClosedSince,resumed,'Resume starts a new closure, never bridges the turn');
    assert.equal(state.totalDistractionMs,59200,'Turn duration is still accounted for');
    let result=scoringEyeMetrics(state,.08,false,resumed+1500,true);
    assert.equal(result.microsleep,false,'Exactly 1500 ms remains below the strict microsleep boundary');
    result=scoringEyeMetrics(result.state,.08,false,resumed+1501,true);
    assert.equal(result.microsleep,true);assert.equal(result.state.microsleeps,1);
    const lastMicro=result.state.lastMicro;
    state=scoringEyeMetrics(result.state,.08,true,resumed+1600,true).state;
    assert.equal(state.eyesClosedSince,0);assert.equal(state.lastMicro,lastMicro,'Exclusion preserves the cooldown history');
    state=scoringEyeMetrics(state,.08,false,resumed+1700,true).state;
    result=scoringEyeMetrics(state,.08,false,resumed+3201,true);
    assert.equal(result.microsleep,false,'Fresh closure does not bypass the existing 3000 ms cooldown');
    assert.deepEqual(initial.perclosWindow,[]);
});

test('accepted yawn preserves the +8 cap, updates the peak immediately and leaves scored averages untouched', () => {
    for (const [fatigue, maxFatigue, expected, peak] of [[0,0,8,8],[72,75,80,80],[95,97,100,100],[100,100,100,100],[50,90,58,90]]) {
        const before = initialScoringState({ fatigue, maxFatigue, fatigueSampleSum: 216, fatigueSampleCount: 3 });
        const saved = structuredClone(before), after = scoringYawn(before);
        assert.notEqual(after, before);
        assert.deepEqual(before, saved, 'The pure event cannot mutate its input');
        assert.deepEqual(after, { ...before, fatigue: expected, maxFatigue: peak });
    }
});

test('a yawn crossing 80 is eligible on that frame after the normal scored sample', () => {
    const before = initialScoringState({ calibrating: false, calibrated: true, confidence: 100,
        fatigue: 75, maxFatigue: 75, fatigueSampleSum: 30, fatigueSampleCount: 1 });
    const scored = scoringTrackedFrame(before, { ear: .3, turned: false, nod: false, perclos: 0 }, SCORING_EPOCH);
    assert.equal(scored.fatigue, 72);
    assert.equal(scoringAlertCandidate(scored), null);
    const after = scoringYawn(scored);
    assert.equal(after.fatigue, 80);
    assert.equal(after.maxFatigue, 80);
    assert.equal(scoringAlertCandidate(after), 'Fatigue');
    assert.equal(scoringTriggerEligible(after, SCORING_EPOCH), true);
    assert.equal(after.fatigueSampleSum, 102, 'The accepted event does not resample the frame');
    assert.equal(after.fatigueSampleCount, 2);
});

test('the real detector keeps released hold, cooldown, scores and alerts with only immediate peak accounting changed', () => {
    const state = initialScoringState({ calibrating:false,calibrated:true,confidence:100,fatigue:71,maxFatigue:71 });
    const previous = createReleasedScoringOracle({state}), current = createReleasedScoringOracle({source:compiled.code,state});
    for (const atMs of [9000,9600,10200,10201]) {
        const points = landmarks({hasFace:true,ear:.2,mar:.8});
        const oldState = previous.landmarks(atMs,points), newState = current.landmarks(atMs,points);
        assert.deepEqual({...newState,maxFatigue:oldState.maxFatigue},oldState);
    }
    assert.equal(previous.context.maxFatigue,79,'The immutable fixture retains its old delayed peak');
    assert.equal(current.context.maxFatigue,87);
    assert.equal(current.context.fatigue,87);
    assert.equal(current.context.fatigueSampleSum,304);
    assert.equal(current.context.fatigueSampleCount,4);
    assert.deepEqual(current.alerts,[{atMs:10201,reason:'Fatigue'}]);
    assert.deepEqual(current.alerts,previous.alerts);
    assert.deepEqual(current.logs,previous.logs);
    assert.equal(current.context.yawnCount,1);
    for (const oracle of [previous,current]) {
        const points = landmarks({hasFace:true,ear:.3,mar:.8});
        oracle.setClock(18201);oracle.context.detectYawn(points);
        assert.equal(oracle.context.yawnCount,1,'Exactly 8000 ms remains inside the released cooldown');
        oracle.setClock(18202);oracle.context.detectYawn(points);
        assert.equal(oracle.context.yawnCount,2);
    }
    assert.equal(current.context.fatigue,95);
    assert.equal(current.context.maxFatigue,95);
    assert.equal(current.context.fatigueSampleSum,304);
    assert.equal(current.context.fatigueSampleCount,4);
    for (const oracle of [previous,current]) {
        const closed = landmarks({hasFace:true,ear:.3,mar:0}), open = landmarks({hasFace:true,ear:.3,mar:.8});
        oracle.setClock(18300);oracle.context.detectYawn(closed);
        assert.notEqual(oracle.context._mouthOpenSince,0,'One closed sample retains the five-frame MAR hold');
        oracle.setClock(18400);oracle.context.detectYawn(closed);
        assert.equal(oracle.context._mouthOpenSince,0,'The second closed sample falls below the unchanged MAR threshold');
        assert.equal(oracle.context._marHist.length,5);
        for (const atMs of [30000,30100,30200,30300,31501]) {
            oracle.setClock(atMs);oracle.context.detectYawn(open);
        }
        assert.equal(oracle.context.yawnCount,3);
        assert.equal(oracle.context.fatigue,100,'The actual accepted detector event remains capped at 100');
    }
    assert.equal(current.context.maxFatigue,100);
    assert.equal(current.context.fatigueSampleSum,304);
    assert.equal(current.context.fatigueSampleCount,4);
});

test('the pinned independent oracle survives normal retirement of the public v97 URL and integrity entry', () => {
    const directory=mkdtempSync(join(tmpdir(),'occulert-scoring-oracle-'));
    try {
        mkdirSync(join(directory,'benchmark/fixtures'),{recursive:true});
        cpSync(new URL('../benchmark/released-scoring-oracle.mjs',import.meta.url),join(directory,'benchmark/released-scoring-oracle.mjs'));
        cpSync(new URL('../benchmark/fixtures/driver-app-v97.js',import.meta.url),join(directory,'benchmark/fixtures/driver-app-v97.js'));
        symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(directory,'node_modules'),'dir');
        cpSync(new URL('../benchmark/fixtures/driver-app-v97.js',import.meta.url),join(directory,'driver-app.v97.js'));
        writeFileSync(join(directory,'asset-integrity.json'),JSON.stringify({'driver-app.v97.js':'retired-entry'}));
        rmSync(join(directory,'driver-app.v97.js'));writeFileSync(join(directory,'asset-integrity.json'),'{}');
        execFileSync(process.execPath,['--input-type=module','-e',"import{createReleasedScoringOracle}from'./benchmark/released-scoring-oracle.mjs';const o=createReleasedScoringOracle();o.step({atMs:4000,hasFace:true,ear:.3,turned:false,nod:false});"],{cwd:directory,stdio:'pipe'});
        assert.match(readFileSync(new URL('../.vercelignore',import.meta.url),'utf8'),/^benchmark\/$/m);
        assert.doesNotMatch(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),/benchmark\/fixtures/);
    } finally {rmSync(directory,{recursive:true,force:true});}
});

function pureParity(frames, { state = initialScoringState(), minimumSamples = 1, sensitivity = 'medium' } = {}) {
    const original = createReleasedScoringOracle({ state, minimumSamples, sensitivity });
    const composed = createReleasedScoringOracle({ source: compiled.code, state, minimumSamples, sensitivity });
    let actual = structuredClone(state);
    const alerts = [], options = { minimumSamples, sensitivityOffset: { low: -.03, medium: 0, high: .03 }[sensitivity] };
    for (const frame of frames) {
        const expected = original.step(frame), now = SCORING_EPOCH + frame.atMs;
        assert.deepEqual(composed.step(frame), expected, 'composed edge frame at ' + frame.atMs);
        actual = scoringReplayFrame(actual, frame, now, options);
        const reason = frame.hasFace && scoringAlertReason(actual, now);
        if (reason && scoringTriggerEligible(actual, now)) { actual.lastAlert = now; alerts.push({ atMs: frame.atMs, reason }); }
        assert.deepEqual(actual, expected, 'frame at ' + frame.atMs);
    }
    assert.deepEqual(alerts, original.alerts);
    assert.deepEqual(composed.alerts, original.alerts);
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

for (const fps of [3, 7, 15]) test(`actual composed EAR smoothing and nod inputs preserve v97 at ${fps}fps`, () => {
    const original = createReleasedScoringOracle(), composed = createReleasedScoringOracle({ source: compiled.code });
    for (const frame of syntheticScoringTrace(fps)) {
        const input = { ...frame, rawEar: frame.ear, noseY: .5 + (frame.atMs % 3000 < 1000 ? 0 : frame.atMs % 3000 < 2000 ? .06 : .01) };
        assert.deepEqual(composed.step(input), original.step(input), 'raw input at ' + frame.atMs);
    }
    assert.deepEqual(composed.alerts, original.alerts);
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
