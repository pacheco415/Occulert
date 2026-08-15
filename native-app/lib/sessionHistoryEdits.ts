export interface SessionRecordIdentity {
  sessionId?: string;
  savedAt?: string;
}

export type SessionRecordMutation<T> = (record: T) => T;

export function updateMatchingSessionRecord<T extends SessionRecordIdentity>(
  sessions: T[],
  target: SessionRecordIdentity,
  targetIndex: number,
  update: SessionRecordMutation<T>,
): T[] {
  return sessions.map((item, itemIndex) => {
    const matches = target.sessionId
      ? item.sessionId === target.sessionId
      : target.savedAt
        ? item.savedAt === target.savedAt
        : itemIndex === targetIndex;
    return matches ? update(item) : item;
  });
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
