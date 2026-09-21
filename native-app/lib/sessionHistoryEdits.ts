export interface SessionRecordIdentity {
  sessionId?: string;
  savedAt?: string;
}

export type SessionRecordMutation<T> = (record: T) => T;

function matchesSessionRecord(
  item: SessionRecordIdentity,
  itemIndex: number,
  target: SessionRecordIdentity,
  targetIndex: number,
): boolean {
  return target.sessionId
    ? item.sessionId === target.sessionId
    : target.savedAt
      ? item.savedAt === target.savedAt
      : itemIndex === targetIndex;
}

export function updateMatchingSessionRecord<T extends SessionRecordIdentity>(
  sessions: T[],
  target: SessionRecordIdentity,
  targetIndex: number,
  update: SessionRecordMutation<T>,
): T[] {
  return sessions.map((item, itemIndex) => {
    const matches = matchesSessionRecord(item, itemIndex, target, targetIndex);
    return matches ? update(item) : item;
  });
}

export function removeMatchingSessionRecord<T extends SessionRecordIdentity>(
  sessions: T[],
  target: SessionRecordIdentity,
  targetIndex: number,
): T[] {
  const matchIndex = sessions.findIndex((item, itemIndex) => (
    matchesSessionRecord(item, itemIndex, target, targetIndex)
  ));
  return matchIndex < 0
    ? sessions
    : sessions.filter((_item, itemIndex) => itemIndex !== matchIndex);
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
