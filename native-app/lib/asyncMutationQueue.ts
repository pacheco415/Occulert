export interface AsyncMutationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Keep async storage mutations ordered even when an earlier operation fails.
 * Callers retain their own revision checks inside each queued operation.
 */
export function createAsyncMutationQueue(): AsyncMutationQueue {
  let tail: Promise<void> = Promise.resolve();

  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = tail.catch(() => {}).then(operation);
    tail = pending.then(() => {}, () => {});
    return pending;
  };

  return { run };
}
