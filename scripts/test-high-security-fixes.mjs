import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  deriveAlertLevel,
  SENSOR_LOSS_GRACE_MS,
  shouldDeliverAlert,
} from '../native-app/lib/alertPolicy.ts';
import {
  clearPreDriveSafetyConfirmation,
  confirmPreDriveSafety,
  consumePreDriveSafety,
  PRE_DRIVE_CONFIRMATION_TTL_MS,
} from '../native-app/lib/preDriveGate.ts';

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
  const appPage = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../driver-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(howItWorks, /runs silently in the background/i);
  assert.match(howItWorks, /open in the foreground/i);
  assert.match(app, /async function handleVisibilityChange/);
  assert.match(app, /Monitoring stopped because Occulert left the foreground/);
  assert.match(app, /await stop\(\)/);
  assert.match(app, /Do not interact with the app while driving/);
  assert.match(appPage, /Supplemental prototype only/);

  const handlerStart = app.indexOf('async function handleVisibilityChange');
  const handlerEnd = app.indexOf("document.addEventListener('visibilitychange'", handlerStart);
  const handlerSource = handlerStart >= 0 && handlerEnd > handlerStart
    ? app.slice(handlerStart, handlerEnd)
    : '';
  assert.ok(handlerSource, 'foreground-loss handler must remain directly testable');
  const logs = [];
  let stopCount = 0;
  const context = {
    document: { visibilityState: 'hidden' },
    running: true,
    starting: false,
    startCancelled: false,
    stream: null,
    video: { srcObject: null },
    hiddenAt: 0,
    Date,
    log: (message) => logs.push(message),
    setOverlay: () => {},
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

  let stoppedTracks = 0;
  context.running = false;
  context.starting = true;
  context.stream = { getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] };
  context.video.srcObject = context.stream;
  assert.equal(await context.testHandler(true), true);
  assert.equal(context.startCancelled, true);
  assert.equal(context.stream, null);
  assert.equal(context.video.srcObject, null);
  assert.equal(stoppedTracks, 1, 'foreground loss must stop a camera stream acquired during startup');
});

test('native monitoring requires a fresh one-time pre-drive safety confirmation', () => {
  clearPreDriveSafetyConfirmation();
  assert.equal(consumePreDriveSafety(1_000), false);

  confirmPreDriveSafety(1_000);
  assert.equal(consumePreDriveSafety(1_001), true);
  assert.equal(consumePreDriveSafety(1_002), false);

  confirmPreDriveSafety(1_000);
  assert.equal(consumePreDriveSafety(1_000 + PRE_DRIVE_CONFIRMATION_TTL_MS + 1), false);

  const home = readFileSync(new URL('../native-app/app/index.tsx', import.meta.url), 'utf8');
  const preDrive = readFileSync(new URL('../native-app/app/pre-drive.tsx', import.meta.url), 'utf8');
  const monitor = readFileSync(new URL('../native-app/app/monitor.tsx', import.meta.url), 'utf8');
  assert.match(home, /router\.push\('\/pre-drive'\)/);
  assert.match(preDrive, /checked\.every\(Boolean\)/);
  assert.match(preDrive, /confirmPreDriveSafety\(\)/);
  assert.match(monitor, /if \(!consumePreDriveSafety\(\)\)/);
  assert.match(monitor, /router\.replace\('\/pre-drive'\)/);
});
