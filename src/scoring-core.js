// Pure released scoring rules. Clocks, signals, calibration and sensitivity are
// explicit inputs; rendering, alert delivery and persistence stay with callers.
export function scoringCalibrationThresholds(samples, minimumSamples) {
    if (samples.length < minimumSamples)
        return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = sorted.slice(Math.floor(sorted.length * .2), Math.ceil(sorted.length * .8));
    const baseline = middle.reduce((a, b) => a + b, 0) / middle.length;
    const closedThreshold = Math.max(.12, Math.min(.22, baseline * .66));
    return { baselineEAR: baseline, baseClosedThreshold: closedThreshold,
        baseWatchThreshold: Math.max(closedThreshold + .025, Math.min(.28, baseline * .82)) };
}

export function scoringSensitivityThresholds(baseClosedThreshold, baseWatchThreshold, offset, factor = 1) {
    const closedThreshold = Math.max(.10 * factor, Math.min(.25 * factor, baseClosedThreshold + offset * factor));
    return { eyeClosedThreshold: closedThreshold,
        eyeWatchThreshold: Math.max(closedThreshold + .025 * factor, Math.min(.31 * factor, baseWatchThreshold + offset * factor)) };
}

export function scoringResetContinuity(state) {
    return { ...state, totalDistractionMs: state.totalDistractionMs + (state.turnedSince ? Math.max(0, state.lastFaceSeen - state.turnedSince) : 0),
        turnedSince: 0, eyesClosedSince: 0 };
}

export function scoringNoFace(state, nowMs) {
    const absenceSince = state.noFaceSince || nowMs;
    return { ...state, noFaceSince: absenceSince, confidence: Math.max(0, state.confidence - 10),
        fatigue: absenceSince && nowMs - absenceSince > 3500 ? Math.max(0, state.fatigue - 2) : state.fatigue };
}

export function scoringCalibrationFrame(state) {
    return { ...state, confidence: Math.min(100, state.confidence + 2), fatigue: Math.max(0, state.fatigue - 2) };
}

export function scoringConfidence(state, turned, stableDistraction = false) {
    return Math.min(100, state.confidence + (state.calibrated || stableDistraction && turned ? 5 : 3));
}

export function scoringEyeMetrics(state, ear, turned, nowMs, liveNowMs = nowMs) {
    const next = { ...state }, closed = ear < state.eyeClosedThreshold;
    next.perclosWindow = [...state.perclosWindow, { t: nowMs, closed }].filter(row => nowMs - row.t < 60000);
    const perclos = next.perclosWindow.length ? Math.round(next.perclosWindow.filter(row => row.closed).length / next.perclosWindow.length * 100) : 0;
    if (closed && !next.eyesClosedSince)
        next.eyesClosedSince = nowMs;
    if (!closed)
        next.eyesClosedSince = 0;
    const microsleep = Boolean(next.eyesClosedSince && nowMs - next.eyesClosedSince > 1500 && nowMs - next.lastMicro > 3000 && next.confidence > 45);
    if (microsleep) {
        next.microsleeps++;
        next.lastMicro = nowMs;
    }
    if (turned && !next.turnedSince)
        next.turnedSince = nowMs;
    if (!turned && next.turnedSince) {
        next.totalDistractionMs += nowMs - next.turnedSince;
        next.turnedSince = 0;
    }
    return { state: next, perclos, microsleep,
        distractionSeconds: scoringDistractionSeconds(next, liveNowMs) };
}

export function scoringDistractionSeconds(state, nowMs) {
    return Math.round((state.totalDistractionMs + (state.turnedSince ? nowMs - state.turnedSince : 0)) / 1000);
}

export function scoringTrackedFrame(state, frame, nowMs) {
    const next = { ...state };
    if (frame.turned) {
        next.confidence = Math.max(35, next.confidence - 5);
        if (next.turnedSince && nowMs - next.turnedSince > 3000)
            next.fatigue += 2;
        else
            next.fatigue = Math.max(0, next.fatigue - 1);
    } else {
        if (frame.nod)
            next.fatigue += 18;
        if (frame.ear < next.eyeClosedThreshold * .82)
            next.fatigue += 9;
        else if (frame.ear < next.eyeClosedThreshold)
            next.fatigue += 6;
        else if (frame.ear < next.eyeWatchThreshold)
            next.fatigue += 2;
        else
            next.fatigue -= 3;
        if (frame.perclos > 45)
            next.fatigue += 8;
        else if (frame.perclos > 30)
            next.fatigue += 5;
        else if (frame.perclos > 18)
            next.fatigue += 2;
        if (next.lastMicro && nowMs - next.lastMicro < 30000)
            next.fatigue++;
        if (next.confidence < 45)
            next.fatigue++;
    }
    next.fatigue = Math.max(0, Math.min(100, next.fatigue));
    next.maxFatigue = Math.max(next.maxFatigue, next.fatigue);
    next.fatigueSampleSum += next.fatigue;
    next.fatigueSampleCount++;
    return next;
}

export function scoringAlertCandidate(state) {
    if (!state.calibrating && state.confidence >= 45 && state.fatigue >= 80)
        return 'Fatigue';
    if (!state.calibrating && state.confidence >= 45 && state.turnedSince)
        return 'Distraction';
    return null;
}

export function scoringDistractionMatured(state, nowMs) {
    return nowMs - state.turnedSince > 6500;
}

export function scoringAlertReason(state, nowMs) {
    const candidate = scoringAlertCandidate(state);
    return candidate === 'Fatigue' || candidate === 'Distraction' && scoringDistractionMatured(state, nowMs) ? candidate : null;
}

/** @param {{lastAlert:number,calibrating:boolean,confidence:number}} state
 * @param {number} nowMs @param {boolean} [qualifiedLoss] */
export function scoringTriggerEligible(state, nowMs, qualifiedLoss = false) {
    return !(nowMs - state.lastAlert < 12000 || state.calibrating || state.confidence < 45 && !qualifiedLoss);
}

// Replay composes the same pure phases used by the live adapters. This does not
// derive face/turn/nod, smooth EAR, invent calibration, or create ground truth.
export function scoringReplayFrame(state, frame, nowMs, options) {
    let next = { ...state, calibrationSamples: [...state.calibrationSamples] };
    if (!frame.hasFace)
        return scoringNoFace(scoringResetContinuity(next), nowMs);
    next.noFaceSince = 0;
    next.lastFaceSeen = nowMs;
    if (next.calibrating) {
        if (frame.ear > .16 && frame.ear < .45)
            next.calibrationSamples.push(frame.ear);
        if (Math.max(0, next.calibrationUntil - nowMs) <= 0) {
            const thresholds = scoringCalibrationThresholds(next.calibrationSamples, options.minimumSamples);
            if (thresholds) {
                next.calibrationSamples.sort((a, b) => a - b);
                Object.assign(next, thresholds);
            }
            next.calibrating = false;
            next.calibrated = thresholds !== null;
            Object.assign(next, scoringSensitivityThresholds(next.baseClosedThreshold, next.baseWatchThreshold, options.sensitivityOffset));
        }
        return scoringCalibrationFrame(next);
    }
    next.confidence = scoringConfidence(next, frame.turned, options.stableDistraction);
    const metrics = scoringEyeMetrics(next, frame.ear, frame.turned, nowMs);
    return scoringTrackedFrame(metrics.state, { ...frame, perclos: metrics.perclos }, nowMs);
}
