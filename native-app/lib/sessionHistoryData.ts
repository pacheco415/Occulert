/**
 * An absent history key means there are no saved sessions. A present but
 * unreadable value must never be treated as empty: doing so would let the next
 * session write replace data that might still be recoverable.
 */
export function parseSessionHistory<T extends object>(raw: string | null): T[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved session history is unreadable; no changes were made.');
  }

  if (!Array.isArray(parsed) || parsed.some(item => (
    item === null || typeof item !== 'object' || Array.isArray(item)
  ))) {
    throw new Error('Saved session history has an unexpected format; no changes were made.');
  }

  return parsed as T[];
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
