export interface SingleFlightActionOptions {
  action(): Promise<void>;
  onBusyChange(busy: boolean): void;
  onError(): void;
}

export interface SingleFlightActionRunner {
  run(options: SingleFlightActionOptions): Promise<boolean>;
}

/**
 * Run one user action at a time and always release its busy state. Duplicate
 * taps are ignored while the first action is still pending.
 */
export function createSingleFlightActionRunner(): SingleFlightActionRunner {
  let running = false;

  const run = async ({
    action,
    onBusyChange,
    onError,
  }: SingleFlightActionOptions): Promise<boolean> => {
    if (running) return false;
    running = true;

    try {
      onBusyChange(true);
      await action();
      return true;
    } catch {
      onError();
      return false;
    } finally {
      running = false;
      onBusyChange(false);
    }
  };

  return { run };
}
