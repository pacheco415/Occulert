export type MonitorAppState =
  | 'active'
  | 'background'
  | 'inactive'
  | 'unknown'
  | 'extension';

export function shouldStopMonitoringForAppState(
  isRunning: boolean,
  nextState: MonitorAppState,
): boolean {
  return isRunning && nextState !== 'active';
}

export function shouldAbortMonitoringStart(
  cancelled: boolean,
  appState: MonitorAppState,
): boolean {
  return cancelled || appState !== 'active';
}

export async function stopBeforeNavigation(
  stop: () => void | Promise<void>,
  navigate: () => void,
  onStopError: () => void = () => {},
): Promise<void> {
  try {
    await stop();
  } catch {
    onStopError();
  }
  navigate();
}
