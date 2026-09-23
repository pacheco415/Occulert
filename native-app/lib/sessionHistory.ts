import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSessionHistory } from './sessionHistoryData';

const HISTORY_KEY = 'occulert-session-history';
let historyQueue: Promise<void> = Promise.resolve();

export async function loadSessionHistory<T extends object>(): Promise<T[]> {
  await historyQueue;
  return parseSessionHistory<T>(await AsyncStorage.getItem(HISTORY_KEY));
}

export function updateSessionHistory<T extends object>(
  update: (sessions: T[]) => T[],
): Promise<void> {
  const operation = historyQueue.then(async () => {
    const sessions = parseSessionHistory<T>(await AsyncStorage.getItem(HISTORY_KEY));
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(update(sessions)));
  });
  historyQueue = operation.catch(() => {});
  return operation;
}

export function clearSessionHistory(): Promise<void> {
  const operation = historyQueue.then(() => AsyncStorage.removeItem(HISTORY_KEY));
  historyQueue = operation.catch(() => {});
  return operation;
}
