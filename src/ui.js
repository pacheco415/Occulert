import { setCameraControlsDisabled, refreshCameraChoices, openSelectedCamera, clearCameraTrackGuards, attachCameraTrackGuards, cameraRecoveryGuidance } from "./camera.js";
import { detectorFailureStopping, discardFaceMesh, initModel, verifyFirstInference, loop, framePerformanceSnapshot, set_processingFrame, set_detectorFailureStopping, set_consecutiveInferenceFailures, set_lastDetectionResultAt } from "./detector.js";
import "./calibration.js";
import { startGPS, stopGPS, riskText, fleetPayload } from "./metrics.js";
import { alerts, escalationLevel, _alertTestOwner, beginAlertAudioScope, releaseAlertAudioScope, clearParkedAlertTest, set_alerts, set_escalationLevel } from "./alerts.js";
import { createLocalDriverId, migrateLocalDriverIdentity, saveLocalSessionHistory, setMonitoringUi } from "./storage-history.js";
import { beginBackendSession, detachBackendSession, finishBackendSession, pushFleet, initCloud } from "./cloud-sync.js";
export const start = startMonitoring;
export const stop = stopMonitoring;
export const EXPERIMENT_HELPER_INTEGRITY = 'sha256-cFKA32XIr6IWVtiwi4m8lXnpAa0DTmEwkVTk8BsFE2M=';
/** @type {Readonly<DriverExperimentFlags>} */
export const experimentFlags = (() => {
    try {
        const q = new URLSearchParams(window.location?.search || ''), yes = (k, v) => q.getAll(k).length === 1 && q.get(k) === v;
        const f = { elapsed: yes('fatigue-timing', 'elapsed'), pixels: yes('ear-units', 'pixels'), tasks: yes('detector', 'tasks'), noface: yes('noface-escalation', '1'), timePerclos: yes('perclos', 'time'), pitch: yes('pitch-gate', '1') };
        const names = Object.keys(f).filter(k => f[k]).sort();
        return Object.freeze({ ...f, names: Object.freeze(names), any: names.length > 0, primary: names.some(k => k !== 'tasks'), delegate: yes('tasks-delegate', 'cpu') ? 'CPU' : 'GPU' });
    }
    catch (_) {
        return Object.freeze({ any: false, primary: false, names: Object.freeze([]) });
    }
})();
// Parked legacy-calibration sample minimum; no detector/controller mode switch.
export const calibrationMinimumSamples = (() => {
    try {
        const query = new URLSearchParams(window.location?.search || '');
        return query.getAll('calibration-min').length === 1 && query.get('calibration-min') === '12' ? 12 : 1;
    } catch (_) { return 1; }
})();
export let experimentController = /** @type {MountedExperimentController|null} */ (null), experimentGeneration = 0, experimentSessionSummary = null, experimentStopping = false;
export function startupAllowsMonitoring() { return typeof window.OcculertStartup?.isReady === 'function' && window.OcculertStartup.isReady() === true; }
export const INTENSITIES = ['dim', 'standard', 'bright'];
export const INTENSITY_ICONS = { dim: '🔅', standard: '🔆', bright: '☀️' };
export const INTENSITY_LABELS = { dim: 'Dim', standard: 'Standard', bright: 'Bright' };
export function applyIntensity(val) {
    val = INTENSITIES.includes(val) ? val : 'standard';
    document.documentElement.setAttribute('data-intensity', val);
    const btn = document.getElementById('intensityToggle');
    const icon = document.getElementById('intensityIcon');
    const label = document.getElementById('intensityLabel');
    if (btn)
        btn.title = 'Display: ' + INTENSITY_LABELS[val] + ' — click to cycle';
    if (icon)
        icon.textContent = INTENSITY_ICONS[val];
    if (label)
        label.textContent = INTENSITY_LABELS[val];
    document.querySelectorAll('.preset-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.intensity === val);
    });
    localStorage.setItem('occulert-intensity', val);
    // Update meta theme-color so mobile chrome matches
    const mc = { dim: '#020508', standard: '#050a0f', bright: '#0d1f30' };
    let meta = document.querySelector('meta[name="theme-color"]');
    if (meta)
        meta.content = mc[val];
}
document.getElementById('intensityToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-intensity') || 'standard';
    const next = INTENSITIES[(INTENSITIES.indexOf(cur) + 1) % INTENSITIES.length];
    applyIntensity(next);
});
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyIntensity(btn.dataset.intensity));
});
(function () {
    const saved = localStorage.getItem('occulert-intensity');
    applyIntensity(saved || 'standard');
})();
export const $ = id => document.getElementById(id), video = /** @type {HTMLVideoElement} */ ($('video')), canvas = /** @type {HTMLCanvasElement} */ ($('canvas')), ctx = canvas.getContext('2d'), statusEl = $('status'), startBtn = /** @type {HTMLButtonElement} */ ($('startBtn')), demoBtn = $('demoBtn'), overlay = $('overlay'), overlayTitle = $('overlayTitle'), overlayText = $('overlayText'), overlayHint = $('overlayHint'), stateCard = $('stateCard'), driveStateEl = $('driveState'), driveHintEl = $('driveHint'), fatigueEl = $('fatigue'), confidenceEl = $('confidence'), calibrationEl = $('calibration'), calibrationFill = $('calibrationFill'), faceStateEl = $('faceState'), earEl = $('ear'), alertsEl = /** @type {CoercingTextElement} */ ($('alerts')), riskEl = $('risk'), riskDetailEl = $('riskDetail'), fatigueFill = $('fatigueFill'), confidenceFill = $('confidenceFill'), alertScreen = /** @type {HTMLElement} */ ($('alertScreen')), alertTitle = /** @type {HTMLElement} */ ($('alertTitle')), alertSub = /** @type {HTMLElement} */ ($('alertSub')), logEl = $('log'), reportEl = $('report'), nodsEl = $('nods'), syncEl = $('sync'), gpsEl = $('gps'), locationEl = $('location'), perclosEl = $('perclos'), microsleepsEl = $('microsleeps'), distractionEl = $('distraction'), escalationEl = $('escalation'), gpsConsent = $('gpsConsent'), cloudConsent = $('cloudConsent'), sessionTimerEl = $('sessionTimer'), nightOpacity = /** @type {HTMLInputElement} */ ($('nightOpacity')), nightVal = $('nightVal'), phoneGuide = $('phoneGuide'), calHint = $('calHint'), cameraSourceRow = $('cameraSourceRow'), cameraSourceSelect = $('cameraSourceSelect'), cameraSourceHint = $('cameraSourceHint'), cameraRefreshBtn = $('cameraRefreshBtn');
export let timerInterval = null;
export function startTimer() {
    if (timerInterval)
        clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!sessionStart) {
            sessionTimerEl.textContent = '00:00';
            return;
        }
        const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        sessionTimerEl.textContent = m + ':' + s;
    }, 1000);
}
export function stopTimer() {
    if (timerInterval)
        clearInterval(timerInterval);
    timerInterval = null;
    sessionTimerEl.textContent = '00:00';
}
export const CAMERA_DEVICE_STORAGE_KEY = 'occulert-camera-device-id';
export let availableCameraDevices = [], cameraLabelsRevealed = false, unavailableCameraDeviceId = '', guardedCameraTrack = null, cameraMuteTimer = null, cameraFailureStopping = false;
nightOpacity.addEventListener('input', () => {
    const v = nightOpacity.value;
    nightVal.textContent = v + '%';
    alertScreen.style.background = 'rgba(255,51,68,' + v / 100 + ')';
});
alertScreen.style.background = 'rgba(255,51,68,' + nightOpacity.value / 100 + ')';
export let wakeLock = null, running = false, starting = false, startCancelled = false, stream = /** @type {MediaStream|null} */ (null), detectionResultGeneration = 0, raf = null, lastRender = 0, fatigue = 0, confidence = 0, earHistory = [], sessionStart = 0, maxFatigue = 0, fatigueSampleSum = 0, fatigueSampleCount = 0, noseYHistory = [], headNods = 0, lastNod = 0, lastFleetPush = 0, cloudReady = false, backendSessionId = null, backendSessionPromise = null, backendEventQueue = Promise.resolve(), backendSessionGeneration = 0, backendSessionScope = null, cloudConsentRevision = 0, cloudSummaryOutbox = null, cloudSummaryClearPending = false, driverId = migrateLocalDriverIdentity(localStorage.getItem('occulert-driver-id')), gpsWatch = null, lastPosition = null, routePoints = [], distanceMeters = 0, perclosWindow = [], eyesClosedSince = 0, microsleeps = 0, lastMicro = 0, turnedSince = 0, totalDistractionMs = 0, calibrating = false, calibrated = false, calibrationUntil = 0, calibrationSamples = [], baselineEAR = .28, baseClosedThreshold = .18, baseWatchThreshold = .22, eyeClosedThreshold = .18, eyeWatchThreshold = .22, noFaceSince = 0, lastFaceSeen = 0, hiddenAt = 0, performanceSamples = [], processedFrames = 0, performanceSessionStart = 0;
export const LEFT = [362, 385, 387, 263, 373, 380], RIGHT = [33, 160, 158, 133, 153, 144], PROCESS_INTERVAL = 135, RENDER_INTERVAL = 180, FLEET_PUSH_INTERVAL = 5000, CALIBRATION_MS = 3200, DETECTION_INFERENCE_TIMEOUT_MS = 3000, DETECTION_CLOSE_TIMEOUT_MS = 750;
window.OcculertPerformance = Object.freeze({ snapshot: framePerformanceSnapshot });
export function log(msg) {
    const d = document.createElement('div');
    d.className = 'event';
    d.textContent = new Date().toLocaleTimeString() + ': ' + msg;
    logEl.prepend(d);
    while (logEl.children.length > 14)
        logEl.lastChild.remove();
}
export function setOverlay(title, text, hint, showGuide) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = text;
    overlayHint.innerHTML = hint || '';
    if (phoneGuide)
        phoneGuide.style.display = showGuide === false ? 'none' : 'flex';
    overlay.classList.remove('hide');
}
export function setTextIfChanged(element, value) {
    if (element.textContent !== value)
        element.textContent = value;
}
export function render(ear) {
    if (!startupAllowsMonitoring()) {
        window.OcculertStartup?.refresh?.();
        return;
    }
    const now = Date.now();
    if (!ear && now - lastRender < RENDER_INTERVAL)
        return;
    lastRender = now;
    fatigueEl.textContent = Math.round(fatigue);
    fatigueFill.style.width = fatigue + '%';
    confidenceEl.textContent = Math.round(confidence) + '%';
    confidenceFill.style.width = confidence + '%';
    if (ear)
        earEl.textContent = ear.toFixed(3);
    if (!running && !calibrated) {
        calibrationEl.textContent = 'READY';
        calibrationFill.style.width = '0%';
        faceStateEl.textContent = '--';
    }
    const risk = riskText();
    riskEl.textContent = risk[0];
    riskDetailEl.textContent = risk[0];
    syncEl.textContent = cloudConsent.checked ? (cloudReady ? 'ON' : 'LOCAL') : 'LOCAL';
    escalationEl.textContent = escalationLevel;
    if (!running) {
        setTextIfChanged(driveStateEl, 'NOT MONITORING');
        setTextIfChanged(driveHintEl, 'Press Start Monitoring only when safely parked.');
        setTextIfChanged(statusEl, 'NOT MONITORING');
        statusEl.className = 'status off';
        stateCard.className = 'card state-card';
        riskEl.textContent = '--';
        riskDetailEl.textContent = '--';
        if (!calibrated)
            calibrationEl.textContent = 'NOT STARTED';
    }
    else {
        const trackingUnavailable = noFaceSince > 0;
        const label = trackingUnavailable ? 'TRACKING UNAVAILABLE' : risk[0] === 'SAFE' ? 'TRACKING ACTIVE' : risk[0];
        const hint = trackingUnavailable
            ? 'Camera tracking is unavailable. Alerts may be missed. Pull over safely before adjusting the phone.'
            : risk[0] === 'CALIBRATING'
                ? 'Camera is starting. Keep your face centered while parked.'
                : risk[0] === 'ALERT' || risk[0] === 'HIGH'
                    ? 'Pull over safely and rest. Do not keep driving tired.'
                    : risk[0] === 'WATCH'
                        ? 'Fatigue signs are building. Prepare to stop if needed.'
                        : 'Camera tracking is active. Stay alert; this does not mean it is safe to drive.';
        setTextIfChanged(driveStateEl, label);
        setTextIfChanged(driveHintEl, hint);
        setTextIfChanged(statusEl, label);
        stateCard.className = 'card state-card ' + (trackingUnavailable ? 'noface' : risk[1]);
        statusEl.className = 'status ' + (trackingUnavailable || ['ALERT', 'HIGH'].includes(risk[0]) ? 'alert' : 'on');
    }
    pushFleet();
}
export function showStoppedReason(message) {
    setTextIfChanged(driveStateEl, 'MONITORING STOPPED');
    setTextIfChanged(driveHintEl, message);
    setTextIfChanged(statusEl, 'MONITORING STOPPED');
    statusEl.className = 'status alert';
    stateCard.className = 'card state-card danger';
}
export function drawEyes(lm, color) { ctx.clearRect(0, 0, canvas.width, canvas.height); [LEFT, RIGHT].forEach(idx => { ctx.beginPath(); idx.forEach((i, k) => { let p = lm[i], x = p.x * canvas.width, y = p.y * canvas.height; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }); }
export function requireForegroundStart() {
    if (!startCancelled && !document.hidden)
        return;
    const error = new Error('Monitoring start cancelled because Occulert left the foreground.');
    error.name = 'AbortError';
    throw error;
}
export let localSessionId = '';
export async function requestSessionWakeLock(expectedSessionId) {
    if (!('wakeLock' in navigator))
        return;
    try {
        const requested = await navigator.wakeLock.request('screen');
        if (!running || document.hidden || localSessionId !== expectedSessionId) {
            Promise.resolve().then(() => requested.release()).catch(() => { });
            return;
        }
        wakeLock = requested;
        log('Screen wake lock active');
    }
    catch (error) {
        if (running && localSessionId === expectedSessionId)
            log('Wake lock unavailable - keep screen unlocked');
    }
}
export function createLocalLifecycleOperations() {
    async function start() {
        if (!startupAllowsMonitoring())
            return;
        if (starting || detectorFailureStopping || cameraFailureStopping || experimentFlags.any && experimentStopping)
            return;
        clearParkedAlertTest(_alertTestOwner);
        const audioOwner = beginAlertAudioScope();
        starting = true;
        setMonitoringUi(true);
        startCancelled = false;
        startBtn.disabled = true;
        startBtn.textContent = 'STARTING...';
        setCameraControlsDisabled(true);
        setOverlay('Preparing Monitoring', 'Occulert is preparing the on-device model before opening the camera.', 'Stay parked until camera monitoring has started. GPS and cloud sync use the choices you made before starting.', false);
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
                throw new Error('Camera is not supported in this browser. Try Safari or Chrome on HTTPS.');
            if (experimentFlags.any) {
                set_processingFrame(false);
                experimentGeneration++;
                await discardFaceMesh();
            }
            await initModel();
            requireForegroundStart();
            stream = await openSelectedCamera();
            requireForegroundStart();
            video.srcObject = stream;
            await video.play();
            requireForegroundStart();
            await verifyFirstInference();
            requireForegroundStart();
            await initCloud();
            requireForegroundStart();
            running = true;
            attachCameraTrackGuards(stream);
            sessionStart = Date.now();
            localSessionId = createLocalDriverId();
            startTimer();
            void requestSessionWakeLock(localSessionId);
            fatigue = 0;
            confidence = 0;
            set_alerts(0);
            headNods = 0;
            microsleeps = 0;
            maxFatigue = 0;
            {
                fatigueSampleSum = 0;
                fatigueSampleCount = 0;
            }
            noseYHistory = [];
            earHistory = [];
            perclosWindow = [];
            eyesClosedSince = 0;
            turnedSince = 0;
            totalDistractionMs = 0;
            set_escalationLevel(0);
            distanceMeters = 0;
            routePoints = [];
            lastPosition = null;
            noFaceSince = 0;
            lastFaceSeen = 0;
            lastRender = 0;
            set_consecutiveInferenceFailures(0);
            set_lastDetectionResultAt(Date.now());
            set_detectorFailureStopping(false);
            _trackLostSince = 0;
            _lastTrackingWarning = 0;
            calibrating = true;
            calibrated = false;
            calibrationSamples = [];
            calibrationUntil = Date.now() + CALIBRATION_MS;
            baselineEAR = .28;
            baseClosedThreshold = .18;
            baseWatchThreshold = .22;
            eyeClosedThreshold = .18;
            eyeWatchThreshold = .22;
            alertsEl.textContent = '0';
            nodsEl.textContent = '0';
            microsleepsEl.textContent = '0';
            perclosEl.textContent = '0%';
            distractionEl.textContent = '0s';
            escalationEl.textContent = '0';
            locationEl.textContent = '--';
            faceStateEl.textContent = '--';
            calibrationEl.textContent = '0%';
            calibrationFill.style.width = '0%';
            reportEl.style.display = 'none';
            const feedbackCard = document.getElementById('feedbackCard');
            if (feedbackCard)
                feedbackCard.hidden = true;
            const feedbackForm = document.getElementById('feedbackForm');
            if (feedbackForm)
                feedbackForm.reset();
            const feedbackStatus = document.getElementById('feedbackStatus');
            if (feedbackStatus)
                feedbackStatus.textContent = '';
            overlay.classList.add('hide');
            startBtn.disabled = false;
            startBtn.textContent = 'STOP MONITORING';
            startBtn.className = 'btn stop';
            if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                Notification.requestPermission().then(p => {
                    if (p === 'granted')
                        log('Notifications enabled. Watch delivery depends on iPhone notification mirroring or the verified native companion setup.');
                }).catch(() => { });
            }
            experimentSessionSummary = null;
            experimentController?.begin();
            log('Monitoring started - calibrating');
            startGPS();
            raf = requestAnimationFrame(loop);
        }
        catch (e) {
            if (experimentFlags.any) {
                experimentGeneration++;
                experimentController?.stop();
                await discardFaceMesh();
            }
            releaseAlertAudioScope(audioOwner);
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                stream = null;
            }
            video.srcObject = null;
            if (e && e.name === 'AbortError') {
                setOverlay('Monitoring Paused', 'Monitoring did not start because Occulert left the foreground.', 'Return to Occulert and press Start Monitoring again only when safely parked.', false);
                log('Monitoring start cancelled after foreground loss');
            }
            else {
                const recovery = cameraRecoveryGuidance(e);
                setOverlay(recovery.title, recovery.text, recovery.hint, false);
                if (e && e.name === 'DetectionRuntimeError')
                    await discardFaceMesh();
                log((e && e.name === 'DetectionRuntimeError' ? 'Detector' : 'Camera') + ' error: ' + (e.message || e.name || e));
            }
            startBtn.textContent = 'START MONITORING';
            startBtn.className = 'btn primary';
            setMonitoringUi(false);
        }
        finally {
            starting = false;
            startBtn.disabled = false;
            setCameraControlsDisabled(running || cameraFailureStopping);
            render();
        }
    }
    async function stop(options = {}) {
        const preserveOverlay = !!options.preserveOverlay;
        if (experimentFlags.any && experimentStopping)
            return;
        running = false;
        let experimentalClose = null;
        if (experimentFlags.any) {
            experimentStopping = true;
            set_processingFrame(false);
            experimentGeneration++;
            experimentSessionSummary = experimentController?.stop();
            experimentalClose = discardFaceMesh().finally(() => { experimentStopping = false; });
        }
        clearParkedAlertTest(_alertTestOwner);
        releaseAlertAudioScope();
        setMonitoringUi(false);
        calibrating = false;
        stopTimer();
        clearCameraTrackGuards();
        const rb3 = document.getElementById('recalBtn');
        if (rb3)
            rb3.style.display = 'none';
        if (wakeLock) {
            const heldWakeLock = wakeLock;
            wakeLock = null;
            Promise.resolve().then(() => heldWakeLock.release()).catch(() => { });
        }
        if (raf)
            cancelAnimationFrame(raf);
        if (stream)
            stream.getTracks().forEach(t => t.stop());
        stream = null;
        stopGPS();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!preserveOverlay)
            setOverlay('AI Fatigue Monitoring', 'Supplemental prototype only. Keep your attention on the road, never rely on alerts alone, and never drive tired.<br>Press Start Monitoring only when safely parked.', '<strong>Foreground required:</strong> monitoring stops if this tab is hidden or the screen locks. Pull over safely before restarting.', true);
        startBtn.textContent = 'START MONITORING';
        startBtn.className = 'btn primary';
        setCameraControlsDisabled(false);
        void refreshCameraChoices();
        let p = fleetPayload();
        p = saveLocalSessionHistory(p) || p;
        let mins = sessionStart ? ((Date.now() - sessionStart) / 60000).toFixed(1) : '0.0';
        render(.001);
        pushFleet(true, p);
        reportEl.style.display = 'block';
        const feedbackCard = document.getElementById('feedbackCard');
        if (feedbackCard)
            feedbackCard.hidden = !p.savedAt;
        reportEl.textContent = 'OCCULERT SESSION REPORT\n\nStatus: ' + p.status + '\nDuration: ' + mins + ' min\nSafety Score: ' + p.safetyScore + '/100\n\nCalibration: ' + (calibrated ? 'Personalized' : 'Default') + '\nOpen-eye EAR: ' + baselineEAR.toFixed(3) + '\nClosed-eye threshold: ' + eyeClosedThreshold.toFixed(3) + '\n\nAlerts Triggered: ' + alerts + '\nEscalation Level: ' + escalationLevel + '\nHead Nods Detected: ' + headNods + '\nMicrosleeps Detected: ' + microsleeps + '\nPERCLOS: ' + (p.perclos === null ? 'Unavailable' : p.perclos + '%') + '\nDistraction Time: ' + p.distractionSeconds + 's\nAverage Fatigue: ' + p.avgFatigue + '/100\nMax Fatigue: ' + p.maxFatigue + '/100\n\nGPS Enabled: ' + (p.gpsEnabled ? 'Yes' : 'No') + '\nDistance: ' + p.distanceMiles + ' mi\nLast Location: ' + (p.location ? p.location.lat + ', ' + p.location.lng : 'Not available') + '\n\nSync Mode: ' + (cloudConsent.checked && cloudReady ? 'Cloud + Local' : 'Local only') + '\nLocal history: ' + (p.savedAt ? 'Saved' : 'Not saved — copy this report before leaving') + '\nReport generated: ' + new Date().toLocaleString() + '\n\nSafety and liability: Occulert is a supplemental prototype only. It may miss drowsiness, may trigger false alerts, and is not a certified safety, medical, emergency, legal, employment, fleet compliance, or transportation compliance device. Do not interact with the app while driving. If tired or unsafe, pull over and rest.';
        try {
            if (!experimentFlags.any && cloudConsent.checked && cloudReady && window.OcculertSync)
                await window.OcculertSync.saveSessionHistory(p);
        }
        catch (e) { }
        log('Session ended');
        if (experimentalClose)
            await experimentalClose;
    }
    const startLocalSession = start;
    const stopLocalSession = stop;
    return { startLocalSession, stopLocalSession };
}
export let localLifecycle = null;
export function initializeLocalLifecycle() { localLifecycle = createLocalLifecycleOperations(); }
export async function startMonitoring() {
    if (!startupAllowsMonitoring())
        return;
    await localLifecycle.startLocalSession();
    if (running)
        backendSessionPromise = beginBackendSession();
}
export async function stopMonitoring(options = {}) { const payload = fleetPayload(), backendState = detachBackendSession(); await localLifecycle.stopLocalSession(options); await finishBackendSession(payload, backendState); }
export async function handleVisibilityChange(hidden = document.visibilityState === 'hidden') {
    if (!hidden || (!running && !starting && !stream))
        return false;
    hiddenAt = Date.now();
    log('Monitoring stopped because Occulert left the foreground');
    if (!running) {
        startCancelled = true;
        if (stream)
            stream.getTracks().forEach(track => track.stop());
        stream = null;
        video.srcObject = null;
        setOverlay('Monitoring Paused', 'Monitoring did not start because Occulert left the foreground.', 'Return to Occulert and press Start Monitoring again only when safely parked.', false);
        return true;
    }
    await stop();
    showStoppedReason('Monitoring stopped when Occulert left the foreground. Restart only while safely parked.');
    return true;
}
export let yawnCount = 0, lastYawn = 0, _marHist = [], _mouthOpenSince = 0;
export const MAR_YAWN_THRESH = 0.58, YAWN_HOLD_MS = 1200, YAWN_COOLDOWN_MS = 8000;
export let _lastLightCheck = 0;
export let _trackLostSince = 0, _lastTrackingWarning = 0;
export const TRACKING_WARNING_DELAY_MS = 5000, TRACKING_WARNING_COOLDOWN_MS = 30000;
export let _lastBreakPrompt = 0;
export let _sessionLog = [];
export let _chartData = [], _chartCtx = null;
export function initChart() {
    const cv = document.getElementById('alertnessChart');
    if (!cv)
        return;
    cv.width = cv.offsetWidth || 300;
    cv.height = cv.offsetHeight || 60;
    _chartCtx = cv.getContext('2d');
}
export function updateChart(val) {
    if (!_chartCtx)
        return;
    _chartData.push({ t: Date.now(), v: isNaN(val) ? 0 : Math.min(100, Math.max(0, val)) });
    if (_chartData.length > 120)
        _chartData.shift();
    const cv = document.getElementById('alertnessChart');
    if (!cv)
        return;
    if (cv.offsetWidth > 0 && cv.width !== cv.offsetWidth) {
        cv.width = cv.offsetWidth;
        _chartCtx = cv.getContext('2d');
    }
    const w = cv.width, h = cv.height;
    _chartCtx.clearRect(0, 0, w, h);
    if (_chartData.length < 2)
        return;
    _chartCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    _chartCtx.lineWidth = 1;
    [25, 50, 75].forEach(y => { const py = h - (y / 100) * h; _chartCtx.beginPath(); _chartCtx.moveTo(0, py); _chartCtx.lineTo(w, py); _chartCtx.stroke(); });
    for (let i = 1; i < _chartData.length; i++) {
        const x0 = ((i - 1) / (_chartData.length - 1)) * w, x1 = (i / (_chartData.length - 1)) * w;
        const y0 = h - (_chartData[i - 1].v / 100) * h, y1 = h - (_chartData[i].v / 100) * h;
        _chartCtx.strokeStyle = _chartData[i].v > 70 ? '#ff3344' : _chartData[i].v > 40 ? '#ffaa00' : '#00ff88';
        _chartCtx.lineWidth = 2;
        _chartCtx.beginPath();
        _chartCtx.moveTo(x0, y0);
        _chartCtx.lineTo(x1, y1);
        _chartCtx.stroke();
    }
}
export const _isIOS = (/iphone|ipad|ipod/i).test(navigator.userAgent) && !window.navigator.standalone;
export const _isAndroid = /android/i.test(navigator.userAgent);
export const _isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode:standalone)').matches;
export function triggerPWAInstall() {
    if (_isIOS && !_isStandalone) {
        // Show iOS instructions modal
        const m = document.getElementById('iosInstallModal');
        if (m) {
            m.style.display = 'flex';
            return;
        }
    }
    if (!window._pwaPrompt)
        return;
    window._pwaPrompt.prompt();
    window._pwaPrompt.userChoice.then(r => {
        if (r.outcome === 'accepted')
            log('PWA installed');
        window._pwaPrompt = null;
        const b = document.getElementById('pwaInstallBtn');
        if (b)
            b.style.display = 'none';
    });
}
export function closeIOSInstallModal() {
    const m = document.getElementById('iosInstallModal');
    if (m)
        m.style.display = 'none';
}
export const SENSITIVITY_PRESETS = {
    low: { offset: -0.03 },
    medium: { offset: 0 },
    high: { offset: 0.03 }
};
export function loadExperimentController() {
    if (window.OcculertDetectionExperiments?.createMountedController) {
        experimentController = window.OcculertDetectionExperiments.createMountedController(experimentFlags);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/detection-experiments.v1.js';
        script.integrity = EXPERIMENT_HELPER_INTEGRITY;
        script.crossOrigin = 'anonymous';
        const timer = setTimeout(() => { script.remove(); reject(Error('Parked helper timed out')); }, 7000);
        script.onload = () => {
            clearTimeout(timer);
            try {
                experimentController = window.OcculertDetectionExperiments.createMountedController(experimentFlags);
                resolve();
            }
            catch (error) {
                reject(error);
            }
        };
        script.onerror = () => { clearTimeout(timer); reject(Error('Parked helper integrity or load failure')); };
        document.head.appendChild(script);
    });
}
export function publishDriverReadiness(core) {
    window.OcculertDriverCore = core;
    if (typeof window.OcculertStartup?.ready === 'function')
        window.OcculertStartup.ready(core);
}
export function set_availableCameraDevices(value) { availableCameraDevices = value; return value; }
export function set_cameraLabelsRevealed(value) { cameraLabelsRevealed = value; return value; }
export function set_unavailableCameraDeviceId(value) { unavailableCameraDeviceId = value; return value; }
export function set_guardedCameraTrack(value) { guardedCameraTrack = value; return value; }
export function set_cameraMuteTimer(value) { cameraMuteTimer = value; return value; }
export function set_cameraFailureStopping(value) { cameraFailureStopping = value; return value; }
export function set_running(value) { running = value; return value; }
/** @param {MediaStream|null} value */
export function set_stream(value) { stream = value; return value; }
export function set_detectionResultGeneration(value) { detectionResultGeneration = value; return value; }
export function set_raf(value) { raf = value; return value; }
export function set_fatigue(value) { fatigue = value; return value; }
export function set_confidence(value) { confidence = value; return value; }
export function set_earHistory(value) { earHistory = value; return value; }
export function set_maxFatigue(value) { maxFatigue = value; return value; }
export function set_fatigueSampleSum(value) { fatigueSampleSum = value; return value; }
export function set_fatigueSampleCount(value) { fatigueSampleCount = value; return value; }
export function set_noseYHistory(value) { noseYHistory = value; return value; }
export function set_headNods(value) { headNods = value; return value; }
export function set_lastNod(value) { lastNod = value; return value; }
export function set_lastFleetPush(value) { lastFleetPush = value; return value; }
export function set_cloudReady(value) { cloudReady = value; return value; }
export function set_backendSessionId(value) { backendSessionId = value; return value; }
export function set_backendSessionPromise(value) { backendSessionPromise = value; return value; }
export function set_backendEventQueue(value) { backendEventQueue = value; return value; }
export function set_backendSessionGeneration(value) { backendSessionGeneration = value; return value; }
export function set_backendSessionScope(value) { backendSessionScope = value; return value; }
export function set_cloudConsentRevision(value) { cloudConsentRevision = value; return value; }
export function set_cloudSummaryOutbox(value) { cloudSummaryOutbox = value; return value; }
export function set_cloudSummaryClearPending(value) { cloudSummaryClearPending = value; return value; }
export function set_gpsWatch(value) { gpsWatch = value; return value; }
export function set_lastPosition(value) { lastPosition = value; return value; }
export function set_routePoints(value) { routePoints = value; return value; }
export function set_distanceMeters(value) { distanceMeters = value; return value; }
export function set_perclosWindow(value) { perclosWindow = value; return value; }
export function set_eyesClosedSince(value) { eyesClosedSince = value; return value; }
export function set_microsleeps(value) { microsleeps = value; return value; }
export function set_lastMicro(value) { lastMicro = value; return value; }
export function set_turnedSince(value) { turnedSince = value; return value; }
export function set_totalDistractionMs(value) { totalDistractionMs = value; return value; }
export function set_calibrating(value) { calibrating = value; return value; }
export function set_calibrated(value) { calibrated = value; return value; }
export function set_calibrationUntil(value) { calibrationUntil = value; return value; }
export function set_calibrationSamples(value) { calibrationSamples = value; return value; }
export function set_baselineEAR(value) { baselineEAR = value; return value; }
export function set_baseClosedThreshold(value) { baseClosedThreshold = value; return value; }
export function set_baseWatchThreshold(value) { baseWatchThreshold = value; return value; }
export function set_eyeClosedThreshold(value) { eyeClosedThreshold = value; return value; }
export function set_eyeWatchThreshold(value) { eyeWatchThreshold = value; return value; }
export function set_noFaceSince(value) { noFaceSince = value; return value; }
export function set_lastFaceSeen(value) { lastFaceSeen = value; return value; }
export function set_hiddenAt(value) { hiddenAt = value; return value; }
export function set_performanceSamples(value) { performanceSamples = value; return value; }
export function set_processedFrames(value) { processedFrames = value; return value; }
export function set_performanceSessionStart(value) { performanceSessionStart = value; return value; }
export function set_yawnCount(value) { yawnCount = value; return value; }
export function set_lastYawn(value) { lastYawn = value; return value; }
export function set__marHist(value) { _marHist = value; return value; }
export function set__mouthOpenSince(value) { _mouthOpenSince = value; return value; }
export function set__lastLightCheck(value) { _lastLightCheck = value; return value; }
export function set__trackLostSince(value) { _trackLostSince = value; return value; }
export function set__lastTrackingWarning(value) { _lastTrackingWarning = value; return value; }
export function set__lastBreakPrompt(value) { _lastBreakPrompt = value; return value; }
