import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSessionHistory, assignMissingSessionIds, serializeSessionHistory, sessionHistoryNeedsMigration } from './sessionHistoryData';

const HISTORY_KEY = 'occulert-session-history';
let historyQueue: Promise<void> = Promise.resolve();

export async function loadSessionHistory<T extends object>(): Promise<T[]> {
  // Queue migration with edits so no caller sees IDs until storage confirms them.
  const operation = historyQueue.then(async () => {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const parsed = parseSessionHistory<T>(raw);
    const migrated = assignMissingSessionIds(parsed);
    if (migrated.changed || sessionHistoryNeedsMigration(raw)) {
      await AsyncStorage.setItem(HISTORY_KEY, serializeSessionHistory(migrated.sessions, raw));
    }
    return migrated.sessions;
  });
  historyQueue = operation.then(() => {}, () => {});
  return operation;
}

export function updateSessionHistory<T extends object>(
  update: (sessions: T[]) => T[],
): Promise<void> {
  const operation = historyQueue.then(async () => {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const sessions = parseSessionHistory<T>(raw);
    await AsyncStorage.setItem(HISTORY_KEY, serializeSessionHistory(update(assignMissingSessionIds(sessions).sessions), raw));
  });
  historyQueue = operation.catch(() => {});
  return operation;
}

export function clearSessionHistory(): Promise<void> {
  const operation = historyQueue.then(() => AsyncStorage.removeItem(HISTORY_KEY));
  historyQueue = operation.catch(() => {});
  return operation;
}
