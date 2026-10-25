// RN 0.88 can expose an unset initial state or a future native state string.
// The existing policy treats every value except 'active' as unavailable.
export type MonitorAppState = string | null | undefined;

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
