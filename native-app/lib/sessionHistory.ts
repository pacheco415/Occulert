import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'occulert-session-history';
let historyQueue: Promise<void> = Promise.resolve();

export function updateSessionHistory<T extends Record<string, unknown>>(
  update: (sessions: T[]) => T[],
): Promise<void> {
  const operation = historyQueue.then(async () => {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    let parsed: unknown = [];
    try {
      parsed = raw ? JSON.parse(raw) : [];
    } catch {
      parsed = [];
    }
    const sessions = Array.isArray(parsed) ? parsed as T[] : [];
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(update(sessions)));
  });
  historyQueue = operation.catch(() => {});
  return operation;
}
