import { createEventOutbox, EVENT_OUTBOX_KEY } from '../lib/event-outbox.ts';

export function webEventRetryEnabled(search) {
    try {
        const values = new URLSearchParams(search || '').getAll('event-outbox');
        return values.length === 1 && values[0] === '1';
    } catch (_) { return false; }
}

// This identity distinguishes login sessions locally across a controller
// restart. It is never sent as authority or retained with an event payload.
export function webEventLoginIdentity(backend) {
    try {
        const auth = backend.captureAuthContext().auth;
        const encoded = auth.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(atob(encoded));
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuid.test(claims.session_id) && claims.sub === auth.user.id
            ? { ownerId: auth.user.id, loginId: claims.session_id } : null;
    } catch (_) { return null; }
}

export function createWebEventOutboxAdapter(options) {
    const unavailable = { available: false, trackSession() {}, queue() { return null; }, stopSession() {}, beginConsentPeriod() { return Promise.resolve(); }, revoke() { return Promise.resolve(); }, isScopeCurrent() { return false; }, flush() { return Promise.resolve(); }, dispose() {} };
    // Nothing below this gate reads storage, creates listeners or contacts a
    // provider. Browsers without ownership locks keep the legacy send path.
    if (options.enabled !== true || typeof options.locks?.request !== 'function'
        || typeof options.randomUUID !== 'function'
        || typeof options.backend?.eventOutboxCapability !== 'function'
        || typeof options.backend?.logQueuedEvent !== 'function') return unavailable;
    const backend = options.backend, storage = options.storage, target = options.target;
    const now = options.now || Date.now, schedule = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const identity = options.loginIdentity || (() => webEventLoginIdentity(backend));
    const visibilityTarget = options.visibilityTarget || target.document || target;
    const foreground = options.isForeground || (() => target.document?.visibilityState !== 'hidden');
    const connected = options.isOnline || (() => target.navigator?.onLine !== false);
    const metadataKey = 'occulert.event-outbox.lifecycle.v1', lockName = 'occulert.event-outbox.owner.v1';
    const ttl = 15 * 60_000, references = new Map(), controllers = new Set(), endedSessions = new Map();
    let epoch = 0, context = null, core = null, blocked = false, timer = null, listening = false, flushing = null;
    let owned = false, ownership = null, releaseOwner = null, consentFlight = null, closed = false;
    let freshConsent = false;
    let adoptedLogin = null;
    const statusChanged = value => { try { options.onStatus?.(value); } catch (_) {} };
    const sharingCurrent = original => {
        try { return options.isSharingCurrent(original) === true; } catch (_) { return false; }
    };
    const matchingIdentity = expected => {
        const current = identity();
        return !!current && current.ownerId === expected.ownerId && current.loginId === expected.loginId;
    };
    const readMetadata = () => {
        const raw = storage.getItem(metadataKey);
        if (raw === null) return null;
        if (typeof raw !== 'string' || raw.length > 16_000) throw Error('Invalid cloud retry lifecycle');
        const value = JSON.parse(raw);
        if (!value || Object.keys(value).sort().join(',') !== 'loginId,ownerId,stopped,version'
            || !Number.isSafeInteger(value.version) || value.version < 0
            || !((value.ownerId === null && value.loginId === null) || (typeof value.ownerId === 'string' && typeof value.loginId === 'string'))
            || !Array.isArray(value.stopped) || value.stopped.length > 50
            || value.stopped.some(row => !row || Object.keys(row).sort().join(',') !== 'sessionId,until'
                || typeof row.sessionId !== 'string' || row.sessionId.length > 128 || !Number.isFinite(row.until))) throw Error('Invalid cloud retry lifecycle');
        return value;
    };
    const nextVersion = metadata => {
        const next = metadata ? metadata.version + 1 : Math.max(0, now());
        if (!Number.isSafeInteger(next)) throw Error('Cloud retry lifecycle exhausted');
        return next;
    };
    const validContext = expected => {
        if (!owned || blocked || !expected || expected.epoch !== epoch || !sharingCurrent(expected.original) || !matchingIdentity(expected)) return false;
        try {
            const metadata = readMetadata();
            return metadata?.version === expected.version && metadata.ownerId === expected.ownerId && metadata.loginId === expected.loginId;
        } catch (_) { return false; }
    };
    const sessionAllowed = (expected, sessionId) => {
        if ((endedSessions.get(sessionId) || 0) > now() || [...references.values()].some(reference => reference.ended && reference.sessionId === sessionId) || !validContext(expected)) return false;
        try { return !readMetadata().stopped.some(row => row.sessionId === sessionId && row.until > now()); }
        catch (_) { return false; }
    };
    const abortWork = () => {
        if (timer !== null) cancel(timer);
        timer = null;
        for (const controller of controllers) controller.abort();
    };
    async function locked(work) {
        const controller = new AbortController(), deadline = schedule(() => controller.abort(), 8_000);
        try { return await options.locks.request(lockName, { mode: 'exclusive', signal: controller.signal }, work); }
        finally { cancel(deadline); }
    }
    async function acquireOwner(requestedEpoch) {
        if (requestedEpoch !== epoch || closed) return false;
        if (owned) return true;
        if (ownership) return ownership;
        let decided;
        const decision = new Promise(resolve => { decided = resolve; });
        const held = new Promise(resolve => { releaseOwner = resolve; });
        void options.locks.request('occulert.event-outbox.live-tab.v1', { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (!lock || closed || requestedEpoch !== epoch) { decided(false); return; }
            owned = true; decided(true);
            await held;
            owned = false;
        }).catch(() => { decided(false); });
        ownership = decision;
        try { return await decision; } finally { if (ownership === decision) ownership = null; }
    }
    function releaseOwnership() {
        owned = false;
        if (releaseOwner) releaseOwner();
        releaseOwner = null;
    }
    function beginConsentPeriod() {
        const version = ++epoch;
        freshConsent = true;
        abortWork(); context = null;
        for (const reference of references.values()) reference.invalidated = true;
        references.clear();
        const work = (async () => {
            const login = identity();
            if (!login || !await backend.eventOutboxCapability() || !await acquireOwner(version)) return;
            // An older grant cannot release a lease now shared with a newer
            // grant. Revocation/disposal own their synchronous invalidation
            // and eventual lease release; acquisition rejects stale epochs.
            if (version !== epoch || closed || !matchingIdentity(login)) return;
            await locked(async () => {
                if (version !== epoch || closed || !matchingIdentity(login)) return;
                const metadata = readMetadata();
                storage.removeItem(EVENT_OUTBOX_KEY);
                storage.setItem(metadataKey, JSON.stringify({ version: nextVersion(metadata), ...login, stopped: [] }));
                if (core) await core.clear();
                endedSessions.clear(); blocked = false; freshConsent = false;
                adoptedLogin = login;
                listen();
            });
        })().catch(() => { blocked = true; statusChanged({ unavailable: true, cleanupFailed: true }); });
        consentFlight = work;
        return work;
    }
    async function revoke() {
        const expected = context || adoptedLogin || [...references.values()].find(row => row.identity)?.identity || null;
        epoch++; blocked = true; abortWork();
        for (const reference of references.values()) reference.invalidated = true;
        context = null;
        // A tab that never owned retries must not clear a consenting tab's
        // queue merely because its own unchecked checkbox or page changed.
        if (!owned) { blocked = false; return; }
        try {
            await locked(async () => {
                const metadata = readMetadata();
                // A late cleanup must never erase another login's new records.
                if (expected && metadata?.ownerId !== null && metadata && (metadata.ownerId !== expected.ownerId || metadata.loginId !== expected.loginId)) return;
                storage.setItem(metadataKey, JSON.stringify({ version: nextVersion(metadata), ownerId: null, loginId: null, stopped: [] }));
                if (core) await core.clear(); else storage.removeItem(EVENT_OUTBOX_KEY);
            });
            blocked = false;
            adoptedLogin = null;
            releaseOwnership();
            statusChanged({ pending: 0, cleared: true });
        } catch (_) {
            statusChanged({ unavailable: true, cleanupFailed: true });
        }
    }
    function storageChanged(event) {
        if (event.key === 'occulert-auth' || event.key === null) {
            if ((context || adoptedLogin) && !matchingIdentity(context || adoptedLogin)) void revoke();
        } else if (event.key === metadataKey && context && !validContext(context)) {
            // Another tab owns a newer consent period. Invalidate this tab but
            // leave its newer queue untouched.
            epoch++; abortWork(); context = null;
            for (const reference of references.values()) reference.invalidated = true;
            statusChanged({ unavailable: true });
        }
    }
    const authChanged = () => { void revoke(); };
    const online = () => { void flush(); };
    const visibilityChanged = () => { if (foreground()) void flush(); else abortWork(); };
    function listen() {
        if (listening) return;
        listening = true;
        target.addEventListener('storage', storageChanged);
        target.addEventListener('occulert:auth-lifecycle', authChanged);
        target.addEventListener('online', online);
        visibilityTarget.addEventListener('visibilitychange', visibilityChanged);
    }
    function createCore() {
        return createEventOutbox({
            getItem: async key => storage.getItem(key), setItem: async (key, value) => storage.setItem(key, value), removeItem: async key => storage.removeItem(key),
        }, scope => validContext(context) && scope.ownerId === context.ownerId && scope.consentVersion === context.version,
        { enabled: true, idempotencyVerified: true, now });
    }
    async function initialize(reference) {
        const version = epoch;
        if (consentFlight) await consentFlight;
        if (reference.invalidated || reference.ended || !sharingCurrent(reference.original) || !reference.identity || !matchingIdentity(reference.identity)) return null;
        if (!await backend.eventOutboxCapability()) return null;
        if (!await acquireOwner(version)) return null;
        if (version !== epoch || blocked || reference.invalidated || reference.ended || !sharingCurrent(reference.original) || !matchingIdentity(reference.identity)) return null;
        return locked(async () => {
            if (version !== epoch || blocked || reference.invalidated || reference.ended || !sharingCurrent(reference.original) || !matchingIdentity(reference.identity)) return null;
            let metadata = readMetadata();
            if (freshConsent || !metadata || metadata.ownerId !== reference.identity.ownerId || metadata.loginId !== reference.identity.loginId) {
                metadata = { version: nextVersion(metadata), ...reference.identity, stopped: [] };
                // New owner/consent cannot inherit an older queue. Cleanup must
                // succeed before the lifecycle can authorize any send.
                storage.removeItem(EVENT_OUTBOX_KEY);
                storage.setItem(metadataKey, JSON.stringify(metadata));
                freshConsent = false;
            }
            const expected = { ...reference.identity, original: reference.original, version: metadata.version, epoch: version };
            context = expected;
            adoptedLogin = reference.identity;
            if (!core) core = createCore();
            listen();
            return expected;
        });
    }
    async function updateStatus(expected) {
        if (!validContext(expected)) return;
        const status = await core.status({ ownerId: expected.ownerId, consentVersion: expected.version });
        if (!validContext(expected)) return;
        statusChanged(status);
        if (timer !== null) cancel(timer);
        timer = null;
        if (foreground() && connected() && status.nextAttemptAt !== null && status.pending > 0) {
            timer = schedule(() => { timer = null; void flush(); }, Math.max(25, status.nextAttemptAt - now()));
        }
    }
    async function send(expected, event, delivery) {
        if (!foreground() || !connected() || Date.parse(event.expires_at) <= now()) return { status: 0 };
        if (!sessionAllowed(expected, event.session_id)) return { status: 410 };
        const controller = new AbortController(); controllers.add(controller);
        let timeout;
        const deadline = new Promise(resolve => { timeout = schedule(() => { controller.abort(); resolve({ status: 0 }); }, 8_000); });
        const details = { client_event_id: event.event_id, fatigue_score: event.fatigue, confidence: event.confidence };
        if (delivery.timestampMode === 'detected') details.occurred_at = event.detected_at;
        try {
            const result = await Promise.race([
                backend.logQueuedEvent(event.session_id, event.type === 'drowsiness' ? 'drowsy' : event.type, details,
                    () => !controller.signal.aborted && foreground() && connected() && Date.parse(event.expires_at) > now() && sessionAllowed(expected, event.session_id), { signal: controller.signal }),
                deadline,
            ]);
            if (controller.signal.aborted || Date.parse(event.expires_at) <= now()) return { status: 0 };
            if (!sessionAllowed(expected, event.session_id)) return { status: 410 };
            if (result.status >= 200 && result.status < 300) {
                if (result.body?.ok !== true || result.body?.client_event_id !== event.event_id || result.body?.event?.session_id !== event.session_id) return { status: 0 };
            }
            return { status: result.status, error: result.body?.error, retryAfterMs: result.retryAfterMs };
        } catch (_) { return { status: 0 }; }
        finally { cancel(timeout); controllers.delete(controller); }
    }
    async function flush() {
        if (flushing) return flushing;
        const expected = context;
        if (!foreground() || !connected() || !validContext(expected)) return;
        let expired = false;
        const bound = schedule(() => { expired = true; for (const controller of controllers) controller.abort(); }, 8_000);
        const work = locked(async () => {
            if (!validContext(expected)) return;
            await core.flush({ ownerId: expected.ownerId, consentVersion: expected.version }, (event, delivery) => expired ? Promise.resolve({ status: 0 }) : send(expected, event, delivery));
            await updateStatus(expected);
        }).catch(() => { blocked = true; abortWork(); statusChanged({ unavailable: true }); });
        flushing = work;
        try { await work; } finally { cancel(bound); if (flushing === work) flushing = null; }
    }
    function trackSession(original, sessionReference) {
        const previous = references.get(sessionReference);
        if (previous) return;
        references.set(sessionReference, { original, identity: identity(), sessionId: typeof sessionReference === 'string' ? sessionReference : null, ended: false, invalidated: false });
    }
    function queue(original, sessionReference, type, details, occurredAt, legacy) {
        const reference = references.get(sessionReference);
        if (!reference || !reference.identity || !['drowsy', 'distracted', 'yawn', 'head_nod'].includes(type)) return null;
        let eventId;
        try { eventId = options.randomUUID(); } catch (_) { return null; }
        const snapshot = { event_id: eventId, session_id: '', type, detected_at: occurredAt,
            expires_at: new Date(Date.parse(occurredAt) + ttl).toISOString(), fatigue: details.fatigue_score, confidence: details.confidence };
        const capturedEpoch = epoch;
        return (async () => {
            let expected;
            try { expected = await initialize(reference); }
            catch (_) { blocked = true; statusChanged({ unavailable: true, cleanupFailed: true }); return; }
            if (!expected) {
                // This is only a pre-adoption capability fallback. Once work
                // may be persisted or sent, errors never remove its key.
                if (!blocked && capturedEpoch === epoch && !reference.ended && !reference.invalidated && sharingCurrent(original)) await legacy();
                return;
            }
            const sessionId = await sessionReference;
            reference.sessionId = sessionId;
            if (!sessionId || reference.ended || reference.invalidated || capturedEpoch !== epoch || !sessionAllowed(expected, sessionId)) return;
            snapshot.session_id = sessionId;
            try {
                await locked(async () => {
                    if (reference.ended || reference.invalidated || !sessionAllowed(expected, sessionId)) return;
                    await core.enqueue({ ownerId: expected.ownerId, consentVersion: expected.version }, snapshot);
                    await updateStatus(expected);
                });
                await flush();
            } catch (_) { blocked = true; abortWork(); statusChanged({ unavailable: true, cleanupFailed: true }); }
        })();
    }
    function stopSession(sessionReference) {
        const reference = references.get(sessionReference);
        if (!reference) return;
        reference.ended = true; abortWork();
        for (const [id, until] of endedSessions) if (until <= now()) endedSessions.delete(id);
        if (reference.sessionId) endedSessions.set(reference.sessionId, now() + ttl);
        const expected = context;
        void Promise.resolve(sessionReference).then(async sessionId => {
            try {
                if (sessionId) endedSessions.set(sessionId, now() + ttl);
                if (!sessionId || !validContext(expected)) return;
                await locked(async () => {
                    if (!validContext(expected)) return;
                    const metadata = readMetadata();
                    metadata.stopped = metadata.stopped.filter(row => row.until > now() && row.sessionId !== sessionId);
                    if (metadata.stopped.length >= 50) throw Error('Cloud retry session bound reached');
                    metadata.stopped.push({ sessionId, until: now() + ttl });
                    storage.setItem(metadataKey, JSON.stringify(metadata));
                    await core.invalidateSession({ ownerId: expected.ownerId, consentVersion: expected.version }, sessionId);
                    await updateStatus(expected);
                });
            } catch (_) { blocked = true; statusChanged({ unavailable: true, cleanupFailed: true }); }
            finally { references.delete(sessionReference); }
        }).catch(() => { references.delete(sessionReference); });
    }
    function isScopeCurrent(original) {
        return validContext(context) && [...references.values()].some(reference => reference.original === original && !reference.invalidated
            && reference.identity && sharingCurrent(original) && matchingIdentity(reference.identity));
    }
    function dispose() {
        epoch++; blocked = true; closed = true; abortWork(); releaseOwnership();
        if (listening) {
            target.removeEventListener('storage', storageChanged);
            target.removeEventListener('occulert:auth-lifecycle', authChanged);
            target.removeEventListener('online', online);
            visibilityTarget.removeEventListener('visibilitychange', visibilityChanged);
        }
        listening = false;
    }
    return { available: true, trackSession, queue, stopSession, beginConsentPeriod, revoke, isScopeCurrent, flush, dispose };
}
