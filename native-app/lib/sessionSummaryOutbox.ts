import { createAsyncMutationQueue } from './asyncMutationQueue.ts';

export const SESSION_SUMMARY_OUTBOX_KEY = 'occulert.cloud.session-outbox.v1';
export const SESSION_SUMMARY_OUTBOX_LIMIT = 20;
export interface SummaryScope { ownerId: string; consentVersion: number }
export interface PendingSessionSummary {
  session_id: string;
  local_session_id?: string;
  ended_at: string;
  average_fatigue: number | null;
  max_fatigue: number | null;
  safety_score: number | null;
  alert_count: number | null;
  head_nod_count: number | null;
}
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
type Owners = Record<string, PendingSessionSummary[]>;
type Send = (entry: PendingSessionSummary) => Promise<{ ok: boolean; status: number }>;

function parse(raw: string | null): Owners {
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unreadable pending session summaries');
  for (const [owner, entries] of Object.entries(value)) {
    if (!owner || !Array.isArray(entries) || entries.length > SESSION_SUMMARY_OUTBOX_LIMIT) throw new Error('Unreadable pending session summaries');
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || typeof entry.session_id !== 'string' || !entry.session_id
        || (entry.local_session_id !== undefined && (typeof entry.local_session_id !== 'string' || !entry.local_session_id))
        || typeof entry.ended_at !== 'string' || !Number.isFinite(Date.parse(entry.ended_at))
        || new Date(entry.ended_at).toISOString() !== entry.ended_at) throw new Error('Unreadable pending session summary');
      for (const key of ['average_fatigue', 'max_fatigue', 'safety_score', 'alert_count', 'head_nod_count']) {
        if (entry[key] !== null && (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]) || entry[key] < 0)) throw new Error('Unreadable pending session metrics');
      }
    }
  }
  return value as Owners;
}

/** Owner-keyed, consent-guarded storage. Network waits never hold the storage queue. */
export function createSessionSummaryOutbox(
  storage: Storage,
  isCurrent: (scope: SummaryScope) => boolean,
  onSynced: (scope: SummaryScope, entry: PendingSessionSummary) => Promise<void> = async () => {},
) {
  const queue = createAsyncMutationQueue();
  const flights = new Map<string, Promise<Set<string>>>();
  const read = async () => parse(await storage.getItem(SESSION_SUMMARY_OUTBOX_KEY));
  const enqueue = (scope: SummaryScope, entry: PendingSessionSummary) => queue.run(async () => {
    if (!isCurrent(scope)) return false;
    parse(JSON.stringify({ [scope.ownerId]: [entry] }));
    const owners = await read();
    if (!isCurrent(scope)) return false;
    const entries = owners[scope.ownerId] || [];
    if (!entries.some(item => item.session_id === entry.session_id)) {
      if (entries.length >= SESSION_SUMMARY_OUTBOX_LIMIT) return false;
      entries.push(JSON.parse(JSON.stringify(entry)));
    }
    owners[scope.ownerId] = entries;
    await storage.setItem(SESSION_SUMMARY_OUTBOX_KEY, JSON.stringify(owners));
    return isCurrent(scope);
  });
  const remove = (scope: SummaryScope, id: string) => queue.run(async () => {
    if (!isCurrent(scope)) return;
    const owners = await read();
    if (!isCurrent(scope)) return;
    owners[scope.ownerId] = (owners[scope.ownerId] || []).filter(item => item.session_id !== id);
    await storage.setItem(SESSION_SUMMARY_OUTBOX_KEY, JSON.stringify(owners));
  });
  const flush = (scope: SummaryScope, send: Send): Promise<Set<string>> => {
    const key = JSON.stringify(scope);
    if (flights.has(key)) return flights.get(key)!;
    const pending = (async () => {
      const synced = new Set<string>();
      if (!isCurrent(scope)) return synced;
      const owners = await queue.run(read);
      for (const entry of owners[scope.ownerId] || []) {
        if (!isCurrent(scope)) break;
        let result;
        try { result = await send(entry); } catch { break; }
        if (!isCurrent(scope)) break;
        const permanent = result.status >= 400 && result.status < 500 && ![401, 408, 429].includes(result.status);
        if (result.ok || permanent) {
          if (result.ok) {
            try { await onSynced(scope, entry); } catch { break; }
            if (!isCurrent(scope)) break;
          }
          await remove(scope, entry.session_id);
          if (result.ok) synced.add(entry.session_id);
        } else break;
      }
      return synced;
    })();
    flights.set(key, pending);
    void pending.then(() => flights.delete(key), () => flights.delete(key));
    return pending;
  };
  const clear = () => queue.run(() => storage.removeItem(SESSION_SUMMARY_OUTBOX_KEY));
  return { enqueue, flush, clear };
}
