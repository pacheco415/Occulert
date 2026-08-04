import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createWatchMonitoringMessage } from '../native-app/lib/watchMessages.ts';

const watchBridge = readFileSync(new URL('../native-app/lib/watchBridge.ts', import.meta.url), 'utf8');
const alertSystem = readFileSync(new URL('../native-app/components/AlertSystem.tsx', import.meta.url), 'utf8');
const alertReceiver = readFileSync(
  new URL('../native-app/targets/occulert-watch/AlertReceiver.swift', import.meta.url),
  'utf8',
);
const contentView = readFileSync(
  new URL('../native-app/targets/occulert-watch/ContentView.swift', import.meta.url),
  'utf8',
);

test('monitoring messages normalize live metrics for the Watch contract', () => {
  const message = createWatchMonitoringMessage({
    running: true,
    state: 'open',
    fatigueScore: 51.6,
    perclos: 0.12349,
    sessionTime: 91.9,
    at: 1_234.9,
  });

  assert.deepEqual(message, {
    type: 'occulert-status',
    running: true,
    state: 'open',
    fatigueScore: 52,
    perclos: 0.123,
    sessionTime: 91,
    at: 1_234,
  });
});

test('stopped and malformed payloads fail to a bounded non-live state', () => {
  const stopped = createWatchMonitoringMessage({
    running: false,
    state: 'closed',
    fatigueScore: 140,
    perclos: 2,
    sessionTime: 99_999,
    at: Number.POSITIVE_INFINITY,
  });
  assert.deepEqual(stopped, {
    type: 'occulert-status',
    running: false,
    state: 'stopped',
    fatigueScore: 100,
    perclos: 1,
    sessionTime: 86_400,
    at: 0,
  });

  const malformed = createWatchMonitoringMessage({
    running: true,
    state: 'unexpected',
    fatigueScore: Number.NaN,
    perclos: -1,
    sessionTime: -5,
    at: -10,
  });
  assert.equal(malformed.state, 'noFace');
  assert.equal(malformed.fatigueScore, 0);
  assert.equal(malformed.perclos, 0);
  assert.equal(malformed.sessionTime, 0);
  assert.equal(malformed.at, 0);
});

test('the live Watch payload contains only the approved status fields', () => {
  const message = createWatchMonitoringMessage({
    running: true,
    state: 'watch',
    fatigueScore: 30,
    perclos: 0.18,
    sessionTime: 60,
    at: Date.now(),
  });

  assert.deepEqual(Object.keys(message).sort(), [
    'at',
    'fatigueScore',
    'perclos',
    'running',
    'sessionTime',
    'state',
    'type',
  ]);
  for (const forbidden of [
    'driverId', 'sessionId', 'email', 'location', 'latitude', 'longitude',
    'image', 'video', 'audio', 'landmarks', 'rawMotion',
  ]) {
    assert.equal(forbidden in message, false, `${forbidden} must not be sent to the Watch`);
  }
});

test('live status uses latest-state delivery and never queues every update', () => {
  const start = watchBridge.indexOf('export async function sendMonitoringStatusToWatch');
  const end = watchBridge.indexOf('/**\n * Whether a paired Apple Watch', start);
  assert.ok(start >= 0 && end > start, 'status sender must be present');
  const sender = watchBridge.slice(start, end);

  assert.match(sender, /createWatchMonitoringMessage/);
  assert.match(sender, /updateApplicationContext/);
  assert.match(sender, /sendMessage/);
  assert.doesNotMatch(sender, /transferUserInfo/);
});

test('the native monitor publishes live state and an explicit stop update', () => {
  assert.match(alertSystem, /sendMonitoringStatusToWatch/);
  assert.match(alertSystem, /AsyncStorage\.getItem\('occulert-watch'\)/);
  assert.match(alertSystem, /setInterval/);
  assert.match(alertSystem, /running: true/);
  assert.match(alertSystem, /running: false/);
  assert.match(alertSystem, /watchStatusSnapshot/);
});

test('Watch status expires visibly and cannot play an alert haptic', () => {
  const start = alertReceiver.indexOf('private func handleStatus');
  const end = alertReceiver.indexOf('private func numberValue', start);
  assert.ok(start >= 0 && end > start, 'Watch status handler must be present');
  const handler = alertReceiver.slice(start, end);

  assert.match(handler, /statusFreshnessMilliseconds/);
  assert.match(handler, /monitoringState = "stale"/);
  assert.match(handler, /statusTimeoutTask/);
  assert.doesNotMatch(handler, /device\.play/);
  assert.doesNotMatch(handler, /WKInterfaceDevice/);
});

test('the Watch UI distinguishes live, stopped, and stale monitoring states', () => {
  assert.match(contentView, /LIVE MONITORING/);
  assert.match(contentView, /Fatigue/);
  assert.match(contentView, /PERCLOS/);
  assert.match(contentView, /Status paused/);
  assert.match(contentView, /pulling over safely/);
});
