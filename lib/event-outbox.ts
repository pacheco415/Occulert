/** Experimental, transport-free foundation. No application imports this module. */
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
  type: 'drowsiness' | 'head_nod';
  fatigue: number | null;
  confidence: number | null;
}
interface Row { event: PendingEvent; attempts: number; nextAttemptAt: number }
interface State { scope: EventScope; rows: Row[] }
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
interface SendResult { status: number }
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
function validScope(scope: unknown): scope is EventScope {
  return object(scope) && exactKeys(scope, ['ownerId', 'consentVersion']) && typeof scope.ownerId === 'string' && /^[\w-]{1,128}$/.test(scope.ownerId) && Number.isSafeInteger(scope.consentVersion) && Number(scope.consentVersion) >= 0;
}
function validateEvent(value: unknown): asserts value is PendingEvent {
  if (!object(value) || !exactKeys(value, ['event_id', 'session_id', 'detected_at', 'expires_at', 'type', 'fatigue', 'confidence'])
    || !['event_id', 'session_id'].every(key => typeof value[key] === 'string' && /^[\w-]{1,128}$/.test(value[key] as string))
    || !iso(value.detected_at) || !iso(value.expires_at)
    || Date.parse(value.expires_at) <= Date.parse(value.detected_at)
    || Date.parse(value.expires_at) - Date.parse(value.detected_at) > EVENT_OUTBOX_TTL_MS
    || !['drowsiness', 'head_nod'].includes(String(value.type))
    || !['fatigue', 'confidence'].every(key => value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 100))) {
    throw new Error('Invalid pending event');
  }
}
function parse(raw: string | null): State | null {
  if (raw === null) return null;
  if (raw.length > MAX_BYTES) throw new Error('Event outbox exceeds storage bound');
  const state: unknown = JSON.parse(raw);
  if (!object(state) || !exactKeys(state, ['scope', 'rows']) || !validScope(state.scope) || !Array.isArray(state.rows) || state.rows.length > EVENT_OUTBOX_LIMIT) throw new Error('Invalid event outbox');
  const ids = new Set<string>();
  for (const row of state.rows) {
    if (!object(row) || !exactKeys(row, ['event', 'attempts', 'nextAttemptAt']) || !Number.isInteger(row.attempts) || Number(row.attempts) < 0 || Number(row.attempts) > EVENT_OUTBOX_MAX_ATTEMPTS || typeof row.nextAttemptAt !== 'number' || !Number.isFinite(row.nextAttemptAt) || row.nextAttemptAt < 0) throw new Error('Invalid event outbox row');
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
  const prune = (state: State) => { state.rows = state.rows.filter(row => Date.parse(row.event.expires_at) > now() && row.attempts < EVENT_OUTBOX_MAX_ATTEMPTS); };

  async function enqueue(scope: EventScope, event: PendingEvent): Promise<boolean> {
    if (!enabled) return false;
    // Snapshot before any await: callers cannot mutate a queued detection or scope.
    validateEvent(event);
    const owner = copy(scope), snapshot = copy(event), revision = epoch;
    return run(async () => {
      if (!current(owner, revision)) return false;
      if (Date.parse(snapshot.expires_at) <= now() || Date.parse(snapshot.detected_at) > now()) return false;
      const stored = await read();
      if (!current(owner, revision)) return false;
      // One scope only. A newly consented scope never inherits earlier consent's data.
      const state = stored && sameScope(stored.scope, owner) ? stored : { scope: owner, rows: [] };
      prune(state);
      const existing = state.rows.find(row => row.event.event_id === snapshot.event_id);
      if (existing) return (Object.keys(snapshot) as (keyof PendingEvent)[]).every(key => existing.event[key] === snapshot[key]);
      if (state.rows.length >= EVENT_OUTBOX_LIMIT) return false;
      state.rows.push({ event: snapshot, attempts: 0, nextAttemptAt: now() });
      await write(state);
      return current(owner, revision);
    });
  }

  function flush(scope: EventScope, send: (event: PendingEvent) => Promise<SendResult>): Promise<void> {
    if (!enabled) return Promise.resolve();
    if (flight) return flight;
    const owner = copy(scope), revision = epoch;
    const pending = (async () => {
      while (current(owner, revision)) {
        // Persist attempt/backoff before sending. Storage failure must prevent network use.
        const event = await run(async () => {
          if (!current(owner, revision)) return null;
          const state = await read();
          if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return null;
          prune(state);
          const row = state.rows.find(item => item.nextAttemptAt <= now());
          if (row) {
            row.attempts++;
            row.nextAttemptAt = now() + Math.min(60_000, 1000 * 2 ** (row.attempts - 1));
          }
          await write(state);
          return row ? copy(row.event) : null;
        });
        if (!event || !current(owner, revision) || Date.parse(event.expires_at) <= now()) return;
        let status: number;
        try { status = (await send(copy(event))).status; } catch { return; }
        if (!current(owner, revision)) return;
        const success = Number.isInteger(status) && status >= 200 && status < 300;
        const permanent = Number.isInteger(status) && status >= 400 && status < 500 && ![401, 408, 429].includes(status);
        // Unknown outcomes, auth refresh, throttling and 5xx retain the original ID.
        if (!success && !permanent) return;
        await run(async () => {
          if (!current(owner, revision)) return;
          const state = await read();
          if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return;
          state.rows = state.rows.filter(row => row.event.event_id !== event.event_id);
          await write(state);
        });
      }
    })();
    flight = pending;
    void pending.then(() => { flight = null; }, () => { flight = null; });
    return pending;
  }

  // Invalidate synchronously before waiting for disk; late in-flight responses cannot repopulate.
  function clear(): Promise<void> { epoch++; return run(() => storage.removeItem(EVENT_OUTBOX_KEY)); }
  async function pendingEntries(scope: EventScope): Promise<PendingEvent[]> {
    if (!enabled) return [];
    const owner = copy(scope), revision = epoch;
    if (!current(owner, revision)) return [];
    const state = await read();
    if (!current(owner, revision) || !state || !sameScope(state.scope, owner)) return [];
    return copy(state.rows.filter(row => Date.parse(row.event.expires_at) > now() && row.attempts < EVENT_OUTBOX_MAX_ATTEMPTS).map(row => row.event));
  }
  return { enqueue, flush, clear, pendingEntries };
}
