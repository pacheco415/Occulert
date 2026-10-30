// Token refresh is shared by concurrent callers, starts 60 seconds before
// expiry, and is serialized across tabs with a Web Lock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { assetByStem } from './lib/current-assets.mjs';

const source = readFileSync(new URL(`../${assetByStem('occulert-backend.js')}`, import.meta.url), 'utf8');
const tick = async (count = 20) => { for (let i = 0; i < count; i++) await new Promise(setImmediate); };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const now = () => Math.floor(Date.now() / 1000);
const owner = { id: 'owner-a', email: 'owner@example.com' };
const session = (name, expiresIn, user = owner) => ({ access_token: `${name}-access`, refresh_token: `${name}-refresh`, expires_at: now() + expiresIn, user });
const rotated = { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, user: owner };

function boot({ auth, refresh = () => json(rotated), password = () => json(rotated), locks }) {
  const store = new Map(), requests = [], refreshes = [], listeners = new Map();
  if (auth) store.set('occulert-auth', JSON.stringify(auth));
  const context = {
    window: { location: { origin: 'https://www.occulert.com', pathname: '/fleet-dashboard.html', search: '', hash: '' }, history: { replaceState() {} }, addEventListener: (name, listener) => listeners.set(name, listener) },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    navigator: { platform: 'fixture', userAgent: 'fixture', ...(locks ? { locks } : {}) },
    async fetch(url, options = {}) {
      url = String(url);
      if (url === '/api/public-config') return json({ supabase: { configured: true, url: 'https://example.supabase.co', anonKey: 'public-key' } });
      if (url.includes('grant_type=refresh_token')) { refreshes.push(JSON.parse(options.body).refresh_token); return refresh(); }
      if (url.includes('grant_type=password')) return password();
      requests.push({ url, authorization: options.headers && options.headers.Authorization });
      return json({ ok: true, fleet: { id: 'fleet-1' }, invitations: [], drivers: [], sessions: [], events: [] });
    },
    Response, JSON, Date, Math, Object, Promise, URLSearchParams, setTimeout, clearTimeout, AbortController,
  };
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { backend: context.window.OcculertBackend, store, requests, refreshes, stored: () => JSON.parse(store.get('occulert-auth') || 'null'), storageChanged: () => listeners.get('storage')?.({ key: 'occulert-auth' }) };
}

test('three fleet calls with an expired token share one refresh and all succeed', async () => {
  const h = boot({ auth: session('old', -10) });
  const results = await Promise.all([h.backend.getFleetSummary(), h.backend.getFleet(), h.backend.listFleetInvitations()]);
  assert.deepEqual(results.map(result => result.status), [200, 200, 200]);
  assert.deepEqual(h.refreshes, ['old-refresh'], 'one refresh for one refresh token');
  assert.deepEqual(h.requests.map(request => request.authorization), Array(3).fill('Bearer rotated-access'));
  assert.equal(h.stored().access_token, 'rotated-access');
});

test('a token with 30 seconds left refreshes first; one with 2 minutes left does not', async () => {
  const soon = boot({ auth: session('soon', 30) });
  assert.equal((await soon.backend.getFleet()).status, 200);
  assert.deepEqual(soon.refreshes, ['soon-refresh']);
  assert.equal(soon.requests[0].authorization, 'Bearer rotated-access');
  const later = boot({ auth: session('later', 120) });
  assert.equal((await later.backend.getFleet()).status, 200);
  assert.deepEqual(later.refreshes, []);
  assert.equal(later.requests[0].authorization, 'Bearer later-access');
});

test('an early refresh that cannot reach Supabase keeps using the still-valid token', async () => {
  const h = boot({ auth: session('soon', 30), refresh: () => json({ error: 'unavailable' }, 503) });
  assert.equal((await h.backend.getSession()).access_token, 'soon-access');
  assert.equal((await h.backend.getFleet()).status, 200);
  assert.equal(h.requests[0].authorization, 'Bearer soon-access');
  assert.equal(h.stored().access_token, 'soon-access', 'a failure never clears a valid account');
});

test('an expired token whose refresh cannot reach Supabase still fails without signing out', async () => {
  const h = boot({ auth: session('old', -10), refresh: () => json({ error: 'unavailable' }, 503) });
  await assert.rejects(h.backend.getSession(), { code: 'cloud_unavailable' });
  assert.equal(h.stored().access_token, 'old-access');
});

test('a rejected refresh signs out once for every waiting caller', async () => {
  const h = boot({ auth: session('old', -10), refresh: () => json({ error: 'invalid_grant' }, 400) });
  assert.deepEqual(await Promise.all([h.backend.getSession(), h.backend.getSession()]), [null, null]);
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.stored(), null);
});

test('refreshes run inside the occulert-auth-refresh Web Lock', async () => {
  const names = [];
  const locks = { request(name, task) { names.push(name); return Promise.resolve().then(task); } };
  const h = boot({ auth: session('old', -10), locks });
  assert.equal((await h.backend.getSession()).access_token, 'rotated-access');
  assert.deepEqual(names, ['occulert-auth-refresh']);
});

test('a newer session another tab stored while this tab waited is reused without refreshing', async () => {
  let release;
  const locks = { request(name, task) { return new Promise(resolve => { release = () => resolve(task()); }); } };
  const h = boot({ auth: session('old', -10), locks });
  const pending = h.backend.getSession();
  await tick();
  h.store.set('occulert-auth', JSON.stringify(session('other-tab', 3600)));
  h.storageChanged();
  release();
  assert.equal((await pending).access_token, 'other-tab-access');
  assert.deepEqual(h.refreshes, [], 'the other tab already rotated the refresh token');
  assert.equal(h.stored().access_token, 'other-tab-access');
});

test('a second queued flight reuses the first rotation of a newer same-user token', async () => {
  const releases = [];
  const locks = { request(name, task) { return new Promise(resolve => { releases.push(() => resolve(task())); }); } };
  const h = boot({ auth: session('old', -10), locks });
  const first = h.backend.getSession();
  await tick();
  h.store.set('occulert-auth', JSON.stringify(session('other-tab', 30)));
  h.storageChanged();
  const second = h.backend.getSession();
  await tick();
  releases[0]();
  assert.equal((await first).access_token, 'rotated-access');
  releases[1]();
  assert.equal((await second).access_token, 'rotated-access');
  assert.deepEqual(h.refreshes, ['other-tab-refresh'], 'internal rotation must remain reusable by another queued flight');
});

test('a different account stored while waiting is never refreshed or overwritten', async () => {
  let release;
  const locks = { request(name, task) { return new Promise(resolve => { release = () => resolve(task()); }); } };
  const h = boot({ auth: session('old', -10), locks });
  const pending = h.backend.getSession();
  await tick();
  const other = session('owner-b', 3600, { id: 'owner-b', email: 'b@example.com' });
  h.store.set('occulert-auth', JSON.stringify(other));
  h.storageChanged();
  release();
  await assert.rejects(pending, { code: 'auth_session_changed' });
  assert.deepEqual(h.refreshes, []);
  assert.equal(h.stored().user.id, 'owner-b');
});

test('a sign-in begun while refresh waits for its Web Lock wins without refreshing the old account', async () => {
  let release, respond;
  const locks = { request(name, task) { return new Promise(resolve => { release = () => resolve(task()); }); } };
  const other = session('owner-b', 3600, { id: 'owner-b', email: 'b@example.com' });
  const h = boot({ auth: session('old', -10), locks, password: () => new Promise(resolve => { respond = resolve; }) });
  const pending = h.backend.getSession();
  const rejected = assert.rejects(pending, { code: 'auth_session_changed' });
  await tick();
  const login = h.backend.signIn('b@example.com', 'fixture-password');
  await tick();
  release();
  await rejected;
  assert.deepEqual(h.refreshes, [], 'an older queued operation must not refresh after a newer sign-in begins');
  respond(json(other));
  assert.equal((await login).status, 200);
  assert.equal(h.stored().user.id, 'owner-b');
});

test('a same-user sign-in completed while refresh waits invalidates the queued operation', async () => {
  let release;
  const locks = { request(name, task) { return new Promise(resolve => { release = () => resolve(task()); }); } };
  const h = boot({ auth: session('old', -10), locks });
  const pending = h.backend.getSession();
  const rejected = assert.rejects(pending, { code: 'auth_session_changed' });
  await tick();
  h.backend.adoptSession(session('new-login', 3600));
  release();
  await rejected;
  assert.deepEqual(h.refreshes, []);
  assert.equal(h.stored().access_token, 'new-login-access');
});

test('an unusable Web Locks API falls back to an unlocked refresh', async () => {
  const locks = { request() { return Promise.reject(new DOMException('Locks unavailable', 'SecurityError')); } };
  const h = boot({ auth: session('old', -10), locks });
  assert.equal((await h.backend.getSession()).access_token, 'rotated-access');
  assert.deepEqual(h.refreshes, ['old-refresh']);
});

test('a refresh failure inside the lock is not retried outside it', async () => {
  const locks = { request(name, task) { return Promise.resolve().then(task); } };
  const h = boot({ auth: session('old', -10), locks, refresh: () => json({ error: 'unavailable' }, 503) });
  await assert.rejects(h.backend.getSession(), { code: 'cloud_unavailable' });
  assert.equal(h.refreshes.length, 1);
});

test('a sign-in during a shared refresh still wins for every caller', async () => {
  let respond;
  const h = boot({ auth: session('old', -10), refresh: () => new Promise(resolve => { respond = resolve; }) });
  const callers = [h.backend.getSession(), h.backend.getSession()];
  await tick();
  h.backend.adoptSession(session('new-login', 3600, { id: 'owner-b', email: 'b@example.com' }));
  respond(json(rotated));
  for (const caller of callers) await assert.rejects(caller, { code: 'auth_session_changed' });
  assert.equal(h.stored().user.id, 'owner-b');
  assert.equal(h.refreshes.length, 1);
});

test('event authorization is checked again after token refresh before dispatch', async () => {
  let release, active = true;
  const h = boot({ auth: session('old', -10), refresh: () => new Promise(resolve => { release = () => resolve(json(rotated)); }) });
  const pending = h.backend.logEvent('session-a', 'fatigue', {}, () => active);
  await tick(); active = false; release(); await pending;
  assert.equal(h.requests.length, 0);
});
test('event lifecycle remains valid across refresh, not same-owner reauthentication', async () => {
  const h = boot({ auth: session('old', -10) });
  const lifecycle = h.backend.captureAuthLifecycle();
  const result = await h.backend.logEvent('session-a', 'fatigue', {}, () => h.backend.isAuthLifecycleCurrent(lifecycle));
  assert.equal(result.status, 200);
  assert.equal(h.requests.length, 1);
  assert.equal(h.backend.isAuthLifecycleCurrent(lifecycle), true);
  h.backend.beginAuthAttempt();
  assert.equal(h.backend.isAuthLifecycleCurrent(lifecycle), false);
});
test('cross-tab auth storage changes invalidate queued event lifecycle', () => {
  const h = boot({ auth: session('old', 3600) });
  const lifecycle = h.backend.captureAuthLifecycle();
  h.storageChanged();
  assert.equal(h.backend.isAuthLifecycleCurrent(lifecycle), false);
});
test('event authorization is rechecked in the final fetch microtask', async () => {
  let active = true, checks = 0;
  const h = boot({ auth: session('valid', 3600) });
  await h.backend.logEvent('session-a', 'fatigue', {}, () => {
    if (++checks === 1) queueMicrotask(() => { active = false; });
    return active;
  });
  assert.equal(h.requests.length, 0);
});
test('auth change in the final fetch microtask prevents even an unguarded event', async () => {
  const h = boot({ auth: session('valid', 3600) });
  const pending = h.backend.logEvent('session-a', 'fatigue');
  queueMicrotask(() => h.backend.beginAuthAttempt());
  await pending;
  assert.equal(h.requests.length, 0);
});
test('a new lifecycle after a cross-tab auth change can dispatch normally', async () => {
  const h = boot({ auth: session('valid', 3600) });
  const oldLifecycle = h.backend.captureAuthLifecycle();
  h.storageChanged();
  await h.backend.logEvent('old-session', 'fatigue', {}, () => h.backend.isAuthLifecycleCurrent(oldLifecycle));
  assert.equal(h.requests.length, 0);
  const newLifecycle = h.backend.captureAuthLifecycle();
  assert.equal((await h.backend.logEvent('new-session', 'fatigue', {}, () => h.backend.isAuthLifecycleCurrent(newLifecycle))).status, 200);
  assert.equal(h.requests.length, 1);
});
