import { rememberCameraDeviceId, updateCameraSourceHint, refreshCameraChoices, findCameraChoices } from "./camera.js";
import { initModel } from "./detector.js";
import { applySensitivity } from "./calibration.js";
import "./metrics.js";
import { escalationLevel, demoAlert, VOICE_MSGS, initializeVoicePreference, speak, toggleVoice, triggerBreakCheck, dismissBreak, registerAcceptedAlertHook, set_alerts, set_escalationLevel } from "./alerts.js";
import { logEvent, exportCSV, browserHistoryStore } from "./storage-history.js";
import { queueBackendEvent, getCloudSummaryOutbox, retryCloudSummaries, initCloud } from "./cloud-sync.js";
import { experimentFlags, experimentController, startupAllowsMonitoring, demoBtn, calibrationEl, calibrationFill, alertsEl, alertScreen, logEl, reportEl, nodsEl, perclosEl, microsleepsEl, distractionEl, escalationEl, cloudConsent, cameraSourceSelect, cameraRefreshBtn, running, starting, fatigue, cloudConsentRevision, cloudSummaryClearPending, hiddenAt, CALIBRATION_MS, log, render, _sessionLog, initChart, updateChart, _isIOS, _isStandalone, triggerPWAInstall, loadExperimentController, publishDriverReadiness, initializeLocalLifecycle, handleVisibilityChange, startBtn, localSessionId, start, stop, set_unavailableCameraDeviceId, set_fatigue, set_confidence, set_earHistory, set_maxFatigue, set_fatigueSampleSum, set_fatigueSampleCount, set_noseYHistory, set_headNods, set_cloudConsentRevision, set_cloudSummaryClearPending, set_perclosWindow, set_eyesClosedSince, set_microsleeps, set_turnedSince, set_totalDistractionMs, set_calibrating, set_calibrated, set_calibrationUntil, set_calibrationSamples, set_hiddenAt } from "./ui.js";
initializeLocalLifecycle();
startBtn.onclick = () => running ? stop() : start();
const recalBtn = document.getElementById('recalBtn');
if (recalBtn) {
    recalBtn.onclick = () => {
        if (!startupAllowsMonitoring() || !running)
            return;
        set_calibrating(true);
        set_calibrated(false);
        set_calibrationSamples([]);
        set_calibrationUntil(Date.now() + CALIBRATION_MS);
        calibrationEl.textContent = '0%';
        calibrationFill.style.width = '0%';
        set_earHistory([]);
        experimentController?.recalibrate();
        log('Recalibration started');
        recalBtn.style.display = 'none';
    };
}
;
demoBtn.onclick = demoAlert;
const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
    resetBtn.onclick = () => {
        if (!startupAllowsMonitoring() || running || starting)
            return;
        if (!confirm('Clear the on-screen diagnostics? Saved session history is not deleted.'))
            return;
        set_fatigue(0);
        set_confidence(0);
        set_alerts(0);
        set_headNods(0);
        set_microsleeps(0);
        set_maxFatigue(0);
        {
            set_fatigueSampleSum(0);
            set_fatigueSampleCount(0);
        }
        set_perclosWindow([]);
        set_eyesClosedSince(0);
        set_turnedSince(0);
        set_totalDistractionMs(0);
        set_escalationLevel(0);
        set_earHistory([]);
        set_noseYHistory([]);
        alertsEl.textContent = '0';
        nodsEl.textContent = '0';
        microsleepsEl.textContent = '0';
        perclosEl.textContent = '0%';
        distractionEl.textContent = '0s';
        escalationEl.textContent = '0';
        reportEl.style.display = 'none';
        logEl.innerHTML = '';
        log('On-screen diagnostics cleared');
        render();
    };
}
const feedbackForm = document.getElementById('feedbackForm');
if (feedbackForm)
    feedbackForm.addEventListener('submit', event => {
        event.preventDefault();
        if (running || starting)
            return;
        const status = document.getElementById('feedbackStatus');
        const selected = feedbackForm.querySelector('input[name="alertReview"]:checked');
        if (!selected || !localSessionId) {
            if (status)
                status.textContent = 'Choose a review before saving.';
            return;
        }
        try {
            browserHistoryStore().changeRecord(localSessionId, session => ({ ...session,
                alertReview: selected.value,
                alertReviewNote: String(document.getElementById('feedbackNote')?.value || '').trim().slice(0, 500),
                alertReviewedAt: new Date().toISOString(),
            }));
            if (status)
                status.textContent = 'Review saved in this browser. It is a personal observation, not a measured detection accuracy result.';
        }
        catch (error) {
            if (status)
                status.textContent = 'Review could not be saved on this device. Try again while parked.';
        }
    });
document.addEventListener('visibilitychange', () => { void handleVisibilityChange(); });
cloudConsent.addEventListener('change', () => {
    if (experimentFlags.any) {
        cloudConsent.checked = false;
        return;
    }
    (set_cloudConsentRevision(cloudConsentRevision + 1) - 1);
    if (cloudSummaryClearPending && cloudConsent.checked) {
        try {
            const outbox = getCloudSummaryOutbox();
            if (outbox)
                outbox.clear();
            set_cloudSummaryClearPending(false);
        }
        catch (error) {
            cloudConsent.checked = false;
            log('Cloud sharing remains off until pending-data removal succeeds');
        }
    }
    if (!cloudConsent.checked) {
        try {
            const outbox = getCloudSummaryOutbox();
            if (outbox)
                outbox.clear();
            set_cloudSummaryClearPending(false);
        }
        catch (error) {
            set_cloudSummaryClearPending(true);
            log('Pending cloud data could not be cleared — cloud remains off');
        }
    }
    void initCloud();
});
window.addEventListener('online', () => { void retryCloudSummaries(); });
if (cameraSourceSelect)
    cameraSourceSelect.addEventListener('change', () => { const deviceId = cameraSourceSelect.value; set_unavailableCameraDeviceId(''); rememberCameraDeviceId(deviceId); updateCameraSourceHint(); });
if (cameraRefreshBtn)
    cameraRefreshBtn.addEventListener('click', () => { void findCameraChoices(); });
if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function')
    navigator.mediaDevices.addEventListener('devicechange', () => { void refreshCameraChoices(); });
void refreshCameraChoices();
initializeVoicePreference();
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    window._pwaPrompt = e;
    const b = document.getElementById('pwaInstallBtn');
    if (b)
        b.style.display = 'inline-flex';
});
if (_isIOS && !_isStandalone) {
    document.addEventListener('DOMContentLoaded', () => {
        const b = document.getElementById('pwaInstallBtn');
        if (b)
            b.style.display = 'inline-flex';
    }, { once: true });
    if (document.readyState !== 'loading') {
        const b = document.getElementById('pwaInstallBtn');
        if (b)
            b.style.display = 'inline-flex';
    }
}
if ('getBattery' in navigator) {
    navigator.getBattery().then(b => {
        function checkBatt() {
            const badge = document.getElementById('batteryBadge');
            if (!badge)
                return;
            if (!b.charging && b.level < 0.2) {
                badge.textContent = '🔋 Low Battery — check performance';
                badge.style.display = 'inline-flex';
            }
            else {
                badge.style.display = 'none';
            }
        }
        b.addEventListener('levelchange', checkBatt);
        b.addEventListener('chargingchange', checkBatt);
        checkBatt();
    }).catch(() => { });
}
setInterval(() => {
    if (!running)
        return;
    updateChart(fatigue);
    if (_sessionLog.length > 1000)
        _sessionLog.splice(0, 100);
    logEvent('fatigue', fatigue, '');
}, 5000);
if (document.readyState === 'complete') {
    initChart();
}
else {
    window.addEventListener('load', initChart);
}
window.toggleVoice = toggleVoice;
window.exportCSV = exportCSV;
window.triggerPWAInstall = triggerPWAInstall;
window.dismissBreak = dismissBreak;
render();
initCloud();
(function initSensitivity() {
    const saved = localStorage.getItem('occulert-sensitivity') || 'medium';
    applySensitivity(saved);
    document.querySelectorAll('[data-sensitivity]').forEach(btn => {
        btn.addEventListener('click', () => applySensitivity(btn.dataset.sensitivity));
    });
})();
(function initVisibilityGuard() {
    const banner = document.getElementById('screenWarning');
    let hiddenWarningShown = false;
    function showWarning() {
        if (banner)
            banner.style.display = 'block';
        hiddenWarningShown = true;
    }
    function hideWarning() {
        if (banner)
            banner.style.display = 'none';
        hiddenWarningShown = false;
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Page hidden - record time
            set_hiddenAt(Date.now());
        }
        else {
            // Page visible again
            if (hiddenAt && (Date.now() - hiddenAt) > 3000) {
                showWarning();
            }
            else {
                hideWarning();
            }
            set_hiddenAt(0);
        }
    });
    window.addEventListener('focus', hideWarning);
    window.addEventListener('blur', () => { });
})();
(function () {
    const v = localStorage.getItem('occulert-voice') === 'true';
    const btn = document.getElementById('voiceToggleBtn');
    if (btn)
        btn.textContent = v ? '🔊 Voice ON' : '🔇 Voice OFF';
    // Initialize chart when DOM ready
    if (document.readyState === 'complete') {
        typeof initChart === 'function' && initChart();
    }
    else
        window.addEventListener('load', () => { typeof initChart === 'function' && initChart(); });
})();
registerAcceptedAlertHook(reason => { experimentController?.recordAlert(reason); speak(VOICE_MSGS[Math.max(0, Math.min(escalationLevel - 1, VOICE_MSGS.length - 1))]); triggerBreakCheck(); logEvent('alert', reason || 'Fatigue', 'esc=' + escalationLevel); queueBackendEvent(reason === 'Distraction' ? 'distracted' : 'drowsy'); updateChart(fatigue); });
const startupCore = Object.freeze({ version: 'v68', start, stop, findCameraChoices, initModel });
if (experimentFlags.any)
    loadExperimentController().then(() => publishDriverReadiness(startupCore)).catch(() => { log('Parked experiment helper unavailable — reload while parked.'); });
else
    publishDriverReadiness(startupCore);
