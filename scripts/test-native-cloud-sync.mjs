import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSingleFlightActionRunner } from '../native-app/lib/singleFlightAction.ts';
import { colors } from '../native-app/constants/theme.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const cloud = read('native-app/lib/cloudSync.ts');
const monitor = read('native-app/app/monitor.tsx');
const settings = read('native-app/app/settings.tsx');
const history = read('native-app/app/history.tsx');
const appConfig = JSON.parse(read('native-app/app.json'));
const nativePackage = JSON.parse(read('native-app/package.json'));
const cloudCard = read('native-app/components/CloudSyncCard.tsx');

const relativeLuminance = hex => {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map(value => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrastRatio = (foreground, background) => {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

assert.equal(
  nativePackage.dependencies['expo-secure-store'],
  '~57.0.2',
  'native auth tokens must use the SDK-compatible SecureStore package',
);
assert.ok(
  appConfig.expo.plugins.includes('expo-secure-store'),
  'the native package must include the SecureStore config plugin',
);
assert.match(cloud, /SecureStore\.setItemAsync\(AUTH_KEY/);
assert.match(cloud, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
assert.doesNotMatch(
  cloud,
  /SERVICE_ROLE|service.role/i,
  'the native bundle must never reference the Supabase service-role credential',
);
assert.doesNotMatch(
  cloud,
  /testConditions|lighting|eyewear|phonePosition|deviceImpact|batteryImpact|phoneHeat|appVersion|appBuildNumber|headNodObservations/,
  'pilot review observations and build metadata must not be added to cloud sync',
);
assert.match(cloud, /if \(!await consentEnabled\(\) \|\| !await ensureDriverProfile\(\)\) return null;/);
assert.match(cloud, /https:\/\/www\.occulert\.com/);

const eventStart = cloud.indexOf('export async function logCloudAlert');
const eventEnd = cloud.indexOf('export async function finishCloudSession');
assert.ok(eventStart >= 0 && eventEnd > eventStart, 'cloud alert function must exist');
const eventSource = cloud.slice(eventStart, eventEnd);
assert.doesNotMatch(
  eventSource,
  /latitude|longitude|location|camera|video|audio/i,
  'native cloud alert events must not add location or media data',
);

assert.match(monitor, /beginCloudSession\(\)/);
assert.match(monitor, /logCloudAlert\(sessionId, result\.fatigueScore\)/);
assert.match(monitor, /finishCloudSession\(cloudSessionId/);
assert.match(monitor, /cloudSynced: true/);
assert.match(monitor, /headNodObservationsRef\.current \+= 1/);
assert.match(cloud, /Candidate head-nod observations remain local until device validation/);
assert.match(settings, /<CloudSyncCard \/>/);
assert.match(history, /This alert rating stays only on this iPhone/);
assert.match(history, /Does not trigger alerts/);

assert.match(cloudCard, /createSingleFlightActionRunner/);
assert.match(cloudCard, /could not complete or confirm that change/);
assert.match(cloudCard, /\.finally\(\(\) =>/);
assert.doesNotMatch(cloudCard, /applyConsent\([^)]*\)\.catch\(\(\) => \{\}\)/);
assert.match(cloudCard, /backgroundColor: colors\.blueStrong/);
assert.ok(
  contrastRatio('#ffffff', colors.blueStrong) >= 4.5,
  'white primary-button text must retain at least 4.5:1 contrast',
);

const failureBusyStates = [];
const failureErrors = [];
let attempts = 0;
const retryRunner = createSingleFlightActionRunner();
const failed = await retryRunner.run({
  action: async () => {
    attempts += 1;
    throw new Error('secure storage unavailable');
  },
  onBusyChange: busy => failureBusyStates.push(busy),
  onError: () => failureErrors.push('error'),
});
const retried = await retryRunner.run({
  action: async () => { attempts += 1; },
  onBusyChange: busy => failureBusyStates.push(busy),
  onError: () => failureErrors.push('unexpected'),
});
assert.equal(failed, false, 'a failed cloud action must report failure');
assert.equal(retried, true, 'the action runner must allow a retry after failure');
assert.equal(attempts, 2, 'the retry must execute after busy state recovers');
assert.deepEqual(failureBusyStates, [true, false, true, false]);
assert.deepEqual(failureErrors, ['error']);

const overlapBusyStates = [];
let releaseFirst;
let markFirstStarted;
const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
const overlapRunner = createSingleFlightActionRunner();
const first = overlapRunner.run({
  action: async () => {
    markFirstStarted();
    await new Promise(resolve => { releaseFirst = resolve; });
  },
  onBusyChange: busy => overlapBusyStates.push(busy),
  onError: () => assert.fail('the first action should not fail'),
});
await firstStarted;
const duplicate = await overlapRunner.run({
  action: async () => assert.fail('a duplicate action must not execute'),
  onBusyChange: busy => overlapBusyStates.push(busy),
  onError: () => assert.fail('an ignored duplicate must not report an error'),
});
assert.equal(duplicate, false, 'a duplicate cloud action must be ignored while busy');
releaseFirst();
assert.equal(await first, true);
assert.deepEqual(overlapBusyStates, [true, false]);

console.log('Occulert native cloud-sync contract tests passed.');
