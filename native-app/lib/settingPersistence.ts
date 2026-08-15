export interface StringSettingStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface PersistSettingOptions<T> {
  key: string;
  nextValue: T;
  previousValue: T;
  serialize(value: T): string;
  parse(value: string): T;
  apply(value: T): void;
  onError(): void;
}

export interface SettingPersister {
  save<T>(options: PersistSettingOptions<T>): Promise<boolean>;
}

/**
 * Persist optimistic Settings changes in order. Only the newest failed save may
 * roll the UI back, and it prefers the actual stored value over a stale render.
 */
export function createSettingPersister(storage: StringSettingStorage): SettingPersister {
  const revisions = new Map<string, number>();
  const writeTails = new Map<string, Promise<void>>();
  const confirmedValues = new Map<string, unknown>();

  const save = async <T>({
    key,
    nextValue,
    previousValue,
    serialize,
    parse,
    apply,
    onError,
  }: PersistSettingOptions<T>): Promise<boolean> => {
    const revision = (revisions.get(key) ?? 0) + 1;
    revisions.set(key, revision);
    apply(nextValue);

    const previousWrite = writeTails.get(key) ?? Promise.resolve();
    const write = previousWrite
      .catch(() => {})
      .then(() => storage.setItem(key, serialize(nextValue)));
    writeTails.set(key, write);

    try {
      await write;
      confirmedValues.set(key, nextValue);
      return true;
    } catch {
      if (revisions.get(key) !== revision) return false;

      let restoredValue = confirmedValues.has(key)
        ? confirmedValues.get(key) as T
        : previousValue;
      try {
        const storedValue = await storage.getItem(key);
        if (storedValue !== null) {
          restoredValue = parse(storedValue);
          confirmedValues.set(key, restoredValue);
        }
      } catch {
        // Fall back to the last confirmed or pre-save value.
      }

      if (revisions.get(key) !== revision) return false;
      apply(restoredValue);
      onError();
      return false;
    } finally {
      if (writeTails.get(key) === write) writeTails.delete(key);
    }
  };

  return { save };
}
