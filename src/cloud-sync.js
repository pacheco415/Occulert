import "./camera.js";
import "./detector.js";
import "./calibration.js";
import { fleetPayload } from "./metrics.js";
import "./alerts.js";
import { browserHistoryStore } from "./storage-history.js";
import { createWebEventOutboxAdapter, webEventRetryEnabled } from "./event-outbox-adapter.js";
import { experimentFlags, startupAllowsMonitoring, syncEl, gpsConsent, cloudConsent, running, fatigue, confidence, sessionStart, lastFleetPush, cloudReady, backendSessionId, backendSessionPromise, backendEventQueue, backendSessionGeneration, backendSessionScope, cloudConsentRevision, cloudSummaryOutbox, lastPosition, FLEET_PUSH_INTERVAL, log, localSessionId, set_lastFleetPush, set_cloudReady, set_backendSessionId, set_backendSessionPromise, set_backendEventQueue, set_backendSessionGeneration, set_backendSessionScope, set_cloudSummaryOutbox } from "./ui.js";
// Event authorization is captured at session creation, not at upload time.
// Detaching a stopped session may drain its queue without reviving revoked work.
let backendEventScope = null;
let webEventDelivery = null;
let webEventFreshConsent = false;
export function initializeWebEventConsent() {
    // Some browsers restore dynamic checkbox state across navigation. A fresh
    // retry-capable document always requires an explicit new consent grant.
    if (!experimentFlags.any && webEventRetryEnabled(window.location?.search)) cloudConsent.checked = false;
}
function webEventSharingCurrent(scope) {
    return Boolean(scope && cloudConsent.checked && scope.revision === cloudConsentRevision
        && window.OcculertBackend === scope.backend
        && scope.backend.currentUser()?.id === scope.auth.ownerId);
}
function getWebEventDelivery() {
    if (experimentFlags.any || !webEventRetryEnabled(window.location?.search)) return null;
    if (!webEventDelivery) try { webEventDelivery = createWebEventOutboxAdapter({
        enabled: true, backend: window.OcculertBackend, storage: localStorage, locks: navigator.locks, target: window,
        randomUUID: typeof crypto?.randomUUID === 'function' ? () => crypto.randomUUID() : null,
        isSharingCurrent: webEventSharingCurrent,
        onStatus: status => {
            const element = document.getElementById('cloudEventStatus');
            if (!element) return;
            element.hidden = false;
            const local = (status.capacityRejected || 0) + (status.expired || 0) + (status.permanentRejected || 0) + (status.exhausted || 0) + (status.stopped || 0);
            element.textContent = status.unavailable ? 'Cloud alert retries are unavailable. Local monitoring continues.'
                : status.cleared ? 'Pending cloud alerts cleared.'
                : `Cloud alerts pending: ${status.pending || 0}.${local ? ` ${local} removed without confirmed delivery.` : ''}`;
        },
    }); } catch (_) { return null; }
    if (webEventDelivery.available && webEventFreshConsent) {
        webEventFreshConsent = false;
        void webEventDelivery.beginConsentPeriod();
    }
    return webEventDelivery.available ? webEventDelivery : null;
}
export function changeWebEventConsent() {
    if (experimentFlags.any || !webEventRetryEnabled(window.location?.search)) return;
    // Remember the explicit grant even if accessing browser APIs prevents
    // construction today; recovery must still clear the earlier consent epoch.
    webEventFreshConsent = cloudConsent.checked;
    const delivery = getWebEventDelivery();
    if (delivery && !cloudConsent.checked) void delivery.revoke();
}
function eventScopeCurrent(scope) {
    const current = Boolean(scope && cloudConsent.checked && scope.revision === cloudConsentRevision
        && window.OcculertBackend === scope.backend
        && (scope.backend.isAuthLifecycleCurrent(scope.auth) || webEventDelivery?.isScopeCurrent(scope)));
    if (!current && scope && scope === backendEventScope && running) {
        syncEl.textContent = 'LOCAL';
        if (!scope.notified) log('Cloud alerts paused after an account or sharing change. Local monitoring continues; cloud alerts can resume with your next session.');
        scope.notified = true;
    }
    return current;
}
export function beginBackendSession() {
    if (experimentFlags.any)
        return Promise.resolve(null);
    set_backendSessionScope(cloudSummaryScope());
    backendEventScope = null;
    void retryCloudSummaries();
    const generation = set_backendSessionGeneration(backendSessionGeneration + 1);
    set_backendSessionId(null);
    set_backendSessionPromise(null);
    set_backendEventQueue(Promise.resolve());
    if (!cloudConsent.checked || !cloudReady || !window.OcculertBackend)
        return Promise.resolve(null);
    const backend = window.OcculertBackend;
    const scope = backendEventScope = { backend, revision: cloudConsentRevision, auth: backend.captureAuthLifecycle() };
    set_backendSessionPromise(backend.startSession().then(result => {
        if (!eventScopeCurrent(scope))
            return null;
        if (result.ok && result.body.session) {
            const id = result.body.session.id;
            if (generation === backendSessionGeneration) {
                set_backendSessionId(id);
                syncEl.textContent = 'ON';
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
    getWebEventDelivery()?.trackSession(scope, backendSessionPromise);
    return backendSessionPromise;
}
export function queueBackendEvent(type) {
    if (experimentFlags.any)
        return;
    if (!cloudConsent.checked || !cloudReady || !window.OcculertBackend)
        return;
    const scope = backendEventScope;
    if (!eventScopeCurrent(scope))
        return;
    // Snapshot detection data before waiting for session creation or earlier events.
    const occurredAt = new Date().toISOString();
    const details = { fatigue_score: Math.round(fatigue), confidence: Math.round(confidence) };
    const location = gpsConsent.checked && lastPosition ? { latitude: lastPosition.lat, longitude: lastPosition.lng } : {}, sessionReference = backendSessionPromise || backendSessionId;
    Object.assign(details, location);
    const previous = backendEventQueue;
    const legacy = () => previous.then(() => sessionReference).then(async id => {
        if (!id || !eventScopeCurrent(scope))
            return null;
        const result = await scope.backend.logEvent(id, type, Object.assign({ occurred_at: occurredAt }, details), () => eventScopeCurrent(scope));
        // A rejected occurrence time has not been stored. If the device clock
        // disagrees with the server or session bounds, let the server stamp it
        // on one final attempt under the original owner and sharing scope.
        if (result && result.status === 400 && result.body && result.body.error === 'invalid_occurred_at' && eventScopeCurrent(scope))
            return scope.backend.logEvent(id, type, details, () => eventScopeCurrent(scope));
        return result;
    }).catch(() => null);
    const delivery = getWebEventDelivery();
    const queued = delivery?.queue(scope, sessionReference, type, details, occurredAt, legacy);
    set_backendEventQueue(queued ? Promise.all([previous, queued]).then(() => null).catch(() => null) : legacy());
}
export function detachBackendSession() { const state = { id: backendSessionId, promise: backendSessionPromise, eventQueue: backendEventQueue, consented: cloudConsent.checked, scope: backendSessionScope, endedAt: new Date().toISOString(), localSessionId }; webEventDelivery?.stopSession(backendSessionPromise || backendSessionId); set_backendSessionScope(null); (set_backendSessionGeneration(backendSessionGeneration + 1) - 1); set_backendSessionId(null); set_backendSessionPromise(null); set_backendEventQueue(Promise.resolve()); return state; }
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
        syncEl.textContent = cloudReady && (!running || !backendEventScope || eventScopeCurrent(backendEventScope)) ? 'ON' : 'LOCAL';
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
