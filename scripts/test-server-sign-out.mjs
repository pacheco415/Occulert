// Web sign-out clears this browser at once, then revokes the session on
// Supabase with one bounded logout request (scope=local).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { assetByStem } from './lib/current-assets.mjs';

const source = readFileSync(new URL(`../${assetByStem('occulert-backend.js')}`, import.meta.url), 'utf8');
const tick = async (count = 20) => { for (let i = 0; i < count; i++) await new Promise(setImmediate); };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const now = () => Math.floor(Date.now() / 1000);

function boot({ auth, transport = () => json({}) }) {
  const store = new Map(), requests = [];
  if (auth) store.set('occulert-auth', JSON.stringify(auth));
  const context = {
    window: { location: { origin: 'https://www.occulert.com', pathname: '/account.html', search: '', hash: '' }, history: { replaceState() {} } },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    navigator: { platform: 'fixture', userAgent: 'fixture' },
    async fetch(url, options = {}) {
      const request = { url: String(url), method: options.method || 'GET', headers: JSON.parse(JSON.stringify(options.headers || {})), body: options.body ? JSON.parse(options.body) : undefined };
      if (request.url === '/api/public-config') return json({ supabase: { configured: true, url: 'https://example.supabase.co', anonKey: 'public-key' } });
      requests.push(request); // copied out of the script realm so deepEqual compares plain objects
      return transport(request);
    },
    Response, JSON, Date, Math, Object, Promise, URLSearchParams, setTimeout, clearTimeout, AbortController,
  };
  context.window.localStorage = context.localStorage;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { backend: context.window.OcculertBackend, store, requests };
}
const user = { id: 'user-1', email: 'driver@example.com' };
const live = { access_token: 'live-access', refresh_token: 'live-refresh', expires_at: now() + 3600, user };
const logoutOf = token => ({ url: 'https://example.supabase.co/auth/v1/logout?scope=local', method: 'POST', headers: { apikey: 'public-key', Authorization: 'Bearer ' + token }, body: undefined });

test('sign-out clears the browser synchronously, then sends one scope=local logout', async () => {
  const h = boot({ auth: live });
  h.store.set('occulert-auth-link-requests', '{}');
  assert.equal(h.backend.signOut(), undefined, 'sign-out returns at once rather than waiting on the network');
  assert.equal(h.store.has('occulert-auth'), false);
  assert.equal(h.store.has('occulert-auth-link-requests'), false);
  assert.equal(h.backend.currentUser(), null);
  await tick();
  assert.deepEqual(h.requests, [logoutOf('live-access')]);
});

test('an expired access token is refreshed once, logout uses the new token, and nothing is stored', async () => {
  const h = boot({
    auth: { ...live, access_token: 'old-access', expires_at: now() - 10 },
    transport: request => request.url.includes('grant_type=refresh_token')
      ? json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, user })
      : json({}),
  });
  h.backend.signOut();
  await tick();
  assert.deepEqual(h.requests.map(request => request.url), [
    'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
    'https://example.supabase.co/auth/v1/logout?scope=local',
  ]);
  assert.deepEqual(h.requests[0].body, { refresh_token: 'live-refresh' });
  assert.deepEqual(h.requests[1], logoutOf('fresh-access'));
  assert.equal(h.store.has('occulert-auth'), false, 'the refreshed session must never be adopted');
  assert.equal(h.backend.currentUser(), null);
});

test('a token within 30 seconds of expiry is refreshed before logout', async () => {
  const h = boot({ auth: { ...live, expires_at: now() + 20 }, transport: request => request.url.includes('grant_type')
    ? json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600, user }) : json({}) });
  h.backend.signOut();
  await tick();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1], logoutOf('fresh-access'));
});

test('a rejected refresh sends no logout and stays signed out', async () => {
  const h = boot({ auth: { ...live, expires_at: now() - 10 }, transport: () => json({ error: 'invalid_grant' }, 400) });
  h.backend.signOut();
  await tick();
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /grant_type=refresh_token/);
  assert.equal(h.backend.currentUser(), null);
});

test('network failures leave the browser signed out without throwing', async () => {
  for (const failure of ['throw', '500']) {
    const h = boot({ auth: live, transport: () => { if (failure === 'throw') throw new TypeError('Failed to fetch'); return json({ error: 'down' }, 500); } });
    h.backend.signOut();
    await tick();
    assert.equal(h.requests.length, 1);
    assert.equal(h.store.has('occulert-auth'), false);
    assert.equal(h.backend.currentUser(), null);
  }
});

test('signing out with nobody signed in sends nothing', async () => {
  const h = boot({});
  h.backend.signOut();
  await tick();
  assert.deepEqual(h.requests, []);
});

test('a new sign-in right after sign-out is not touched by the old revocation', async () => {
  let releaseLogout;
  const h = boot({ auth: live, transport: request => request.url.includes('/logout')
    ? new Promise(resolve => { releaseLogout = () => resolve(json({})); }) : json({}) });
  h.backend.signOut();
  await tick();
  const next = { ...live, access_token: 'next-access', refresh_token: 'next-refresh', user: { id: 'user-2', email: 'next@example.com' } };
  h.backend.adoptSession(next);
  releaseLogout();
  await tick();
  assert.equal(h.backend.currentUser().id, 'user-2');
  assert.deepEqual(h.requests, [logoutOf('live-access')], 'only the old session is revoked');
});
