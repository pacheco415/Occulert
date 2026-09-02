export type AlertLevel = 'none' | 'tracking' | 'watch' | 'alert' | 'critical';
export type MonitoredEyeState = 'open' | 'watch' | 'closed' | 'noFace';

export const CRITICAL_WARMUP_SECONDS = 10;
export const SENSOR_LOSS_GRACE_MS = 3_000;

interface AlertLevelInput {
  isRunning: boolean;
  metrics: {
    perclos: number;
    closedDurationMs: number;
    state: MonitoredEyeState;
  };
  sessionTime: number;
  trackingLostForMs: number;
  criticalPerclosThreshold: number;
  criticalClosedDurationMs: number;
}

export function confirmedEyeStateForAlert(
  rawState: MonitoredEyeState,
  closedDurationMs: number,
  earlyClosedAlertMs: number,
): MonitoredEyeState {
  if (rawState !== 'closed') return rawState;
  return closedDurationMs >= earlyClosedAlertMs ? 'closed' : 'watch';
}

export function deriveAlertLevel({
  isRunning,
  metrics,
  sessionTime,
  trackingLostForMs,
  criticalPerclosThreshold,
  criticalClosedDurationMs,
}: AlertLevelInput): AlertLevel {
  if (!isRunning) return 'none';
  if (metrics.state === 'noFace') {
    return trackingLostForMs >= SENSOR_LOSS_GRACE_MS ? 'tracking' : 'none';
  }
  if (
    metrics.state === 'closed'
    && sessionTime >= CRITICAL_WARMUP_SECONDS
    && (
      metrics.closedDurationMs >= criticalClosedDurationMs
      || metrics.perclos >= criticalPerclosThreshold
    )
  ) return 'critical';
  if (metrics.state === 'closed') return 'alert';
  if (metrics.state === 'watch') return 'watch';
  return 'none';
}

export function shouldDeliverAlert(
  previousLevel: AlertLevel,
  previousAt: number,
  nextLevel: AlertLevel,
  now: number,
  cooldownMs: number,
): boolean {
  if (nextLevel === 'none') return false;
  if (nextLevel === 'tracking' && previousLevel !== 'tracking') return true;
  const priority: Record<AlertLevel, number> = {
    none: 0,
    watch: 1,
    tracking: 2,
    alert: 3,
    critical: 4,
  };
  if (priority[nextLevel] > priority[previousLevel]) return true;
  return now - previousAt >= cooldownMs;
}
