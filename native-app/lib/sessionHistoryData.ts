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

  if (!Array.isArray(parsed)) {
    throw new Error('Saved session history has an unexpected format; no changes were made.');
  }

  return parsed as T[];
}
