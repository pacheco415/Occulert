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
  let lastPersistedValue: boolean | undefined;

  const get = (forceRefresh = false): Promise<boolean> => {
    if (!forceRefresh && cached !== undefined) return Promise.resolve(cached);
    if (!forceRefresh && pendingRead) return pendingRead;

    const readRevision = revision;
    const precedingWrites = writeTail;
    const read = precedingWrites
      .then(() => storage.getItem(key))
      .then(async (value) => {
        if (readRevision !== revision) {
          await writeTail;
          return cached ?? fallback;
        }
        cached = value === 'true';
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
    const operation = writeTail.then(() => storage.setItem(key, String(enabled)));
    writeTail = operation.catch(() => {});
    return operation.then(
      () => {
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
  };

  return { get, set };
}
