/**
 * Wait for a bounded delay while allowing component cleanup to settle the
 * pending promise immediately. Returns false when the signal is aborted.
 */
export function waitForCancellableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);

  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;

    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => finish(false);

    timer = setTimeout(() => finish(true), Math.max(0, milliseconds));
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
