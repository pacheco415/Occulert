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

// Independent coordinate specification: do not derive expectations from the
// browser initializer or use its generator for the released oracle comparison.
function referenceBrowserLandmarks(frame) {
    if (!frame.hasFace) return null;
    const points = Array.from({length:468},()=>({x:0.5,y:0.5}));
    const h = frame.ear * 0.05;
    const eyes = [
        [362,.62-.05,.5],[385,.62-.02,.5-h],[387,.62+.02,.5-h],
        [263,.62+.05,.5],[373,.62+.02,.5+h],[380,.62-.02,.5+h],
        [33,.38-.05,.5],[160,.38-.02,.5-h],[158,.38+.02,.5-h],
        [133,.38+.05,.5],[153,.38+.02,.5+h],[144,.38-.02,.5+h],
    ];
    for (const [index,x,y] of eyes) points[index]={x,y};
    points[4]={x:frame.turned ? .8 : .5,y:frame.noseY ?? .55};
    points[234]={x:.25,y:.6};points[454]={x:.75,y:.6};
    return points;
}

test('compact browser scoring transport preserves every landmark at every original frame rate', async () => {
    const {runInNewContext} = await import('node:vm');
    const {landmarks,scoringGeometryInitScript} = await import('../tests/helpers/scoring-replay-geometry.mjs');
    const browser={};runInNewContext(scoringGeometryInitScript,browser);
    const {parse}=await import('acorn');
    const source=readFileSync(new URL('../tests/scoring-replay.spec.mjs',import.meta.url),'utf8');
    const declaration=parse(source,{ecmaVersion:2022,sourceType:'module'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='runBrowserTrace');
    assert.ok(declaration,'exercise the actual Playwright transport function');
    const transportContext={landmarks,initialScoringState:()=>({}),fields:[],SCORING_EPOCH:0};
    runInNewContext(source.slice(declaration.start,declaration.end),transportContext);
    for (const fps of [3,7,15]) {
        const frames=syntheticScoringTrace(fps);
        const payload=await transportContext.runBrowserTrace({evaluate:(_callback,input)=>input},frames,false);
        const transport=JSON.parse(JSON.stringify(payload.frames));
        assert.equal(transport.length,100*fps+1);
        assert.equal(Object.hasOwn(transport[0],'landmarks'),false,'transfer scalar frames, not expanded geometry');
        assert.deepEqual(transport,frames,'scalar transport preserves every observation and timestamp');
        for (const frame of transport) {
            const expected=referenceBrowserLandmarks(frame);
            assert.deepEqual(landmarks(frame),expected);
            assert.deepEqual(JSON.parse(JSON.stringify(browser.__scoringReplayLandmarks(frame))),expected);
        }
        const expanded=frames.map(frame=>({atMs:frame.atMs,landmarks:referenceBrowserLandmarks(frame)}));
        assert.ok(Buffer.byteLength(JSON.stringify(transport)) < Buffer.byteLength(JSON.stringify(expanded))/50,
            'wire payload must avoid hundreds of expanded point objects per frame');
    }
    for (const frame of [{hasFace:false},{hasFace:true,ear:0,turned:true,noseY:0},{hasFace:true,ear:.37,noseY:.61}]) {
        assert.deepEqual(JSON.parse(JSON.stringify(browser.__scoringReplayLandmarks(frame))),referenceBrowserLandmarks(frame));
    }
    const frame={hasFace:true,ear:.3},a=browser.__scoringReplayLandmarks(frame),b=browser.__scoringReplayLandmarks(frame);
    a[0].x=99;
    assert.equal(a[1].x,.5,'points must not alias');
    assert.equal(b[0].x,.5,'frames must not share mutable geometry');
});
