import "./camera.js";
import "./detector.js";
import "./metrics.js";
import "./alerts.js";
import "./storage-history.js";
import "./cloud-sync.js";
import { calibrationMinimumSamples, experimentFlags, calibrationEl, calibrationFill, calHint, calibrating, calibrationUntil, calibrationSamples, baselineEAR, baseClosedThreshold, baseWatchThreshold, eyeClosedThreshold, CALIBRATION_MS, log, SENSITIVITY_PRESETS, set_calibrating, set_calibrated, set_baselineEAR, set_baseClosedThreshold, set_baseWatchThreshold, set_eyeClosedThreshold, set_eyeWatchThreshold } from "./ui.js";
export function finishCalibration() {
    if (calibrationSamples.length < calibrationMinimumSamples) {
        set_calibrating(false);
        set_calibrated(false);
        calibrationEl.textContent = 'DEFAULT';
        calibrationFill.style.width = '100%';
        if (typeof applySensitivity === 'function')
            applySensitivity(localStorage.getItem('occulert-sensitivity') || 'medium');
        if (calHint)
            calHint.textContent = 'Using default thresholds.';
        log('Calibration used default thresholds');
        const rb2 = document.getElementById('recalBtn');
        if (rb2)
            rb2.style.display = 'block';
        return;
    }
    calibrationSamples.sort((a, b) => a - b);
    let mid = calibrationSamples.slice(Math.floor(calibrationSamples.length * .2), Math.ceil(calibrationSamples.length * .8));
    set_baselineEAR(mid.reduce((a, b) => a + b, 0) / mid.length);
    set_baseClosedThreshold(Math.max(.12, Math.min(.22, baselineEAR * .66)));
    set_baseWatchThreshold(Math.max(baseClosedThreshold + .025, Math.min(.28, baselineEAR * .82)));
    if (typeof applySensitivity === 'function')
        applySensitivity(localStorage.getItem('occulert-sensitivity') || 'medium');
    set_calibrated(true);
    set_calibrating(false);
    calibrationEl.textContent = 'DONE';
    calibrationFill.style.width = '100%';
    if (calHint)
        calHint.textContent = 'Personalized to your eyes. EAR baseline: ' + baselineEAR.toFixed(3);
    log('Calibration complete');
    const rb = document.getElementById('recalBtn');
    if (rb)
        rb.style.display = 'block';
}
export function updateCalibration(ear) {
    if (!calibrating)
        return;
    if (ear > .16 && ear < .45)
        calibrationSamples.push(ear);
    let left = Math.max(0, calibrationUntil - Date.now()), pct = Math.min(100, Math.round((1 - left / CALIBRATION_MS) * 100));
    calibrationEl.textContent = pct + '%';
    calibrationFill.style.width = pct + '%';
    if (calHint)
        calHint.textContent = 'Keep eyes open and face centered… ' + pct + '%';
    if (left <= 0)
        finishCalibration();
}
export function applySensitivity(level) {
    level = Object.prototype.hasOwnProperty.call(SENSITIVITY_PRESETS, level) ? level : 'medium';
    const preset = SENSITIVITY_PRESETS[level];
    const factor = experimentFlags.pixels ? 4 / 3 : 1;
    set_eyeClosedThreshold(Math.max(.10 * factor, Math.min(.25 * factor, baseClosedThreshold + preset.offset * factor)));
    set_eyeWatchThreshold(Math.max(eyeClosedThreshold + .025 * factor, Math.min(.31 * factor, baseWatchThreshold + preset.offset * factor)));
    localStorage.setItem('occulert-sensitivity', level);
    document.querySelectorAll('[data-sensitivity]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sensitivity === level);
    });
}
