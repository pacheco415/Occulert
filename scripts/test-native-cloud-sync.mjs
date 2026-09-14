import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSingleFlightActionRunner } from '../native-app/lib/singleFlightAction.ts';
import { createAsyncMutationQueue } from '../native-app/lib/asyncMutationQueue.ts';
import { createCachedBooleanPreference } from '../native-app/lib/cachedBooleanPreference.ts';
import { colors } from '../native-app/constants/theme.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const cloud = read('native-app/lib/cloudSync.ts');
const monitor = read('native-app/app/monitor.tsx');
const settings = read('native-app/app/settings.tsx');
const history = read('native-app/app/history.tsx');
const preDrive = read('native-app/app/pre-drive.tsx');
const rootLayout = read('native-app/app/_layout.tsx');
const appConfig = JSON.parse(read('native-app/app.json'));
const nativePackage = JSON.parse(read('native-app/package.json'));
const cloudCard = read('native-app/components/CloudSyncCard.tsx');
const sessionSyncRoute = read('api/session-sync-v1.js');
const eventSyncRoute = read('api/event-sync-v1.js');
const sessionCancelRoute = read('api/session-cancel-v1.js');

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
  '~57.0.4',
  'native auth tokens must use the SDK-compatible SecureStore package',
);
assert.ok(
  appConfig.expo.plugins.includes('expo-secure-store'),
  'the native package must include the SecureStore config plugin',
);
assert.match(cloud, /SecureStore\.setItemAsync\(AUTH_KEY/);
assert.match(cloud, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
assert.match(cloud, /let authCache: StoredAuth \| null \| undefined/);
assert.match(cloud, /if \(authCache !== undefined\) return authCache/);
assert.match(cloud, /if \(!authLoadPromise\)/);
assert.match(cloud, /readVersion !== authMutationVersion/);
assert.match(cloud, /A transient keychain or JSON read failure must remain retryable/);
assert.match(cloud, /expectedVersion !== authMutationVersion/);
assert.match(cloud, /authStorageQueue\.run\(async \(\) =>/);
assert.match(cloud, /authStorageQueue\.run\(\(\) => SecureStore\.deleteItemAsync/);
assert.doesNotMatch(
  cloud,
  /writeVersion !== authMutationVersion[\s\S]{0,120}SecureStore\.deleteItemAsync/,
  'a stale token writer must never delete a newer queued login',
);
assert.match(cloud, /refreshAuth\(auth, refreshVersion\)/);
assert.match(cloud, /if \(!authRefreshPromise\)/);
assert.match(cloud, /authCache = auth/);
assert.match(cloud, /consentRuntimeOverride = false;\s*authMutationVersion \+= 1;[\s\S]{0,100}sharingEpoch \+= 1;/);
assert.match(cloud, /cloudSyncPreference\.set\(false\)/);
assert.match(cloud, /cloudSyncPreference\.get\(\)/);
assert.match(cloud, /await sessionOutbox\.clear\(\)/);
const clearAuthStart = cloud.indexOf('async function clearAuth');
const clearAuthEnd = cloud.indexOf('async function authFetch', clearAuthStart);
const clearAuthSource = cloud.slice(clearAuthStart, clearAuthEnd);
assert.ok(
  clearAuthSource.indexOf('consentRuntimeOverride = false') < clearAuthSource.indexOf('await loadAuth()'),
  'account clearing must revoke the runtime before reading storage',
);
assert.match(clearAuthSource, /const cleanup = flushCloudUploads\(auth\)\.then\(\(\) => flushCloudUploads\(auth\)\)/);
const revokeConsent = cloud.indexOf('await cloudSyncPreference.set(false)', clearAuthStart);
const revokeOutbox = cloud.indexOf('await sessionOutbox.clear', revokeConsent);
const revokeCredential = cloud.indexOf('SecureStore.deleteItemAsync', revokeOutbox);
const revokeCache = cloud.indexOf('authCache = null', revokeCredential);
assert.ok(
  revokeConsent >= 0 && revokeConsent < revokeOutbox && revokeOutbox < revokeCredential && revokeCredential < revokeCache,
  'sign-out must persist consent, persist cleanup tombstones, then remove credentials',
);
const disableStart = cloud.indexOf('export async function setCloudSyncEnabled');
const disableEnd = cloud.indexOf('async function sendOutboxRequest', disableStart);
const disableSource = cloud.slice(disableStart, disableEnd);
assert.ok(
  disableSource.indexOf('consentRuntimeOverride = false') < disableSource.indexOf('await loadAuth()'),
  'disabling sharing must revoke the runtime before reading storage',
);
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
assert.match(cloud, /auth.user.id !== expectedOwner/);
assert.match(cloud, /expectedSharingEpoch !== sharingEpoch/);
assert.match(cloud, /sessionOutbox.clear\(/);
assert.match(cloud, /sessionOutbox.add\(/);
assert.match(cloud, /const sessionCreate = method === 'POST' && path === '\/api\/sessions'/);
assert.match(cloud, /loadConfig\(sessionCreate\)/);
assert.match(cloud, /'\/api\/sessions': '\/api\/session-sync-v1'/);
assert.match(cloud, /'\/api\/events': '\/api\/event-sync-v1'/);
assert.match(cloud, /'\/api\/session-cancel-v1'/);
assert.match(cloud, /cancel_token: cancelToken/);
const tokenCancelStart = cloud.indexOf('async function cancelPendingCloudSessionByToken');
const tokenCancelEnd = cloud.indexOf('async function clearAuth', tokenCancelStart);
const tokenCancelSource = cloud.slice(tokenCancelStart, tokenCancelEnd);
assert.match(tokenCancelSource, /method: 'DELETE'/);
assert.match(tokenCancelSource, /session_id: sessionId,[\s\S]*cancel_token: cancelToken,[\s\S]*cleanup_token: cleanupToken/);
assert.doesNotMatch(tokenCancelSource, /Authorization/);
assert.match(cloud, /returnedId !== expectedId/);
assert.match(cloud, /sessionsWithUploadGaps\.has\(sessionId\)/);
assert.match(cloud, /sessionOutbox.markPartial\(sessionId\)/);
assert.match(cloud, /result\.body\.cancellation_recorded !== true/);
assert.match(cloud, /fleet_sync_token: auth\.fleet_sync_token \|\| null/);
assert.match(cloud, /expectedGeneration !== fleetGrantRequestGeneration/);
assert.match(cloud, /profile_refresh_superseded/);
assert.match(cloud, /requestDriverProfile\('GET', owner/);
assert.match(cloud, /if \(result\.status === 404/);
assert.match(cloud, /requestDriverProfile\('POST', owner/);
assert.match(preDrive, /await refreshCloudFleetGrant\(\)/);
assert.match(preDrive, /Fleet sync unavailable/);
assert.match(preDrive, /may stay only in your account/);
assert.match(preDrive, /checkGeneration !== cloudCheckGenerationRef\.current/);
assert.match(preDrive, /cloudCheckGenerationRef\.current \+= 1;/);
assert.match(preDrive, /if \(!checklistReadyRef\.current\) return;/);
assert.match(preDrive, /if \(!checklistReadyRef\.current \|\| cloudCheckInFlightRef\.current\) return;/);
assert.match(preDrive, /useFocusEffect/);
assert.match(rootLayout, /refreshCloudFleetGrant\(\)/);
assert.match(sessionSyncRoute, /require\('\.\/sessions'\)/);
assert.match(eventSyncRoute, /require\('\.\/events'\)/);
assert.match(sessionCancelRoute, /request\.method !== 'DELETE'/);
assert.match(sessionCancelRoute, /validId\(body\.session_id\)/);
assert.match(sessionCancelRoute, /validId\(body\.cancel_token\)/);
assert.match(sessionCancelRoute, /validId\(body\.cleanup_token\)/);
assert.match(sessionCancelRoute, /rpc\/cancel_session_sync_token_v1/);
assert.match(cloud, /configPromise = null;\s*nextUploadAttempt = Date\.now\(\) \+ 60_000;/);
assert.match(cloud, /https:\/\/www\.occulert\.com/);

const loadAuthSource = cloud
  .slice(cloud.indexOf('async function loadAuth'), cloud.indexOf('async function saveAuth'))
  .replace('async function loadAuth(): Promise<StoredAuth | null>', 'async function loadAuth()')
  .replace('const parsed: unknown', 'const parsed');
assert.ok(loadAuthSource.includes('async function loadAuth'), 'loadAuth must remain directly testable');
let secureStoreReads = 0;
const retryingSecureStore = {
  getItemAsync: async () => {
    secureStoreReads += 1;
    if (secureStoreReads === 1) throw new Error('temporary keychain failure');
    return JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: 4_000_000_000,
      user: { id: 'user-1', email: 'driver@example.com' },
    });
  },
};
const makeLoadAuth = new Function(
  'SecureStore',
  'AUTH_KEY',
  'SECURE_OPTIONS',
  'validStoredAuth',
  `let authCache;
   let authLoadPromise = null;
   let authMutationVersion = 0;
   ${loadAuthSource}
   return loadAuth;`,
);
const retryingLoadAuth = makeLoadAuth(
  retryingSecureStore,
  'occulert-auth',
  {},
  value => Boolean(value?.access_token && value?.refresh_token && value?.user?.id && value?.user?.email),
);
assert.equal(await retryingLoadAuth(), null, 'a transient storage failure should fail closed');
assert.equal((await retryingLoadAuth())?.user.email, 'driver@example.com', 'the next auth read must retry and recover');
assert.equal((await retryingLoadAuth())?.access_token, 'access', 'successful auth should remain cached');
assert.equal(secureStoreReads, 2, 'only the failed read and one successful retry should reach SecureStore');

const mutationEvents = [];
let releaseOldTokenWrite;
const tokenQueue = createAsyncMutationQueue();
const oldTokenWrite = tokenQueue.run(async () => {
  mutationEvents.push('old-start');
  await new Promise(resolve => { releaseOldTokenWrite = resolve; });
  mutationEvents.push('old-finish');
});
const clearToken = tokenQueue.run(async () => { mutationEvents.push('clear'); });
const saveNewToken = tokenQueue.run(async () => { mutationEvents.push('new'); });
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(mutationEvents, ['old-start']);
releaseOldTokenWrite();
await Promise.all([oldTokenWrite, clearToken, saveNewToken]);
assert.deepEqual(
  mutationEvents,
  ['old-start', 'old-finish', 'clear', 'new'],
  'sign-out and a newer login must persist after an older token write',
);

let resolveConsentRead;
let storedConsent = 'true';
const consentPreference = createCachedBooleanPreference({
  getItem() {
    return new Promise(resolve => { resolveConsentRead = resolve; });
  },
  async setItem(_key, value) {
    storedConsent = value;
  },
}, 'cloud-consent');
const staleConsentRead = consentPreference.get();
const disableConsent = consentPreference.set(false);
await Promise.resolve();
assert.equal(typeof resolveConsentRead, 'function');
resolveConsentRead('true');
await disableConsent;
assert.equal(await staleConsentRead, false, 'a delayed read must not restore disabled cloud sync');
assert.equal(storedConsent, 'false');
assert.equal(await consentPreference.get(), false);

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
assert.match(cloud, /cloudSynced: !partial/);
assert.match(cloud, /cloudSyncNeedsReview: partial/);
assert.match(
  monitor,
  /if \(!isRunningRef\.current \|\| stoppingRef\.current\) return;/,
  'late frame callbacks must not mutate a stopped monitoring session',
);
assert.match(monitor, /headNodObservationsRef\.current \+= 1/);
assert.match(cloud, /Candidate head-nod observations remain local until device validation/);
assert.match(settings, /<CloudSyncCard \/>/);
assert.match(history, /This alert rating stays only on this iPhone/);
assert.match(history, /Does not trigger alerts/);

assert.match(cloudCard, /createSingleFlightActionRunner/);
assert.match(cloudCard, /pendingCloudSessionIds\(\)\.catch\(\(\) => \[\]\)/);
assert.match(cloudCard, /const generation = \+\+refreshGenerationRef\.current/);
assert.match(cloudCard, /generation !== refreshGenerationRef\.current/);
assert.match(cloudCard, /could not complete or confirm that change/);
assert.match(cloudCard, /\.finally\(\(\) =>/);
assert.match(cloudCard, /retryRunnerRef\.current\.run\(/);
assert.match(cloudCard, /onPress=\{retrySync\}/);
assert.match(cloudCard, /disabled=\{busy \|\| syncing \|\| !state\.syncEnabled\}/);
assert.match(cloudCard, /disabled=\{busy\} onPress=\{signOut\}/);
assert.match(cloudCard, /accessibilityLabel="Share session summaries"\s*disabled=\{busy\}/);
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
