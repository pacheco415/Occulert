import type { AlertLevel } from './alertPolicy';

export const IN_EAR_ALERT_PATTERN_KEY = 'occulert-in-ear-alert-pattern';

export type InEarAlertPattern = 'balanced' | 'alternating';
export type AlertAudioChannel = 'balanced' | 'left' | 'right';

export function parseInEarAlertPattern(value: string | null | undefined): InEarAlertPattern {
  return value === 'alternating' ? 'alternating' : 'balanced';
}

/**
 * Directional emphasis is deliberately limited to non-critical drowsiness
 * alerts. Tracking-loss and critical alerts stay centered so they remain as
 * audible as possible on speakers, car audio, or a single earbud.
 */
export function nextAlertAudioChannel(
  pattern: InEarAlertPattern,
  level: AlertLevel,
  previousDirectionalChannel: Exclude<AlertAudioChannel, 'balanced'> | null,
): AlertAudioChannel {
  if (pattern !== 'alternating' || level === 'critical' || level === 'tracking') {
    return 'balanced';
  }

  return previousDirectionalChannel === 'left' ? 'right' : 'left';
}
