import { readHistorySourceOwners } from './lib/history-source-owners.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createSingleFlightActionRunner } from '../native-app/lib/singleFlightAction.ts';
import { createAsyncMutationQueue } from '../native-app/lib/asyncMutationQueue.ts';
import { createCachedBooleanPreference } from '../native-app/lib/cachedBooleanPreference.ts';
import { createSessionSummaryOutbox, SESSION_SUMMARY_OUTBOX_KEY } from '../native-app/lib/sessionSummaryOutbox.ts';
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
  '~58.0.2',
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
assert.match(monitor, /logCloudAlert\(sessionId, result\.fatigueScore, occurredAt\)/);
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
// Erase types while exercising the actual pinned configuration/auth functions.
const sliceSource = (start, end) => {
  const from = cloud.indexOf(start), to = cloud.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} must remain directly testable`);
  return stripTypeScriptTypes(cloud.slice(from, to));
};
const configAndAuthSource = sliceSource('async function loadConfig', 'function nativeEventLogin')
  + sliceSource('async function authFetch', 'function authErrorText');
const makeAuthFetch = new Function('API_BASE', 'pinnedSupabaseConfig', 'fetchJsonWithTimeout',
  `let configPromise = null;const NATIVE_EVENT_RETRY_ENABLED=false;\n${configAndAuthSource}\nreturn authFetch;`);
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

// Exercise the complete production module, including its real storage queues,
// outbox and request deadlines; only native bridges and transport are replaced.
const signOutAuthKey = 'occulert.cloud.auth.v1';
const signOutConsentKey = 'occulert-cloud-sync-enabled';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flushCloud = async () => { for (let i = 0; i < 80; i += 1) await Promise.resolve(); };
const cloudResponse = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
const cloudAuth = (owner = 'old', expires_at = 4_000_000_000) => ({
  access_token: `${owner}-access`, refresh_token: `${owner}-refresh`, expires_at,
  user: { id: owner, email: `${owner}@example.com` },
});
const cloudToken = (owner, access_token = `${owner}-fresh-access`) => ({
  ...cloudAuth(owner), access_token, expires_in: 3600,
});
const logoutRequests = fixture => fixture.requests.filter(({ url }) => new URL(url).pathname === '/auth/v1/logout');
const refreshRequests = fixture => fixture.requests.filter(({ url }) => url.includes('grant_type=refresh_token'));
function signOutFixture(initial = cloudAuth()) {
  const secure = new Map(initial ? [[signOutAuthKey, JSON.stringify(initial)]] : []);
  const storage = new Map([[signOutConsentKey, 'true'], [SESSION_SUMMARY_OUTBOX_KEY, JSON.stringify({ old: [] })]]);
  const requests = [], timers = new Map(), events = [];
  let timerId = 0;
  const fixture = {
    secure, storage, requests, timers, events,
    transport: async url => url.includes('grant_type=password')
      ? cloudResponse(200, cloudToken('new', 'new-login-access'))
      : url.includes('grant_type=refresh_token') ? cloudResponse(200, cloudToken(initial.user.id)) : cloudResponse(200),
  };
  fixture.secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device', isAvailableAsync: async () => true,
    getItemAsync: async key => { events.push('auth-read'); return secure.get(key) ?? null; },
    setItemAsync: async (key, value) => { events.push('auth-write'); secure.set(key, value); },
    deleteItemAsync: async key => { events.push('auth-delete'); secure.delete(key); },
  };
  const bindings = {
    SIMULATOR_TRACE: false,
    SecureStore: fixture.secureStore,
    AsyncStorage: {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => { events.push(`preference:${value}`); storage.set(key, value); },
      removeItem: async key => { events.push('outbox-clear'); storage.delete(key); },
    },
    createAsyncMutationQueue, createCachedBooleanPreference, createSessionSummaryOutbox, pinnedSupabaseConfig,
    updateSessionHistory: async () => {}, Platform: { OS: 'ios', Version: '27.1' },
    currentAppBuildInfo: () => ({}), formatAppBuildLabel: () => 'test',
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, init) => {
      requests.push({ url, init });
      events.push(`request:${new URL(url).pathname}`);
      if (url.endsWith('/api/public-config')) return fixture.publicConfig
        ? fixture.publicConfig(url, init)
        : cloudResponse(200, { supabase: { configured: true, url: SUPABASE_ORIGIN, anonKey } });
      if (url.endsWith('/api/profile')) return cloudResponse(200, { driver: { id: 'driver' } });
      return fixture.transport(url, init);
    },
  };
  const body = cloud.replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export /gm, '');
  const exports = {};
  vm.runInNewContext(`${stripTypeScriptTypes(body)}\nObject.assign(exports, {
    getCloudState, signInToCloud, signOutOfCloud, setCloudSyncEnabled, loadAuth, refreshIfNeeded, cloudSessionScopes, logCloudAlert,
    snapshot: () => ({ auth: authCache, authVersion: authMutationVersion, consent: consentRuntimeOverride }),
  });`, { exports, AbortController, Date, ...bindings }, { timeout: 1000 });
  fixture.api = exports;
  fixture.api.cloudSessionScopes.set('old-session', { ownerId: 'old', consentVersion: 0 });
  fixture.expire = async () => {
    const pending = [...timers.values()];
    assert.ok(pending.length, 'pending native reads/requests must have a deadline');
    assert.ok(pending.every(timer => timer.delay === 8_000));
    pending.forEach(timer => timer.fn());
    await flushCloud();
  };
  return fixture;
}

const eventRequests = fixture => fixture.requests.filter(({ url }) => url.endsWith('/api/events'));
const eventBodies = fixture => eventRequests(fixture).map(({ init }) => JSON.parse(init.body));

for (const wait of ['session creation', 'an earlier event']) {
  test(`native monitor captures occurrence time before waiting for ${wait}`, async () => {
    const f = signOutFixture(), pending = deferred();
    const detectedAt = Date.parse('2026-10-28T20:00:00.000Z');
    const queue = { current: wait === 'an earlier event' ? pending.promise : Promise.resolve() };
    const from = monitor.indexOf("    const alerting = result.state === 'closed';");
    const to = monitor.indexOf('    prevAlertingRef.current = alerting;', from);
    assert.ok(from >= 0 && to > from, 'exercise the production monitor alert transition');
    vm.runInNewContext(monitor.slice(from, to + '    prevAlertingRef.current = alerting;'.length), {
      Date, now: detectedAt, result: { state: 'closed', fatigueScore: 61.4 },
      prevAlertingRef: { current: false }, alertCountRef: { current: 0 }, setAlertCount() {},
      cloudSessionRef: { current: wait === 'session creation' ? pending.promise : Promise.resolve('old-session') },
      cloudEventQueueRef: queue, logCloudAlert: f.api.logCloudAlert, queueNativeCloudAlert: () => null,
    });
    await flushCloud();
    assert.equal(eventRequests(f).length, 0, 'local alert handling must not wait for cloud work');
    pending.resolve(wait === 'session creation' ? 'old-session' : undefined);
    await queue.current;
    assert.deepEqual(eventBodies(f), [{ session_id: 'old-session', type: 'drowsy', fatigue_score: 61, occurred_at: new Date(detectedAt).toISOString() }]);
  });
}

for (const fallbackStatus of [200, 400, 401]) {
  test(`native skew fallback sends only one untimed request, ending in ${fallbackStatus}`, async () => {
    const f = signOutFixture();
    f.transport = async () => cloudResponse(eventRequests(f).length === 1 ? 400 : fallbackStatus, { error: 'invalid_occurred_at' });
    const detectedAt = '2030-01-01T00:00:00.000Z';
    assert.equal(await f.api.logCloudAlert('old-session', 61.4, detectedAt), fallbackStatus === 200);
    assert.deepEqual(eventBodies(f), [
      { session_id: 'old-session', type: 'drowsy', fatigue_score: 61, occurred_at: detectedAt },
      { session_id: 'old-session', type: 'drowsy', fatigue_score: 61 },
    ]);
    assert.equal(refreshRequests(f).length, 0, 'the untimed fallback must not trigger another authenticated event POST');
    assert.equal(f.timers.size, 0);
  });
}

for (const [status, error] of [[400, 'invalid_event'], [409, 'invalid_occurred_at'], [503, 'invalid_occurred_at']]) {
  test(`native alert failure ${status} ${error} does not resend`, async () => {
    const f = signOutFixture();
    f.transport = async () => cloudResponse(status, { error });
    assert.equal(await f.api.logCloudAlert('old-session', 40, '2026-10-28T20:00:00.000Z'), false);
    assert.equal(eventRequests(f).length, 1);
  });
}

test('native untimed alerts do not retry invalid_occurred_at', async () => {
  const f = signOutFixture();
  f.transport = async () => cloudResponse(400, { error: 'invalid_occurred_at' });
  assert.equal(await f.api.logCloudAlert('old-session', 40), false);
  assert.deepEqual(eventBodies(f), [{ session_id: 'old-session', type: 'drowsy', fatigue_score: 40 }]);
});

for (const change of ['sharing off', 'sharing off/on', 'account switch', 'logout/login', 'session finished']) {
  test(`native timestamp fallback cannot survive ${change}`, async () => {
    const f = signOutFixture(), started = deferred(), rejected = deferred();
    const transport = f.transport;
    f.transport = async (url, init) => {
      if (url.endsWith('/api/events')) { started.resolve(); return rejected.promise; }
      if (change === 'logout/login' && url.includes('grant_type=password')) return cloudResponse(200, cloudToken('old'));
      return transport(url, init);
    };
    const pending = f.api.logCloudAlert('old-session', 40, '2030-01-01T00:00:00.000Z');
    await started.promise;
    if (change === 'sharing off' || change === 'sharing off/on') {
      assert.equal(await f.api.setCloudSyncEnabled(false), true);
      if (change === 'sharing off/on') assert.equal(await f.api.setCloudSyncEnabled(true), true);
    } else if (change === 'session finished') {
      f.api.cloudSessionScopes.delete('old-session');
    } else {
      if (change === 'logout/login') await f.api.signOutOfCloud();
      assert.equal((await f.api.signInToCloud('driver@example.com', 'fixture-password')).ok, true);
    }
    rejected.resolve(cloudResponse(400, { error: 'invalid_occurred_at' }));
    assert.equal(await pending, false);
    assert.equal(eventRequests(f).length, 1);
  });
}

test('a stalled native skew fallback remains bounded by the existing request deadline', async () => {
  const f = signOutFixture(), stalled = deferred();
  f.transport = async () => eventRequests(f).length === 1
    ? cloudResponse(400, { error: 'invalid_occurred_at' }) : stalled.promise;
  const pending = f.api.logCloudAlert('old-session', 40, '2030-01-01T00:00:00.000Z');
  await flushCloud();
  assert.equal(eventRequests(f).length, 2);
  await f.expire();
  assert.equal(await pending, false);
  assert.equal(eventRequests(f).length, 2);
});

test('native sign-out invalidates local state and revokes once while token deletion is stalled', async () => {
  const f = signOutFixture(), deletion = deferred();
  await f.api.getCloudState();
  f.secureStore.deleteItemAsync = async key => { await deletion.promise; f.secure.delete(key); };
  const logout = f.api.signOutOfCloud();
  assert.equal(f.api.snapshot().auth, null);
  assert.equal(f.api.snapshot().consent, false);
  assert.equal(f.api.cloudSessionScopes.size, 0);
  await flushCloud();
  const requests = logoutRequests(f);
  assert.equal(requests.length, 1, 'stalled keychain deletion must not prevent bounded server revocation');
  assert.equal(requests[0].url, `${SUPABASE_ORIGIN}/auth/v1/logout?scope=local`);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.apikey, anonKey);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer old-access');
  assert.equal(refreshRequests(f).length, 0);
  assert.equal((await f.api.getCloudState()).signedIn, false);
  assert.equal(f.timers.size, 0, 'the completed revocation releases its request deadline before deletion settles');
  deletion.resolve();
  await logout;
  await flushCloud();
  assert.equal(f.secure.has(signOutAuthKey), false);
  assert.equal(f.storage.get(signOutConsentKey), 'false');
  assert.equal(f.storage.has(SESSION_SUMMARY_OUTBOX_KEY), false);
  assert.equal(f.events.includes('auth-write'), false);
  await f.api.signOutOfCloud();
  await flushCloud();
  assert.equal(logoutRequests(f).length, 1, 'a repeated signed-out action must not reuse the old credentials');
});

test('native expired sign-out refreshes the captured session once without saving credentials', async () => {
  const f = signOutFixture(cloudAuth('old', 0));
  await f.api.getCloudState();
  await f.api.signOutOfCloud();
  await flushCloud();
  assert.equal(refreshRequests(f).length, 1);
  assert.equal(JSON.parse(refreshRequests(f)[0].init.body).refresh_token, 'old-refresh');
  assert.equal(refreshRequests(f)[0].init.headers.apikey, anonKey);
  assert.equal(logoutRequests(f).length, 1);
  assert.equal(logoutRequests(f)[0].init.headers.Authorization, 'Bearer old-fresh-access');
  assert.equal(f.events.includes('auth-write'), false);
  assert.equal(f.api.snapshot().auth, null);
  assert.equal(f.secure.has(signOutAuthKey), false);
});

for (const [label, reply] of [
  ['missing owner', { access_token: 'fresh-access' }],
  ['different owner', cloudToken('other')],
  ['missing token', { user: { id: 'old' } }],
  ['non-string token', { user: { id: 'old' }, access_token: 42 }],
  ['empty token', cloudToken('old', '')],
  ['header-injection token', cloudToken('old', 'fresh\r\nInjected: value')],
  ['trailing-newline token', cloudToken('old', 'fresh\n')],
  ['missing lifetime', { ...cloudToken('old'), expires_in: undefined }],
  ['zero lifetime', { ...cloudToken('old'), expires_in: 0 }],
  ['negative lifetime', { ...cloudToken('old'), expires_in: -1 }],
  ['non-number lifetime', { ...cloudToken('old'), expires_in: '3600' }],
  ['null lifetime', { ...cloudToken('old'), expires_in: null }],
]) {
  test(`native sign-out rejects a refresh with ${label}`, async () => {
    const f = signOutFixture(cloudAuth('old', 0));
    f.transport = async () => cloudResponse(200, reply);
    await f.api.getCloudState();
    await f.api.signOutOfCloud();
    await flushCloud();
    assert.equal(refreshRequests(f).length, 1);
    assert.equal(logoutRequests(f).length, 0);
    assert.equal(f.api.snapshot().auth, null);
    assert.equal(f.events.includes('auth-write'), false);
  });
}

test('native sign-out rejects a non-finite numeric refresh lifetime', async () => {
  const f = signOutFixture(cloudAuth('old', 0));
  f.transport = async () => ({ status: 200, ok: true,
    text: async () => '{"access_token":"fresh-access","expires_in":1e400,"user":{"id":"old"}}' });
  await f.api.getCloudState();
  await f.api.signOutOfCloud();
  await flushCloud();
  assert.equal(refreshRequests(f).length, 1);
  assert.equal(logoutRequests(f).length, 0);
  assert.equal(f.api.snapshot().auth, null);
});

for (const stage of ['refresh', 'logout']) {
  for (const failure of ['offline', 'timeout', 'unauthorized']) {
    test(`native ${stage} ${failure} leaves sign-out cleared without mutation retries`, async () => {
      const f = signOutFixture(cloudAuth('old', stage === 'refresh' ? 0 : 4_000_000_000));
      const late = deferred();
      f.transport = async () => {
        if (failure === 'offline') throw new Error('offline');
        if (failure === 'timeout') return late.promise;
        return cloudResponse(401, { error: 'expired' });
      };
      await f.api.getCloudState();
      await f.api.signOutOfCloud();
      await flushCloud();
      if (failure === 'timeout') {
        await f.expire();
        assert.equal(f.requests.at(-1).init.signal.aborted, true);
        late.resolve(cloudResponse(200, cloudToken('old')));
        await flushCloud();
      }
      assert.equal(refreshRequests(f).length, stage === 'refresh' ? 1 : 0);
      assert.equal(logoutRequests(f).length, stage === 'logout' ? 1 : 0);
      assert.equal((await f.api.getCloudState()).signedIn, false);
      assert.equal(f.secure.has(signOutAuthKey), false);
      assert.equal(f.storage.get(signOutConsentKey), 'false');
      assert.equal(f.api.cloudSessionScopes.size, 0);
      assert.equal(f.timers.size, 0);
    });
  }
}

for (const owner of ['new', 'old']) {
  test(`native captured refresh/logout cannot overwrite a newer ${owner === 'old' ? 'same-owner' : 'different-owner'} login`, async () => {
    const f = signOutFixture(cloudAuth('old', 0)), started = deferred(), late = deferred();
    f.transport = async url => {
      if (url.includes('grant_type=refresh_token')) { started.resolve(); return late.promise; }
      if (url.includes('grant_type=password')) return cloudResponse(200, cloudToken(owner, 'new-login-access'));
      return cloudResponse(204);
    };
    await f.api.getCloudState();
    await f.api.signOutOfCloud();
    await started.promise;
    assert.equal((await f.api.signInToCloud(`${owner}@example.com`, 'password')).ok, true);
    assert.equal(await f.api.setCloudSyncEnabled(true), true);
    late.resolve(cloudResponse(200, cloudToken('old')));
    await flushCloud();
    assert.equal(logoutRequests(f).length, 1);
    assert.equal(logoutRequests(f)[0].init.headers.Authorization, 'Bearer old-fresh-access');
    assert.equal(JSON.parse(f.secure.get(signOutAuthKey)).access_token, 'new-login-access');
    assert.equal((await f.api.getCloudState()).email, `${owner}@example.com`);
    assert.equal(f.storage.get(signOutConsentKey), 'true');
    assert.equal(refreshRequests(f).length, 1);
  });
}

test('native cold sign-out captures old stored credentials before delete and a queued new login', async () => {
  const f = signOutFixture(), read = deferred(), started = deferred();
  f.secureStore.getItemAsync = async key => {
    const oldValue = f.secure.get(key) ?? null;
    started.resolve();
    await read.promise;
    return oldValue;
  };
  const logout = f.api.signOutOfCloud();
  assert.equal(f.api.snapshot().auth, null);
  await started.promise;
  const newLogin = f.api.signInToCloud('new@example.com', 'password');
  await flushCloud();
  read.resolve();
  await logout;
  assert.equal((await newLogin).ok, true);
  await flushCloud();
  assert.equal(logoutRequests(f).length, 1);
  assert.equal(logoutRequests(f)[0].init.headers.Authorization, 'Bearer old-access');
  assert.equal(JSON.parse(f.secure.get(signOutAuthKey)).access_token, 'new-login-access');
});

test('native sign-out never uses the newer account returned by a stale pending auth load', async () => {
  const f = signOutFixture(), oldRead = deferred(), started = deferred();
  let reads = 0;
  f.secureStore.getItemAsync = async key => {
    if (++reads === 1) { started.resolve(); return oldRead.promise; }
    return f.secure.get(key) ?? null;
  };
  const pendingLoad = f.api.loadAuth();
  await started.promise;
  await f.api.signOutOfCloud();
  assert.equal((await f.api.signInToCloud('new@example.com', 'password')).ok, true);
  oldRead.resolve(JSON.stringify(cloudAuth()));
  assert.equal((await pendingLoad).user.id, 'new', 'the normal stale-read fallback demonstrates why it cannot capture revocation auth');
  await flushCloud();
  assert.equal(logoutRequests(f).length, 1);
  assert.equal(logoutRequests(f)[0].init.headers.Authorization, 'Bearer old-access');
  assert.equal(JSON.parse(f.secure.get(signOutAuthKey)).access_token, 'new-login-access');
});

test('native cold keychain timeout clears locally and ignores late credentials', async () => {
  const f = signOutFixture(), read = deferred();
  f.secureStore.getItemAsync = () => read.promise;
  const logout = f.api.signOutOfCloud();
  assert.equal(f.api.snapshot().auth, null);
  await flushCloud();
  await f.expire();
  await logout;
  read.resolve(JSON.stringify(cloudAuth()));
  await flushCloud();
  assert.equal(f.secure.has(signOutAuthKey), false);
  assert.equal(logoutRequests(f).length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.api.snapshot().auth, null);
});

test('native sign-out stays cleared if native token deletion fails', async () => {
  const f = signOutFixture();
  await f.api.getCloudState();
  f.secureStore.deleteItemAsync = async () => { throw new Error('keychain unavailable'); };
  await f.api.signOutOfCloud();
  await flushCloud();
  assert.equal((await f.api.getCloudState()).signedIn, false);
  assert.equal(f.api.snapshot().consent, false);
  assert.equal(f.api.cloudSessionScopes.size, 0);
  assert.equal(f.storage.get(signOutConsentKey), 'false');
  assert.equal(logoutRequests(f).length, 1, 'captured credentials can still revoke remotely after local delete failure');
  assert.equal(logoutRequests(f)[0].init.headers.Authorization, 'Bearer old-access');
  assert.equal(f.events.includes('auth-write'), false);
});

for (const failure of ['unavailable', 'malformed']) {
  test(`native cold ${failure} credentials never restore auth or start revocation`, async () => {
    const f = signOutFixture();
    f.secureStore.getItemAsync = async () => {
      if (failure === 'unavailable') throw new Error('keychain unavailable');
      return '{invalid';
    };
    await f.api.signOutOfCloud();
    await flushCloud();
    assert.equal(f.api.snapshot().auth, null);
    assert.equal(f.secure.has(signOutAuthKey), false);
    assert.equal(f.requests.length, 0);
  });
}

test('native sign-out does not wait for config/logout or clear a login completed while they wait', async () => {
  const f = signOutFixture(), configStarted = deferred(), config = deferred(), logoutStarted = deferred(), lateLogout = deferred();
  f.publicConfig = () => { configStarted.resolve(); return config.promise; };
  f.transport = async url => {
    if (new URL(url).pathname === '/auth/v1/logout') { logoutStarted.resolve(); return lateLogout.promise; }
    return cloudResponse(200, cloudToken('new', 'new-login-access'));
  };
  await f.api.getCloudState();
  await f.api.signOutOfCloud();
  await configStarted.promise;
  assert.equal(f.api.snapshot().auth, null, 'local sign-out resolves before config transport');
  const newLogin = f.api.signInToCloud('new@example.com', 'password');
  await flushCloud();
  config.resolve(cloudResponse(200, { supabase: { configured: true, url: SUPABASE_ORIGIN, anonKey } }));
  await logoutStarted.promise;
  assert.equal((await newLogin).ok, true);
  assert.equal(await f.api.setCloudSyncEnabled(true), true);
  lateLogout.resolve(cloudResponse(401));
  await flushCloud();
  assert.equal(logoutRequests(f).length, 1);
  assert.equal(logoutRequests(f)[0].init.headers.Authorization, 'Bearer old-access');
  assert.equal(refreshRequests(f).length, 0);
  assert.equal(JSON.parse(f.secure.get(signOutAuthKey)).access_token, 'new-login-access');
  assert.equal((await f.api.getCloudState()).email, 'new@example.com');
  assert.equal(f.storage.get(signOutConsentKey), 'true');
});

console.log('Occulert native cloud-sync contract tests passed.');
