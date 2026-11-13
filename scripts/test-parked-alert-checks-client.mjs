import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/cloud-sync.js', import.meta.url), 'utf8');
const start = source.indexOf('// A parked answer belongs');
const end = source.indexOf('// Event authorization', start);
assert.ok(start >= 0 && end > start, 'The parked confirmation source block must exist');
const parkedSource = source.slice(start, end).replace(/^export /gm, '');
const completedAt = '2026-11-10T08:00:00.000Z';
const noParkedListeners = { auth: 0, storage: 0, pagehide: 0, visibility: 0 };
const activeParkedListeners = { auth: 1, storage: 1, pagehide: 1, visibility: 1 };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(check, ok = true) {
  return { ok, json: async () => ({ ok, check, telemetry_trust: 'unverified_client_report' }) };
}

function harness({ signedIn = true, sharing = true, experiment = false } = {}) {
  const elements = Object.fromEntries(['parkedCheckConfirmation', 'parkedCheckStatus', 'parkedCheckYes', 'parkedCheckNo']
    .map(id => [id, { hidden: id === 'parkedCheckConfirmation', disabled: false, textContent: '' }]));
  const requests = [], storage = [], timers = [];
  let lifecycleRevision = 0, authRevision = 0, sessionCalls = 0;
  let auth = signedIn ? { access_token: 'token-a', refresh_token: 'refresh-a', user: { id: 'owner-a' } } : null;
  let transport = request => Promise.resolve(response(request.json));
  const backend = {
    currentUser: () => auth?.user || null,
    captureAuthLifecycle: () => ({ revision: lifecycleRevision, ownerId: auth?.user.id }),
    isAuthLifecycleCurrent: context => Boolean(context && auth && context.ownerId === auth.user.id && context.revision === lifecycleRevision),
    captureAuthContext: () => ({ revision: authRevision, auth }),
    requireAuthContext(context) {
      if (!context || context.revision !== authRevision || context.auth !== auth) throw Error('auth_session_changed');
    },
    getSession() { sessionCalls += 1; return Promise.resolve(auth); },
    fetchWithDeadline(url, options) {
      const request = { url, ...options, json: JSON.parse(options.body) };
      requests.push(request);
      return transport(request);
    },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [completedAt])); }
    static now() { return Date.parse(completedAt); }
  }
  const context = {
    window: Object.assign(new EventTarget(), { OcculertBackend: backend }),
    document: Object.assign(new EventTarget(), { hidden: false, getElementById: id => elements[id] || null }),
    cloudConsent: { checked: sharing }, cloudConsentRevision: 0,
    experimentFlags: { any: experiment }, running: false, starting: false,
    AbortController, Date: ClockDate,
    // Record any accidental persistence or scheduling instead of implementing
    // a second confirmation policy or silently accepting a retry queue.
    localStorage: {
      getItem(key) { storage.push(['get', key]); return null; },
      setItem(key, value) { storage.push(['set', key, value]); },
      removeItem(key) { storage.push(['remove', key]); },
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  };
  const api = vm.runInNewContext(`${parkedSource}\n({begin:beginParkedAlertConfirmation,show:showParkedAlertConfirmation,save:saveParkedAlertConfirmation,clear:clearParkedAlertConfirmation})`, context);
  return {
    context, api, backend, elements, requests, storage, timers,
    get auth() { return auth; },
    get sessionCalls() { return sessionCalls; },
    set transport(value) { transport = value; },
    setAuth(value, { routineRefresh = false } = {}) {
      auth = value;
      authRevision += 1;
      if (!routineRefresh) lifecycleRevision += 1;
    },
    listenerCounts() {
      return {
        auth: getEventListeners(context.window, 'occulert:auth-lifecycle').length,
        storage: getEventListeners(context.window, 'storage').length,
        pagehide: getEventListeners(context.window, 'pagehide').length,
        visibility: getEventListeners(context.document, 'visibilitychange').length,
      };
    },
    ready() { const scope = api.begin(); api.show(scope); return scope; },
  };
}

for (const confirmed of [true, false]) {
  test(`an explicit ${confirmed} answer sends only the current check and verified-session token`, async () => {
    const h = harness();
    const scope = h.api.begin();
    await h.api.save(confirmed);
    assert.equal(h.requests.length, 0, 'an unfinished output check cannot be answered');
    h.api.show(scope);
    assert.equal(h.elements.parkedCheckConfirmation.hidden, false);
    assert.equal(h.requests.length, 0, 'showing the question is not consent to submit an answer');
    await h.api.save(confirmed);
    assert.equal(h.requests.length, 1);
    const request = h.requests[0];
    assert.equal(request.url, '/api/parked-alert-checks');
    assert.equal(request.method, 'POST');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.credentials, 'same-origin');
    assert.deepEqual(request.json, { completed_at: completedAt, platform: 'web', confirmed });
    assert.equal(request.headers.Authorization, 'Bearer token-a');
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.equal(request.signal, scope.controller.signal);
    assert.equal(request.signal.aborted, false);
    assert.equal(h.elements.parkedCheckStatus.textContent, confirmed ? 'Confirmation saved for your fleet.'
      : 'Result saved for your fleet. Check volume, mute, Focus, and audio routing while parked.');
    assert.deepEqual(h.storage, []);
    assert.deepEqual(h.timers, []);
  });
}

test('signed-out, local-only, and experimental checks cannot establish a cloud scope', async () => {
  for (const options of [{ signedIn: false }, { sharing: false }, { experiment: true }]) {
    const h = harness(options);
    assert.equal(h.api.begin(), null);
    h.api.show(null);
    await h.api.save(true);
    assert.equal(h.elements.parkedCheckConfirmation.hidden, true);
    assert.equal(h.sessionCalls, 0);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.listenerCounts(), noParkedListeners);
  }
});

test('parked listeners exist only for a valid scope and replacement cues do not accumulate them', () => {
  const h = harness();
  assert.deepEqual(h.listenerCounts(), noParkedListeners, 'idle source evaluation adds no listeners');
  h.api.clear();
  assert.deepEqual(h.listenerCounts(), noParkedListeners);
  const first = h.ready();
  assert.deepEqual(h.listenerCounts(), activeParkedListeners);
  h.api.show(first);
  assert.deepEqual(h.listenerCounts(), activeParkedListeners, 'showing the same question adds no listeners');
  const replacement = h.ready();
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(replacement.controller.signal.aborted, false);
  assert.deepEqual(h.listenerCounts(), activeParkedListeners, 'only the replacement scope remains registered');
  h.api.clear();
  assert.equal(replacement.controller.signal.aborted, true);
  assert.equal(h.elements.parkedCheckConfirmation.hidden, true);
  assert.deepEqual(h.listenerCounts(), noParkedListeners);
  h.api.clear();
  assert.deepEqual(h.listenerCounts(), noParkedListeners, 'repeated cleanup is harmless');
});

for (const interruption of ['auth lifecycle', 'auth storage', 'all storage', 'pagehide', 'hidden']) {
  test(`${interruption} clears and aborts the active parked scope and removes its listeners`, async () => {
    const h = harness();
    const scope = h.ready();
    h.elements.parkedCheckStatus.textContent = 'Previous status';
    assert.deepEqual(h.listenerCounts(), activeParkedListeners);
    if (interruption === 'auth lifecycle') h.context.window.dispatchEvent(new Event('occulert:auth-lifecycle'));
    else if (interruption === 'auth storage' || interruption === 'all storage') {
      h.context.window.dispatchEvent(Object.assign(new Event('storage'), { key: interruption === 'all storage' ? null : 'occulert-auth' }));
    } else if (interruption === 'pagehide') h.context.window.dispatchEvent(new Event('pagehide'));
    else {
      h.context.document.hidden = true;
      h.context.document.dispatchEvent(new Event('visibilitychange'));
    }
    assert.equal(scope.controller.signal.aborted, true);
    assert.equal(h.elements.parkedCheckConfirmation.hidden, true);
    assert.equal(h.elements.parkedCheckStatus.textContent, '');
    assert.deepEqual(h.listenerCounts(), noParkedListeners);
    await h.api.save(true);
    assert.deepEqual(h.requests, []);
    h.api.show(scope);
    assert.equal(h.elements.parkedCheckConfirmation.hidden, true, 'an obsolete cue cannot revive a cleared scope');
  });
}

test('unrelated storage and visible-page events preserve the current parked question', () => {
  const h = harness();
  const scope = h.ready();
  h.context.window.dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated-view-preference' }));
  h.context.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(scope.controller.signal.aborted, false);
  assert.equal(h.elements.parkedCheckConfirmation.hidden, false);
  assert.deepEqual(h.listenerCounts(), activeParkedListeners);
});

test('a new cue supersedes the earlier question and an older completion cannot revive it', async () => {
  const h = harness();
  const first = h.ready();
  const replacement = h.api.begin();
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(h.elements.parkedCheckConfirmation.hidden, true);
  h.api.show(first);
  assert.equal(h.elements.parkedCheckConfirmation.hidden, true);
  await h.api.save(true);
  assert.deepEqual(h.requests, []);
  h.api.show(replacement);
  await h.api.save(false);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].signal, replacement.controller.signal);
  assert.equal(h.requests[0].json.confirmed, false);
});

for (const interruption of ['consent', 'account']) {
  test(`${interruption === 'account' ? 'an' : 'a'} ${interruption} change while awaiting authentication prevents any POST`, async () => {
    const h = harness();
    const authWait = deferred();
    const originalAuth = h.auth;
    h.backend.getSession = () => authWait.promise;
    const scope = h.ready();
    const save = h.api.save(true);
    assert.match(h.elements.parkedCheckStatus.textContent, /Saving/);
    if (interruption === 'consent') {
      h.context.cloudConsent.checked = false;
      h.context.cloudConsentRevision += 1;
    } else {
      h.setAuth({ access_token: 'token-b', refresh_token: 'refresh-b', user: { id: 'owner-b' } });
    }
    h.api.clear();
    assert.equal(scope.controller.signal.aborted, true);
    authWait.resolve(originalAuth);
    await save;
    assert.deepEqual(h.requests, []);
    assert.equal(h.elements.parkedCheckConfirmation.hidden, true);
    assert.equal(h.elements.parkedCheckStatus.textContent, '');
  });
}

test('scope guards reject invalidated consent, auth, visibility, and monitoring even without the cleanup listener', async () => {
  const mutations = [
    h => { h.context.cloudConsent.checked = false; },
    h => { h.context.cloudConsentRevision += 1; },
    h => h.setAuth({ access_token: 'replacement', refresh_token: 'replacement', user: { id: 'owner-b' } }),
    h => { h.context.window.OcculertBackend = { ...h.backend }; },
    h => { h.context.running = true; },
    h => { h.context.starting = true; },
    h => { h.context.document.hidden = true; },
    h => { h.context.experimentFlags.any = true; },
  ];
  for (const mutate of mutations) {
    const h = harness();
    h.ready();
    mutate(h);
    await h.api.save(true);
    assert.equal(h.sessionCalls, 0);
    assert.deepEqual(h.requests, []);
  }
});

test('a routine token refresh preserves the check and uses the refreshed token', async () => {
  const h = harness();
  h.backend.getSession = async () => {
    h.setAuth({ access_token: 'refreshed-token', refresh_token: 'rotated-refresh', user: { id: 'owner-a' } }, { routineRefresh: true });
    return h.auth;
  };
  h.ready();
  await h.api.save(true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].headers.Authorization, 'Bearer refreshed-token');
  assert.equal(h.elements.parkedCheckStatus.textContent, 'Confirmation saved for your fleet.');
});

test('a stale auth result cannot send with a replacement same-owner token', async () => {
  const h = harness();
  const previous = h.auth;
  h.backend.getSession = async () => {
    h.setAuth({ access_token: 'newer-token', refresh_token: 'newer-refresh', user: { id: 'owner-a' } }, { routineRefresh: true });
    return previous;
  };
  h.ready();
  await h.api.save(true);
  assert.deepEqual(h.requests, []);
  assert.match(h.elements.parkedCheckStatus.textContent, /Could not confirm/);
});

test('a late success from an abandoned request cannot overwrite a newer answer', async () => {
  const h = harness();
  const firstRequest = deferred(), firstReply = deferred();
  h.transport = request => {
    if (h.requests.length === 1) { firstRequest.resolve(request); return firstReply.promise; }
    return Promise.resolve(response(request.json));
  };
  const original = h.ready();
  const firstSave = h.api.save(true);
  const request = await firstRequest.promise;
  h.setAuth({ access_token: 'token-b', refresh_token: 'refresh-b', user: { id: 'owner-b' } });
  h.api.clear();
  assert.equal(original.controller.signal.aborted, true);
  assert.equal(h.elements.parkedCheckStatus.textContent, '');
  h.ready();
  await h.api.save(false);
  assert.equal(h.requests[1].headers.Authorization, 'Bearer token-b');
  const newerStatus = h.elements.parkedCheckStatus.textContent;
  assert.match(newerStatus, /^Result saved/);
  // Deliberately ignore the abort in this fake transport. The actual client
  // must still prevent an obsolete completion from changing visible state.
  firstReply.resolve(response(request.json));
  await firstSave;
  assert.equal(h.elements.parkedCheckStatus.textContent, newerStatus);
});

test('a transport failure is truthful and neither retries nor persists the answer', async () => {
  const h = harness();
  h.transport = async () => { throw Error('offline'); };
  h.ready();
  await h.api.save(true);
  assert.equal(h.requests.length, 1);
  assert.match(h.elements.parkedCheckStatus.textContent, /Could not confirm this result was saved/);
  await h.api.save(true);
  assert.equal(h.requests.length, 1, 'retry requires a fresh parked cue');
  assert.deepEqual(h.timers, []);
  assert.deepEqual(h.storage, []);
});

test('a mismatched server acknowledgment cannot claim the answer was saved', async () => {
  for (const mutate of [
    check => ({ ...check, confirmed: !check.confirmed }),
    check => ({ ...check, completed_at: '2026-11-09T08:00:00.000Z' }),
    check => ({ ...check, platform: 'ios' }),
  ]) {
    const h = harness();
    h.transport = request => Promise.resolve(response(mutate(request.json)));
    h.ready();
    await h.api.save(true);
    assert.match(h.elements.parkedCheckStatus.textContent, /Could not confirm/);
  }
});

test('consecutive answers share one submission and cannot change its captured decision', async () => {
  const h = harness();
  const requested = deferred(), replied = deferred();
  h.transport = request => { requested.resolve(request); return replied.promise; };
  h.ready();
  const first = h.api.save(true);
  await h.api.save(false);
  const request = await requested.promise;
  assert.equal(h.requests.length, 1);
  assert.equal(request.json.confirmed, true);
  assert.equal(h.elements.parkedCheckYes.disabled, true);
  assert.equal(h.elements.parkedCheckNo.disabled, true);
  replied.resolve(response(request.json));
  await first;
  await h.api.save(false);
  assert.equal(h.requests.length, 1);
  assert.equal(h.elements.parkedCheckStatus.textContent, 'Confirmation saved for your fleet.');
});
