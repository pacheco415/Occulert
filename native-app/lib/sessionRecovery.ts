import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hasConflictingActiveSessionCheckpoint,
  isActiveSessionCheckpoint,
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
    if (raw) {
      try {
        const stored: unknown = JSON.parse(raw);
        if (hasConflictingActiveSessionCheckpoint(stored, checkpoint.sessionId)) {
          throw new ActiveSessionCheckpointConflictError();
        }
      } catch (error) {
        if (error instanceof ActiveSessionCheckpointConflictError) throw error;
      }
    }
    await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(checkpoint));
  });
}

export async function loadActiveSessionCheckpoint(): Promise<ActiveSessionCheckpoint | null> {
  await recoveryQueue;
  const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isActiveSessionCheckpoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearActiveSessionCheckpoint(sessionId?: string): Promise<void> {
  return enqueue(async () => {
    if (!sessionId) {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
      return;
    }
    const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isActiveSessionCheckpoint(parsed) || parsed.sessionId === sessionId) {
        await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  });
}
