import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createAsyncMutationQueue } from '../native-app/lib/asyncMutationQueue.ts';
import { createCachedBooleanPreference } from '../native-app/lib/cachedBooleanPreference.ts';
import { createHealthReadinessSnapshot, isHealthReadinessSnapshot } from '../native-app/lib/healthReadiness.ts';
import { alertDeliveryPlan, deliverCueIfCurrent } from '../native-app/lib/alertDelivery.ts';

// Execute the production TS logic with native bridges replaced. Removing imports
// and JSX presentation avoids requiring a device, Expo, or a TS compiler in CI.
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function load(source, names, bindings) {
  const body = source.replace(/^import[\s\S]*?;\s*/gm, '')
    .replace(/^export type \{[^}]+\} from .*;\s*$/gm, '')
    .replace(/^export (?:default )?/gm, '');
  const exports = {};
  vm.runInNewContext(`${stripTypeScriptTypes(body)}\nObject.assign(exports, {${names.join(',')}});`,
    { exports, AbortController, Date, console, ...bindings }, { timeout: 1000 });
  return exports;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let count = 0; count < 40; count += 1) await Promise.resolve(); };
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
const auth = (owner, expires_at = 0) => ({ access_token: `${owner}-access`, refresh_token: `${owner}-refresh`, expires_at, user: { id: owner, email: `${owner}@example.com` } });
const token = owner => ({ ...auth(owner), expires_in: 3600 });
const AUTH_KEY = 'occulert.cloud.auth.v1';
const CONSENT_KEY = 'occulert-cloud-sync-enabled';
function cloudFixture(initial, { consent = false } = {}) {
  const secure = new Map(initial ? [[AUTH_KEY, JSON.stringify(initial)]] : []);
  const storage = new Map([[CONSENT_KEY, String(consent)]]), requests = [], timers = new Map();
  let nextTimer = 0;
  const fixture = {
    secure, storage, requests, timers,
    transport: async (url) => {
      if (url.includes('grant_type=password')) return response(200, token('new'));
      if (url.includes('grant_type=refresh_token')) return response(200, token(initial.user.id));
      if (url.endsWith('/api/sessions')) return response(200, { session: { id: 'session' } });
      return response(200, {});
    },
  };
  fixture.secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device', isAvailableAsync: async () => true,
    getItemAsync: async key => secure.get(key) ?? null,
    setItemAsync: async (key, value) => { secure.set(key, value); },
    deleteItemAsync: async key => { secure.delete(key); },
  };
  fixture.asyncStorage = {
    getItem: async key => storage.get(key) ?? null,
    setItem: async (key, value) => { storage.set(key, value); },
  };
  fixture.api = load(read('native-app/lib/cloudSync.ts'), [
    'getCloudState', 'signInToCloud', 'signOutOfCloud', 'setCloudSyncEnabled',
    'beginCloudSession', 'logCloudAlert', 'finishCloudSession',
  ], {
    SecureStore: fixture.secureStore, AsyncStorage: fixture.asyncStorage,
    Platform: { OS: 'ios', Version: '26' }, createAsyncMutationQueue, createCachedBooleanPreference,
    setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/api/public-config')) return response(200, { supabase: { configured: true, url: 'https://test.supabase.co', anonKey: 'public' } });
      if (url.endsWith('/api/profile') && !fixture.profile) return response(200, { driver: { id: 'driver' } });
      if (url.endsWith('/logout')) return response(200, {});
      if (url.endsWith('/api/profile')) return fixture.profile(url, init);
      return fixture.transport(url, init);
    },
  });
  fixture.expire = async () => {
    const pending = [...timers.values()];
    assert.ok(pending.length, 'the request must retain a finite deadline');
    assert.ok(pending.every(timer => timer.delay === 8000));
    pending.forEach(timer => timer.fn());
    await flush();
  };
  return fixture;
}

for (const status of [200, 400, 401]) {
  test(`stale refresh ${status} cannot replace or clear a newer login`, async () => {
    const f = cloudFixture(auth('old')), started = deferred(), result = deferred();
    f.transport = url => {
      if (url.includes('grant_type=refresh_token')) { started.resolve(); return result.promise; }
      return response(200, token('new'));
    };
    const pending = f.api.setCloudSyncEnabled(true);
    await started.promise;
    assert.equal((await f.api.signInToCloud('new@example.com', 'password')).ok, true);
    result.resolve(response(status, status === 200 ? token('old') : { error: 'invalid_refresh' }));
    assert.equal(await pending, false);
    assert.equal((await f.api.getCloudState()).email, 'new@example.com');
    assert.equal(JSON.parse(f.secure.get(AUTH_KEY)).user.id, 'new');
    assert.equal(f.storage.get(CONSENT_KEY), 'false');
  });
}
for (const status of [200, 400, 401]) {
  test(`stale refresh ${status} cannot restore auth after explicit sign-out`, async () => {
    const f = cloudFixture(auth('old')), started = deferred(), result = deferred();
    f.transport = () => { started.resolve(); return result.promise; };
    const pending = f.api.setCloudSyncEnabled(true);
    await started.promise;
    await f.api.signOutOfCloud();
    result.resolve(response(status, status === 200 ? token('old') : { error: 'invalid_refresh' }));
    assert.equal(await pending, false);
    assert.equal((await f.api.getCloudState()).signedIn, false);
    assert.equal(f.secure.has(AUTH_KEY), false);
  });
}
for (const status of [200, 401]) {
  test(`delayed password response ${status} remains cancelled after sign-out`, async () => {
    const f = cloudFixture(), started = deferred(), result = deferred();
    f.transport = () => { started.resolve(); return result.promise; };
    const pending = f.api.signInToCloud('new@example.com', 'password');
    await started.promise;
    await f.api.signOutOfCloud();
    result.resolve(response(status, status === 200 ? token('new') : { error: 'invalid_credentials' }));
    assert.equal((await pending).ok, false);
    assert.equal((await f.api.getCloudState()).signedIn, false);
    assert.equal(f.secure.has(AUTH_KEY), false);
  });
}
for (const stage of ['headers', 'body']) {
  test(`cloud sign-in has a deadline for stalled ${stage}, ignores late success, and permits retry`, async () => {
    const f = cloudFixture(), started = deferred(), late = deferred();
    f.transport = () => {
      if (stage === 'headers') { started.resolve(); return late.promise; }
      return { status: 200, ok: true, text: () => { started.resolve(); return late.promise; } };
    };
    const pending = f.api.signInToCloud('new@example.com', 'password');
    await started.promise;
    await f.expire();
    assert.equal((await pending).ok, false);
    assert.equal(f.requests.at(-1).init.signal.aborted, true);
    late.resolve(stage === 'headers' ? response(200, token('new')) : JSON.stringify(token('new')));
    await flush();
    assert.equal((await f.api.getCloudState()).signedIn, false);
    f.transport = () => response(200, token('new'));
    assert.equal((await f.api.signInToCloud('new@example.com', 'password')).ok, true);
    assert.equal(f.timers.size, 0);
  });
}

test('concurrent expired-auth operations share one refresh and keep enabled consent', async () => {
  const f = cloudFixture(auth('old'), { consent: true }), started = deferred(), result = deferred();
  f.transport = url => {
    if (url.includes('grant_type=refresh_token')) { started.resolve(); return result.promise; }
    return response(200, {});
  };
  const first = f.api.logCloudAlert('session', 40), second = f.api.finishCloudSession('session', {});
  await started.promise;
  await flush();
  assert.equal(f.requests.filter(r => r.url.includes('grant_type=refresh_token')).length, 1);
  result.resolve(response(200, token('old')));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal((await f.api.getCloudState()).syncEnabled, true);
});

for (const status of [200, 401]) {
  test(`protected transport response ${status} cannot act on a replacement account`, async () => {
    const f = cloudFixture(auth('old', 4000000000), { consent: true }), started = deferred(), result = deferred();
    f.transport = url => {
      if (url.endsWith('/api/events')) { started.resolve(); return result.promise; }
      return response(200, token('new'));
    };
    const pending = f.api.logCloudAlert('old-session', 40);
    await started.promise;
    assert.equal((await f.api.signInToCloud('new@example.com', 'password')).ok, true);
    result.resolve(response(status, {}));
    assert.equal(await pending, false);
    assert.equal((await f.api.getCloudState()).email, 'new@example.com');
    assert.equal(f.requests.some(r => r.url.includes('grant_type=refresh_token')), false);
  });
}

test('stalled session-finalization body returns failure within its deadline', async () => {
  const f = cloudFixture(auth('old', 4000000000), { consent: true }), started = deferred(), late = deferred();
  f.transport = () => ({ status: 200, ok: true, text: () => { started.resolve(); return late.promise; } });
  const pending = f.api.finishCloudSession('session', {});
  await started.promise;
  await f.expire();
  assert.equal(await pending, false);
  late.resolve('{}');
  await flush();
  assert.equal((await f.api.getCloudState()).signedIn, true);
});

test('disabling sync during profile setup prevents later session transport', async () => {
  const f = cloudFixture(auth('old', 4000000000), { consent: true }), started = deferred(), result = deferred();
  f.profile = () => { started.resolve(); return result.promise; };
  const pending = f.api.beginCloudSession();
  await started.promise;
  assert.equal(await f.api.setCloudSyncEnabled(false), true);
  result.resolve(response(200, { driver: { id: 'driver' } }));
  assert.equal(await pending, null);
  assert.equal(f.requests.some(r => r.url.endsWith('/api/sessions')), false);
});

test('a newer owner with enabled sync cannot inherit old multi-stage session work', async () => {
  const f = cloudFixture(auth('old', 4000000000), { consent: true }), started = deferred(), result = deferred();
  f.profile = () => { started.resolve(); return result.promise; };
  const pending = f.api.beginCloudSession();
  await started.promise;
  f.profile = null;
  await f.api.signOutOfCloud();
  assert.equal((await f.api.signInToCloud('new@example.com', 'password')).ok, true);
  assert.equal(await f.api.setCloudSyncEnabled(true), true);
  result.resolve(response(200, { driver: { id: 'driver' } }));
  assert.equal(await pending, null);
  assert.equal(f.requests.some(r => r.url.endsWith('/api/sessions')), false);
});

test('disabling sync during token refresh prevents event and finalization transports', async () => {
  const f = cloudFixture(auth('old'), { consent: true }), started = deferred(), result = deferred();
  f.transport = () => { started.resolve(); return result.promise; };
  const event = f.api.logCloudAlert('session', 60), finish = f.api.finishCloudSession('session', {});
  await started.promise;
  await f.api.setCloudSyncEnabled(false);
  result.resolve(response(200, token('old')));
  assert.deepEqual(await Promise.all([event, finish]), [false, false]);
  assert.equal(f.requests.some(r => /\/api\/(events|sessions)$/.test(r.url)), false);
});

test('a pending consent enable cannot restore runtime sync after newer disable', async () => {
  const f = cloudFixture(auth('old', 4000000000)), started = deferred(), write = deferred();
  f.asyncStorage.setItem = async (key, value) => {
    if (value === 'true') { started.resolve(); await write.promise; }
    f.storage.set(key, value);
  };
  const enable = f.api.setCloudSyncEnabled(true);
  await started.promise;
  const disable = f.api.setCloudSyncEnabled(false);
  write.resolve();
  assert.deepEqual(await Promise.all([enable, disable]), [false, true]);
  assert.equal((await f.api.getCloudState()).syncEnabled, false);
  assert.equal(f.storage.get(CONSENT_KEY), 'false');
});

const HEALTH_KEY = 'occulert.apple-health.readiness.v1';
function healthFixture() {
  const store = new Map(), queries = [];
  const f = { store, queries, secureStore: {
    getItemAsync: async key => store.get(key) ?? null,
    setItemAsync: async (key, value) => { store.set(key, value); },
    deleteItemAsync: async key => { store.delete(key); },
  } };
  const healthKit = {
    isHealthDataAvailable: () => true, requestAuthorization: async () => true,
    queryCategorySamples: () => { const query = deferred(); queries.push(query); return query.promise; },
    queryQuantitySamples: async () => [],
  };
  f.api = load(read('native-app/lib/appleHealth.ts').replaceAll("import('@kingstinct/react-native-healthkit')", 'healthKitModule()'),
    ['refreshAppleHealthReadiness', 'clearStoredHealthReadiness', 'loadStoredHealthReadiness'], {
      SecureStore: f.secureStore, Platform: { OS: 'ios' }, createAsyncMutationQueue,
      createHealthReadinessSnapshot, isHealthReadinessSnapshot, healthKitModule: async () => healthKit,
    });
  return f;
}

test('deleted Health context cannot be restored by an older in-flight query', async () => {
  const f = healthFixture();
  const pending = f.api.refreshAppleHealthReadiness();
  const rejected = assert.rejects(pending, /superseded/);
  await flush();
  assert.equal(f.queries.length, 1);
  await f.api.clearStoredHealthReadiness();
  f.queries[0].resolve([]);
  await rejected;
  assert.equal(f.store.has(HEALTH_KEY), false);
  assert.equal(await f.api.loadStoredHealthReadiness(), null);
});

test('removal is ordered after a Health storage write already in progress', async () => {
  const f = healthFixture(), started = deferred(), write = deferred();
  f.secureStore.setItemAsync = async (key, value) => { started.resolve(); await write.promise; f.store.set(key, value); };
  const pending = f.api.refreshAppleHealthReadiness();
  const rejected = assert.rejects(pending, /superseded/);
  await flush();
  f.queries[0].resolve([]);
  await started.promise;
  const remove = f.api.clearStoredHealthReadiness();
  write.resolve();
  await Promise.all([rejected, remove]);
  assert.equal(f.store.has(HEALTH_KEY), false);
});

test('newer Health refresh wins and explicit refresh after removal remains usable', async () => {
  const f = healthFixture();
  const first = f.api.refreshAppleHealthReadiness(new Date('2026-09-25T10:00:00Z'));
  const rejected = assert.rejects(first, /superseded/);
  const second = f.api.refreshAppleHealthReadiness(new Date('2026-09-26T10:00:00Z'));
  await flush();
  f.queries[1].resolve([]);
  assert.equal((await second).status, 'no_data');
  f.queries[0].resolve([]);
  await rejected;
  assert.equal((await f.api.loadStoredHealthReadiness()).capturedAt, '2026-09-26T10:00:00.000Z');
  await f.api.clearStoredHealthReadiness();
  const third = f.api.refreshAppleHealthReadiness();
  await flush();
  f.queries[2].resolve([]);
  assert.equal((await third).status, 'no_data');
  assert.equal(f.store.has(HEALTH_KEY), true);
});

// Preserve the real component's hooks and async handlers, omit only its JSX.
function hookFixture() {
  const hooks = [], effects = [], updates = [];
  let index = 0;
  const React = {
    useRef(value) { const slot = index++; hooks[slot] ??= { current: value }; return hooks[slot]; },
    useState(value) {
      const slot = index++;
      if (!(slot in hooks)) hooks[slot] = typeof value === 'function' ? value() : value;
      return [hooks[slot], next => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next; updates.push({ slot, value: hooks[slot] }); }];
    },
    useCallback(callback, deps) {
      const slot = index++, previous = hooks[slot];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) hooks[slot] = { deps, value: callback };
      return hooks[slot].value;
    },
    useMemo(callback, deps) {
      const slot = index++, previous = hooks[slot];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) hooks[slot] = { deps, value: callback() };
      return hooks[slot].value;
    },
    useEffect(callback, deps) {
      const slot = index++, previous = effects[slot];
      const changed = !previous || deps.some((dep, i) => dep !== previous.deps[i]);
      if (changed) effects[slot] = { deps, callback, cleanup: previous?.cleanup, changed: true };
    },
  };
  return { React, updates, render(callback) {
    index = 0;
    const value = callback();
    effects.forEach(effect => {
      if (!effect?.changed) return;
      effect.cleanup?.();
      effect.cleanup = effect.callback();
      effect.changed = false;
    });
    return value;
  }, unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}
function alertFixture() {
  const h = hookFixture(), preference = deferred(), delivery = deferred(), sends = [], events = [];
  const source = read('native-app/components/AlertSystem.tsx');
  const component = source.slice(0, source.indexOf("  if (level === 'none') return null;")) + '\nreturn {fire};\n}';
  const api = load(component, ['AlertSystem'], {
    ...h.React, React: h.React, require: () => 'sound',
    Animated: { Value: class { stopAnimation() {} setValue() {} } },
    useAccessibilityPreferences: () => ({ reduceMotion: true }),
    useAudioPlayer: () => ({ pause() {} }),
    loadAlertPreferences: async () => {}, configureAlertAudioMode: async () => {},
    currentAlertPreferences: () => ({ audioEnabled: false, hapticEnabled: false }),
    getWatchAlertsEnabled: () => preference.promise,
    sendAlertToWatch: payload => { sends.push(payload); return delivery.promise; },
    sendMonitoringStatusToWatch: async () => {},
    deriveAlertLevel: ({ isRunning }) => isRunning ? 'alert' : 'none',
    shouldDeliverAlert: (oldLevel, oldAt, nextLevel) => oldLevel !== nextLevel,
    SENSOR_LOSS_GRACE_MS: 5000, PERCLOS_ALERT_THRESHOLD: 0.2, CRITICAL_CLOSED_ALERT_MS: 2000, ALERT_COOLDOWN_MS: 4000,
    alertDeliveryPlan, deliverCueIfCurrent,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  });
  const render = running => h.render(() => api.AlertSystem({
    metrics: { state: 'closed', fatigueScore: 80, perclos: 0.5 }, isRunning: running,
    sessionStartedAt: Date.now() - 10000, sessionEndedAt: null, onTimingEvent: event => events.push(event),
  }));
  return { ...h, preference, delivery, sends, events, render };
}
for (const cancellation of ['stop', 'unmount']) {
  test(`Watch preference completing after ${cancellation} sends no stale alert`, async () => {
    const f = alertFixture();
    f.render(true);
    if (cancellation === 'stop') f.render(false); else f.unmount();
    f.preference.resolve(true);
    await flush();
    assert.equal(f.sends.length, 0);
    assert.equal(f.events.some(event => event.kind === 'watch-result'), false);
  });
  test(`Watch acknowledgement completing after ${cancellation} cannot enter later session timing`, async () => {
    const f = alertFixture();
    f.render(true);
    f.preference.resolve(true);
    await flush();
    assert.equal(f.sends.length, 1);
    if (cancellation === 'stop') f.render(false); else f.unmount();
    f.delivery.resolve({ accepted: true, acknowledged: true, roundTripMs: 10 });
    await flush();
    assert.equal(f.events.some(event => event.kind === 'watch-result'), false);
  });
}

test('current Watch cue reports its result once', async () => {
  const f = alertFixture();
  f.render(true);
  f.preference.resolve(true);
  await flush();
  f.delivery.resolve({ accepted: true, acknowledged: true, roundTripMs: 10 });
  await flush();
  assert.equal(f.sends.length, 1);
  assert.equal(f.events.filter(event => event.kind === 'watch-result').length, 1);
  f.unmount();
});

function preDriveFixture() {
  const h = hookFixture(), refresh = deferred();
  const source = read('native-app/app/pre-drive.tsx');
  const component = source.slice(0, source.indexOf('  return (\n    <SafeAreaView')) + '\nreturn {refreshHealth, removeHealthSummary};\n}';
  const api = load(component, ['PreDriveScreen'], {
    ...h.React, React: h.React, Platform: { OS: 'ios' }, useRouter: () => ({}),
    loadStoredHealthReadiness: async () => null, isAppleHealthAvailable: async () => true,
    clearStoredHealthReadiness: async () => {}, refreshAppleHealthReadiness: () => refresh.promise,
  });
  return { ...h, refresh, actions: h.render(() => api.PreDriveScreen()) };
}

test('Health removal wins over delayed refresh UI and clears busy state', async () => {
  const f = preDriveFixture();
  await flush();
  const pending = f.actions.refreshHealth();
  await f.actions.removeHealthSummary();
  const settledUpdates = f.updates.length;
  f.refresh.resolve({ status: 'updated', snapshot: { capturedAt: 'old' } });
  await pending;
  assert.equal(f.updates.length, settledUpdates, 'old success cannot repaint a removed summary or notice');
  assert.ok(f.updates.some(update => update.value === false), 'removal releases refresh busy state');
  assert.ok(f.updates.some(update => typeof update.value === 'string' && update.value.includes('was removed')));
});

test('unmounted Health screen ignores delayed refresh failure and busy completion', async () => {
  const f = preDriveFixture();
  await flush();
  const pending = f.actions.refreshHealth();
  f.unmount();
  const settledUpdates = f.updates.length;
  f.refresh.reject(new Error('access failed'));
  await pending;
  assert.equal(f.updates.length, settledUpdates);
});

function parkedFixture() {
  const h = hookFixture(), queries = [], subscriptions = [];
  let focusCallback, focusCleanup;
  const source = read('native-app/components/ParkedReadinessCard.tsx');
  const component = source.slice(0, source.indexOf('  return (\n    <View')) + '\nreturn {runStabilityTest,controlsBusy,stabilityBusy,stabilityResult};\n}';
  const appState = { currentState: 'active', addEventListener: (_name, callback) => {
    subscriptions.push(callback);
    return { remove() { subscriptions.splice(subscriptions.indexOf(callback), 1); } };
  } };
  const api = load(component, ['ParkedReadinessCard'], {
    ...h.React, React: h.React, AppState: appState, useRouter: () => ({}),
    useFocusEffect: callback => { focusCallback = callback; },
    createReadinessSession: (_read, publish) => ({
      refresh: () => publish({ snapshot: { camera: { multiCamProbe: { state: 'withinBudget' } } }, busy: false, now: Date.now() }),
      invalidate: () => publish({ snapshot: null, busy: false, now: Date.now() }), dispose() {},
    }),
    collectDeviceReadiness() {}, deviceReadinessSources: {}, describeDeviceReadiness: () => [],
    runMultiCamStabilityTest: () => { const query = deferred(); queries.push(query); return query.promise; },
  });
  const render = () => h.render(() => api.ParkedReadinessCard());
  render();
  const focus = () => { focusCleanup = focusCallback(); return render(); };
  const blur = () => { focusCleanup(); };
  return { ...h, queries, render, focus, blur, background() {
    appState.currentState = 'background'; subscriptions.forEach(callback => callback('background'));
  }, foreground() {
    appState.currentState = 'active'; subscriptions.forEach(callback => callback('active'));
  } };
}
const stabilityResult = { state: 'passed', elapsedMs: 5000, frontFrames: 20, roadFrames: 20 };

test('parked camera result settling while blurred cannot leave controls stuck on return', async () => {
  const f = parkedFixture(), card = f.focus();
  const pending = card.runStabilityTest();
  assert.equal(f.render().controlsBusy, true);
  f.blur();
  f.queries[0].resolve(stabilityResult);
  await pending;
  assert.equal(f.focus().controlsBusy, false);
  assert.equal(f.render().stabilityResult, null);
  const retry = f.render().runStabilityTest();
  assert.equal(f.queries.length, 2);
  f.queries[1].resolve(stabilityResult);
  await retry;
  assert.equal(f.render().controlsBusy, false);
  assert.equal(f.render().stabilityResult.state, 'passed');
  f.blur();
});

test('old parked result cannot repaint or clear the busy state of a new focused test', async () => {
  const f = parkedFixture(), card = f.focus();
  const oldTest = card.runStabilityTest();
  // A rapid duplicate before React re-renders is also ignored.
  await card.runStabilityTest();
  assert.equal(f.queries.length, 1);
  f.blur();
  const currentTest = f.focus().runStabilityTest();
  f.queries[0].resolve(stabilityResult);
  await oldTest;
  assert.equal(f.render().controlsBusy, true);
  assert.equal(f.render().stabilityResult, null);
  f.queries[1].resolve({ ...stabilityResult, state: 'driverOnlyFallback' });
  await currentTest;
  assert.equal(f.render().controlsBusy, false);
  assert.equal(f.render().stabilityResult.state, 'driverOnlyFallback');
  f.blur();
});

test('backgrounding invalidates parked test and foreground retry ignores its late result', async () => {
  const f = parkedFixture(), oldTest = f.focus().runStabilityTest();
  f.background();
  assert.equal(f.render().controlsBusy, false);
  f.foreground();
  const currentTest = f.render().runStabilityTest();
  f.queries[0].resolve(stabilityResult);
  await oldTest;
  assert.equal(f.render().controlsBusy, true);
  assert.equal(f.render().stabilityResult, null);
  f.queries[1].resolve(stabilityResult);
  await currentTest;
  assert.equal(f.render().controlsBusy, false);
  f.blur();
});

test('current unexpected parked bridge failure releases busy state for retry', async () => {
  const f = parkedFixture(), pending = f.focus().runStabilityTest();
  const rejected = assert.rejects(pending, /bridge failed/);
  f.queries[0].reject(new Error('bridge failed'));
  await rejected;
  assert.equal(f.render().controlsBusy, false);
  f.blur();
});

test('history mutation refuses malformed members without writing away existing bytes', async () => {
  const source = read('native-app/lib/sessionHistory.ts');
  const { parseSessionHistory } = await import('../native-app/lib/sessionHistoryData.ts');
  const stored = '[{"sessionId":"recoverable"},null]';
  const writes = [];
  const api = load(source, ['loadSessionHistory', 'updateSessionHistory'], {
    AsyncStorage: { getItem: async () => stored, setItem: async (_key, value) => writes.push(value) },
    parseSessionHistory,
  });
  await assert.rejects(api.loadSessionHistory(), /Saved session history/);
  await assert.rejects(api.updateSessionHistory(() => []), /Saved session history/);
  assert.deepEqual(writes, []);
});

test('password login never inherits stored sharing consent from absent or replacement auth', async () => {
  for (const initial of [undefined, auth('old', 4000000000)]) {
    const f = cloudFixture(initial, { consent: true });
    assert.equal((await f.api.signInToCloud('new@example.com', 'password')).ok, true);
    assert.equal((await f.api.getCloudState()).email, 'new@example.com');
    assert.equal((await f.api.getCloudState()).syncEnabled, false);
    assert.equal(f.storage.get(CONSENT_KEY), 'false');
    assert.equal(await f.api.beginCloudSession(), null);
    assert.equal(f.requests.some(request => request.url.endsWith('/api/sessions')), false);
  }
});

test('failed consent opt-out prevents successful password tokens from being saved', async () => {
  const f = cloudFixture(undefined, { consent: true });
  f.asyncStorage.setItem = async () => { throw new Error('storage unavailable'); };
  const result = await f.api.signInToCloud('new@example.com', 'password');
  assert.equal(result.ok, false);
  assert.match(result.message, /Sign-in was not saved/);
  assert.equal(f.secure.has(AUTH_KEY), false);
  assert.equal((await f.api.getCloudState()).syncEnabled, false);
  assert.equal(f.requests.some(request => request.url.endsWith('/api/profile')), false);
});
