import { readHistorySourceOwners } from './lib/history-source-owners.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSingleFlightActionRunner } from '../native-app/lib/singleFlightAction.ts';
import { createAsyncMutationQueue } from '../native-app/lib/asyncMutationQueue.ts';
import { createCachedBooleanPreference } from '../native-app/lib/cachedBooleanPreference.ts';
import { colors } from '../native-app/constants/theme.ts';
import { SUPABASE_HOST as NATIVE_SUPABASE_HOST, SUPABASE_ORIGIN, pinnedSupabaseConfig } from '../native-app/lib/supabaseHost.ts';
import { SUPABASE_HOST as WEB_SUPABASE_HOST } from './lib/csp-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const cloud = read('native-app/lib/cloudSync.ts');
const monitor = read('native-app/app/monitor.tsx');
const settings = read('native-app/app/settings.tsx');
const historyOwners = readHistorySourceOwners(read);
  const history = historyOwners.screen;
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
assert.match(cloud, /A transient keychain read failure must remain retryable/);
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
assert.match(cloud, /consentRuntimeOverride = false;\s*consentMutationVersion \+= 1;\s*authMutationVersion \+= 1;\s*authCache = null;/);
assert.match(cloud, /cloudSyncPreference\.set\(false\)/);
assert.match(cloud, /cloudSyncPreference\.get\(\)/);
assert.doesNotMatch(
  cloud,
  /SERVICE_ROLE|service.role/i,
  'the native bundle must never reference the Supabase service-role credential',
);
assert.doesNotMatch(
  cloud,
  /testConditions|lighting|eyewear|phonePosition|deviceImpact|batteryImpact|phoneHeat|headNodObservations/,
  'pilot review observations must not be added to cloud sync',
);
assert.match(cloud, /detector_pipeline: detectorPipeline/);
assert.match(cloud, /app_version: formatAppBuildLabel\(currentAppBuildInfo\(\)\)/);
assert.match(cloud, /if \(!syncContext \|\| !await ensureDriverProfile\(syncContext\)\) return null;/);
assert.equal(
  [...cloud.matchAll(/const syncContext = await currentSyncContext\(\)/g)].length,
  3,
  'session start, alert logging, and session finish must bind consent and owner before transport',
);
assert.match(cloud, /https:\/\/www\.occulert\.com/);

const loadAuthSource = cloud
  .slice(cloud.indexOf('async function loadAuth'), cloud.indexOf('async function saveAuth'))
  .replace('async function loadAuth(): Promise<StoredAuth | null>', 'async function loadAuth()')
  .replace('let parsed: unknown', 'let parsed');
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
  'withCloudReadDeadline',
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
  read => read(),
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
const completion = read('native-app/lib/sessionCompletion.ts');
assert.match(monitor, /finalizeCompletedNativeSession/);
assert.match(monitor, /finish: finishCloudSession/);
assert.match(completion, /services\.finish\(cloudId/);
assert.match(completion, /cloudSynced: true/);
assert.match(
  monitor,
  /if \(!isRunningRef\.current \|\| stoppingRef\.current\) return;/,
  'late frame callbacks must not mutate a stopped monitoring session',
);
assert.match(monitor, /headNodObservationsRef\.current \+= 1/);
assert.match(cloud, /Candidate head-nod observations remain local until device validation/);
assert.match(settings, /<CloudSyncCard \/>/);
assert.match(historyOwners.review, /This alert rating stays only on this iPhone/);
assert.match(historyOwners.diagnostics, /Does not trigger alerts/);

assert.match(cloudCard, /createSingleFlightActionRunner/);
assert.match(cloudCard, /could not complete or confirm that change/);
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

// Sign-in credentials go only to the pinned Supabase project, never to a
// host named by a changed or spoofed /api/public-config response.
assert.equal(NATIVE_SUPABASE_HOST, WEB_SUPABASE_HOST, 'the app and website CSP must pin the same Supabase project');
assert.equal(SUPABASE_ORIGIN, `https://${WEB_SUPABASE_HOST}`);
const anonKey = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl';
assert.deepEqual(pinnedSupabaseConfig({ configured: true, url: SUPABASE_ORIGIN, anonKey }),
  { configured: true, url: SUPABASE_ORIGIN, anonKey });
assert.equal(pinnedSupabaseConfig({ configured: true, url: SUPABASE_ORIGIN, anonKey: 'sb_publishable_AbC123_x' })?.anonKey, 'sb_publishable_AbC123_x');
for (const url of [
  'https://attacker.supabase.co',
  'https://attacker.example',
  `http://${WEB_SUPABASE_HOST}`,
  `${SUPABASE_ORIGIN}/`,
  `${SUPABASE_ORIGIN}/auth`,
  `${SUPABASE_ORIGIN}:443`,
  `${SUPABASE_ORIGIN}:8443`,
  `https://user:pass@${WEB_SUPABASE_HOST}`,
  `https://${WEB_SUPABASE_HOST}.attacker.example`,
  `https://${WEB_SUPABASE_HOST.toUpperCase()}`,
  ` ${SUPABASE_ORIGIN}`,
  `${SUPABASE_ORIGIN}?x=1`,
  `${SUPABASE_ORIGIN}#x`,
  '',
  undefined,
  null,
  ['https://' + WEB_SUPABASE_HOST],
]) assert.equal(pinnedSupabaseConfig({ configured: true, url, anonKey }), null, `config url ${JSON.stringify(url)} must be refused`);
for (const key of ['', ' ', 'key\r\nX-Injected: 1', 'a'.repeat(2049), 123, null, undefined, { key: anonKey }]) {
  assert.equal(pinnedSupabaseConfig({ configured: true, url: SUPABASE_ORIGIN, anonKey: key }), null, 'malformed anon keys must be refused');
}
for (const config of [null, undefined, 'https://' + WEB_SUPABASE_HOST, [], { configured: false, url: SUPABASE_ORIGIN, anonKey },
  { configured: 'true', url: SUPABASE_ORIGIN, anonKey }, { url: SUPABASE_ORIGIN, anonKey }]) {
  assert.equal(pinnedSupabaseConfig(config), null);
}
assert.match(cloud, /response\.ok \? pinnedSupabaseConfig\(body\.supabase\) : null/, 'loadConfig must accept only the pinned project');

// Run the real loadConfig and authFetch: a config naming another host must not
// receive the email and password.
// Remove the few TypeScript annotations so the shipped source runs unchanged.
const sliceSource = (start, end, annotations) => {
  const from = cloud.indexOf(start), to = cloud.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} must remain directly testable`);
  return annotations.reduce((source, [typed, plain]) => {
    assert.ok(source.includes(typed), `expected ${typed}`);
    return source.replace(typed, plain);
  }, cloud.slice(from, to));
};
const configAndAuthSource = sliceSource('async function loadConfig', 'async function secureStoreAvailable', [
  ['loadConfig(): Promise<PublicConfig | null>', 'loadConfig()'],
  ['fetchJsonWithTimeout<{ supabase?: unknown }>(', 'fetchJsonWithTimeout('],
]) + sliceSource('async function authFetch', 'function authErrorText', [
  ['authFetch(path: string, body: Record<string, unknown>): Promise<ApiResult<AuthResponse>>', 'authFetch(path, body)'],
  ['fetchJsonWithTimeout<AuthResponse>(', 'fetchJsonWithTimeout('],
]);
const makeAuthFetch = new Function('API_BASE', 'pinnedSupabaseConfig', 'fetchJsonWithTimeout',
  `let configPromise = null;\n${configAndAuthSource}\nreturn authFetch;`);
const credentialRequests = [];
const fakeTransport = publicConfig => async (url, init = {}) => {
  if (url === 'https://www.occulert.com/api/public-config') return { response: { ok: true }, body: { ok: true, supabase: publicConfig } };
  credentialRequests.push({ url, apikey: init.headers?.apikey, body: init.body });
  return { response: { ok: true, status: 200 }, body: { access_token: 'fixture' } };
};
const credentials = { email: 'driver@example.com', password: 'fixture-password' };
for (const url of ['https://attacker.supabase.co', `${SUPABASE_ORIGIN}/`, `http://${WEB_SUPABASE_HOST}`]) {
  const authFetch = makeAuthFetch('https://www.occulert.com', pinnedSupabaseConfig, fakeTransport({ configured: true, url, anonKey }));
  const result = await authFetch('/token?grant_type=password', credentials);
  assert.deepEqual({ ok: result.ok, status: result.status, error: result.body.error }, { ok: false, status: 503, error: 'cloud_not_configured' });
}
assert.deepEqual(credentialRequests, [], 'credentials must never be sent to an unpinned host');
const pinnedAuthFetch = makeAuthFetch('https://www.occulert.com', pinnedSupabaseConfig,
  fakeTransport({ configured: true, url: SUPABASE_ORIGIN, anonKey }));
assert.equal((await pinnedAuthFetch('/token?grant_type=password', credentials)).ok, true);
assert.deepEqual(credentialRequests, [{ url: `${SUPABASE_ORIGIN}/auth/v1/token?grant_type=password`, apikey: anonKey, body: JSON.stringify(credentials) }]);
assert.doesNotMatch(cloud, /config\.url \|\| |url: config\.url/, 'no unpinned config URL may reach a request');

console.log('Occulert native cloud-sync contract tests passed.');
