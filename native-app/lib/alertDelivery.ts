import type { AlertLevel } from './alertPolicy';

export interface AlertDeliveryPlan {
  hapticOffsetsMs: readonly number[];
  audioOffsetsMs: readonly number[];
}

const SINGLE_CUE: AlertDeliveryPlan = {
  hapticOffsetsMs: [0],
  audioOffsetsMs: [0],
};

const PLANS: Record<AlertLevel, AlertDeliveryPlan> = {
  none: { hapticOffsetsMs: [], audioOffsetsMs: [] },
  tracking: SINGLE_CUE,
  watch: SINGLE_CUE,
  alert: {
    hapticOffsetsMs: [0, 450],
    audioOffsetsMs: [0, 900],
  },
  critical: {
    hapticOffsetsMs: [0, 350, 700],
    audioOffsetsMs: [0, 900, 1_800],
  },
};

/**
 * Return a short, severity-bounded delivery sequence for enabled outputs.
 * Detection thresholds and cooldowns remain separate from this output plan.
 */
export function alertDeliveryPlan(level: AlertLevel): AlertDeliveryPlan {
  return PLANS[level];
}
