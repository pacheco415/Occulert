/**
 * An absent history key means there are no saved sessions. A present but
 * unreadable value must never be treated as empty: doing so would let the next
 * session write replace data that might still be recoverable.
 */
type HistoryDocument<T extends object> = { schemaVersion: 1; sessions: T[]; [key: string]: unknown };

function readHistoryDocument<T extends object>(raw: string | null): HistoryDocument<T> {
  if (raw === null) return { schemaVersion: 1, sessions: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Saved session history is unreadable; no changes were made.'); }
  const legacy = Array.isArray(parsed);
  if (!legacy && (parsed === null || typeof parsed !== 'object'
    || (parsed as Record<string, unknown>).schemaVersion !== 1)) {
    throw new Error('Saved session history has an unsupported format version; no changes were made.');
  }
  const document = legacy ? { schemaVersion: 1, sessions: parsed } : parsed as Record<string, unknown>;
  const sessions = document.sessions;
  if (!Array.isArray(sessions) || sessions.some(item => (
    item === null || typeof item !== 'object' || Array.isArray(item)
  ))) throw new Error('Saved session history has an unexpected format; no changes were made.');
  return document as HistoryDocument<T>;
}

export function parseSessionHistory<T extends object>(raw: string | null): T[] {
  return readHistoryDocument<T>(raw).sessions;
}

/** Preserve unknown envelope metadata and partial record fields on every write. */
export function serializeSessionHistory<T extends object>(sessions: T[], previousRaw: string | null): string {
  const previous = readHistoryDocument<T>(previousRaw);
  // Validate callback output before replacing the stored document as well.
  const checked = readHistoryDocument<T>(JSON.stringify({ schemaVersion: 1, sessions }));
  return JSON.stringify({ ...previous, schemaVersion: 1, sessions: checked.sessions });
}

export function sessionHistoryNeedsMigration(raw: string | null): boolean {
  if (raw === null) return false;
  readHistoryDocument(raw); // Never decide to migrate unreadable or future data.
  return Array.isArray(JSON.parse(raw));
}

/** Local record identity only; these IDs confer no cloud authority. */
export function assignMissingSessionIds<T extends object>(
  sessions: T[],
  makeId: () => string = () => `local-legacy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
): { sessions: T[]; changed: boolean } {
  const used = new Set(sessions.flatMap(record => {
    const id = (record as { sessionId?: unknown }).sessionId;
    return typeof id === 'string' && id.trim() ? [id] : [];
  }));
  let changed = false;
  const next = sessions.map(record => {
    const existing = (record as { sessionId?: unknown }).sessionId;
    if (typeof existing === 'string' && existing.trim()) return record;
    let id = '';
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = makeId();
      if (typeof candidate === 'string' && candidate.trim() && !used.has(candidate)) { id = candidate; break; }
    }
    if (!id) throw new Error('Saved session identity could not be assigned; no changes were made.');
    used.add(id);
    changed = true;
    return { ...record, sessionId: id };
  });
  return { sessions: changed ? next : sessions, changed };
}
