import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordScoringFixture } from './lib/scoring-replay-fixture.mjs';
import { replayScoring, writeScoringReplay } from '../benchmark/replay-scoring.mjs';
import { adaptTrace } from '../benchmark/parked-detection-trace.mjs';
import { createReleasedScoringOracle, initialScoringState, syntheticScoringTrace, SCORING_EPOCH } from '../benchmark/released-scoring-oracle.mjs';
import { parseFile } from '../benchmark/run-event-benchmark.mjs';

for (const fps of [3,7,15]) for (const clockStepMs of [0,1]) test(`actual live v3 export replays released decisions and score state at ${fps}fps/${clockStepMs}ms clock steps`, () => {
    const captured = recordScoringFixture({fps,clockStepMs});
    assert.equal(captured.trace.version,3);
    assert.equal(captured.trace.scoringReplay.version,2);
    assert.ok(captured.trace.scoringReplay.frames.every(row => row.yawn === false));
    const replay = replayScoring(captured.trace), released = replay.variants.find(row => row.name === 'released');
    assert.ok(replay.variants.every(row => row.status === 'available'));
    assert.deepEqual(released.samples.map(row => [row.at_ms,row.fatigue,row.confidence,row.calibrated]),
        captured.recorded.map(row => [row.frame_id,row.fatigue,row.confidence,row.calibrated]));
    assert.deepEqual(released.alerts.map(row => row.at_ms),captured.trace.legacyAlerts.map(row => row.atMs));
    assert.deepEqual(released.finalState,captured.finalState);
    assert.deepEqual(released.clockFallbacks,{});
    const adapted = adaptTrace(captured.trace,{participant:'SyntheticFixture',split:'test',episodes:[]});
    assert.equal(adapted.comparison.length,captured.trace.samples.length,'v3 remains compatible with the existing measurement/episode adapter');
    assert.equal(replay.labelsGenerated,false); assert.equal(replay.promotion,'none');
});

test('legacy v1/v2 and missing/truncated/invalid signals never produce fabricated zero-alert results', () => {
    const {trace} = recordScoringFixture({fps:3});
    for (const change of [copy => {copy.version=1;delete copy.scoringReplay;},
        copy => {copy.version=2;copy.scoringReplay.version=1;for(const row of copy.scoringReplay.frames)delete row.yawn;},
        copy => {copy.scoringReplay.droppedFrames=1;}, copy => {copy.scoringReplay.frames[0].rawEar=null;},
        copy => {copy.scoringReplay.frames[0].hasFace=false;copy.scoringReplay.frames[0].faceMissing=false;}]) {
        const copy = structuredClone(trace); change(copy); const result = replayScoring(copy);
        assert.ok(result.variants.every(row => row.status === 'unavailable' && !Object.hasOwn(row,'alerts')));
    }
    const copy=structuredClone(trace);copy.scoringReplay.frames[1].frameId=1;
    assert.throws(() => replayScoring(copy),/Invalid or missing scoring frame/);
    const clocks=structuredClone(trace);delete clocks.scoringReplay.frames[0].clocks.score;
    assert.throws(()=>replayScoring(clocks),/Invalid or missing scoring frame/);
    const missing=structuredClone(trace);delete missing.scoringReplay.frames[0].yawn;
    assert.throws(()=>replayScoring(missing),/Invalid or missing scoring frame/);
    for (const value of [undefined,0,1,'true',null]) {
        const invalid=structuredClone(trace);invalid.scoringReplay.frames[0].yawn=value;
        assert.throws(()=>replayScoring(invalid),/Invalid or missing scoring frame/);
    }
    const absent=structuredClone(trace),row=absent.scoringReplay.frames.find(row=>!row.hasFace);
    row.yawn=true;
    assert.throws(()=>replayScoring(absent),/Accepted yawn requires a tracked face/);
    const invalidGeometry=structuredClone(trace);invalidGeometry.scoringReplay.frames[0].rawEar=null;invalidGeometry.scoringReplay.frames[0].yawn=true;
    assert.ok(replayScoring(invalidGeometry).variants.every(row=>row.status==='unavailable'));
    for(const version of [1,2]) {
        const legacy=structuredClone(trace);legacy.version=version;
        if(version===1)delete legacy.scoringReplay;
        else {legacy.scoringReplay.version=1;for(const row of legacy.scoringReplay.frames)delete row.yawn;}
        assert.equal(adaptTrace(legacy,{participant:'LegacyFixture',split:'test',episodes:[]}).comparison.length,trace.samples.length);
    }
});

test('real accepted yawns replay after scoring and before same-frame alerts without resampling the frame', () => {
    const frames=[9000,9600,10200,10201].map(atMs=>({atMs,hasFace:true,ear:.2,mar:.8,turned:false,nod:false}));
    const state=initialScoringState({calibrating:false,calibrated:true,confidence:100,fatigue:71,maxFatigue:71});
    const captured=recordScoringFixture({frames,state}),result=replayScoring(captured.trace);
    assert.equal(captured.yawnCount,1);
    assert.deepEqual(captured.trace.scoringReplay.frames.map(row=>row.yawn),[false,false,false,true],'Hold is strictly greater than 1200 ms');
    const released=result.variants.find(row=>row.name==='released');
    assert.deepEqual(released.alerts,[{at_ms:10201,reason:'Fatigue'}]);
    assert.deepEqual(released.finalState,captured.finalState);
    assert.equal(released.finalState.fatigue,87);
    assert.equal(released.finalState.maxFatigue,87);
    assert.equal(released.finalState.fatigueSampleSum,304);
    assert.equal(released.finalState.fatigueSampleCount,4);
    assert.deepEqual(released.clockFallbacks,{});
    assert.match(result.acceptedYawnPolicy,/do not reconstruct MAR/);
    for(const variant of result.variants){
        const live=recordScoringFixture({frames,state,query:variant.query,minimumSamples:variant.minimumSamples??1});
        assert.equal(live.yawnCount,1,variant.name);
        assert.deepEqual(variant.finalState,live.finalState,variant.name);
        assert.deepEqual(variant.alerts,live.decisions,variant.name);
    }
});

test('recorded yawns retain cooldown and mouth smoothing with false events on closed and missing-face frames', () => {
    const times=[9000,9600,10200,10201];
    for(let atMs=10701;atMs<18201;atMs+=500)times.push(atMs);
    times.push(18201,18202,18300,18400,18500,18600,18700,18800);
    const frames=times.map(atMs=>({atMs,hasFace:atMs!==18800,ear:.3,mar:atMs<18300?.8:0,turned:false,nod:false}));
    const captured=recordScoringFixture({frames,state:initialScoringState({calibrating:false,calibrated:true,confidence:100})});
    assert.equal(captured.yawnCount,2);
    assert.deepEqual(captured.trace.scoringReplay.frames.filter(row=>row.yawn).map(row=>row.atMs),[10201,18202]);
    assert.equal(captured.trace.scoringReplay.frames.find(row=>row.atMs===18201).yawn,false,'Cooldown is strictly greater than 8000 ms');
    assert.ok(captured.trace.scoringReplay.frames.filter(row=>row.atMs>=18300).every(row=>!row.yawn));
    assert.deepEqual(replayScoring(captured.trace).variants.find(row=>row.name==='released').finalState,captured.finalState);
});

test('an actual accepted yawn on the calibration-ending frame precedes eligibility', () => {
    const frames=[9000,9600,10200,10201].map(atMs=>({atMs,hasFace:true,ear:.3,mar:.8,turned:false,nod:false}));
    // The primary path observes mouth opening during calibration, and the last
    // frame completes calibration before the real detector accepts its yawn.
    const captured=recordScoringFixture({frames,query:'?observer=1&perclos=time',
        state:initialScoringState({calibrationUntil:SCORING_EPOCH+10201,confidence:100,fatigue:80,maxFatigue:80})});
    assert.deepEqual(captured.trace.scoringReplay.frames.map(row=>row.yawn),[false,false,false,true]);
    const released=replayScoring(captured.trace).variants.find(row=>row.name==='released');
    assert.deepEqual(released.finalState,captured.finalState);
    assert.equal(released.finalState.fatigue,80);
    assert.equal(released.finalState.maxFatigue,80);
    assert.equal(released.finalState.fatigueSampleSum,0);
    assert.equal(released.finalState.fatigueSampleCount,0);
    assert.equal(released.finalState.calibrating,false);
    assert.deepEqual(released.alerts,[{at_ms:10201,reason:'Fatigue'}]);
    assert.deepEqual(released.alerts,captured.decisions);
});

test('primary calibration accepts its existing detector events and variants reuse those fixed observed inputs', () => {
    const frames=[9000,9600,10200,10201].map(atMs=>({atMs,hasFace:true,ear:.3,mar:.8,turned:false,nod:false}));
    const state=initialScoringState({calibrationUntil:SCORING_EPOCH+20000,fatigue:80,maxFatigue:80,confidence:100});
    const primary=recordScoringFixture({frames,state,query:'?observer=1&fatigue-timing=elapsed'});
    assert.equal(primary.yawnCount,1,'Preserve the existing primary detector call during calibration');
    assert.equal(primary.trace.samples.at(-1).calibrating,true);
    const replay=replayScoring(primary.trace);
    assert.deepEqual(replay.variants.find(row=>row.name==='fatigue-timing-elapsed').finalState,primary.finalState);
    const releasedLive=recordScoringFixture({frames,state}),releasedReplay=replay.variants.find(row=>row.name==='released');
    assert.equal(releasedLive.yawnCount,0,'The legacy live path keeps its existing calibration gate');
    assert.equal(releasedReplay.finalState.fatigue,releasedLive.finalState.fatigue+8,'Counterfactuals consume accepted events rather than inventing detector decisions');
    assert.equal(releasedReplay.finalState.calibrating,true);
    assert.deepEqual(releasedReplay.alerts,[],'Normal alert calibration gating still applies');
});

test('all replay variants match their actual live helper/results paths on the same raw observations', () => {
    const captured=recordScoringFixture({fps:3}),result=replayScoring(captured.trace);
    for (const variant of result.variants) {
        const reference=recordScoringFixture({fps:3,query:variant.query,minimumSamples:variant.minimumSamples??1});
        assert.deepEqual(variant.samples.map(row => [row.at_ms,row.fatigue,row.confidence,row.calibrated]),
            reference.recorded.map(row => [row.frame_id,row.fatigue,row.confidence,row.calibrated]),variant.name);
        assert.deepEqual(variant.alerts,reference.decisions,variant.name);
    }
});

test('25-second open-eye turn replays released and parked hold policies against the actual live paths', () => {
    const fixture = JSON.parse(readFileSync(new URL('../benchmark/fixtures/head-turn-25s.json', import.meta.url), 'utf8'));
    const state = initialScoringState(fixture.initialState), frames = fixture.frames;
    const captured = recordScoringFixture({ frames, state }), result = replayScoring(captured.trace);
    const released = result.variants.find(row => row.name === 'released');
    const held = result.variants.find(row => row.name === 'turn-fatigue-hold');
    const liveHold = recordScoringFixture({ frames, state, query: '?observer=1&turn-fatigue=hold' });
    const oracle = createReleasedScoringOracle({ state });
    let independent;
    for (const frame of frames) independent = oracle.step({...frame, rawEar:frame.ear, noseY:.55});
    assert.equal(JSON.stringify(released.finalState), JSON.stringify(captured.finalState));
    assert.deepEqual(released.finalState, independent, 'Flag-off scores match the immutable independent oracle');
    assert.deepEqual(released.alerts, captured.decisions);
    assert.deepEqual(released.alerts, oracle.alerts.map(({atMs, reason}) => ({at_ms: atMs, reason})));
    assert.deepEqual(released.alerts.map(row => row.reason), ['Distraction', 'Fatigue']);
    assert.equal(released.finalState.maxFatigue, 100);
    assert.equal(released.samples.find(row => row.fatigue >= 80).at_ms, 9000);
    assert.deepEqual(held.finalState, liveHold.finalState);
    assert.deepEqual(held.alerts, liveHold.decisions);
    assert.deepEqual(held.alerts, [{at_ms:6600, reason:'Distraction'}, {at_ms:18600, reason:'Distraction'}]);
    assert.equal(held.finalState.fatigue, 0);
    assert.equal(held.finalState.maxFatigue, 0);
    for (const key of ['confidence','perclosWindow','eyesClosedSince','microsleeps','turnedSince','totalDistractionMs','lastAlert']) {
        assert.deepEqual(held.finalState[key], released.finalState[key], key);
    }
    assert.equal(held.finalState.microsleeps, 0);
    assert.ok(held.samples.every(row => row.fatigue === 0));
    const adapted = adaptTrace(liveHold.trace, {participant:'SyntheticTurnFixture', split:'test', episodes:[]});
    assert.deepEqual(adapted.summary.experimentFlags, ['observer','turnFatigue']);
    assert.equal(result.labelsGenerated, false);
    assert.equal(result.promotion, 'none');
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
    const points = Array.from({length:468},()=>({x:0.5,y:0.5,z:0}));
    const h = frame.ear * 0.05;
    const eyes = [
        [362,.62-.05,.5],[385,.62-.02,.5-h],[387,.62+.02,.5-h],
        [263,.62+.05,.5],[373,.62+.02,.5+h],[380,.62-.02,.5+h],
        [33,.38-.05,.5],[160,.38-.02,.5-h],[158,.38+.02,.5-h],
        [133,.38+.05,.5],[153,.38+.02,.5+h],[144,.38-.02,.5+h],
    ];
    for (const [index,x,y] of eyes) points[index]={x,y,z:0};
    points[4]={x:frame.turned ? .8 : .5,y:frame.noseY ?? .55,z:0};
    points[234]={x:.25,y:.6,z:0};points[454]={x:.75,y:.6,z:0};
    points[13]={x:.5,y:.4,z:0};points[14]={x:.5,y:.4+(frame.mar??0)*.2,z:0};
    points[61]={x:.4,y:.5,z:0};points[291]={x:.6,y:.5,z:0};
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
    for (const frame of [{hasFace:false},{hasFace:true,ear:0,turned:true,noseY:0},{hasFace:true,ear:.37,noseY:.61,mar:.8}]) {
        assert.deepEqual(JSON.parse(JSON.stringify(browser.__scoringReplayLandmarks(frame))),referenceBrowserLandmarks(frame));
    }
    const frame={hasFace:true,ear:.3},a=browser.__scoringReplayLandmarks(frame),b=browser.__scoringReplayLandmarks(frame);
    a[0].x=99;
    assert.equal(a[1].x,.5,'points must not alias');
    assert.equal(b[0].x,.5,'frames must not share mutable geometry');
});
