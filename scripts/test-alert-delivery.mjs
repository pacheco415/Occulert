import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { alertDeliveryPlan } from '../native-app/lib/alertDelivery.ts';

test('alert output escalates in a short bounded sequence', () => {
  assert.deepEqual(alertDeliveryPlan('none'), {
    hapticOffsetsMs: [],
    audioOffsetsMs: [],
  });
  assert.deepEqual(alertDeliveryPlan('watch'), {
    hapticOffsetsMs: [0],
    audioOffsetsMs: [0],
  });
  assert.deepEqual(alertDeliveryPlan('alert'), {
    hapticOffsetsMs: [0, 450],
    audioOffsetsMs: [0, 900],
  });
  assert.deepEqual(alertDeliveryPlan('critical'), {
    hapticOffsetsMs: [0, 350, 700],
    audioOffsetsMs: [0, 900, 1_800],
  });
});

test('all cue plans start immediately, stay ordered, and stop within two seconds', () => {
  for (const level of ['tracking', 'watch', 'alert', 'critical']) {
    const plan = alertDeliveryPlan(level);
    for (const offsets of [plan.hapticOffsetsMs, plan.audioOffsetsMs]) {
      assert.equal(offsets[0], 0);
      assert.ok(offsets.length <= 3, `${level} must stay bounded to three cues`);
      assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
      assert.ok(offsets.at(-1) <= 1_800, `${level} must finish promptly`);
    }
  }
});

test('the delivery plan changes output only, not detection or cooldown policy', () => {
  const delivery = readFileSync(new URL('../native-app/lib/alertDelivery.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(delivery, /PERCLOS_ALERT_THRESHOLD|ALERT_COOLDOWN_MS|fatigueScore|headphoneMotion/i);
});

test('the native alert engine cancels pending cues before a new sequence', () => {
  const alertSystem = readFileSync(new URL('../native-app/components/AlertSystem.tsx', import.meta.url), 'utf8');
  assert.match(alertSystem, /cancelPendingCues/);
  assert.match(alertSystem, /cueSequenceVersion/);
  assert.match(alertSystem, /alertDeliveryPlan/);
  assert.match(alertSystem, /hapticEnabled\.current/);
  assert.match(alertSystem, /audioEnabled\.current/);
});

test('the Watch uses stronger foreground cues and a time-sensitive background alert', () => {
  const receiver = readFileSync(new URL('../native-app/targets/occulert-watch/AlertReceiver.swift', import.meta.url), 'utf8');
  assert.match(receiver, /playCriticalHapticSequence/);
  assert.match(receiver, /playStandardAlertHapticSequence/);
  assert.match(receiver, /interruptionLevel = \.timeSensitive/);
  assert.match(receiver, /Pull over safely and rest now/);
});
