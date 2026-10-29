// Local counterfactual decisions from recorded signals, never generated labels.
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toCsv } from './prepare-dataset.mjs';
import { validateProvenance } from './parked-detection-trace.mjs';
import { sourceSnapshot, contentSha256 } from './provenance.mjs';
import { scoringSmooth, scoringNodHistory, scoringNodDetected, scoringResetContinuity, scoringSensitivityThresholds,
    scoringEyeMetrics, scoringAlertCandidate, scoringDistractionMatured, scoringTriggerEligible } from '../src/scoring-core.js';
import { scoringUpdateCalibration, scoringReplayFrame } from './scoring-step.mjs';

export const REPLAY_EPOCH_MS = 1700000000000;
export const scoringVariants = Object.freeze([
    { name: 'released', query: '' },
    { name: 'fatigue-timing-elapsed', query: '?fatigue-timing=elapsed' },
    { name: 'perclos-time', query: '?perclos=time' },
    { name: 'calibration-min-12', query: '?calibration-min=12', minimumSamples: 12 },
    { name: 'noface-escalation-1', query: '?noface-escalation=1' },
    { name: 'distraction-confidence-stable', query: '?distraction-confidence=stable' },
].map(Object.freeze));
const stateKeys = ['fatigue','confidence','maxFatigue','fatigueSampleSum','fatigueSampleCount','perclosWindow','eyesClosedSince','microsleeps','lastMicro','turnedSince','totalDistractionMs','noFaceSince','lastFaceSeen','calibrating','calibrated','calibrationUntil','calibrationSamples','baselineEAR','baseClosedThreshold','baseWatchThreshold','eyeClosedThreshold','eyeWatchThreshold','lastAlert','earHistory','noseYHistory','lastNod','headNods'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const settingsValid = value => exactKeys(value, ['sensitivity','minimumSamples'])
    && ['low','medium','high'].includes(value.sensitivity) && [1,12].includes(value.minimumSamples);
const offset = sensitivity => ({ low: -.03, medium: 0, high: .03 })[sensitivity];
const clockPhases = ['score','calibration','eye','distraction','nodSample','nodDecision','eligibility','trigger'];
function stateValid(state) {
    if (!exactKeys(state, stateKeys)) return false;
    for (const key of stateKeys.filter(key => !['calibrating','calibrated','perclosWindow','calibrationSamples','earHistory','noseYHistory'].includes(key))) {
        if (!finite(state[key])) return false;
    }
    if (typeof state.calibrating !== 'boolean' || typeof state.calibrated !== 'boolean'
        || ![state.fatigue,state.confidence,state.maxFatigue].every(value => value >= 0 && value <= 100)
        || !['fatigueSampleCount','microsleeps','headNods'].every(key => Number.isSafeInteger(state[key]) && state[key] >= 0)) return false;
    return Array.isArray(state.earHistory) && state.earHistory.length <= 6 && state.earHistory.every(finite)
        && Array.isArray(state.calibrationSamples) && state.calibrationSamples.length <= 20000 && state.calibrationSamples.every(finite)
        && Array.isArray(state.perclosWindow) && state.perclosWindow.length <= 20000
        && state.perclosWindow.every(row => exactKeys(row,['t','closed']) && finite(row.t) && typeof row.closed === 'boolean')
        && Array.isArray(state.noseYHistory) && state.noseYHistory.length <= 10
        && state.noseYHistory.every(row => exactKeys(row,['t','y']) && finite(row.t) && finite(row.y));
}
function capability(trace) {
    const session = trace?.session;
    if (trace?.schema !== 'occulert.parked-detection-trace' || ![1,2].includes(trace.version)
        || session?.platform !== 'web' || !/^[A-Za-z0-9_-]{1,128}$/.test(session.sessionId ?? '')
        || !finite(session.durationMs) || session.durationMs <= 0 || !Array.isArray(trace.samples) || trace.samples.length > 20000) throw Error('Invalid parked trace header');
    validateProvenance(session);
    if (trace.version === 1) return { reason: 'Trace v1 omits initial scoring state and face/turn/nod/clock inputs; replay is unavailable.' };
    if (session.geometryUnits !== 'normalized' || session.experimentFlags.includes('pixels') || session.experimentFlags.includes('pitch'))
        return { reason: 'Pixel/pitch preprocessing cannot be converted to normalized released signals without the original landmarks.' };
    const replay = trace.scoringReplay;
    if (!exactKeys(replay, ['version','epochMs','initialState','initialSettings','frames','controls','droppedFrames','droppedControls','invalidatedFrames'])
        || replay.version !== 1 || replay.epochMs !== REPLAY_EPOCH_MS || !stateValid(replay.initialState)
        || !settingsValid(replay.initialSettings) || !Array.isArray(replay.frames) || !Array.isArray(replay.controls)
        || replay.frames.length > 2400 || replay.controls.length > 256
        || !['droppedFrames','droppedControls','invalidatedFrames'].every(key => Number.isSafeInteger(replay[key]) && replay[key] >= 0)) throw Error('Invalid scoring replay metadata');
    if (replay.droppedFrames || replay.droppedControls || replay.invalidatedFrames || session.droppedFrames
        || replay.frames.length !== trace.samples.length || !replay.frames.length)
        return { reason: 'The complete scoring prefix was not retained; no missing frames or state are fabricated.' };
    const orders = new Set();
    let previousId = 0, previousAt = -1;
    for (let index = 0; index < replay.frames.length; index++) {
        const row = replay.frames[index], sample = trace.samples[index];
        if (!exactKeys(row, ['order','frameId','atMs','wallMs','rawEar','ear','hasFace','faceMissing','turned','nod','noseY','sensitivity','clocks'])
            || row.frameId !== previousId + 1 || row.frameId !== sample?.frameId || !finite(sample.atMs) || sample.atMs < 0
            || !finite(row.atMs) || row.atMs < sample.atMs || row.atMs < previousAt || row.atMs > session.durationMs
            || !finite(row.wallMs) || Math.abs(row.wallMs) > 8e15 || !['low','medium','high'].includes(row.sensitivity)
            || !['hasFace','faceMissing','turned','nod'].every(key => typeof row[key] === 'boolean')
            || !row.clocks || typeof row.clocks !== 'object' || Array.isArray(row.clocks)
            || !row.clocks.score || row.clocks.score.wallMs !== row.wallMs
            || Object.entries(row.clocks).some(([phase,point]) => !clockPhases.includes(phase)
                || !exactKeys(point,['wallMs','atMs']) || !finite(point.wallMs) || Math.abs(point.wallMs)>8e15 || !finite(point.atMs)
                || point.atMs < sample.atMs || point.atMs > session.durationMs)) throw Error('Invalid or missing scoring frame');
        if (row.hasFace && (row.faceMissing || !finite(row.rawEar) || row.rawEar <= 0 || row.rawEar > 1 || !finite(row.ear) || !finite(row.noseY)))
            return { reason: 'A tracked observation has invalid or missing raw EAR/nose signals; no healthy/open state is invented.' };
        if (!row.hasFace && (!row.faceMissing || row.rawEar !== null || row.ear !== null || row.noseY !== null || row.turned || row.nod))
            return { reason: 'Invalid tracked-face geometry is distinct from face absence and cannot be reconstructed from this trace.' };
        if (!Number.isSafeInteger(row.order) || row.order <= 0 || orders.has(row.order)) throw Error('Invalid replay ordering');
        orders.add(row.order); previousId = row.frameId; previousAt = row.atMs;
    }
    for (const row of replay.controls) {
        if (!exactKeys(row, ['order','atMs','wallMs','kind','state','settings']) || row.kind !== 'recalibrate' || !stateValid(row.state)
            || !settingsValid(row.settings) || !Number.isSafeInteger(row.order) || row.order <= 0 || orders.has(row.order)
            || !finite(row.atMs) || row.atMs < 0 || row.atMs > session.durationMs || !finite(row.wallMs)) throw Error('Invalid replay control');
        orders.add(row.order);
    }
    const timeline = [...replay.frames.map(row => ({ ...row, kind: 'frame' })), ...replay.controls].sort((a,b) => a.order - b.order);
    if (timeline.some((row,index) => index && row.atMs < timeline[index-1].atMs)) throw Error('Replay ordering contradicts its monotonic clock');
    return { replay, timeline };
}
function loadModels() {
    const name = 'src/detection-experiments.js', bytes = readFileSync(new URL('../' + name, import.meta.url));
    const sandbox = { module: { exports: {} }, URLSearchParams };
    vm.runInNewContext(bytes.toString('utf8'), sandbox);
    return { models: sandbox.module.exports, path: name, sha256: contentSha256(bytes) };
}
function runVariant(initial, initialSettings, timeline, variant, models) {
    let state = structuredClone(initial), mono = 0, wall = REPLAY_EPOCH_MS, sensitivity = initialSettings.sensitivity, currentRow = null;
    const flags = models.parseFlags(variant.query), alerts = [], samples = [], minimumSamples = variant.minimumSamples ?? 1;
    const clockFallbacks = {};
    const point = phase => {
        const captured = currentRow?.clocks?.[phase];
        if (captured) return { wall: REPLAY_EPOCH_MS + captured.wallMs, atMs: captured.atMs };
        if (currentRow && phase !== 'score') clockFallbacks[phase] = (clockFallbacks[phase] ?? 0) + 1;
        return { wall, atMs: mono };
    };
    const applySensitivity = () => Object.assign(state, scoringSensitivityThresholds(state.baseClosedThreshold, state.baseWatchThreshold, offset(sensitivity)));
    let controller;
    const accept = (reason, eligibility) => {
        const qualified = flags.noface && reason === 'Face lost after fatigue' && controller.qualifiedLoss(eligibility);
        const at = point('trigger');
        if (!scoringTriggerEligible(state, at.wall, Boolean(qualified))) return;
        state.lastAlert = at.wall; alerts.push({ at_ms: at.atMs, reason });
    };
    const noop = () => {};
    controller = models.createController({ read: () => ({ ...state }), write: value => Object.assign(state,value),
        now: () => mono, wallNow: phase => point(phase ?? 'score').wall, calibrationMs: 3200, dimensions: () => ({width:360,height:480}),
        applySensitivity, resetContinuous: () => Object.assign(state,scoringResetContinuity(state)),
        defaultCalibration: ear => Object.assign(state,scoringUpdateCalibration(state,ear,point('calibration').wall,minimumSamples,offset(sensitivity))),
        defaultEyeMetrics: (ear,turned) => { const result = scoringEyeMetrics(state,ear,turned,point('eye').wall); Object.assign(state,result.state); return result.perclos; },
        alert: accept, log: noop, render: noop, ui: {face:noop,perclos:noop,microsleeps:noop,distraction:noop,calibration:noop,tasks:noop},
    }, flags);
    controller.begin();
    for (const row of timeline) {
        currentRow = row;
        mono = row.atMs; wall = REPLAY_EPOCH_MS + row.wallMs;
        if (row.kind === 'recalibrate') {
            sensitivity = row.settings.sensitivity;
            for (const key of ['calibrating','calibrated','calibrationUntil','calibrationSamples','baselineEAR','baseClosedThreshold','baseWatchThreshold']) state[key] = structuredClone(row.state[key]);
            state.earHistory = []; applySensitivity();
            // The live entry calls the helper only for a selected parked flag.
            if (flags.any) controller.recalibrate();
            continue;
        }
        if (sensitivity !== row.sensitivity) { sensitivity = row.sensitivity; applySensitivity(); }
        if (flags.primary) controller.prepareObservation(mono,row.hasFace,row.faceMissing);
        let ear = 0, nod = false;
        if (row.hasFace) {
            const smooth = scoringSmooth(state.earHistory,row.rawEar); state.earHistory = smooth.samples; ear = smooth.ear;
            if (!state.calibrating) {
                state.noseYHistory = scoringNodHistory(state.noseYHistory,row.noseY,point('nodSample').wall);
                const nodTime = state.noseYHistory.length >= 8 ? point('nodDecision').wall : wall;
                nod = scoringNodDetected(state.noseYHistory,state.lastNod,nodTime);
                if (nod) { state.lastNod = nodTime; state.headNods++; }
            }
        }
        if (flags.primary) controller.score(ear,row.turned,nod,row.hasFace,null,row.noseY,row.faceMissing,true);
        else state = scoringReplayFrame(state,{ear,turned:row.turned,nod,hasFace:row.hasFace,
            ...(row.hasFace && state.calibrating ? { calibrationNowMs: point('calibration').wall } : {}),
            ...(row.hasFace && !state.calibrating ? { eyeNowMs: point('eye').wall } : {})},wall,
            { minimumSamples, sensitivityOffset: offset(sensitivity), stableDistraction: flags.distractionConfidence });
        const candidate = row.hasFace && scoringAlertCandidate(state);
        const reason = candidate === 'Distraction' ? scoringDistractionMatured(state,point('eligibility').wall) && candidate : candidate;
        if (reason) accept(reason);
        samples.push({ frame_id: row.frameId, at_ms: mono, fatigue: state.fatigue, confidence: state.confidence,
            calibrated: state.calibrated, perclos_samples: state.perclosWindow.length });
    }
    return { alerts, samples, finalState: state, clockFallbacks };
}

export function replayScoring(trace) {
    const support = capability(trace);
    const source = loadModels();
    const variants = scoringVariants.map(variant => support.reason
        ? { ...variant, status: 'unavailable', reason: support.reason }
        : { ...variant, status: 'available', ...runVariant(support.replay.initialState,support.replay.initialSettings,support.timeline,variant,source.models) });
    return { schema: 'occulert.scoring-replay', version: 1, sessionId: trace.session.sessionId,
        decisionClock: 'recorded named phase clocks where observed; monotonic at_ms, normalized nonzero wall-clock epoch with zero sentinels preserved',
        counterfactualTimingLimit: 'A phase absent under the recording rules uses that observation clock and is counted in clockFallbacks. Exact sub-frame timing is not known for those counterfactual decisions.',
        signalPolicy: 'raw normalized EAR and nose/turn observations; per-variant six-frame smoothing, nod history and continuity; no interpolation',
        labelsGenerated: false, promotion: 'none', helper: { path: source.path, sha256: source.sha256 }, variants };
}

export async function writeScoringReplay(trace, directory, traceBytes = JSON.stringify(trace)) {
    const result = replayScoring(trace);
    // Never leave older alerts next to a new unavailable manifest.
    await mkdir(dirname(directory),{recursive:true});
    await mkdir(directory);
    for (const variant of result.variants) {
        if (variant.status !== 'available') continue;
        const output = join(directory,variant.name); await mkdir(output,{recursive:true});
        await writeFile(join(output,'alerts.csv'),toCsv(['session_id','at_ms'],variant.alerts.map(row => ({session_id:result.sessionId,at_ms:row.at_ms})))+'\n');
        await writeFile(join(output,'scoring.csv'),toCsv(['frame_id','at_ms','fatigue','confidence','calibrated','perclos_samples'],variant.samples)+'\n');
    }
    const source = readFileSync(new URL('../src/scoring-core.js',import.meta.url));
    const manifest = { ...result, variants: result.variants.map(({alerts,samples,finalState,...variant}) => ({...variant,
        ...(alerts ? { alerts: alerts.length, frames: samples.length } : {})})), traceSha256:contentSha256(traceBytes),
        scoringCoreSha256:createHash('sha256').update(source).digest('hex'), ...sourceSnapshot(['replay-scoring.mjs','scoring-step.mjs','parked-detection-trace.mjs']) };
    await writeFile(join(directory,'replay-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--trace' || args[2] !== '--out') throw Error('Usage: --trace local.json --out fresh-directory');
    const bytes = await readFile(args[1]);
    if (bytes.byteLength > 20_000_000) throw Error('Trace exceeds the local replay input bound');
    const result = await writeScoringReplay(JSON.parse(bytes),args[3],bytes);
    console.log(JSON.stringify({ sessionId:result.sessionId,variants:result.variants },null,2));
}
