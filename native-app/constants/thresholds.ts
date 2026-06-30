/**
 * Occulert Sensitivity Thresholds
 *
 * These match the web app thresholds in app.html.
 * Update both files together when changing preset values.
 *
 * EAR = Eye Aspect Ratio (0.0 = fully closed, ~0.3+ = fully open)
 * Lower closed threshold = more aggressive alerting
 * Higher closed threshold = more lenient alerting
 */

export type SensitivityLevel = 'low' | 'medium' | 'high';

export interface SensitivityPreset {
    /** EAR below this = eyes closed (triggers alert accumulation) */
  eyeClosedThreshold: number;
    /** EAR below this but above closed = eyes watch zone (yellow warning) */
  eyeWatchThreshold: number;
    /** Label for UI display */
  label: string;
    /** Description for tooltip */
  description: string;
}

export const SENSITIVITY_PRESETS: Record<SensitivityLevel, SensitivityPreset> = {
    low: {
          eyeClosedThreshold: 0.15,
          eyeWatchThreshold: 0.19,
          label: 'Low',
          description: 'Triggers only on sustained eye closure. Fewer false alerts, may miss brief events.',
    },
    medium: {
          eyeClosedThreshold: 0.18,
          eyeWatchThreshold: 0.22,
          label: 'Medium',
          description: 'Balanced detection. Recommended for most drivers. (Default)',
    },
    high: {
          eyeClosedThreshold: 0.21,
          eyeWatchThreshold: 0.25,
          label: 'High',
          description: 'Triggers earlier. More sensitive. May produce more false alerts in some conditions.',
    },
};

export const DEFAULT_SENSITIVITY: SensitivityLevel = 'medium';

/**
 * PERCLOS threshold: fraction of time eyes are closed in a rolling window
 * that triggers a fatigue alert. 0.15 = 15% of frames in the window.
 */
export const PERCLOS_ALERT_THRESHOLD = 0.15;

/**
 * Rolling window size in milliseconds for PERCLOS calculation.
 * 10 seconds is the standard clinical definition.
 */
export const PERCLOS_WINDOW_MS = 10_000;

/**
 * Minimum time between consecutive audio/haptic alerts (ms).
 * Prevents alert fatigue from rapid repeated warnings.
 */
export const ALERT_COOLDOWN_MS = 8_000;
