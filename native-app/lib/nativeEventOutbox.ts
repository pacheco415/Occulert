import { createEventOutbox, EVENT_OUTBOX_KEY, EVENT_OUTBOX_TTL_MS } from '../../lib/event-outbox.ts';
import type { PendingEvent, EventDelivery } from '../../lib/event-outbox.ts';

export interface NativeEventLifecycle { authVersion: number; consentVersion: number }
export interface NativeEventAuthority {
  ownerId: string;
  loginId: string;
  lifecycle: NativeEventLifecycle;
}
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
interface Metadata { ownerId: string | null; loginId: string | null; version: number; stopped: { sessionId: string; until: number }[] }
export interface NativeEventResult { status: number; body?: { ok?: unknown; client_event_id?: unknown; event?: { session_id?: unknown }; error?: string }; retryAfterMs?: number }
export interface NativeEventRetryStatus {
  pending: number; capacityRejected: number; expired: number; permanentRejected: number; exhausted: number; stopped: number;
  nextAttemptAt: number | null; unavailable?: boolean; cleanupFailed?: boolean;
}
interface Options {
  enabled: boolean;
  storage: Storage;
  randomUUID(): string;
  lifecycle(): NativeEventLifecycle;
  sessionScope(id: string): NativeEventAuthority | null;
  isCurrent(authority: NativeEventAuthority): boolean;
  capability(): Promise<boolean>;
  foreground(): boolean;
  send(event: PendingEvent, delivery: EventDelivery, isCurrent: () => boolean, signal: AbortSignal): Promise<NativeEventResult>;
  onStatus?(status: NativeEventRetryStatus): void;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}
const META_KEY = 'occulert.native-event-outbox.lifecycle.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sameLifecycle = (a: NativeEventLifecycle, b: NativeEventLifecycle) => a.authVersion === b.authVersion && a.consentVersion === b.consentVersion;
const emptyStatus = (): NativeEventRetryStatus => ({ pending: 0, capacityRejected: 0, expired: 0, permanentRejected: 0, exhausted: 0, stopped: 0, nextAttemptAt: null });

/** One live JS service owns this store. A new process never restores unknown sessions. */
export function createNativeEventOutbox(options: Options) {
  const now = options.now ?? Date.now, schedule = options.setTimeout ?? setTimeout, cancel = options.clearTimeout ?? clearTimeout;
  type Reference = { lifecycle: NativeEventLifecycle; ended: boolean; sessionId: string | null; epoch: number };
  type Context = { authority: NativeEventAuthority; version: number; epoch: number };
  const references = new Map<Promise<string | null> | string, Reference>(), ended = new Map<string, number>(), controllers = new Set<AbortController>();
  let epoch = 0, blocked = false, context: Context | null = null, core: ReturnType<typeof createEventOutbox> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null, flight: Promise<void> | null = null;
  let lifecycleTail: Promise<unknown> = Promise.resolve(), adoption: Promise<Context | null> | null = null;
  let storageTail: Promise<unknown> = Promise.resolve();
  let status = emptyStatus();
  const enabled = options.enabled === true;
  const report = (value: NativeEventRetryStatus) => { status = { ...value }; try { options.onStatus?.({ ...status }); } catch {} };
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const result = lifecycleTail.catch(() => {}).then(work); lifecycleTail = result; return result; };
  const currentAuthority = (authority: NativeEventAuthority) => {
    try { return options.isCurrent(authority) === true && sameLifecycle(authority.lifecycle, options.lifecycle()); } catch { return false; }
  };
  const current = (expected: Context | null): expected is Context => enabled && !blocked && expected !== null
    && expected === context && expected.epoch === epoch && currentAuthority(expected.authority);
  const sessionCurrent = (expected: Context, id: string) => current(expected) && (ended.get(id) ?? 0) <= now()
    && ![...references.values()].some(reference => reference.ended && reference.sessionId === id);
  const abort = () => {
    if (timer !== null) cancel(timer); timer = null;
    for (const controller of controllers) controller.abort();
  };
  function storeOperation<T>(work: () => Promise<T>, mutation = false): Promise<T> {
    const revision = epoch;
    // A timed-out native write may still commit. Keep its actual promise in
    // this barrier so a later cleanup/adoption cannot overtake it.
    const actual = storageTail.catch(() => {}).then(() => {
      if (mutation && revision !== epoch) throw Error('Native event scope changed');
      return work();
    });
    storageTail = actual;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = schedule(() => {
        epoch++; blocked = true; abort();
        report({ ...status, unavailable: true, cleanupFailed: true });
        reject(Error('Native event storage timed out'));
      }, 8_000);
    });
    return Promise.race([actual, deadline]).finally(() => cancel(timeout));
  }
  const store: Storage = {
    getItem: key => storeOperation(() => options.storage.getItem(key)),
    setItem: (key, value) => storeOperation(() => options.storage.setItem(key, value), true),
    removeItem: key => storeOperation(() => options.storage.removeItem(key)),
  };
  async function metadata(): Promise<Metadata | null> {
    const raw = await store.getItem(META_KEY);
    if (raw === null) return null;
    if (raw.length > 16_000) throw Error('Invalid native event lifecycle');
    const value = JSON.parse(raw) as Metadata;
    if (!value || Object.keys(value).sort().join(',') !== 'loginId,ownerId,stopped,version'
      || !Number.isSafeInteger(value.version) || value.version < 0
      || !((value.ownerId === null && value.loginId === null) || (typeof value.ownerId === 'string' && UUID.test(value.ownerId) && typeof value.loginId === 'string' && UUID.test(value.loginId)))
      || !Array.isArray(value.stopped) || value.stopped.length > 50
      || value.stopped.some(row => !row || Object.keys(row).sort().join(',') !== 'sessionId,until'
        || typeof row.sessionId !== 'string' || !UUID.test(row.sessionId) || !Number.isFinite(row.until))) throw Error('Invalid native event lifecycle');
    return value;
  }
  function nextVersion(previous: Metadata | null): number {
    const value = previous ? previous.version + 1 : Math.max(0, now());
    if (!Number.isSafeInteger(value)) throw Error('Native event lifecycle exhausted');
    return value;
  }
  function createCore() {
    return createEventOutbox(store, scope => current(context)
      && scope.ownerId === context.authority.ownerId && scope.consentVersion === context.version,
    { enabled: true, idempotencyVerified: true, now });
  }
  async function adopt(authority: NativeEventAuthority, revision: number): Promise<Context | null> {
    await lifecycleTail.catch(() => {});
    if (revision !== epoch || blocked || !currentAuthority(authority)) return null;
    if (current(context) && context.authority.ownerId === authority.ownerId && context.authority.loginId === authority.loginId
      && sameLifecycle(context.authority.lifecycle, authority.lifecycle)) return context;
    if (adoption) return adoption;
    const work = (async () => {
      if (!await options.capability()) return null;
      return serial(async () => {
        if (revision !== epoch || blocked || !currentAuthority(authority)) return null;
        const previous = await metadata();
        if (revision !== epoch || blocked || !currentAuthority(authority)) return null;
        // Cold process or new consent/login: unknown prior sessions cannot be
        // replayed. Existing sharing preference is owned by the caller.
        if (core) await core.clear(); else await store.removeItem(EVENT_OUTBOX_KEY);
        if (revision !== epoch || blocked || !currentAuthority(authority)) return null;
        const version = nextVersion(previous);
        await store.setItem(META_KEY, JSON.stringify({ ownerId: authority.ownerId, loginId: authority.loginId, version, stopped: [] }));
        if (revision !== epoch || blocked || !currentAuthority(authority)) return null;
        const expected = { authority: { ...authority, lifecycle: { ...authority.lifecycle } }, version, epoch: revision };
        context = expected; if (!core) core = createCore();
        return expected;
      });
    })();
    adoption = work;
    try { return await work; } finally { if (adoption === work) adoption = null; }
  }
  async function refreshStatus(expected: Context) {
    if (!current(expected) || !core) return;
    const value = await core.status({ ownerId: expected.authority.ownerId, consentVersion: expected.version });
    if (!current(expected)) return;
    report(value);
    if (timer !== null) cancel(timer); timer = null;
    if (options.foreground() && value.pending > 0 && value.nextAttemptAt !== null) {
      timer = schedule(() => { timer = null; void flush(); }, Math.max(25, value.nextAttemptAt - now()));
    }
  }
  async function send(expected: Context, event: PendingEvent, delivery: EventDelivery) {
    const controller = new AbortController(); controllers.add(controller);
    const allowed = () => !controller.signal.aborted && options.foreground() && Date.parse(event.expires_at) > now() && sessionCurrent(expected, event.session_id);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<NativeEventResult>(resolve => { timeout = schedule(() => { controller.abort(); resolve({ status: 0 }); }, 8_000); });
    try {
      if (!allowed()) return { status: 0 };
      const result = await Promise.race([options.send(event, delivery, allowed, controller.signal), deadline]);
      if (controller.signal.aborted || Date.parse(event.expires_at) <= now()) return { status: 0 };
      if (!sessionCurrent(expected, event.session_id)) return { status: 410 };
      if (result.status >= 200 && result.status < 300 && (result.body?.ok !== true
        || result.body.client_event_id !== event.event_id || result.body.event?.session_id !== event.session_id)) return { status: 0 };
      return { status: result.status, error: result.body?.error, retryAfterMs: result.retryAfterMs };
    } catch { return { status: 0 }; }
    finally { cancel(timeout); controllers.delete(controller); }
  }
  async function flush(): Promise<void> {
    if (flight) return flight;
    const expected = context;
    if (!current(expected) || !core || !options.foreground()) return;
    let expired = false;
    const bound = schedule(() => { expired = true; for (const controller of controllers) controller.abort(); }, 8_000);
    const work = (async () => {
      await core!.flush({ ownerId: expected.authority.ownerId, consentVersion: expected.version },
        (event, delivery) => expired ? Promise.resolve({ status: 0 }) : send(expected, event, delivery));
      await refreshStatus(expected);
    })().catch(() => { blocked = true; abort(); report({ ...status, unavailable: true }); });
    flight = work;
    try { await work; } finally { cancel(bound); if (flight === work) flight = null; }
  }
  function queue(session: Promise<string | null>, type: PendingEvent['type'], fatigue: number | null, confidence: number | null,
    occurredAt: string, legacy: (sessionId: string) => Promise<unknown>): Promise<void> | null {
    if (!enabled) return null;
    let eventId: string;
    try { eventId = options.randomUUID(); } catch { return null; }
    if (!UUID.test(eventId) || !Number.isFinite(Date.parse(occurredAt)) || new Date(occurredAt).toISOString() !== occurredAt) return null;
    const snapshot: PendingEvent = { event_id: eventId, session_id: '', type, fatigue, confidence, detected_at: occurredAt,
      expires_at: new Date(Date.parse(occurredAt) + EVENT_OUTBOX_TTL_MS).toISOString() };
    let reference = references.get(session);
    if (!reference) { reference = { lifecycle: { ...options.lifecycle() }, ended: false, sessionId: null, epoch }; references.set(session, reference); }
    const captured = reference;
    return (async () => {
      const id = await session; captured.sessionId = id;
      if (!id || captured.ended || captured.epoch !== epoch || !sameLifecycle(captured.lifecycle, options.lifecycle())) return;
      const authority = options.sessionScope(id);
      if (!authority) {
        // Missing local login hints disable adoption, not an otherwise current
        // legacy cloud session. Its callback still enforces original consent
        // and owner. No queued/attempted event reaches this pre-adoption path.
        if (!blocked && (ended.get(id) ?? 0) <= now()
          && ![...references.values()].some(reference => reference.ended && reference.sessionId === id)) await legacy(id);
        return;
      }
      if (!sameLifecycle(authority.lifecycle, captured.lifecycle) || !currentAuthority(authority)) return;
      try {
        const expected = await adopt(authority, captured.epoch);
        if (!expected) {
          if (!blocked && captured.epoch === epoch && !captured.ended && currentAuthority(authority)) await legacy(id);
          return;
        }
        if (captured.ended || !sessionCurrent(expected, id)) return;
        snapshot.session_id = id;
        await core!.enqueue({ ownerId: expected.authority.ownerId, consentVersion: expected.version }, snapshot);
        await refreshStatus(expected); await flush();
      } catch { blocked = true; abort(); report({ ...status, unavailable: true, cleanupFailed: true }); }
    })().catch(() => {});
  }
  function stopSession(session: Promise<string | null> | string) {
    if (!enabled) return;
    let reference = references.get(session);
    if (!reference) { reference = { lifecycle: { ...options.lifecycle() }, ended: true, sessionId: typeof session === 'string' ? session : null, epoch }; references.set(session, reference); }
    reference.ended = true; abort();
    for (const [id, until] of ended) if (until <= now()) ended.delete(id);
    if (reference.sessionId) ended.set(reference.sessionId, now() + EVENT_OUTBOX_TTL_MS);
    const expected = context;
    void Promise.resolve(session).then(async id => {
      if (id) ended.set(id, now() + EVENT_OUTBOX_TTL_MS);
      try {
        if (!id || !current(expected) || !core) return;
        const invalidation = core.invalidateSession({ ownerId: expected.authority.ownerId, consentVersion: expected.version }, id);
        await serial(async () => {
          if (!current(expected)) return;
          const previous = await metadata();
          if (!current(expected) || !previous) return;
          previous.stopped = previous.stopped.filter(row => row.until > now() && row.sessionId !== id);
          if (previous.stopped.length >= 50) throw Error('Native stopped session bound reached');
          previous.stopped.push({ sessionId: id, until: now() + EVENT_OUTBOX_TTL_MS });
          await store.setItem(META_KEY, JSON.stringify(previous));
        });
        await invalidation; await refreshStatus(expected);
      } catch { blocked = true; abort(); report({ ...status, unavailable: true, cleanupFailed: true }); }
      finally { references.delete(session); }
    }).catch(() => { references.delete(session); });
  }
  function revoke(): Promise<void> {
    if (!enabled) return Promise.resolve();
    const revision = ++epoch;
    blocked = true; abort(); context = null;
    for (const reference of references.values()) reference.ended = true;
    const clearing = core?.clear() ?? store.removeItem(EVENT_OUTBOX_KEY);
    void clearing.catch(() => {});
    return serial(async () => {
      const previous = await metadata();
      await clearing;
      await store.setItem(META_KEY, JSON.stringify({ ownerId: null, loginId: null, version: nextVersion(previous), stopped: [] }));
      if (revision !== epoch) return;
      blocked = false; ended.clear(); references.clear(); report(emptyStatus());
    }).catch(() => { if (revision === epoch || blocked) report({ ...status, unavailable: true, cleanupFailed: true }); });
  }
  function foregroundChanged() { if (!enabled) return; if (options.foreground()) void flush(); else abort(); }
  return { queue, stopSession, revoke, flush, foregroundChanged, status: () => ({ ...status }) };
}
