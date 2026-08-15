import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCachedBooleanPreference } from '../native-app/lib/cachedBooleanPreference.ts';
import { createWatchMonitoringMessage } from '../native-app/lib/watchMessages.ts';

const watchBridge = readFileSync(new URL('../native-app/lib/watchBridge.ts', import.meta.url), 'utf8');
const watchPreferences = readFileSync(
  new URL('../native-app/lib/watchPreferences.ts', import.meta.url),
  'utf8',
);
const alertSystem = readFileSync(new URL('../native-app/components/AlertSystem.tsx', import.meta.url), 'utf8');
const alertReceiver = readFileSync(
  new URL('../native-app/targets/occulert-watch/AlertReceiver.swift', import.meta.url),
  'utf8',
);
const contentView = readFileSync(
  new URL('../native-app/targets/occulert-watch/ContentView.swift', import.meta.url),
  'utf8',
);
const targetConfig = readFileSync(
  new URL('../native-app/targets/occulert-watch/expo-target.config.js', import.meta.url),
  'utf8',
);
const settingsScreen = readFileSync(
  new URL('../native-app/app/settings.tsx', import.meta.url),
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
  assert.match(sender, /getWatchStatus\(WATCH_STATUS_CACHE_MS\)/);
  assert.match(sender, /updateApplicationContext/);
  assert.match(sender, /sendMessage/);
  assert.doesNotMatch(sender, /transferUserInfo/);
});

test('immediate alerts always refresh reachability instead of using the status cache', () => {
  const start = watchBridge.indexOf('export async function sendAlertToWatch');
  const end = watchBridge.indexOf('/**\n * Mirror the latest monitoring state', start);
  assert.ok(start >= 0 && end > start, 'alert sender must be present');
  const sender = watchBridge.slice(start, end);

  assert.match(sender, /getWatchStatus\(\)/);
  assert.doesNotMatch(sender, /WATCH_STATUS_CACHE_MS/);
  assert.match(sender, /transferUserInfo/);
  assert.match(sender, /sendMessage/);
});

test('the native monitor publishes live state and an explicit stop update', () => {
  assert.match(alertSystem, /sendMonitoringStatusToWatch/);
  assert.match(alertSystem, /const enabled = await getWatchAlertsEnabled\(\)/);
  assert.match(alertSystem, /getWatchAlertsEnabled\(true\)/);
  assert.doesNotMatch(alertSystem, /AsyncStorage\.getItem\('occulert-watch'\)/);
  const intervalMatch = alertSystem.match(/WATCH_STATUS_SYNC_INTERVAL_MS\s*=\s*([\d_]+)/);
  assert.ok(intervalMatch, 'Watch status interval must be explicit');
  const intervalMs = Number(intervalMatch[1].replaceAll('_', ''));
  assert.ok(intervalMs >= 2_000, 'informational Watch status must not cross the bridge every second');
  assert.ok(intervalMs <= 5_000, 'Watch status must remain comfortably inside the freshness window');
  assert.match(alertSystem, /setInterval[\s\S]*WATCH_STATUS_SYNC_INTERVAL_MS/);
  assert.match(alertSystem, /running: true/);
  assert.match(alertSystem, /running: false/);
  assert.match(alertSystem, /watchStatusSnapshot/);
});

test('the Watch preference cache removes repeated native storage reads', () => {
  assert.match(watchPreferences, /createCachedBooleanPreference/);
  assert.match(watchPreferences, /watchAlertsPreference\.get\(forceRefresh\)/);
  assert.match(watchPreferences, /watchAlertsPreference\.set\(enabled\)/);
  assert.match(settingsScreen, /getWatchAlertsEnabled\(true\)/);
  assert.match(settingsScreen, /setWatchAlertsEnabled/);
});

test('the Watch preference cache reuses reads and supports an explicit refresh', async () => {
  let value = 'true';
  let reads = 0;
  const preference = createCachedBooleanPreference({
    async getItem() {
      reads += 1;
      return value;
    },
    async setItem(_key, nextValue) {
      value = nextValue;
    },
  }, 'watch-alerts');

  assert.equal(await preference.get(), true);
  assert.equal(await preference.get(), true);
  assert.equal(reads, 1);
  value = 'false';
  assert.equal(await preference.get(true), false);
  assert.equal(reads, 2);
});

test('a stale Watch preference read cannot overwrite a newer write', async () => {
  let resolveRead;
  let stored = 'false';
  const preference = createCachedBooleanPreference({
    getItem() {
      return new Promise((resolve) => { resolveRead = resolve; });
    },
    async setItem(_key, value) {
      stored = value;
    },
  }, 'watch-alerts');

  const staleRead = preference.get(true);
  await Promise.resolve();
  await preference.set(true);
  resolveRead('false');

  assert.equal(stored, 'true');
  assert.equal(await staleRead, true);
  assert.equal(await preference.get(), true);
});

test('overlapping Watch preference writes stay ordered', async () => {
  const events = [];
  let releaseFirst;
  let stored = 'false';
  const preference = createCachedBooleanPreference({
    async getItem() {
      return stored;
    },
    async setItem(_key, value) {
      events.push(`start:${value}`);
      if (value === 'true') {
        await new Promise((resolve) => { releaseFirst = resolve; });
      }
      stored = value;
      events.push(`end:${value}`);
    },
  }, 'watch-alerts');

  const first = preference.set(true);
  const second = preference.set(false);
  await Promise.resolve();
  assert.deepEqual(events, ['start:true']);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, ['start:true', 'end:true', 'start:false', 'end:false']);
  assert.equal(stored, 'false');
  assert.equal(await preference.get(), false);
});

test('a failed Watch preference write does not poison the cache', async () => {
  let stored = 'true';
  let failNextWrite = true;
  const preference = createCachedBooleanPreference({
    async getItem() {
      return stored;
    },
    async setItem(_key, value) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error('storage unavailable');
      }
      stored = value;
    },
  }, 'watch-alerts');

  assert.equal(await preference.get(), true);
  await assert.rejects(preference.set(false), /storage unavailable/);
  assert.equal(await preference.get(), true);
});

test('background Watch alerts use an authorized notification instead of a silent direct haptic', () => {
  assert.match(alertReceiver, /import UserNotifications/);
  assert.match(alertReceiver, /applicationState == \.active/);
  assert.match(alertReceiver, /scheduleBackgroundAlert/);
  assert.match(alertReceiver, /UNMutableNotificationContent/);
  assert.match(alertReceiver, /interruptionLevel = \.timeSensitive/);
  assert.match(alertReceiver, /requestAuthorization\(options: \[\.alert, \.sound\]\)/);
  assert.match(alertReceiver, /authorizationStatus == \.authorized/);
  assert.match(targetConfig, /'UserNotifications'/);
  assert.match(contentView, /Enable background alerts/);
  assert.match(contentView, /refreshNotificationAuthorization/);
  assert.match(settingsScreen, /Queued delivery may be delayed/);
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
