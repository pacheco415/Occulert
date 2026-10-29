// Test fixture executes actual composed driver adapters and the actual helper.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildDriverArtifact } from './driver-build.mjs';
import { fileURLToPath } from 'node:url';
import { traceContract } from '../../benchmark/parked-detection-trace.mjs';
import { createReleasedScoringOracle, initialScoringState, syntheticScoringTrace, SCORING_EPOCH } from '../../benchmark/released-scoring-oracle.mjs';

const compiled = await buildDriverArtifact({ sourceRoot: fileURLToPath(new URL('../../src',import.meta.url)),
    contractPath: fileURLToPath(new URL('../../source-driver-contract.json',import.meta.url)) });
export function recordScoringFixture({ fps = 7, clockStepMs = 0, frames = syntheticScoringTrace(fps), state = initialScoringState(), query = '?observer=1', sensitivity = 'medium', minimumSamples = 1 } = {}) {
    const sandbox = { module:{exports:{}},URLSearchParams };
    vm.runInNewContext(readFileSync(new URL('../../src/detection-experiments.js',import.meta.url),'utf8'),sandbox);
    const models = sandbox.module.exports, flags = models.parseFlags(query);
    const original = createReleasedScoringOracle({ source:compiled.code,state,clockStepMs,sensitivity,minimumSamples });
    const context = original.context, fields = Object.keys(state), recorded = [], decisions = [];
    let time = 0, current = null;
    const snapshot = () => Object.fromEntries(fields.map(key => [key,context[key]]));
    const noop = () => {};
    const controller = models.createController({ read:() => ({...snapshot(),running:context.running,localSessionId:'scoring-fixture'}),
        write:value => Object.assign(context,value),scoringState:snapshot,scoringSettings:() => ({sensitivity,minimumSamples}),
        now:() => time,wallNow:phase => context.scoringReadWallClock(phase),calibrationMs:3200,
        dimensions:() => ({width:360,height:480}),applySensitivity:() => context.applySensitivity(sensitivity),
        resetContinuous:() => context.resetContinuousObservations(),defaultCalibration:ear => context.updateCalibration(ear),
        defaultEyeMetrics:(ear,turned) => context.updateEyeMetrics(ear,turned),alert:(reason,eligibility) => context.trigger(reason,eligibility),
        log:noop,render:noop,tracking:noop,clearEyes:noop,resetMouth:noop,draw:noop,otherFaceMetrics:noop,
        calcEAR:() => current.rawEar ?? current.ear,headTurn:() => current.turned,
        smooth:value => context.smooth(value),detectNod:landmarks => context.detectHeadNod(landmarks),
        ui:{face:noop,perclos:noop,microsleeps:noop,distraction:noop,calibration:noop,tasks:noop,observer:noop},
        detectorVersion:() => traceContract.detectorPrefix + flags.names.join('+'),
        provenance:() => ({runtimeVersion:traceContract.runtimeVersion,helperIntegrity:traceContract.helperIntegrity,
            runtimePins:traceContract.runtimePins,modelIntegrity:traceContract.modelIntegrity}),
    },flags);
    context.experimentFlags = flags;
    context.experimentController = flags.any ? controller : null;
    const accepted = context.acceptedAlertHook;
    context.acceptedAlertHook = reason => { accepted(reason); decisions.push({at_ms:time,reason}); controller.recordAlert(reason); };
    controller.begin();
    for (const frame of frames) {
        time = frame.atMs; current = {...frame,rawEar:frame.rawEar ?? frame.ear,noseY:frame.noseY ?? .55};
        if (frame.sensitivity) { sensitivity=frame.sensitivity;context.applySensitivity(sensitivity); }
        if (frame.recalibrate) {
            original.setClock(time);
            Object.assign(context,{baselineEAR:.28,baseClosedThreshold:.18,baseWatchThreshold:.22,eyeClosedThreshold:.18,eyeWatchThreshold:.22,
                calibrating:true,calibrated:false,calibrationSamples:[],calibrationUntil:SCORING_EPOCH+time+3200,earHistory:[]});
            context.applySensitivity(sensitivity);if(flags.any)controller.recalibrate();
        }
        controller.capture({currentTime:time/1000});
        if (flags.primary) {
            // The real results entry validates/prepares raw observations before
            // smoothing/nod extraction, unlike calling score on derived inputs.
            original.setClock(time);
            const landmarks = Array.from({length:468},() => ({x:.5,y:.5}));
            landmarks[4].y = current.noseY;
            controller.results({multiFaceLandmarks:frame.hasFace?[landmarks]:[]});
        } else original.step({...current});
        recorded.push({frame_id:frame.atMs,fatigue:context.fatigue,confidence:context.confidence,calibrated:context.calibrated});
        if (!flags.primary) controller.recordResults({multiFaceLandmarks:frame.hasFace?[[]]:[]},frame.hasFace?current.rawEar:null,
            frame.hasFace?context.earHistory.reduce((a,b)=>a+b,0)/context.earHistory.length:null,current.turned);
    }
    time = Math.max(1,frames.at(-1)?.atMs ?? 1); context.running = false; controller.stop();
    return {trace:JSON.parse(JSON.stringify(controller.exportData())),recorded,finalState:structuredClone(snapshot()),alerts:original.alerts,decisions};
}
