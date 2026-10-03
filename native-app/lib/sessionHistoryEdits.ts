export interface SessionRecordIdentity {
  sessionId?: string;
  savedAt?: string;
}

export type SessionRecordMutation<T> = (record: T) => T;

function matchingSessionIndex(
  sessions: SessionRecordIdentity[],
  target: SessionRecordIdentity,
  targetIndex: number,
): number {
  const candidates = sessions.flatMap((item, index) => {
    const matches = target.sessionId
      ? item.sessionId === target.sessionId && (!target.savedAt || item.savedAt === target.savedAt)
      : target.savedAt
        ? item.savedAt === target.savedAt
        : index === targetIndex && item === target;
    return matches ? [index] : [];
  });
  if (candidates.length > 1) throw new Error('The saved session identity is ambiguous. Reload History before editing.');
  return candidates[0] ?? -1;
}

export function updateMatchingSessionRecord<T extends SessionRecordIdentity>(
  sessions: T[],
  target: SessionRecordIdentity,
  targetIndex: number,
  update: SessionRecordMutation<T>,
): T[] {
  const matchIndex = matchingSessionIndex(sessions, target, targetIndex);
  return sessions.map((item, index) => index === matchIndex ? update(item) : item);
}

export function removeMatchingSessionRecord<T extends SessionRecordIdentity>(
  sessions: T[],
  target: SessionRecordIdentity,
  targetIndex: number,
): T[] {
  const matchIndex = matchingSessionIndex(sessions, target, targetIndex);
  return matchIndex < 0 ? sessions : sessions.filter((_item, index) => index !== matchIndex);
}

export interface CommitSessionHistoryEditOptions<T> {
  update: SessionRecordMutation<T>;
  persist(update: SessionRecordMutation<T>): Promise<void>;
  apply(update: SessionRecordMutation<T>): void;
  onError(): void;
}

/**
 * Apply a History edit to the screen only after its ordered local write
 * succeeds. A failed edit leaves the last confirmed UI state intact.
 */
export async function commitSessionHistoryEdit<T>({
  update,
  persist,
  apply,
  onError,
}: CommitSessionHistoryEditOptions<T>): Promise<boolean> {
  try {
    await persist(update);
    apply(update);
    return true;
  } catch {
    onError();
    return false;
  }
}
