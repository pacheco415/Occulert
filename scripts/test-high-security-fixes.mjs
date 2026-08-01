import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  deriveAlertLevel,
  SENSOR_LOSS_GRACE_MS,
  shouldDeliverAlert,
} from '../native-app/lib/alertPolicy.ts';

const noFace = { ear: 0.3, perclos: 0, fatigueScore: 0, state: 'noFace' };
const open = { ear: 0.3, perclos: 0, fatigueScore: 0, state: 'open' };
const watch = { ear: 0.2, perclos: 0.1, fatigueScore: 35, state: 'watch' };
const closed = { ear: 0.1, perclos: 0.5, fatigueScore: 90, state: 'closed' };
const criticalPerclosThreshold = 0.15;

test('sustained tracking loss becomes an explicit warning without startup noise', () => {
  assert.equal(deriveAlertLevel({
    isRunning: false,
    metrics: noFace,
    sessionTime: 0,
    trackingLostForMs: SENSOR_LOSS_GRACE_MS,
    criticalPerclosThreshold,
  }), 'none');
  assert.equal(deriveAlertLevel({
    isRunning: true,
    metrics: noFace,
    sessionTime: 3,
    trackingLostForMs: SENSOR_LOSS_GRACE_MS - 1,
    criticalPerclosThreshold,
  }), 'none');
  assert.equal(deriveAlertLevel({
    isRunning: true,
    metrics: noFace,
    sessionTime: 3,
    trackingLostForMs: SENSOR_LOSS_GRACE_MS,
    criticalPerclosThreshold,
  }), 'tracking');
  assert.equal(deriveAlertLevel({
    isRunning: true,
    metrics: open,
    sessionTime: 3,
    trackingLostForMs: 0,
    criticalPerclosThreshold,
  }), 'none');
});

test('upward severity escalation and tracking loss bypass the shared cooldown', () => {
  assert.equal(shouldDeliverAlert('watch', 1_000, 'watch', 1_001, 8_000), false);
  assert.equal(shouldDeliverAlert('watch', 1_000, 'alert', 1_001, 8_000), true);
  assert.equal(shouldDeliverAlert('alert', 1_000, 'critical', 1_001, 8_000), true);
  assert.equal(shouldDeliverAlert('critical', 1_000, 'tracking', 1_001, 8_000), true);
  assert.equal(shouldDeliverAlert('tracking', 1_000, 'alert', 1_001, 8_000), true);
  assert.equal(shouldDeliverAlert('tracking', 1_000, 'critical', 1_001, 8_000), true);
  assert.equal(shouldDeliverAlert('tracking', 1_000, 'tracking', 1_001, 8_000), false);
  assert.equal(shouldDeliverAlert('alert', 1_000, 'watch', 1_001, 8_000), false);
  assert.equal(shouldDeliverAlert('critical', 1_000, 'critical', 9_000, 8_000), true);
});

test('normal eye-state severity behavior remains intact', () => {
  assert.equal(deriveAlertLevel({
    isRunning: true,
    metrics: watch,
    sessionTime: 3,
    trackingLostForMs: 0,
    criticalPerclosThreshold,
  }), 'watch');
  assert.equal(deriveAlertLevel({
    isRunning: true,
    metrics: closed,
    sessionTime: 3,
    trackingLostForMs: 0,
    criticalPerclosThreshold,
  }), 'alert');
  assert.equal(deriveAlertLevel({
    isRunning: true,
    metrics: closed,
    sessionTime: 12,
    trackingLostForMs: 0,
    criticalPerclosThreshold,
  }), 'critical');
});

test('web copy and runtime disclose and enforce foreground-only monitoring', async () => {
  const howItWorks = readFileSync(new URL('../how-it-works.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  assert.doesNotMatch(howItWorks, /runs silently in the background/i);
  assert.match(howItWorks, /open in the foreground/i);
  assert.match(app, /async function handleVisibilityChange/);
  assert.match(app, /Monitoring stopped because Occulert left the foreground/);
  assert.match(app, /await stop\(\)/);
  assert.match(app, /Do not interact with the app while driving/);

  const handlerSource = app.match(
    /async function handleVisibilityChange\(hidden=document\.visibilityState==='hidden'\)\{.*?return true\}/s,
  )?.[0];
  assert.ok(handlerSource, 'foreground-loss handler must remain directly testable');
  const logs = [];
  let stopCount = 0;
  const context = {
    document: { visibilityState: 'hidden' },
    running: true,
    hiddenAt: 0,
    Date,
    log: (message) => logs.push(message),
    stop: async () => {
      stopCount += 1;
      context.running = false;
    },
  };
  runInNewContext(`${handlerSource}; globalThis.testHandler = handleVisibilityChange;`, context);
  assert.equal(await context.testHandler(true), true);
  assert.equal(stopCount, 1);
  assert.equal(context.running, false);
  assert.deepEqual(logs, ['Monitoring stopped because Occulert left the foreground']);
  assert.equal(await context.testHandler(true), false);
  assert.equal(stopCount, 1);
  context.running = true;
  assert.equal(await context.testHandler(false), false);
  assert.equal(stopCount, 1);
});
