import "./camera.js";
import "./detector.js";
import "./calibration.js";
import "./metrics.js";
import { alerts } from "./alerts.js";
import "./cloud-sync.js";
import { fatigue, sessionStart, headNods, microsleeps, log, localSessionId, _sessionLog } from "./ui.js";
export function createLocalDriverId() {
    try {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
            return 'local-' + globalThis.crypto.randomUUID();
        if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
            const bytes = new Uint8Array(16);
            globalThis.crypto.getRandomValues(bytes);
            return 'local-' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
        }
    }
    catch (e) { }
    return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}
export function normalizeLocalDriverId(value) { const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80); return !id || /^D-\d{3}$/.test(id) ? createLocalDriverId() : id; }
export function browserHistoryStore() {
    if (!window.OcculertLocalHistory)
        throw Error('Local history support is unavailable');
    return window.OcculertLocalHistory.create(localStorage);
}
export function rewriteStoredDriverId(key, oldId, newId) {
    try {
        if (key === 'occulert-session-history') {
            if (localStorage.getItem(key) === null)
                return;
            browserHistoryStore().update(rows => rows.map(row => row.driverId === oldId ? { ...row, driverId: newId } : row));
            return;
        }
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        let changed = false;
        if (Array.isArray(value))
            value.forEach(item => {
                if (item && item.driverId === oldId) {
                    item.driverId = newId;
                    changed = true;
                }
            });
        else if (value && value.driverId === oldId) {
            value.driverId = newId;
            changed = true;
        }
        if (changed)
            localStorage.setItem(key, JSON.stringify(value));
    }
    catch (e) { }
}
export function migrateLocalDriverIdentity(value) {
    const oldId = String(value || '').trim(), newId = normalizeLocalDriverId(oldId);
    if (oldId && oldId !== newId)
        ['occulert-profile', 'occulert-live-session', 'occulert-session-history', 'occulert-drivers'].forEach(key => rewriteStoredDriverId(key, oldId, newId));
    localStorage.setItem('occulert-driver-id', newId);
    return newId;
}
export function saveLocalSessionHistory(payload) {
    if (!sessionStart || !localSessionId)
        return null;
    try {
        const existing = browserHistoryStore().load();
        const prior = existing.find(row => row && (row.id === localSessionId || row.sessionId === localSessionId));
        if (prior)
            return prior;
        const stoppedAt = new Date().toISOString();
        const saved = { ...payload, id: localSessionId, sessionId: localSessionId, startedAt: new Date(sessionStart).toISOString(), endedAt: stoppedAt, savedAt: stoppedAt };
        browserHistoryStore().update(rows => [saved, ...rows.filter(row => row.id !== localSessionId && row.sessionId !== localSessionId)].slice(0, 50));
        return saved;
    }
    catch (error) {
        log('Local history could not be saved. Copy the session report before leaving.');
        return null;
    }
}
export function setMonitoringUi(active) {
    document.body.classList.toggle('monitoring-active', active);
    const parkedControls = document.getElementById('parkedControls');
    if (parkedControls)
        parkedControls.hidden = active;
    const intensityToggle = document.getElementById('intensityToggle');
    if (intensityToggle)
        intensityToggle.disabled = active;
    for (const badgeId of ['trackingBadge', 'lightBadge', 'batteryBadge']) {
        const badge = document.getElementById(badgeId);
        if (badge)
            badge.style.display = 'none';
    }
}
export function logEvent(type, value, extra) { _sessionLog.push({ ts: Date.now(), type, value, extra: extra || '' }); }
export function exportCSV() {
    if (!_sessionLog.length) {
        // Generate from current session state
        _sessionLog.push({ ts: Date.now(), type: 'snapshot', value: fatigue, extra: 'alerts=' + alerts + ',microsleeps=' + microsleeps + ',nods=' + headNods });
    }
    const rows = _sessionLog.map(e => [new Date(e.ts).toISOString(), e.type, e.value, e.extra].map(v => '"' + OcculertSecurity.csvCell(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['Timestamp,Type,Value,Extra\n' + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'occulert-session-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('CSV exported: ' + _sessionLog.length + ' events');
}
