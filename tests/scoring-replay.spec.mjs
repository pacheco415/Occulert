import {test,expect} from '@playwright/test';
import {prepareDetectorPage} from './helpers/detector-runtime.mjs';
import {createReleasedScoringOracle,initialScoringState,syntheticScoringTrace,SCORING_EPOCH} from '../benchmark/released-scoring-oracle.mjs';
import {replayScoring} from '../benchmark/replay-scoring.mjs';

test.beforeEach(async({page})=>{await prepareDetectorPage(page);});
const fields=['fatigue','confidence','maxFatigue','fatigueSampleSum','fatigueSampleCount','eyesClosedSince','microsleeps','lastMicro','turnedSince','totalDistractionMs','noFaceSince','lastFaceSeen','calibrating','calibrated','baselineEAR','baseClosedThreshold','baseWatchThreshold','eyeClosedThreshold','eyeWatchThreshold','lastAlert','lastNod','headNods'];
function landmarks(frame) {
    if (!frame.hasFace) return null;
    const points=Array.from({length:468},()=>({x:.5,y:.5}));
    for(const [indices,center]of [[[362,385,387,263,373,380],.62],[[33,160,158,133,153,144],.38]]) {
        const h=frame.ear*.05,xy=[[center-.05,.5],[center-.02,.5-h],[center+.02,.5-h],[center+.05,.5],[center+.02,.5+h],[center-.02,.5+h]];
        indices.forEach((index,i)=>{points[index]={x:xy[i][0],y:xy[i][1]};});
    }
    points[4]={x:frame.turned?.8:.5,y:frame.noseY??.55};points[234]={x:.25,y:.6};points[454]={x:.75,y:.6};
    return points;
}
async function runBrowserTrace(page,frames,record) {
    return page.evaluate(({frames,state,fields,epoch,record})=>{
        window.__replayAt=0;Date.now=()=>epoch+window.__replayAt;performance.now=()=>window.__replayAt;
        Object.assign(window,{});
        // These are the actual owned driver bindings, matching a newly started
        // local session. Inference is supplied by deterministic scalar geometry.
        fatigue=state.fatigue;confidence=state.confidence;maxFatigue=state.maxFatigue;fatigueSampleSum=0;fatigueSampleCount=0;
        perclosWindow=[];eyesClosedSince=0;microsleeps=0;lastMicro=0;turnedSince=0;totalDistractionMs=0;noFaceSince=0;lastFaceSeen=0;
        calibrating=true;calibrated=false;calibrationUntil=state.calibrationUntil;calibrationSamples=[];
        baselineEAR=.28;baseClosedThreshold=.18;baseWatchThreshold=.22;eyeClosedThreshold=.18;eyeWatchThreshold=.22;
        lastAlert=0;earHistory=[];noseYHistory=[];lastNod=0;headNods=0;alerts=0;lastEscalation=0;escalationLevel=0;_sessionLog=[];
        running=true;starting=false;sessionStart=epoch;localSessionId='browser-scoring-replay';cloudConsent.checked=false;
        Object.defineProperty(video,'videoWidth',{configurable:true,value:360});Object.defineProperty(video,'videoHeight',{configurable:true,value:480});canvas.width=360;canvas.height=480;
        if(record)experimentController.begin();
        const result=[];
        for(const frame of frames){window.__replayAt=frame.atMs;if(record)experimentController.capture({currentTime:frame.atMs/1000});onResults({multiFaceLandmarks:frame.landmarks?[frame.landmarks]:[]});
            const current={fatigue,confidence,maxFatigue,fatigueSampleSum,fatigueSampleCount,eyesClosedSince,microsleeps,lastMicro,turnedSince,totalDistractionMs,noFaceSince,lastFaceSeen,calibrating,calibrated,baselineEAR,baseClosedThreshold,baseWatchThreshold,eyeClosedThreshold,eyeWatchThreshold,lastAlert,lastNod,headNods};
            result.push(fields.map(key=>current[key]));}
        running=false;if(record)experimentController.stop();
        return {result,alerts:_sessionLog.filter(row=>row.type==='alert').map(row=>({atMs:row.ts-epoch,reason:row.value})),trace:record?experimentController.exportData():null};
    },{frames:frames.map(frame=>({atMs:frame.atMs,landmarks:landmarks(frame)})),state:initialScoringState(),fields,epoch:SCORING_EPOCH,record});
}

for(const fps of [3,7,15])test(`actual released driver matches immutable v97 scoring and alert timestamps at ${fps}fps`,async({page})=>{
    await page.goto('/app.html');await expect.poll(()=>page.evaluate(()=>window.OcculertStartup?.isReady())).toBe(true);
    const frames=syntheticScoringTrace(fps),oracle=createReleasedScoringOracle(),expected=[];
    for(const frame of frames){const state=oracle.landmarks(frame.atMs,landmarks(frame));expected.push(fields.map(key=>state[key]));}
    const actual=await runBrowserTrace(page,frames,false);
    expect(actual.result).toEqual(expected);expect(actual.alerts).toEqual(oracle.alerts);
});

test('actual observer v2 export replays its captured released scores and decisions',async({page})=>{
    await page.goto('/app.html?observer=1');await expect.poll(()=>page.evaluate(()=>window.OcculertStartup?.isReady())).toBe(true);
    const actual=await runBrowserTrace(page,syntheticScoringTrace(7),true),replay=replayScoring(actual.trace),released=replay.variants.find(row=>row.name==='released');
    expect(actual.trace.version).toBe(2);expect(released.status).toBe('available');expect(released.clockFallbacks).toEqual({});
    expect(released.samples.map(row=>[row.fatigue,row.confidence])).toEqual(actual.result.map(row=>row.slice(0,2)));
    expect(released.alerts.map(row=>row.at_ms)).toEqual(actual.trace.legacyAlerts.map(row=>row.atMs));
});

test('calibration-only flag is non-primary, identified and blocks actual cloud entrypoints',async({page})=>{
    const calls=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))calls.push(request.url());});
    await page.goto('/app.html?calibration-min=12&event-outbox=1');await expect.poll(()=>page.evaluate(()=>window.OcculertStartup?.isReady())).toBe(true);
    await expect(page.locator('#cloudConsent')).toBeDisabled();
    const result=await page.evaluate(async()=>{cloudConsent.checked=true;cloudReady=true;running=true;sessionStart=Date.now();
        const id=await beginBackendSession();queueBackendEvent('drowsy');await pushFleet(true,{});await initCloud();
        return {id,minimum:calibrationMinimumSamples,primary:experimentFlags.primary,names:experimentFlags.names,cloudReady,version:fleetPayload().detectorVersion};});
    expect(result).toEqual({id:null,minimum:12,primary:false,names:['calibrationMin'],cloudReady:false,version:'web-v81:parked:calibrationMin'});expect(calls).toEqual([]);
});
