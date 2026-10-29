// Independent executable oracle: function bodies and caller eligibility come
// from retained immutable released bytes, never from scoring-core or a rewrite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parse } from 'acorn';

export const SCORING_EPOCH = 1_700_000_000_000;
export function initialScoringState(overrides = {}) {
    return { fatigue: 0, confidence: 0, maxFatigue: 0, fatigueSampleSum: 0, fatigueSampleCount: 0,
        perclosWindow: [], eyesClosedSince: 0, microsleeps: 0, lastMicro: 0, turnedSince: 0,
        totalDistractionMs: 0, noFaceSince: 0, lastFaceSeen: 0, calibrating: true, calibrated: false,
        calibrationUntil: SCORING_EPOCH + 3200, calibrationSamples: [], baselineEAR: .28,
        baseClosedThreshold: .18, baseWatchThreshold: .22, eyeClosedThreshold: .18, eyeWatchThreshold: .22,
        lastAlert: 0, ...overrides };
}

export function syntheticScoringTrace(fps) {
    return Array.from({ length: 100 * fps + 1 }, (_, index) => {
        const atMs = Math.round(index * 1000 / fps);
        return { atMs, hasFace: !(atMs >= 38000 && atMs < 45000),
            ear: atMs >= 10000 && atMs < 20000 || atMs >= 45000 && atMs < 50000 || atMs >= 70000 && atMs < 85000 ? .10 : .30,
            turned: atMs >= 28000 && atMs < 38000 || atMs >= 50000 && atMs < 70000,
            nod: index === 46 * fps };
    });
}

export function createReleasedScoringOracle({ path = new URL('../driver-app.v97.js', import.meta.url), source, state = initialScoringState(), minimumSamples = 1, sensitivity = 'medium', clockStepMs = 0 } = {}) {
    const bytes = source === undefined ? readFileSync(path) : Buffer.from(source), code = bytes.toString('utf8');
    if (source === undefined && String(path).endsWith('driver-app.v97.js')) {
        const integrity = JSON.parse(readFileSync(new URL('../asset-integrity.json', import.meta.url), 'utf8'));
        const expected = integrity['driver-app.v97.js'] ?? integrity.assets?.['driver-app.v97.js'];
        assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, 'Oracle must execute the retained immutable v97 bytes');
    }
    const ast = parse(code, { ecmaVersion: 2022, sourceType: 'script' });
    const names = ['updateScore', 'updateEyeMetrics', 'resetContinuousObservations', 'updateCalibration', 'finishCalibration', 'applySensitivity', 'trigger'];
    const functions = ast.body.filter(node => node.type === 'FunctionDeclaration' && (names.includes(node.id.name) || node.id.name.startsWith('scoring')));
    assert.ok(names.every(name => functions.some(node => node.id.name === name)), 'Released scoring functions must remain identifiable');
    const onResults = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'onResults');
    const eligible = onResults.body.body.find(node => node.type === 'IfStatement' && code.slice(node.start, node.end).includes("trigger('Fatigue')"));
    assert.ok(eligible, 'Execute the actual released caller eligibility expression');
    const noop = () => {}, element = () => ({ textContent: '', style: {}, classList: { add: noop, remove: noop, toggle: noop } });
    let now = SCORING_EPOCH;
    const alerts = [], logs = [], context = { ...structuredClone(state), Date: class extends Date { static now() { const value = now; now += clockStepMs; return value; } },
        Math, experimentFlags: { primary: false, distractionConfidence: false, noface: false, pixels: false }, experimentController: null,
        running: true, calibrationMinimumSamples: minimumSamples, sensitivityLevel: sensitivity, CALIBRATION_MS: 3200,
        SENSITIVITY_PRESETS: { low: { offset: -.03 }, medium: { offset: 0 }, high: { offset: .03 } },
        earHistory: [], noseYHistory: [], _mouthOpenSince: 0, _marHist: [], alerts: 0, escalationLevel: 0, lastEscalation: 0,
        strongAlertPattern: false, nightOpacity: { value: '40' }, navigator: {}, setTimeout: noop,
        document: { getElementById: () => null, querySelectorAll: () => [] },
        getAC: () => null, tone: noop, pushFleet: noop, setPreference: noop,
        log: value => logs.push(value), acceptedAlertHook: reason => alerts.push({ atMs: context.lastAlert - SCORING_EPOCH, reason }) };
    for (const name of ['faceStateEl', 'perclosEl', 'microsleepsEl', 'distractionEl', 'calibrationEl', 'calibrationFill', 'calHint', 'alertsEl', 'alertTitle', 'alertSub', 'alertScreen']) context[name] = element();
    for (const name of Object.keys(context)) context['set_' + name] = value => (context[name] = value);
    vm.createContext(context);
    vm.runInContext(functions.map(node => code.slice(node.start, node.end)).join('\n') + '\nfunction runCallerEligibility(){' + code.slice(eligible.start, eligible.end) + '}', context);
    return { alerts, logs, context, step(frame) {
        now = SCORING_EPOCH + frame.atMs;
        context.updateScore(frame.ear, frame.turned, frame.nod, frame.hasFace);
        if (frame.hasFace) context.runCallerEligibility();
        return Object.fromEntries(Object.keys(state).map(key => [key, structuredClone(context[key])]));
    } };
}
