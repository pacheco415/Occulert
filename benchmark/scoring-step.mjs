// Offline orchestration imports the actual pure phases; it is not shipped.
import { scoringCalibrationSamples, scoringCalibrationThresholds, scoringSensitivityThresholds, scoringNoFace, scoringResetContinuity, scoringCalibrationFrame, scoringConfidence, scoringEyeMetrics, scoringObservedEyeMetrics, scoringTrackedFrame, scoringAlertCandidate, scoringDistractionMatured } from '../src/scoring-core.js';

export function scoringUpdateCalibration(state, ear, nowMs, minimumSamples, sensitivityOffset) {
    const next = { ...state, calibrationSamples: [...state.calibrationSamples] };
    if (!next.calibrating) return next;
    next.calibrationSamples = scoringCalibrationSamples(next.calibrationSamples, ear);
    if (Math.max(0, next.calibrationUntil - nowMs) <= 0) {
        const thresholds = scoringCalibrationThresholds(next.calibrationSamples, minimumSamples);
        if (thresholds) {
            next.calibrationSamples.sort((a, b) => a - b);
            Object.assign(next, thresholds);
        }
        next.calibrating = false;
        next.calibrated = thresholds !== null;
        Object.assign(next, scoringSensitivityThresholds(next.baseClosedThreshold, next.baseWatchThreshold, sensitivityOffset));
    }
    return next;
}

export function scoringAlertReason(state, nowMs) {
    const candidate = scoringAlertCandidate(state);
    return candidate === 'Fatigue' || candidate === 'Distraction' && scoringDistractionMatured(state, nowMs) ? candidate : null;
}

export function scoringReplayFrame(state, frame, nowMs, options) {
    let next = { ...state, calibrationSamples: [...state.calibrationSamples] };
    if (!frame.hasFace)
        return scoringNoFace(scoringResetContinuity(next), nowMs);
    next.noFaceSince = 0;
    next.lastFaceSeen = nowMs;
    if (next.calibrating) {
        if (options.tasksBlink) return scoringCalibrationFrame(next);
        return scoringCalibrationFrame(scoringUpdateCalibration(next, frame.ear, frame.calibrationNowMs ?? nowMs, options.minimumSamples, options.sensitivityOffset));
    }
    next.confidence = scoringConfidence(next, frame.turned, options.stableDistraction);
    const eyeNow = frame.eyeNowMs ?? nowMs;
    if (options.tasksBlink) {
        const closed = frame.eyeClosed;
        const metrics = scoringObservedEyeMetrics(next, closed, frame.turned, eyeNow);
        const eyePoints = closed === null ? 0 : closed ? 6 : -3;
        return scoringTrackedFrame(metrics.state, { ...frame, perclos: closed === null ? null : metrics.perclos },
            nowMs, options.holdTurnFatigue, eyePoints);
    }
    const metrics = scoringEyeMetrics(next, frame.ear, frame.turned, eyeNow, options.excludeTurned);
    return scoringTrackedFrame(metrics.state, { ...frame, perclos: metrics.perclos }, nowMs, options.holdTurnFatigue);
}
