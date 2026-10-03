import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSessionHistory, assignMissingSessionIds } from './sessionHistoryData';

const HISTORY_KEY = 'occulert-session-history';
let historyQueue: Promise<void> = Promise.resolve();

export async function loadSessionHistory<T extends object>(): Promise<T[]> {
  // Queue migration with edits so no caller sees IDs until storage confirms them.
  const operation = historyQueue.then(async () => {
    const parsed = parseSessionHistory<T>(await AsyncStorage.getItem(HISTORY_KEY));
    const migrated = assignMissingSessionIds(parsed);
    if (migrated.changed) await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(migrated.sessions));
    return migrated.sessions;
  });
  historyQueue = operation.then(() => {}, () => {});
  return operation;
}

export function updateSessionHistory<T extends object>(
  update: (sessions: T[]) => T[],
): Promise<void> {
  const operation = historyQueue.then(async () => {
    const sessions = parseSessionHistory<T>(await AsyncStorage.getItem(HISTORY_KEY));
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(update(assignMissingSessionIds(sessions).sessions)));
  });
  historyQueue = operation.catch(() => {});
  return operation;
}

export function clearSessionHistory(): Promise<void> {
  const operation = historyQueue.then(() => AsyncStorage.removeItem(HISTORY_KEY));
  historyQueue = operation.catch(() => {});
  return operation;
}
