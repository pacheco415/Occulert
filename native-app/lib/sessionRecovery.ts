import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActiveSessionCheckpointUnreadableError,
  hasConflictingActiveSessionCheckpoint,
  parseActiveSessionCheckpoint,
  type ActiveSessionCheckpoint,
} from './sessionRecoveryModel';

const ACTIVE_SESSION_KEY = 'occulert-active-session-v1';
let recoveryQueue: Promise<void> = Promise.resolve();

export class ActiveSessionCheckpointConflictError extends Error {
  constructor() {
    super('A different active-session checkpoint must be recovered before starting another session.');
    this.name = 'ActiveSessionCheckpointConflictError';
  }
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const pending = recoveryQueue.then(operation);
  recoveryQueue = pending.catch(() => {});
  return pending;
}

export function saveActiveSessionCheckpoint(checkpoint: ActiveSessionCheckpoint): Promise<void> {
  return enqueue(async () => {
    const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    const stored = parseActiveSessionCheckpoint(raw);
    if (hasConflictingActiveSessionCheckpoint(stored, checkpoint.sessionId)) {
      throw new ActiveSessionCheckpointConflictError();
    }
    await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(checkpoint));
  });
}

export async function loadActiveSessionCheckpoint(): Promise<ActiveSessionCheckpoint | null> {
  await recoveryQueue;
  return parseActiveSessionCheckpoint(await AsyncStorage.getItem(ACTIVE_SESSION_KEY));
}

export function clearActiveSessionCheckpoint(sessionId?: string): Promise<void> {
  return enqueue(async () => {
    if (!sessionId) {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
      return;
    }
    const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    const stored = parseActiveSessionCheckpoint(raw);
    if (stored?.sessionId === sessionId) {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  });
}

/** Explicit recovery-only discard; never delete a checkpoint that became readable. */
export function discardUnreadableActiveSessionCheckpoint(): Promise<void> {
  return enqueue(async () => {
    const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    try {
      parseActiveSessionCheckpoint(raw);
    } catch (error) {
      if (error instanceof ActiveSessionCheckpointUnreadableError) {
        await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
        return;
      }
      throw error;
    }
    throw new Error('The recovery checkpoint changed; refresh its status before clearing it.');
  });
}
