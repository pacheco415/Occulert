import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sources = Object.fromEntries(['occulert-backend', 'auth-helper', 'passkey-auth', 'passwordless-auth'].map(name => [name, readFileSync(new URL(`../${name}.v60.js`, import.meta.url), 'utf8')]));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function session(id = 'A', token = id) { return { access_token: `access-${token}`, refresh_token: `refresh-${token}`, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: `${id}@example.com`, email_confirmed_at: '2026-01-01', user_metadata: {} } }; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function boot() {
  const store = new Map(), calls = [], timers = new Map(), clients = [];
  let nextTimer = 0;
  const hooks = { fetch: () => json({}), setSession: value => ({ data: { session: session() }, error: null }), passkey: () => ({ data: { session: session(), user: session().user }, error: null }), getUser: () => ({ data: { user: session().user }, error: null }), manage: () => ({ data: [], error: null }) };
  const context = {
    console, URLSearchParams, Response, AbortController, ReadableStream, Promise,
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    navigator: { credentials: {}, platform: 'fixture', userAgent: 'fixture' },
    location: { origin: 'https://www.occulert.com', hash: '', search: '', pathname: '/login.html' }, history: { replaceState() {} },
    isSecureContext: true, PublicKeyCredential() {},
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    fetch(url, options = {}) { calls.push({ url: String(url), options }); if (url === '/api/public-config') return json({ supabase: { configured: true, url: 'https://example.supabase.co', anonKey: 'fixture-public' } }); return hooks.fetch(url, options); },
  };
  context.window = context;
  context.supabase = { createClient(url, key, options) {
    const client = { options, token: null, auth: {
      async setSession(value) { const result = await hooks.setSession(value, client); client.token = value.access_token; return result; },
      signInWithPasskey: () => hooks.passkey(client), signInWithOtp: value => hooks.manage('otp', value, client), getUser: () => hooks.getUser(client),
      registerPasskey: () => hooks.manage('register', null, client), signOut: () => hooks.manage('signout', null, client),
      passkey: { list: () => hooks.manage('list', null, client), update: value => hooks.manage('rename', value, client), delete: value => hooks.manage('remove', value, client) },
    } }; clients.push(client); return client;
  } };
  context.OcculertSupabaseLoader = { load: async () => context.supabase, retry: async () => context.supabase };
  vm.createContext(context);
  for (const name of Object.keys(sources)) vm.runInContext(sources[name], context, { filename: `${name}.v60.js` });
  return { context, backend: context.OcculertBackend, auth: context.OcculertAuth, passkeys: context.OcculertPasskeys, passwordless: context.OcculertPasswordless, store, calls, hooks, timers, clients,
    expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } },
  };
}

for (const method of ['signIn', 'signUp']) {
  for (const change of ['signout', 'other-tab', 'same-owner-token']) test(`${method} ignores a successful response after ${change}`, async () => {
    const b = boot(), pending = deferred(); b.backend.adoptSession(session()); b.hooks.fetch = () => pending.promise;
    const request = b.backend[method]('A@example.com', 'fixture-password'); await tick();
    if (change === 'signout') b.backend.signOut();
    else if (change === 'other-tab') b.store.set('occulert-auth', JSON.stringify(session('B')));
    else b.backend.adoptSession(session('A', 'replacement'));
    pending.resolve(json(session()));
    assert.equal((await request).status, 409);
    assert.equal(b.backend.currentUser()?.id ?? null, change === 'signout' ? null : change === 'other-tab' ? 'B' : 'A');
    if (change === 'same-owner-token') assert.equal((await b.backend.getSession()).access_token, 'access-replacement');
  });
}

test('the latest overlapping login attempt wins even when the old response arrives first', async () => {
  const b = boot(), first = deferred(), second = deferred(); let n = 0; b.hooks.fetch = () => (++n === 1 ? first : second).promise;
  const old = b.backend.signIn('old@example.com', 'fixture'); await tick();
  const fresh = b.backend.signIn('new@example.com', 'fixture'); await tick();
  first.resolve(json(session('old'))); assert.equal((await old).status, 409); assert.equal(b.backend.currentUser(), null);
  second.resolve(json(session('new'))); assert.equal((await fresh).ok, true); assert.equal(b.backend.currentUser().id, 'new');
});

test('recovery verification cannot restore an account after logout', async () => {
  const b = boot(), pending = deferred(); b.hooks.fetch = () => pending.promise;
  b.context.location.hash = '#type=recovery&access_token=access-A&refresh_token=refresh-A';
  const request = b.backend.consumeAuthRedirect(); await tick(); b.backend.signOut(); pending.resolve(json(session().user));
  const result = await request; assert.equal(result.handled, true); assert.equal(result.status, 409); assert.equal(b.backend.currentUser(), null);
});

test('passkey ceremony cannot adopt a late success after logout', async () => {
  const b = boot(), pending = deferred(); b.hooks.passkey = () => pending.promise;
  const request = b.passkeys.signIn(); const rejected = assert.rejects(request, error => error.code === 'auth_session_changed');
  await tick(); b.backend.signOut(); pending.resolve({ data: { session: session(), user: session().user }, error: null }); await rejected; assert.equal(b.backend.currentUser(), null);
});

for (const method of ['register', 'list', 'rename', 'remove']) test(`passkey ${method} never sends management request after delayed SDK setup crosses accounts`, async () => {
  const b = boot(), pending = deferred(), operations = []; b.backend.adoptSession(session()); b.hooks.setSession = () => pending.promise; b.hooks.manage = name => { operations.push(name); return { data: [], error: null }; };
  const request = b.passkeys[method]('fixture-id', 'fixture-name'); const rejected = assert.rejects(request, error => error.code === 'auth_session_changed');
  await tick(); b.backend.adoptSession(session('B')); pending.resolve({ data: { session: session() }, error: null }); await rejected; assert.deepEqual(operations, []);
});

test('late passkey management results are discarded and concurrent clients keep separate sessions', async () => {
  const b = boot(), pending = deferred(); b.backend.adoptSession(session()); b.hooks.manage = name => name === 'list' ? pending.promise : ({ data: [], error: null });
  const old = b.passkeys.list(); const rejected = assert.rejects(old, error => error.code === 'auth_session_changed'); await tick();
  b.backend.adoptSession(session('B')); await b.passkeys.remove('fixture');
  assert.equal(b.clients[0].token, 'access-A'); assert.equal(b.clients[1].token, 'access-B'); assert.notEqual(b.clients[0], b.clients[1]);
  pending.resolve({ data: [{ id: 'private-A' }], error: null }); await rejected;
});

test('logout revokes local access and resolves even when SDK cleanup never resolves', async () => {
  const b = boot(), pending = deferred(); let cleanupStarted = false;
  b.backend.adoptSession(session()); b.auth.saveProfile({ uid: 'A', authenticated: true, cloudProfile: true });
  b.hooks.manage = name => name === 'signout' ? (cleanupStarted = true, new Promise(() => {})) : pending.promise;
  const old = b.passkeys.list(); const rejected = assert.rejects(old, error => error.code === 'auth_session_changed'); await tick();
  await b.auth.signOut(); assert.equal(cleanupStarted, true); assert.equal(b.backend.currentUser(), null); assert.equal(b.auth.getProfile().authenticated, false); assert.equal(b.auth.getProfile().cloudProfile, false);
  pending.resolve({ data: [], error: null }); await rejected;
});

test('blocked storage removal cannot retain local access after signout', async () => {
  const b = boot(); b.backend.adoptSession(session());
  b.context.localStorage.removeItem = () => { throw new Error('fixture storage blocked'); };
  b.context.localStorage.setItem = () => { throw new Error('fixture storage blocked'); };
  await b.auth.signOut(); assert.equal(b.backend.currentUser(), null); assert.equal(await b.backend.getSession(), null);
  assert.equal((await b.backend.getFleet()).status, 401);
});

test('a delayed profile save cannot restore authenticated profile after logout', async () => {
  const b = boot(), pending = deferred(); b.hooks.fetch = url => String(url).includes('/auth/v1/token') ? json(session()) : pending.promise;
  const request = b.auth.signInEmail('A@example.com', 'fixture', 'signin', {}); const rejected = assert.rejects(request, error => error.code === 'auth_session_changed');
  await tick(); await b.auth.signOut(); pending.resolve(json({ ok: true })); await rejected; assert.equal(b.auth.getProfile().authenticated, false);
});

for (const stage of ['setSession', 'getUser']) test(`email-link ${stage} rejects account changes before adoption or profile writes`, async () => {
  const b = boot(), pending = deferred(); b.context.location.hash = '#type=magiclink&access_token=access-A&refresh_token=refresh-A'; b.hooks[stage] = () => pending.promise;
  const request = b.passwordless.consumeRedirect(); const rejected = assert.rejects(request, error => error.code === 'auth_session_changed'); await tick();
  b.backend.adoptSession(session('B')); pending.resolve(stage === 'setSession' ? { data: { session: session() }, error: null } : { data: { user: session().user }, error: null }); await rejected;
  assert.equal(b.backend.currentUser().id, 'B'); assert.equal(b.auth.getProfile(), null);
});

test('email-link profile completion cannot overwrite a new account profile', async () => {
  const b = boot(), pending = deferred(); b.context.location.hash = '#type=signup&access_token=access-A&refresh_token=refresh-A'; b.hooks.fetch = () => pending.promise;
  const request = b.passwordless.consumeRedirect(); const rejected = assert.rejects(request, error => error.code === 'auth_session_changed'); await tick();
  b.backend.adoptSession(session('B')); b.auth.saveProfile({ uid: 'B', driverId: 'B', authenticated: true }); pending.resolve(json({ ok: true })); await rejected; assert.equal(b.auth.getProfile().uid, 'B');
});

for (const phase of ['headers', 'body']) test(`browser auth timeout includes stalled ${phase}, aborts, ignores late success and keeps current account`, async () => {
  const b = boot(), pending = deferred(); b.backend.adoptSession(session('B'));
  let stream;
  b.hooks.fetch = () => phase === 'headers' ? pending.promise : new Response(new ReadableStream({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('{')); } }));
  const request = b.backend.signIn('A@example.com', 'fixture'); await tick();
  const network = b.calls.find(call => call.url.includes('/auth/v1/token')); assert.equal(b.timers.size, 1); assert.equal([...b.timers.values()][0].ms, 8000);
  b.expire(); assert.equal((await request).status, 503); assert.equal(network.options.signal.aborted, true);
  if (phase === 'headers') pending.resolve(json(session())); else { stream.enqueue(new TextEncoder().encode(JSON.stringify(session()).slice(1))); stream.close(); }
  await tick(); assert.equal(b.backend.currentUser().id, 'B'); assert.equal(b.timers.size, 0);
});

test('SDK fetch shares the body deadline and returns the native complete response', async () => {
  const b = boot(); const original = json({ ok: true }); b.hooks.fetch = () => original;
  assert.equal(await b.backend.fetchWithDeadline('/sdk'), original); assert.equal(original.bodyUsed, false); assert.equal(b.timers.size, 0);
  let controller; b.hooks.fetch = () => new Response(new ReadableStream({ start(value) { controller = value; value.enqueue(new TextEncoder().encode('{')); } }));
  const request = b.backend.fetchWithDeadline('/sdk'); const rejected = assert.rejects(request, error => error.code === 'cloud_unavailable'); await tick(); b.expire(); await rejected;
  controller.close(); await tick(); assert.equal(b.timers.size, 0);
});

test('provider refresh outage preserves auth while confirmed invalid refresh clears it', async () => {
  for (const status of [503, 401]) {
    const b = boot(); b.backend.adoptSession({ ...session(), expires_at: 1 }); b.hooks.fetch = () => json({ error: 'fixture-error' }, status);
    if (status === 503) { await assert.rejects(b.backend.getSession(), error => error.code === 'cloud_unavailable'); assert.equal(b.backend.currentUser().id, 'A'); }
    else { assert.equal(await b.backend.getSession(), null); assert.equal(b.backend.currentUser(), null); }
  }
});

test('onAuth still reports a legitimately refreshed session', async () => {
  const b = boot(); b.backend.adoptSession({ ...session(), expires_at: 1 }); b.hooks.fetch = () => json(session('A', 'fresh'));
  let user; await b.auth.onAuth(value => { user = value; }); assert.equal(user.uid, 'A');
});

test('SDK fetch preserves caller cancellation and does not send an already-aborted request', async () => {
  const b = boot(), controller = new AbortController(); controller.abort();
  await assert.rejects(b.backend.fetchWithDeadline('/sdk', { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(b.calls.length, 0); assert.equal(b.timers.size, 0);
  const active = new AbortController(), pending = deferred(); b.hooks.fetch = () => pending.promise;
  const request = b.backend.fetchWithDeadline('/sdk', { signal: active.signal }); const rejected = assert.rejects(request, error => error.name === 'AbortError');
  await tick(); active.abort(); await rejected; assert.equal(b.calls[0].options.signal.aborted, true); assert.equal(b.timers.size, 0);
  pending.resolve(json({ ok: true })); await tick();
});

test('passwordless retries settings after an initial null config using isolated SDK clients', async () => {
  const b = boot(); let refreshed = 0, loads = 0;
  b.backend.getAuthConfig = async () => null;
  b.backend.refreshAuthConfig = async () => { refreshed++; return { url: 'https://example.supabase.co', anonKey: 'fixture-public' }; };
  b.context.OcculertSupabaseLoader.retry = async () => { loads++; return b.context.supabase; };
  await assert.rejects(b.passwordless.start('fixture@example.com'), /Account settings could not load/);
  await b.passwordless.start('fixture@example.com'); assert.equal(refreshed, 1); assert.equal(loads, 1); assert.equal(b.clients.length, 1);
});

for (const blocked of [false, true]) test(`recovery from A to B ${blocked ? 'rejects failed persistence' : 'saves the verified tokens, identity and expiry'}`, async () => {
  const b = boot(), pending = deferred(); b.backend.adoptSession(session());
  const expires = Math.floor(Date.now() / 1000) + 900;
  b.context.location.hash = `#type=recovery&access_token=access-B&refresh_token=refresh-B&expires_at=${expires}`;
  b.hooks.fetch = () => pending.promise;
  const request = b.backend.consumeAuthRedirect(); await tick();
  if (blocked) b.context.localStorage.setItem = () => { throw new Error('fixture write blocked'); };
  pending.resolve(json(session('B').user));
  const result = await request; assert.equal(result.handled, true);
  if (blocked) { assert.equal(result.ok, false); assert.equal(result.status, 503); assert.equal(b.backend.currentUser().id, 'A'); }
  else { assert.equal(result.ok, true); const saved = await b.backend.getSession(); assert.equal(saved.user.id, 'B'); assert.equal(saved.access_token, 'access-B'); assert.equal(saved.refresh_token, 'refresh-B'); assert.equal(saved.expires_at, expires); }
});
