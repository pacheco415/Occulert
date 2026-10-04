import "./camera.js";
import "./detector.js";
import "./calibration.js";
import { fleetPayload } from "./metrics.js";
import "./alerts.js";
import { browserHistoryStore } from "./storage-history.js";
import { experimentFlags, startupAllowsMonitoring, syncEl, gpsConsent, cloudConsent, running, fatigue, confidence, sessionStart, lastFleetPush, cloudReady, backendSessionId, backendSessionPromise, backendEventQueue, backendSessionGeneration, backendSessionScope, cloudConsentRevision, cloudSummaryOutbox, lastPosition, FLEET_PUSH_INTERVAL, log, localSessionId, set_lastFleetPush, set_cloudReady, set_backendSessionId, set_backendSessionPromise, set_backendEventQueue, set_backendSessionGeneration, set_backendSessionScope, set_cloudSummaryOutbox } from "./ui.js";
export function beginBackendSession() {
    if (experimentFlags.any)
        return Promise.resolve(null);
    set_backendSessionScope(cloudSummaryScope());
    void retryCloudSummaries();
    const generation = set_backendSessionGeneration(backendSessionGeneration + 1);
    set_backendSessionId(null);
    set_backendSessionPromise(null);
    set_backendEventQueue(Promise.resolve());
    if (!cloudConsent.checked || !cloudReady || !window.OcculertBackend)
        return Promise.resolve(null);
    set_backendSessionPromise(window.OcculertBackend.startSession().then(result => {
        if (!cloudConsent.checked)
            return null;
        if (result.ok && result.body.session) {
            const id = result.body.session.id;
            if (generation === backendSessionGeneration) {
                set_backendSessionId(id);
                log('Protected cloud session started');
            }
            return id;
        }
        if (generation === backendSessionGeneration) {
            set_cloudReady(false);
            syncEl.textContent = 'LOCAL';
            log(result.status === 403 ? 'Cloud profile is not ready - saved locally' : 'Cloud session unavailable - saved locally');
        }
        return null;
    }).catch(() => {
        if (generation === backendSessionGeneration) {
            set_cloudReady(false);
            syncEl.textContent = 'LOCAL';
            log('Cloud session unavailable - saved locally');
        }
        return null;
    }));
    return backendSessionPromise;
}
export function queueBackendEvent(type) {
    if (experimentFlags.any)
        return;
    if (!cloudConsent.checked || !cloudReady || !window.OcculertBackend)
        return;
    const location = gpsConsent.checked && lastPosition ? { latitude: lastPosition.lat, longitude: lastPosition.lng } : {}, sessionReference = backendSessionPromise || backendSessionId;
    set_backendEventQueue(backendEventQueue.then(() => sessionReference).then(id => id && cloudConsent.checked ? window.OcculertBackend.logEvent(id, type, Object.assign({ fatigue_score: Math.round(fatigue), confidence: Math.round(confidence) }, location)) : null).catch(() => null));
}
export function detachBackendSession() { const state = { id: backendSessionId, promise: backendSessionPromise, eventQueue: backendEventQueue, consented: cloudConsent.checked, scope: backendSessionScope, endedAt: new Date().toISOString(), localSessionId }; set_backendSessionScope(null); (set_backendSessionGeneration(backendSessionGeneration + 1) - 1); set_backendSessionId(null); set_backendSessionPromise(null); set_backendEventQueue(Promise.resolve()); return state; }
export function cloudSummaryScope() {
    if (experimentFlags.any)
        return null;
    const user = window.OcculertBackend && window.OcculertBackend.currentUser();
    return user ? { ownerId: user.id, revision: cloudConsentRevision } : null;
}
export function getCloudSummaryOutbox() {
    if (experimentFlags.any)
        return null;
    if (!cloudSummaryOutbox && window.OcculertBackend && window.OcculertBackend.createCloudSummaryOutbox) {
        set_cloudSummaryOutbox(window.OcculertBackend.createCloudSummaryOutbox(scope => cloudConsent.checked && scope.revision === cloudConsentRevision, entry => {
            if (!entry.localSessionId)
                return;
            browserHistoryStore().changeRecord(entry.localSessionId, row => ({ ...row, cloudSynced: true, cloudSessionId: entry.sessionId, cloudOwnerId: entry.ownerId }));
        }));
    }
    return cloudSummaryOutbox;
}
export async function retryCloudSummaries() {
    if (experimentFlags.any)
        return;
    try {
        const scope = cloudSummaryScope(), outbox = getCloudSummaryOutbox();
        if (scope && cloudConsent.checked && outbox)
            await outbox.flush(scope);
    }
    catch (error) {
        log('Pending cloud summaries retained — retry when connected');
    }
}
export async function finishBackendSession(payload, state) {
    if (experimentFlags.any)
        return;
    if (!state || !state.scope || !state.promise && !state.id || !state.consented)
        return;
    try {
        const id = state.id || await state.promise;
        await state.eventQueue;
        if (id && cloudConsent.checked) {
            const outbox = getCloudSummaryOutbox(), entry = { sessionId: id, endedAt: state.endedAt, localSessionId: state.localSessionId, stats: { average_fatigue: payload.avgFatigue, max_fatigue: payload.maxFatigue, safety_score: payload.safetyScore, alert_count: payload.alerts, head_nod_count: payload.headNods } };
            if (!outbox || !outbox.enqueue(state.scope, entry)) {
                log('Cloud retry queue unavailable or full — local copy kept');
                return;
            }
            const saved = await outbox.flush(state.scope);
            log(saved.has(id) ? 'Protected cloud session saved' : 'Cloud summary pending — will retry when connected');
        }
    }
    catch (error) {
        log('Cloud summary unavailable — local copy kept');
    }
}
export async function pushFleet(force = false, payload) {
    if (!sessionStart || (!running && !force))
        return;
    const now = Date.now();
    if (!force && now - lastFleetPush < FLEET_PUSH_INTERVAL)
        return;
    set_lastFleetPush(now);
    const p = payload || fleetPayload();
    try {
        localStorage.setItem('occulert-live-session', JSON.stringify(p));
    }
    catch (error) {
        log('Local session snapshot could not be saved. Copy the session report before leaving.');
        return;
    }
    if (!experimentFlags.any && cloudConsent.checked && cloudReady && window.OcculertSync) {
        try {
            await window.OcculertSync.saveLiveSession(p);
        }
        catch (error) {
            log('Cloud latest-session sync unavailable - local copy kept');
        }
    }
}
export async function initCloud() {
    if (experimentFlags.any) {
        set_cloudReady(false);
        syncEl.textContent = 'LOCAL';
        return;
    }
    if (!startupAllowsMonitoring() || !cloudConsent.checked) {
        set_cloudReady(false);
        syncEl.textContent = 'LOCAL';
        return;
    }
    try {
        const configured = window.OcculertBackend && await window.OcculertBackend.isConfigured();
        const user = configured && window.OcculertBackend.currentUser();
        set_cloudReady(!!user);
        syncEl.textContent = cloudReady ? 'ON' : 'LOCAL';
        if (cloudReady)
            void retryCloudSummaries();
        log(cloudReady ? 'Protected cloud sync ready' : configured ? 'Sign in before enabling cloud sync' : 'Cloud sync is not configured - using local mode');
    }
    catch (e) {
        set_cloudReady(false);
        syncEl.textContent = 'LOCAL';
        log('Cloud sync unavailable - using local mode');
    }
}
