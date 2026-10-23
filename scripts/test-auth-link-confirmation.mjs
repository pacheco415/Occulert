// Email links carry complete sessions in the URL fragment. A link this browser
// did not request, or one for a different account than the one signed in, must
// wait for an explicit Continue before it can change this browser's account.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { assetByStem } from './lib/current-assets.mjs';

const sources = ['occulert-backend', 'auth-helper', 'passkey-auth', 'passwordless-auth'].map(name => {
  const filename = assetByStem(`${name}.js`);
  return { filename, source: readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8') };
});
const MARKERS = 'occulert-auth-link-requests';

function user(id) { return { id, email: `${id}@example.com`, email_confirmed_at: '2026-01-01', user_metadata: {} }; }
function session(id, token = id) {
  return { access_token: `access-${token}`, refresh_token: `refresh-${token}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user: user(id) };
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

function boot() {
  const store = new Map(), calls = [], listeners = new Map();
  // The link sender's account is what Auth verifies for the presented tokens.
  let linkUser = user('B');
  const context = {
    console, URLSearchParams, Response, AbortController, ReadableStream, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    navigator: { credentials: {}, platform: 'fixture', userAgent: 'fixture' },
    location: { origin: 'https://www.occulert.com', hash: '', search: '', pathname: '/login.html' }, history: { replaceState() {} },
    isSecureContext: true, PublicKeyCredential() {},
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
    fetch(url, options = {}) {
      calls.push(String(url));
      if (url === '/api/public-config') return json({ supabase: { configured: true, url: 'https://example.supabase.co', anonKey: 'fixture-public' } });
      if (String(url).includes('/auth/v1/token?grant_type=refresh_token')) return json(session('A', 'fresh'));
      if (String(url).endsWith('/auth/v1/user')) return json(linkUser);
      if (url === '/api/profile') return json({ ok: true, driver: { id: 'driver-fixture' } });
      return json({});
    },
  };
  context.window = context;
  context.supabase = { createClient() {
    return { auth: {
      async setSession(value) { return { data: { session: { ...value, user: linkUser, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }; },
      async getUser() { return { data: { user: linkUser }, error: null }; },
      async signInWithOtp() { return { error: null }; },
    } };
  } };
  context.OcculertSupabaseLoader = { load: async () => context.supabase, retry: async () => context.supabase };
  vm.createContext(context);
  for (const { filename, source } of sources) vm.runInContext(source, context, { filename });
  return {
    context, store, calls, backend: context.OcculertBackend, auth: context.OcculertAuth, passwordless: context.OcculertPasswordless,
    link(type, id) { linkUser = user(id); context.location.hash = `#type=${type}&access_token=access-${id}-link&refresh_token=refresh-${id}-link&expires_in=3600`; },
    markers() { return JSON.parse(store.get(MARKERS) || '{}'); },
  };
}

test('a reset link for another account waits while A stays signed in, then Continue switches', async () => {
  const b = boot(); b.backend.adoptSession(session('A')); b.link('recovery', 'B');
  const pending = await b.backend.consumeAuthRedirect();
  assert.equal(pending.handled, true); assert.equal(pending.ok, false); assert.equal(pending.needsConfirmation, true);
  assert.equal(pending.email, 'B@example.com');
  assert.equal(b.backend.currentUser().id, 'A'); assert.equal((await b.backend.getSession()).access_token, 'access-A');
  const result = await pending.confirm();
  assert.equal(result.ok, true); assert.equal(b.backend.currentUser().id, 'B');
  assert.equal((await b.backend.getSession()).access_token, 'access-B-link');
});

test('a reset link this browser requested for that email is adopted without a prompt and clears its marker', async () => {
  const b = boot(); await b.backend.requestPasswordReset(' B@Example.com ');
  assert.equal(b.markers().recovery.email, 'b@example.com');
  b.link('recovery', 'B');
  const result = await b.backend.consumeAuthRedirect();
  assert.equal(result.ok, true); assert.equal(result.needsConfirmation, undefined); assert.equal(b.backend.currentUser().id, 'B');
  assert.equal(b.markers().recovery, undefined);
});

test('an expired or mismatched reset marker still requires confirmation', async () => {
  for (const marker of [{ email: 'b@example.com', created_at: Date.now() - 61 * 60 * 1000 }, { email: 'c@example.com', created_at: Date.now() }]) {
    const b = boot(); b.store.set(MARKERS, JSON.stringify({ recovery: marker })); b.link('recovery', 'B');
    const pending = await b.backend.consumeAuthRedirect();
    assert.equal(pending.needsConfirmation, true); assert.equal(b.backend.currentUser(), null);
  }
});

test('a sign-in marker does not authorize a reset link, and a reset marker does not authorize a sign-in link', async () => {
  const b = boot(); b.backend.recordAuthLinkRequest('signin', 'B@example.com'); b.link('recovery', 'B');
  assert.equal((await b.backend.consumeAuthRedirect()).needsConfirmation, true);
  const c = boot(); c.backend.recordAuthLinkRequest('recovery', 'B@example.com'); c.link('magiclink', 'B');
  assert.equal((await c.passwordless.consumeRedirect()).needsConfirmation, true);
});

test('Cancel keeps A signed in and the discarded link cannot be confirmed later', async () => {
  const b = boot(); b.backend.adoptSession(session('A')); b.link('recovery', 'B');
  const pending = await b.backend.consumeAuthRedirect(); pending.cancel();
  const late = await pending.confirm();
  assert.equal(late.ok, false); assert.equal(late.status, 409); assert.equal(b.backend.currentUser().id, 'A');
});

test('an account change while the prompt is shown makes Continue fail without switching', async () => {
  for (const change of ['other-account', 'sign-out']) {
    const b = boot(); b.backend.adoptSession(session('A')); b.link('recovery', 'B');
    const pending = await b.backend.consumeAuthRedirect();
    if (change === 'other-account') b.backend.adoptSession(session('C')); else b.backend.signOut();
    const result = await pending.confirm();
    assert.equal(result.ok, false); assert.equal(b.backend.currentUser()?.id ?? null, change === 'other-account' ? 'C' : null);
  }
});

test('a link for the same signed-in account still needs matching local intent', async () => {
  const b = boot(); b.backend.adoptSession(session('B')); b.link('recovery', 'B');
  const pending = await b.backend.consumeAuthRedirect(); assert.equal(pending.needsConfirmation, true);
  assert.equal((await b.backend.getSession()).access_token, 'access-B'); pending.cancel();
  await b.backend.requestPasswordReset('B@example.com'); b.link('recovery', 'B');
  const result = await b.backend.consumeAuthRedirect(); assert.equal(result.ok, true); assert.equal(result.needsConfirmation, undefined);
  assert.equal((await b.backend.getSession()).access_token, 'access-B-link');
});

test('sign-out clears pending link markers', async () => {
  const b = boot(); await b.backend.requestPasswordReset('B@example.com'); b.backend.recordAuthLinkRequest('signin', 'B@example.com');
  assert.ok(b.store.has(MARKERS)); b.backend.signOut(); assert.equal(b.store.has(MARKERS), false);
});

test('sign-up and resend record a sign-in marker for the confirmation link', async () => {
  const b = boot(); await b.backend.signUp('B@example.com', 'fixture-password');
  assert.equal(b.markers().signin.email, 'b@example.com');
  const c = boot(); await c.backend.resendSignupConfirmation('B@example.com');
  assert.equal(c.markers().signin.email, 'b@example.com');
});

test('a magic link for another account waits, leaves A and its profile untouched, then Continue adopts B', async () => {
  const b = boot(); b.backend.adoptSession(session('A')); b.auth.saveProfile({ uid: 'A', driverId: 'A', authenticated: true });
  b.link('magiclink', 'B');
  const pending = await b.passwordless.consumeRedirect();
  assert.equal(pending.needsConfirmation, true); assert.equal(pending.email, 'B@example.com');
  assert.equal(b.backend.currentUser().id, 'A'); assert.equal(b.auth.getProfile().uid, 'A');
  assert.equal(b.calls.includes('/api/profile'), false);
  const result = await pending.confirm();
  assert.equal(b.backend.currentUser().id, 'B'); assert.equal(result.profile.uid, 'B'); assert.equal(b.auth.getProfile().uid, 'B');
});

test('a magic link requested from this browser signs in directly', async () => {
  const b = boot(); await b.passwordless.start('B@example.com');
  assert.equal(b.markers().signin.email, 'b@example.com');
  b.link('magiclink', 'B');
  const result = await b.passwordless.consumeRedirect();
  assert.equal(result.needsConfirmation, undefined); assert.equal(result.profile.uid, 'B'); assert.equal(b.backend.currentUser().id, 'B');
  assert.equal(b.markers().signin, undefined);
});

test('an unrequested magic link with nobody signed in still asks first', async () => {
  const b = boot(); b.link('signup', 'B');
  const pending = await b.passwordless.consumeRedirect();
  assert.equal(pending.needsConfirmation, true); assert.equal(b.backend.currentUser(), null);
  pending.cancel(); await assert.rejects(pending.confirm(), error => error.code === 'auth_session_changed');
  assert.equal(b.backend.currentUser(), null);
});

for (const type of ['recovery', 'magiclink', 'signup']) {
  test(`${type} a newer sign-in attempt still wins after an automatic refresh settles`, async () => {
    const b = boot(); b.backend.adoptSession({ ...session('A'), expires_at: 1 }); b.link(type, 'B');
    const write = b.context.localStorage.setItem;
    b.context.localStorage.setItem = (key, value) => {
      write(key, value);
      if (key === 'occulert-auth' && JSON.parse(value).access_token === 'access-fresh') queueMicrotask(() => b.backend.beginAuthAttempt());
    };
    if (type === 'recovery') assert.equal((await b.backend.consumeAuthRedirect()).status, 409);
    else await assert.rejects(b.passwordless.consumeRedirect(), error => error.code === 'auth_session_changed');
    assert.equal(b.backend.currentUser().id, 'A');
  });
  test(`${type} completes the existing session refresh before showing a usable confirmation`, async () => {
    const b = boot(); b.backend.adoptSession({ ...session('A'), expires_at: 1 }); b.link(type, 'B');
    const pending = type === 'recovery' ? await b.backend.consumeAuthRedirect() : await b.passwordless.consumeRedirect();
    assert.equal(pending.needsConfirmation, true); assert.equal((await b.backend.getSession()).access_token, 'access-fresh');
    assert.equal(b.calls.filter(url => url.includes('grant_type=refresh_token')).length, 1);
    const result = await pending.confirm();
    if (type === 'recovery') assert.equal(result.ok, true); else assert.equal(result.profile.uid, 'B');
    assert.equal(b.backend.currentUser().id, 'B');
  });
  test(`${type} observed cross-tab changes cannot revive the same original auth after a prompt`, async () => {
    const b = boot(); b.backend.adoptSession(session('A')); b.link(type, 'B');
    const before = b.store.get('occulert-auth');
    const pending = type === 'recovery' ? await b.backend.consumeAuthRedirect() : await b.passwordless.consumeRedirect();
    b.store.set('occulert-auth', JSON.stringify(session('C'))); b.context.dispatchEvent({ type: 'storage', key: 'occulert-auth' });
    b.store.set('occulert-auth', before); b.context.dispatchEvent({ type: 'storage', key: 'occulert-auth' });
    if (type === 'recovery') assert.equal((await pending.confirm()).status, 409);
    else await assert.rejects(pending.confirm(), error => error.code === 'auth_session_changed');
    assert.equal(b.store.get('occulert-auth'), before);
  });
  for (const invalid of ['future', 'string', 'deadline']) test(`${type} ${invalid} request time still requires confirmation`, async () => {
    const b = boot(), ttl = type === 'recovery' ? 3600000 : 86400000;
    const created = invalid === 'future' ? Date.now() + 60000 : invalid === 'string' ? String(Date.now()) : Date.now() - ttl;
    b.store.set(MARKERS, JSON.stringify({ [type === 'recovery' ? 'recovery' : 'signin']: { email: 'b@example.com', created_at: created } }));
    b.link(type, 'B');
    const pending = type === 'recovery' ? await b.backend.consumeAuthRedirect() : await b.passwordless.consumeRedirect();
    assert.equal(pending.needsConfirmation, true); assert.equal(b.backend.currentUser(), null); pending.cancel();
  });
  for (const replacement of ['new-session', 'signout-then-same-user']) test(`${type} Continue rejects ${replacement} for the same user after the prompt`, async () => {
    const b = boot(); b.backend.adoptSession(session('A')); b.link(type, 'B');
    const pending = type === 'recovery' ? await b.backend.consumeAuthRedirect() : await b.passwordless.consumeRedirect();
    if (replacement === 'signout-then-same-user') b.backend.signOut();
    b.backend.adoptSession(session('A', 'replacement'));
    const before = b.store.get('occulert-auth');
    if (type === 'recovery') { const result = await pending.confirm(); assert.equal(result.ok, false); assert.equal(result.status, 409); }
    else await assert.rejects(pending.confirm(), error => error.code === 'auth_session_changed');
    assert.equal(b.store.get('occulert-auth'), before);
  });
  test(`${type} Continue rejects expiry without writing the link session`, async () => {
    const b = boot(); b.backend.adoptSession(session('A')); b.link(type, 'B');
    const pending = type === 'recovery' ? await b.backend.consumeAuthRedirect() : await b.passwordless.consumeRedirect();
    const before = b.store.get('occulert-auth');
    let now = Date.now() + 7200000; b.context.Date = class extends Date { static now() { return now; } };
    if (type === 'recovery') assert.equal((await pending.confirm()).ok, false);
    else await assert.rejects(pending.confirm());
    assert.equal(b.store.get('occulert-auth'), before);
  });
}
