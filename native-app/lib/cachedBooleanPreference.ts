export interface AsyncStringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface CachedBooleanPreference {
  get(forceRefresh?: boolean): Promise<boolean>;
  set(enabled: boolean): Promise<void>;
}

/**
 * Cache a boolean preference without allowing slow reads or overlapping writes
 * to restore an older value. Writes stay ordered and the cache changes only
 * after storage confirms the newest value was persisted.
 */
export function createCachedBooleanPreference(
  storage: AsyncStringStorage,
  key: string,
  fallback = false,
): CachedBooleanPreference {
  let cached: boolean | undefined;
  let revision = 0;
  let pendingRead: Promise<boolean> | null = null;
  let writeTail: Promise<void> = Promise.resolve();
  let lastPersistedRevision = 0;
  let lastPersistedValue: boolean | undefined;

  const get = (forceRefresh = false): Promise<boolean> => {
    if (!forceRefresh && cached !== undefined) return Promise.resolve(cached);
    if (!forceRefresh && pendingRead) return pendingRead;

    const readRevision = revision;
    const precedingWrites = writeTail;
    const read = precedingWrites
      .then(() => storage.getItem(key))
      .then(async (value) => {
        const storedValue = value === 'true';
        if (readRevision !== revision) {
          await writeTail;
          if (lastPersistedRevision > readRevision) {
            return lastPersistedValue ?? fallback;
          }
          cached = storedValue;
          return cached;
        }
        cached = storedValue;
        return cached;
      })
      .catch(async () => {
        if (readRevision !== revision) await writeTail;
        return cached ?? fallback;
      })
      .finally(() => {
        if (pendingRead === read) pendingRead = null;
      });
    pendingRead = read;
    return read;
  };

  const set = (enabled: boolean): Promise<void> => {
    const writeRevision = ++revision;
    const storageWrite = writeTail.then(() => storage.setItem(key, String(enabled)));
    const operation = storageWrite.then(
      () => {
        lastPersistedRevision = writeRevision;
        lastPersistedValue = enabled;
        if (writeRevision === revision) cached = enabled;
      },
      (error: unknown) => {
        if (writeRevision === revision && lastPersistedValue !== undefined) {
          cached = lastPersistedValue;
        }
        throw error;
      },
    );
    writeTail = operation.catch(() => {});
    return operation;
  };

  return { get, set };
}
