/** Shared, transport-free event delivery engine. Applications supply authorization and transport. */
export const EVENT_OUTBOX_KEY = 'occulert.event-outbox.v1';
export const EVENT_OUTBOX_LIMIT = 50;
export const EVENT_OUTBOX_TTL_MS = 15 * 60_000;
export const EVENT_OUTBOX_MAX_ATTEMPTS = 5;
const MAX_BYTES = 64_000;
export interface EventScope { ownerId: string; consentVersion: number }
export interface PendingEvent {
  event_id: string;
  session_id: string;
  detected_at: string;
  expires_at: string;
  type: 'drowsiness' | 'drowsy' | 'distracted' | 'yawn' | 'head_nod';
  fatigue: number | null;
  confidence: number | null;
}
export interface EventDelivery { timestampMode: 'detected' | 'server' }
interface Row extends EventDelivery { event: PendingEvent; attempts: number; nextAttemptAt: number }
interface EventCounters { capacityRejected: number; expired: number; permanentRejected: number; exhausted: number; stopped: number }
interface State { scope: EventScope; rows: Row[]; counters: EventCounters }
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface EventSendResult { status: number; error?: string; retryAfterMs?: number }
interface Options {
  /** Both gates must be explicitly true. They are not proof of server support. */
  enabled?: boolean;
  idempotencyVerified?: boolean;
  now?: () => number;
}
const sameScope = (a: EventScope, b: EventScope) => a.ownerId === b.ownerId && a.consentVersion === b.consentVersion;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const eventCounterNames = ['capacityRejected', 'expired', 'permanentRejected', 'exhausted', 'stopped'] as const;
const eventEmptyCounters = (): EventCounters => ({ capacityRejected: 0, expired: 0, permanentRejected: 0, exhausted: 0, stopped: 0 });
function validScope(scope: unknown): scope is EventScope {
  return object(scope) && exactKeys(scope, ['ownerId', 'consentVersion']) && typeof scope.ownerId === 'string' && /^[\w-]{1,128}$/.test(scope.ownerId) && Number.isSafeInteger(scope.consentVersion) && Number(scope.consentVersion) >= 0;
}
function validateEvent(value: unknown): asserts value is PendingEvent {
  if (!object(value) || !exactKeys(value, ['event_id', 'session_id', 'detected_at', 'expires_at', 'type', 'fatigue', 'confidence'])
    || !['event_id', 'session_id'].every(key => typeof value[key] === 'string' && /^[\w-]{1,128}$/.test(value[key] as string))
    || !iso(value.detected_at) || !iso(value.expires_at)
    || Date.parse(value.expires_at) <= Date.parse(value.detected_at)
    || Date.parse(value.expires_at) - Date.parse(value.detected_at) > EVENT_OUTBOX_TTL_MS
    || !['drowsiness', 'drowsy', 'distracted', 'yawn', 'head_nod'].includes(String(value.type))
    || !['fatigue', 'confidence'].every(key => value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 100))) {
    throw new Error('Invalid pending event');
  }
}
function parse(raw: string | null): State | null {
  if (raw === null) return null;
  if (raw.length > MAX_BYTES) throw new Error('Event outbox exceeds storage bound');
  const state: unknown = JSON.parse(raw);
  if (!object(state) || !(exactKeys(state, ['scope', 'rows']) || exactKeys(state, ['scope', 'rows', 'counters'])) || !validScope(state.scope) || !Array.isArray(state.rows) || state.rows.length > EVENT_OUTBOX_LIMIT) throw new Error('Invalid event outbox');
  if (!Object.hasOwn(state, 'counters')) state.counters = eventEmptyCounters();
  if (!object(state.counters) || !exactKeys(state.counters, [...eventCounterNames]) || eventCounterNames.some(key => !Number.isSafeInteger(state.counters && (state.counters as Record<string, unknown>)[key]) || Number((state.counters as Record<string, unknown>)[key]) < 0)) throw new Error('Invalid event counters');
  const ids = new Set<string>();
  for (const row of state.rows) {
    if (!object(row) || !(exactKeys(row, ['event', 'attempts', 'nextAttemptAt']) || exactKeys(row, ['event', 'attempts', 'nextAttemptAt', 'timestampMode'])) || !Number.isInteger(row.attempts) || Number(row.attempts) < 0 || Number(row.attempts) > EVENT_OUTBOX_MAX_ATTEMPTS || typeof row.nextAttemptAt !== 'number' || !Number.isFinite(row.nextAttemptAt) || row.nextAttemptAt < 0) throw new Error('Invalid event outbox row');
    if (!Object.hasOwn(row, 'timestampMode')) row.timestampMode = 'detected';
    if (!['detected', 'server'].includes(String(row.timestampMode))) throw new Error('Invalid event delivery mode');
    validateEvent(row.event);
    if (ids.has(row.event.event_id)) throw new Error('Duplicate pending identity');
    ids.add(row.event.event_id);
  }
  return state as unknown as State;
}

/** No timers, network, credentials, coordinates or telemetry. Adapter supplies scoped storage/send. */
export function createEventOutbox(storage: Storage, isCurrent: (scope: EventScope) => boolean, options: Options = {}) {
  const now = options.now ?? Date.now;
  const enabled = options.enabled === true && options.idempotencyVerified === true;
  let epoch = 0;
  let tail: Promise<unknown> = Promise.resolve();
  let flight: Promise<void> | null = null;
  let activeAttempt: { scope: EventScope; revision: number; eventId: string } | null = null;
  const stoppedSessions = new Map<string, number>();
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = tail.catch(() => {}).then(operation);
    tail = pending;
    return pending;
  };
  const current = (scope: EventScope, revision: number) => validScope(scope) && revision === epoch && isCurrent(scope);
  const read = async () => parse(await storage.getItem(EVENT_OUTBOX_KEY));
  const write = async (state: State) => {
    const raw = JSON.stringify(state);
    parse(raw);
    await storage.setItem(EVENT_OUTBOX_KEY, raw);
  };
  const sessionKey = (scope: EventScope, sessionId: string) => JSON.stringify([scope.ownerId, scope.consentVersion, sessionId]);
  const sessionCurrent = (scope: EventScope, sessionId: string) => (stoppedSessions.get(sessionKey(scope, sessionId)) ?? 0) <= now();
  const count = (state: State, key: keyof EventCounters) => { state.counters[key] = Math.min(Number.MAX_SAFE_INTEGER, state.counters[key] + 1); };
  const inFlight = (scope: EventScope, row: Row) => activeAttempt !== null
    && activeAttempt.revision === epoch && sameScope(activeAttempt.scope, scope)
    && activeAttempt.eventId === row.event.event_id;
  const prune = (state: State) => {
    state.rows = state.rows.filter(row => {
      const reason = !sessionCurrent(state.scope, row.event.session_id) ? 'stopped'
        : Date.parse(row.event.expires_at) <= now() ? 'expired'
        : row.attempts >= EVENT_OUTBOX_MAX_ATTEMPTS && !inFlight(state.scope, row) ? 'exhausted' : null;
      if (reason) count(state, reason);
      return !reason;
    });
  };

  async function enqueue(scope: EventScope, event: PendingEvent): Promise<boolean> {
    if (!enabled) return false;
    // Snapshot before any await: callers cannot mutate a queued detection or scope.
    validateEvent(event);
    const owner = copy(scope), snapshot = copy(event), revision = epoch;
    return run(async () => {
      if (!current(owner, revision) || !sessionCurrent(owner, snapshot.session_id)) return false;
      if (Date.parse(snapshot.detected_at) > now()) return false;
      const stored = await read();
      if (!current(owner, revision) || !sessionCurrent(owner, snapshot.session_id)) return false;
      // One scope only. A newly consented scope never inherits earlier consent's data.
      const state = stored && sameScope(stored.scope, owner) ? stored : { scope: owner, rows: [], counters: eventEmptyCounters() };
      prune(state);
      if (Date.parse(snapshot.expires_at) <= now()) { count(state, 'expired'); await write(state); return false; }
      const existing = state.rows.find(row => row.event.event_id === snapshot.event_id);
      if (existing) return (Object.keys(snapshot) as (keyof PendingEvent)[]).every(key => existing.event[key] === snapshot[key]);
      if (state.rows.length >= EVENT_OUTBOX_LIMIT) { count(state, 'capacityRejected'); await write(state); return false; }
      state.rows.push({ event: snapshot, attempts: 0, nextAttemptAt: now(), timestampMode: 'detected' });
      await write(state);
      return current(owner, revision);
    });
  }

  function flush(scope: EventScope, send: (event: PendingEvent, delivery: EventDelivery) => Promise<EventSendResult>): Promise<void> {
    if (!enabled) return Promise.resolve();
    if (flight) return flight;
    const owner = copy(scope), revision = epoch;
    const pending = (async () => {
      try {
        while (current(owner, revision)) {
          // Persist attempt/backoff before sending. Storage failure must prevent network use.
          const event = await run(async () => {
            if (!current(owner, revision)) return null;
            const state = await read();
            if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return null;
            prune(state);
            const row = state.rows.find(item => item.nextAttemptAt <= now());
            if (row) {
              // Persist the consumed attempt before transport, but keep its live
              // row visible until settlement. This exemption never survives restart.
              activeAttempt = { scope: owner, revision, eventId: row.event.event_id };
              row.attempts++;
              row.nextAttemptAt = now() + Math.min(60_000, 1000 * 2 ** (row.attempts - 1));
            }
            await write(state);
            return row ? { event: copy(row.event), timestampMode: row.timestampMode } : null;
          });
          if (!event || !current(owner, revision) || !sessionCurrent(owner, event.event.session_id) || Date.parse(event.event.expires_at) <= now()) return;
          let result: EventSendResult;
          try { result = await send(copy(event.event), { timestampMode: event.timestampMode }); } catch { return; }
          if (!current(owner, revision)) return;
          const status = result.status;
          const timestampRejected = status === 400 && result.error === 'invalid_occurred_at' && event.timestampMode === 'detected';
          const success = Number.isInteger(status) && status >= 200 && status < 300;
          const permanent = !timestampRejected && Number.isInteger(status) && status >= 400 && status < 500 && ![401, 408, 429].includes(status);
          await run(async () => {
            if (!current(owner, revision)) return;
            const state = await read();
            if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return;
            activeAttempt = null;
            const row = state.rows.find(item => item.event.event_id === event.event.event_id);
            if (row && timestampRejected && sessionCurrent(owner, row.event.session_id)) {
              // The timed request was explicitly rejected, so changing the wire
              // intent is safe. Persist it BEFORE the fallback; uncertain future
              // outcomes must replay this same untimed intent after a restart.
              row.timestampMode = 'server'; row.nextAttemptAt = now();
            } else if (row && (success || permanent)) {
              state.rows = state.rows.filter(item => item !== row);
              if (permanent) count(state, 'permanentRejected');
            } else if (row && status === 429 && typeof result.retryAfterMs === 'number' && Number.isFinite(result.retryAfterMs) && result.retryAfterMs > 0) {
              row.nextAttemptAt = Math.min(Date.parse(row.event.expires_at), Math.max(row.nextAttemptAt, now() + result.retryAfterMs));
            }
            prune(state);
            await write(state);
          });
          // Unknown outcomes, auth, throttling and 5xx stop this flush. A single
          // explicit timestamp rejection switches intent and uses another of the
          // same five-send budget; a second 400 is permanent.
          if (!success && !permanent && !timestampRejected) return;
        }
      } finally { activeAttempt = null; }
    })();
    flight = pending;
    void pending.then(() => { flight = null; }, () => { flight = null; });
    return pending;
  }

  // Invalidate synchronously before waiting for disk; late in-flight responses cannot repopulate.
  function clear(): Promise<void> { epoch++; return run(async () => { await storage.removeItem(EVENT_OUTBOX_KEY); stoppedSessions.clear(); }); }
  function invalidateSession(scope: EventScope, sessionId: string): Promise<void> {
    const owner = copy(scope), revision = epoch;
    for (const [key, until] of stoppedSessions) if (until <= now()) stoppedSessions.delete(key);
    stoppedSessions.set(sessionKey(owner, sessionId), now() + EVENT_OUTBOX_TTL_MS);
    return run(async () => {
      if (!current(owner, revision)) return;
      const state = await read();
      if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return;
      prune(state); await write(state);
    });
  }
  async function status(scope: EventScope) {
    const empty = { ...eventEmptyCounters(), pending: 0, nextAttemptAt: null as number | null };
    if (!enabled) return empty;
    const owner = copy(scope), revision = epoch;
    return run(async () => {
      if (!current(owner, revision)) return empty;
      const state = await read();
      if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return empty;
      prune(state); await write(state);
      return { ...state.counters, pending: state.rows.length, nextAttemptAt: state.rows.length ? Math.min(...state.rows.map(row => row.nextAttemptAt)) : null };
    });
  }
  async function pendingEntries(scope: EventScope): Promise<PendingEvent[]> {
    if (!enabled) return [];
    const owner = copy(scope), revision = epoch;
    if (!current(owner, revision)) return [];
    const state = await read();
    if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return [];
    return copy(state.rows.filter(row => sessionCurrent(owner, row.event.session_id) && Date.parse(row.event.expires_at) > now() && (row.attempts < EVENT_OUTBOX_MAX_ATTEMPTS || inFlight(state.scope, row))).map(row => row.event));
  }
  return { enqueue, flush, clear, pendingEntries, invalidateSession, status };
}
