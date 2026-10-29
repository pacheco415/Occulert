import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordScoringFixture } from './lib/scoring-replay-fixture.mjs';
import { replayScoring, writeScoringReplay } from '../benchmark/replay-scoring.mjs';
import { adaptTrace } from '../benchmark/parked-detection-trace.mjs';
import { syntheticScoringTrace } from '../benchmark/released-scoring-oracle.mjs';
import { parseFile } from '../benchmark/run-event-benchmark.mjs';

for (const fps of [3,7,15]) for (const clockStepMs of [0,1]) test(`actual live v2 export replays released decisions and score state at ${fps}fps/${clockStepMs}ms clock steps`, () => {
    const captured = recordScoringFixture({fps,clockStepMs});
    assert.equal(captured.trace.version,2);
    const replay = replayScoring(captured.trace), released = replay.variants.find(row => row.name === 'released');
    assert.ok(replay.variants.every(row => row.status === 'available'));
    assert.deepEqual(released.samples.map(row => [row.at_ms,row.fatigue,row.confidence,row.calibrated]),
        captured.recorded.map(row => [row.frame_id,row.fatigue,row.confidence,row.calibrated]));
    assert.deepEqual(released.alerts.map(row => row.at_ms),captured.trace.legacyAlerts.map(row => row.atMs));
    assert.deepEqual(released.finalState,captured.finalState);
    assert.deepEqual(released.clockFallbacks,{});
    const adapted = adaptTrace(captured.trace,{participant:'SyntheticFixture',split:'test',episodes:[]});
    assert.equal(adapted.comparison.length,captured.trace.samples.length,'v2 remains compatible with the existing measurement/episode adapter');
    assert.equal(replay.labelsGenerated,false); assert.equal(replay.promotion,'none');
});

test('legacy v1 and missing/truncated/invalid signals never produce fabricated zero-alert results', () => {
    const {trace} = recordScoringFixture({fps:3});
    for (const change of [copy => {copy.version=1;delete copy.scoringReplay;},
        copy => {copy.scoringReplay.droppedFrames=1;}, copy => {copy.scoringReplay.frames[0].rawEar=null;},
        copy => {copy.scoringReplay.frames[0].hasFace=false;copy.scoringReplay.frames[0].faceMissing=false;}]) {
        const copy = structuredClone(trace); change(copy); const result = replayScoring(copy);
        assert.ok(result.variants.every(row => row.status === 'unavailable' && !Object.hasOwn(row,'alerts')));
    }
    const copy=structuredClone(trace);copy.scoringReplay.frames[1].frameId=1;
    assert.throws(() => replayScoring(copy),/Invalid or missing scoring frame/);
    const clocks=structuredClone(trace);delete clocks.scoringReplay.frames[0].clocks.score;
    assert.throws(()=>replayScoring(clocks),/Invalid or missing scoring frame/);
});

test('all six replay variants match their actual live helper/results paths on the same raw observations', () => {
    const captured=recordScoringFixture({fps:3}),result=replayScoring(captured.trace);
    for (const variant of result.variants) {
        const reference=recordScoringFixture({fps:3,query:variant.query,minimumSamples:variant.minimumSamples??1});
        assert.deepEqual(variant.samples.map(row => [row.at_ms,row.fatigue,row.confidence,row.calibrated]),
            reference.recorded.map(row => [row.frame_id,row.fatigue,row.confidence,row.calibrated]),variant.name);
        assert.deepEqual(variant.alerts,reference.decisions,variant.name);
    }
});

test('variant replay preserves real recalibration, sensitivity changes and unknown processing gaps', () => {
    const frames=syntheticScoringTrace(3).filter(row=>row.atMs<=15000||row.atMs>=17000).map(row=>({...row,
        noseY:.5+(row.atMs%3000<1000?0:row.atMs%3000<2000?.06:.01),recalibrate:row.atMs===20000,
        sensitivity:row.atMs===30000?'high':row.atMs===60000?'low':undefined}));
    const captured=recordScoringFixture({frames}),result=replayScoring(captured.trace);
    assert.equal(captured.trace.scoringReplay.controls.length,1);
    for(const variant of result.variants){
        const reference=recordScoringFixture({frames,query:variant.query,minimumSamples:variant.minimumSamples??1});
        assert.deepEqual(variant.samples.map(row=>[row.at_ms,row.fatigue,row.confidence,row.calibrated]),
            reference.recorded.map(row=>[row.frame_id,row.fatigue,row.confidence,row.calibrated]),variant.name);
        assert.deepEqual(variant.finalState,reference.finalState,variant.name);
        assert.deepEqual(variant.alerts,reference.decisions,variant.name);
    }
});

test('reusing a supported output for an unavailable trace fails without replacing provenance or leaving misleading old alerts', async () => {
    const parent=mkdtempSync(join(tmpdir(),'occulert-replay-output-')),directory=join(parent,'run');
    try {
        const {trace}=recordScoringFixture({fps:3});await writeScoringReplay(trace,directory);
        for(const name of readdirSync(directory).filter(name=>name!=='replay-manifest.json')){
            const alerts=parseFile(readFileSync(join(directory,name,'alerts.csv'),'utf8'),'alerts');
            assert.ok(alerts.every(row=>row.session_id===trace.session.sessionId && row.at_ms<=trace.session.durationMs));
        }
        const previous=readFileSync(join(directory,'replay-manifest.json'),'utf8');
        const old=structuredClone(trace);old.version=1;delete old.scoringReplay;
        await assert.rejects(writeScoringReplay(old,directory),{code:'EEXIST'});
        assert.equal(readFileSync(join(directory,'replay-manifest.json'),'utf8'),previous);
        const unsupported=join(parent,'unavailable');await writeScoringReplay(old,unsupported);
        assert.deepEqual(readdirSync(unsupported),['replay-manifest.json']);
    } finally {rmSync(parent,{recursive:true,force:true});}
});
