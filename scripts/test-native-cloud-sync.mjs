import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const cloud = read('native-app/lib/cloudSync.ts');
const monitor = read('native-app/app/monitor.tsx');
const settings = read('native-app/app/settings.tsx');
const history = read('native-app/app/history.tsx');
const appConfig = JSON.parse(read('native-app/app.json'));
const nativePackage = JSON.parse(read('native-app/package.json'));

assert.equal(
  nativePackage.dependencies['expo-secure-store'],
  '~57.0.1',
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
  /testConditions|lighting|eyewear|phonePosition|deviceImpact|batteryImpact|phoneHeat|appVersion|appBuildNumber/,
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
assert.match(settings, /<CloudSyncCard \/>/);
assert.match(history, /This alert rating stays only on this iPhone/);

console.log('Occulert native cloud-sync contract tests passed.');
