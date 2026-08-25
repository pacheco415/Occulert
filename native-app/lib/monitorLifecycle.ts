export type MonitorAppState =
  | 'active'
  | 'background'
  | 'inactive'
  | 'unknown'
  | 'extension';

export function shouldStopMonitoringForAppState(
  isRunning: boolean,
  isStarting: boolean,
  isRequestingCameraPermission: boolean,
  nextState: MonitorAppState,
): boolean {
  const hasActiveMonitoringWork = isRunning
    || (isStarting && !isRequestingCameraPermission);
  return hasActiveMonitoringWork && nextState !== 'active';
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
