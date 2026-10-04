import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createCachedJwtVerifier } = require('../api/_lib/cached-jwks.js');
const issuer = 'https://fixture.supabase.co/auth/v1';
const subject = '01890f80-7237-7c38-893d-026c203e47b8';
const keys = {
  ec: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  rotated: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  rsa: generateKeyPairSync('rsa', { modulusLength: 2048 }),
  weak: generateKeyPairSync('rsa', { modulusLength: 1024 }),
  wrongCurve: generateKeyPairSync('ec', { namedCurve: 'secp384r1' }),
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const clockStart = Date.UTC(2026, 9, 4);
function jwk(name, overrides = {}) {
  return { ...keys[name].publicKey.export({ format: 'jwk' }), kid: name, alg: name === 'rsa' || name === 'weak' ? 'RS256' : 'ES256', use: 'sig', key_ops: ['verify'], ...overrides };
}
function jwt(name = 'ec', { now = clockStart, header = {}, claims = {}, der = false } = {}) {
  const algorithm = name === 'rsa' || name === 'weak' ? 'RS256' : 'ES256';
  const parts = [encode({ alg: algorithm, typ: 'JWT', kid: name, ...header }), encode({ iss: issuer, aud: 'authenticated', role: 'authenticated', sub: subject,
    exp: Math.floor(now / 1000) + 3600, nbf: Math.floor(now / 1000) - 60,
    email: 'stale@example.com', user_metadata: { email_verified: true }, ...claims })];
  const bytes = Buffer.from(parts.join('.'));
  const signature = sign('sha256', bytes, algorithm === 'ES256' && !der ? { key: keys[name].privateKey, dsaEncoding: 'ieee-p1363' } : keys[name].privateKey);
  return parts.join('.') + '.' + signature.toString('base64url');
}
function fixture(initial = [jwk('ec'), jwk('rsa')]) {
  let now = clockStart, elapsed = 0, discovery = { keys: initial }, count = 0;
  const verify = createCachedJwtVerifier(() => now, () => elapsed);
  const load = async () => { count++; if (discovery instanceof Error) throw discovery; return discovery; };
  return { verify: (token, configuredIssuer = issuer) => verify(token, configuredIssuer, load), set: value => { discovery = value; },
    advance: ms => { now += ms; elapsed += ms; }, shiftWall: ms => { now += ms; }, now: () => now, count: () => count, verifier: verify, load };
}
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('actual signed P-256 and RSA tokens return only canonical identity and reuse cached keys', async () => {
  const f = fixture();
  assert.deepEqual(await f.verify(jwt()), { id: subject });
  assert.deepEqual(await f.verify(jwt('rsa')), { id: subject });
  assert.deepEqual(await f.verify(jwt()), { id: subject });
  assert.equal(f.count(), 1);
});

test('signed wrong claims and malformed headers fail closed before discovery or fallback', async () => {
  const f = fixture(), now = Math.floor(f.now() / 1000);
  for (const claims of [{ iss: issuer + '/' }, { iss: 'https://foreign.supabase.co/auth/v1' }, { aud: 'anon' }, { aud: ['authenticated'] },
    { role: 'service_role' }, { sub: subject + '\n' }, { sub: [subject] }, { exp: now - 31 }, { exp: String(now + 100) },
    { exp: null }, { exp: now + 0.5 }, { nbf: now + 31 }, { nbf: '0' }, { nbf: null }, { nbf: now + 4000 }]) {
    assert.equal(await f.verify(jwt('ec', { claims })), null, JSON.stringify(claims));
  }
  for (const header of [{ alg: 'none' }, { alg: 'es256' }, { alg: 'PS256' }, { typ: 'notJWT' }, { crit: [] }, { crit: ['custom'] },
    { b64: false }, { jku: 'https://attacker.invalid/jwks' }, { jwk: jwk('ec') }, { x5u: 'https://attacker.invalid/key' }, { x5c: [] },
    { kid: '' }, { kid: 1 }, { kid: 'x'.repeat(129) }]) assert.equal(await f.verify(jwt('ec', { header })), null, JSON.stringify(header));
  assert.equal(f.count(), 0);
  const valid = jwt();
  for (const token of [null, [], '', 'not-a-token', valid + '.', ' '.repeat(16385), valid.replace('.', '=.'), valid + '\n']) assert.equal(await f.verify(token), null);
  assert.equal(f.count(), 0);
});

test('30-second skew has exact expiration/not-before boundaries and is rechecked after refresh', async () => {
  const f = fixture(), now = f.now() / 1000;
  assert.deepEqual(await f.verify(jwt('ec', { claims: { exp: now - 29 } })), { id: subject });
  assert.equal(await f.verify(jwt('ec', { claims: { exp: now - 30 } })), null);
  assert.deepEqual(await f.verify(jwt('ec', { claims: { nbf: now + 30 } })), { id: subject });
  assert.equal(await f.verify(jwt('ec', { claims: { nbf: now + 31 } })), null);
  const cold = fixture(), late = deferred();
  const pending = cold.verifier(jwt('ec', { claims: { exp: now + 1 } }), issuer, () => late.promise);
  await tick(); cold.advance(31000); late.resolve({ keys: [jwk('ec')] }); assert.equal(await pending, null);
});

test('known-key bad signatures/alg confusion/DER encoding never use an Auth fallback', async () => {
  const f = fixture();
  const valid = jwt(), parts = valid.split('.'), signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1;
  assert.equal(await f.verify(parts[0] + '.' + parts[1] + '.' + signature.toString('base64url')), null);
  assert.equal(await f.verify(jwt('rotated', { header: { kid: 'ec' } })), null);
  assert.equal(await f.verify(jwt('rsa', { header: { kid: 'ec' } })), null);
  assert.equal(await f.verify(jwt('ec', { header: { kid: 'rsa' } })), null);
  assert.equal(await f.verify(jwt('ec', { der: true })), null);
  assert.equal(f.count(), 1);
});

test('matching JWKs enforce public-only algorithm/type/curve/key-size/use/operation guards', async () => {
  const bad = [jwk('ec', { use: 'enc' }), jwk('ec', { key_ops: ['sign'] }), jwk('ec', { key_ops: [] }), jwk('ec', { key_ops: ['verify', 'sign'] }),
    jwk('ec', { d: '' }), jwk('ec', { alg: 'ES384' }), jwk('ec', { kty: 'RSA' }), jwk('wrongCurve', { kid: 'ec' }),
    jwk('ec', { x: jwk('ec').x + '=' }), jwk('weak', { kid: 'rsa' }), jwk('rsa', { p: '' }), jwk('rsa', { e: 'Ag' }),
    jwk('rsa', { n: 'A'.repeat(685) }), jwk('rsa', { n: Buffer.concat([Buffer.from([0]), Buffer.from(jwk('rsa').n, 'base64url')]).toString('base64url') })];
  for (const key of bad) {
    const f = fixture([key]); assert.equal(await f.verify(jwt(key.kid === 'rsa' ? 'rsa' : 'ec')), null); assert.equal(f.count(), 1);
  }
  const duplicate = fixture([jwk('ec'), jwk('ec')]); assert.equal(await duplicate.verify(jwt()), null);
});

test('expiry refresh drops revoked keys; bounded kid misses can discover a rotated key', async () => {
  const f = fixture(); await f.verify(jwt());
  f.set({ keys: [jwk('ec'), jwk('rotated')] });
  assert.deepEqual(await f.verify(jwt('rotated')), { id: subject }); assert.equal(f.count(), 2);
  for (let i = 0; i < 1000; i++) assert.equal(await f.verify(jwt('ec', { header: { kid: 'missing-' + i } })), null);
  assert.equal(f.count(), 2, 'new attacker-controlled kids cannot cause unbounded refreshes or retained miss records');
  f.advance(30000); await f.verify(jwt('ec', { header: { kid: 'still-missing' } })); assert.equal(f.count(), 3);
  f.set({ keys: [jwk('rotated')] }); f.advance(600000);
  assert.equal(await f.verify(jwt()), null); assert.equal(f.count(), 4);
});

test('cold/TTL refreshes are single-flight and configured projects have separate trust', async () => {
  const f = fixture(), pendingDiscovery = deferred(); let count = 0;
  const load = () => { count++; return pendingDiscovery.promise; };
  const requests = Array.from({ length: 50 }, () => f.verifier(jwt(), issuer, load));
  await tick(); assert.equal(count, 1); pendingDiscovery.resolve({ keys: [jwk('ec')] });
  assert.ok((await Promise.all(requests)).every(identity => identity.id === subject));
  const foreign = issuer.replace('fixture.', 'other.');
  assert.equal(await f.verify(jwt(), foreign), null); assert.equal(f.count(), 0);
  assert.deepEqual(await f.verify(jwt('ec', { claims: { iss: foreign } }), foreign), { id: subject }); assert.equal(f.count(), 1);
});

test('unavailable discovery/oversized key sets are fallback signals with bounded retry backoff', async () => {
  const f = fixture(); f.set(new Error('outage'));
  assert.equal(await f.verify(jwt()), undefined); assert.equal(await f.verify(jwt()), undefined); assert.equal(f.count(), 1);
  f.advance(5000); f.set({ keys: Array.from({ length: 33 }, (_, i) => jwk('ec', { kid: 'key-' + i })) });
  assert.equal(await f.verify(jwt()), undefined); assert.equal(f.count(), 2);
  f.advance(5000); f.set({ keys: [] }); assert.equal(await f.verify(jwt()), null, 'a healthy missing key is denied');
});

test('monotonic cache TTL and miss/backoff timers survive backwards wall-clock changes', async () => {
  const token = jwt('ec', { claims: { nbf: 0 } });
  const missing = jwt('ec', { header: { kid: 'missing' }, claims: { nbf: 0 } });
  const expired = fixture(); await expired.verify(token);
  expired.advance(300000); expired.shiftWall(-600000); expired.set({ keys: [] }); expired.advance(360000);
  assert.equal(await expired.verify(token), null); assert.equal(expired.count(), 2, 'revoked keys refresh after eleven elapsed minutes');
  const miss = fixture(); await miss.verify(token); miss.shiftWall(-600000);
  await miss.verify(missing); assert.equal(miss.count(), 2);
  miss.advance(30000); await miss.verify(missing); assert.equal(miss.count(), 3);
  const outage = fixture(); outage.set(new Error('outage')); await outage.verify(token); outage.shiftWall(-600000);
  outage.advance(5000); await outage.verify(token); assert.equal(outage.count(), 2, 'discovery retries after five elapsed seconds');
});

test('failed rotated-key discovery preserves safe Auth fallback throughout the bounded miss cooldown', async () => {
  const f = fixture([jwk('ec')]); await f.verify(jwt()); f.set(new Error('outage'));
  const rotated = jwt('rotated');
  assert.equal(await f.verify(rotated), undefined); assert.equal(f.count(), 2);
  for (const delta of [4999, 1, 24999]) {
    f.advance(delta); assert.equal(await f.verify(rotated), undefined);
    assert.deepEqual(await f.verify(jwt()), { id: subject }, 'a known unexpired key remains usable');
    assert.equal(f.count(), 2, 'misses cannot force repeated discovery during the cooldown');
  }
  f.set({ keys: [jwk('ec'), jwk('rotated')] }); f.advance(1);
  assert.deepEqual(await f.verify(rotated), { id: subject }); assert.equal(f.count(), 3);
});

// Load actual route-relative helpers, with isolated module caches and a mocked
// HTTP boundary. Cryptography, local-vs-network policy and the deadline stay real.
function networkFixture(fetch, options = {}) {
  const calls = [], modules = new Map(), sourceRoot = new URL('../api/', import.meta.url);
  const environment = { SUPABASE_URL: issuer.slice(0, -'/auth/v1'.length), SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' };
  const contextExtras = { Buffer, URL, URLSearchParams, AbortController, Date: options.Date || Date,
    setTimeout: options.setTimeout || setTimeout, clearTimeout: options.clearTimeout || clearTimeout,
    console: { error() {} }, fetch: async (url, opts) => { calls.push({ url: String(url), options: opts }); return fetch(String(url), opts); } };
  function load(relative) {
    const absolute = require.resolve(new URL(relative, sourceRoot).pathname);
    if (options.budget && absolute === require.resolve('../api/_lib/provider-budget.js')) return options.budget;
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} }; modules.set(absolute, module);
    const moduleRequire = createRequire(absolute);
    vm.runInNewContext(readFileSync(absolute, 'utf8'), { ...contextExtras, module, exports: module.exports, process: { env: environment },
      require: name => name.startsWith('.') ? load(new URL(moduleRequire.resolve(name), 'file:').pathname)
        : name === 'node:perf_hooks' && options.cacheClock ? { performance: { now: options.cacheClock } } : require(name) }, { filename: absolute });
    return module.exports;
  }
  return { lib: load('_lib/supabase.js'), load, calls, environment };
}
const liveJwt = (name = 'ec', opts = {}) => jwt(name, { now: Date.now(), ...opts });
function hsJwt(claims = {}) {
  const input = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ iss: issuer, aud: 'authenticated', role: 'authenticated', sub: subject, exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return input + '.' + createHmac('sha256', 'fixture-only-secret').update(input).digest('base64url');
}

test('actual Auth adapter verifies HS256 and discovery outage with the existing network path', async () => {
  for (const outage of [false, true]) {
    const f = networkFixture(async url => url.endsWith('/jwks.json') ? new Response('outage', { status: 503 }) : Response.json({ id: subject, email: 'current@example.com', email_confirmed_at: '2026-01-01' }));
    const token = outage ? liveJwt() : hsJwt();
    const identity = await f.lib.verifyAccessToken(token, { cachedIdentity: true }); assert.equal(identity.id, subject);
    assert.equal(identity.email, 'current@example.com');
    assert.deepEqual(f.calls.map(call => new URL(call.url).pathname), outage ? ['/auth/v1/.well-known/jwks.json', '/auth/v1/user'] : ['/auth/v1/user']);
    assert.equal(f.calls.at(-1).options.headers.Authorization, 'Bearer ' + token);
    if (outage) assert.equal(f.calls[0].options.headers.apikey, undefined, 'public key discovery sends no service credential');
  }
});

test('actual cached adapter denies invalid signatures/claims/unknown kids even if Auth would accept', async () => {
  const f = networkFixture(async url => url.endsWith('/jwks.json') ? Response.json({ keys: [jwk('ec')] }) : Response.json({ id: subject, email_confirmed_at: 'forbidden fallback' }));
  assert.equal((await f.lib.verifyAccessToken(liveJwt(), { cachedIdentity: true })).id, subject);
  for (const token of [liveJwt('rotated', { header: { kid: 'ec' } }), liveJwt('ec', { claims: { aud: 'anon' } }), liveJwt('ec', { header: { kid: 'absent' } })]) {
    assert.equal(await f.lib.verifyAccessToken(token, { cachedIdentity: true }), null);
  }
  assert.ok(f.calls.every(call => call.url.endsWith('/jwks.json')));
});

test('actual rotated-token requests use Auth throughout a failed-discovery cooldown, then return to local verification', async () => {
  let elapsed = 0, mode = 'original';
  const f = networkFixture(async url => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: subject });
    return mode === 'outage' ? new Response('outage', { status: 503 })
      : Response.json({ keys: mode === 'original' ? [jwk('ec')] : [jwk('ec'), jwk('rotated')] });
  }, { cacheClock: () => elapsed });
  const original = liveJwt(), rotated = liveJwt('rotated');
  assert.equal((await f.lib.verifyAccessToken(original, { cachedIdentity: true })).id, subject); mode = 'outage';
  for (const delta of [0, 4999, 1, 24999]) {
    elapsed += delta;
    assert.equal((await f.lib.verifyAccessToken(rotated, { cachedIdentity: true })).id, subject);
    assert.ok(f.calls.at(-1).url.endsWith('/auth/v1/user'));
    const calls = f.calls.length;
    assert.equal((await f.lib.verifyAccessToken(original, { cachedIdentity: true })).id, subject); assert.equal(f.calls.length, calls);
  }
  assert.equal(f.calls.filter(call => call.url.endsWith('/jwks.json')).length, 2);
  mode = 'rotated'; elapsed += 1;
  assert.equal((await f.lib.verifyAccessToken(rotated, { cachedIdentity: true })).id, subject);
  assert.ok(f.calls.at(-1).url.endsWith('/jwks.json')); assert.equal(f.calls.length, 7);
});

test('default/explicit fresh Auth never downgrades after rejection or outage despite a warm cached key', async () => {
  for (const status of [401, 403, 503]) {
    const f = networkFixture(async url => url.endsWith('/jwks.json') ? Response.json({ keys: [jwk('ec')] }) : new Response('{}', { status }));
    const token = liveJwt(); assert.equal((await f.lib.verifyAccessToken(token, { cachedIdentity: true })).id, subject);
    for (const options of [undefined, { freshUser: true }, { freshUser: true, cachedIdentity: true }]) {
      if (status === 503) await assert.rejects(f.lib.verifyAccessToken(token, options), error => error.message === 'supabase_auth_unavailable');
      else assert.equal(await f.lib.verifyAccessToken(token, options), null);
      assert.ok(f.calls.at(-1).url.endsWith('/auth/v1/user'));
    }
  }
});

function protectedRequest(route, token, method, body = {}) {
  return { method, url: '/api/' + route, query: {}, body, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } };
}
async function invoke(handler, request) {
  const headers = {}, response = { statusCode: 200, setHeader(name, value) { headers[name] = value; }, end(raw) { this.body = JSON.parse(raw); } };
  await handler(request, response); return response;
}

test('actual sensitive handlers fetch current Auth even with warm valid asymmetric identity', async () => {
  for (const [route, method, body] of [['account', 'DELETE', { confirm: 'DELETE' }], ['profile', 'POST', {}],
    ['fleets', 'POST', { company_name: 'Fleet' }], ['fleet-invitations', 'POST', { email: 'driver@example.com' }],
    ['accept-invitation', 'POST', { token: 'x'.repeat(43) }], ['fleet-followups', 'GET', {}],
    ['_lib/routes/billing-status', 'GET', {}], ['_lib/routes/billing-checkout', 'POST', { plan: 'starter' }], ['_lib/routes/billing-portal', 'POST', {}]]) {
    const token = liveJwt('ec', { claims: { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }], session_id: subject } });
    const f = networkFixture(async url => url.endsWith('/jwks.json') ? Response.json({ keys: [jwk('ec')] }) : new Response('{}', { status: 401 }));
    Object.assign(f.environment, { STRIPE_TEST_SECRET_KEY: 'sk_test_fixture', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_TEST_PRICE_STARTER: 'price_starter', STRIPE_TEST_PRICE_GROWTH: 'price_growth', STRIPE_TEST_PORTAL_CONFIGURATION_ID: 'bpc_fixture' });
    assert.equal((await f.lib.verifyAccessToken(token, { cachedIdentity: true })).id, subject);
    f.lib.pgFetch = async () => assert.fail('freshly rejected identity cannot reach storage');
    const req = protectedRequest(route, token, method, body); req.headers['idempotency-key'] = 'fixture-key-123456';
    const result = await invoke(f.load(route + '.js'), req);
    assert.equal(result.statusCode, 401, route);
    assert.ok(f.calls.at(-1).url.endsWith('/auth/v1/user'), route);
    assert.equal(f.calls.length, 2, 'fresh Auth denial cannot use or refresh cached identity');
  }
});

test('actual email gates reject editable confirmation metadata and profile refresh uses current Auth email', async () => {
  for (const route of ['fleets', 'fleet-invitations', 'accept-invitation', 'fleet-followups', '_lib/routes/billing-portal']) {
    const f = networkFixture(async url => { assert.ok(url.endsWith('/auth/v1/user')); return Response.json({ id: subject,
      email: 'current@example.com', user_metadata: { email_verified: true }, app_metadata: { email_verified: true } }); });
    Object.assign(f.environment, { STRIPE_TEST_SECRET_KEY: 'sk_test_fixture', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_TEST_PRICE_STARTER: 'price_starter', STRIPE_TEST_PRICE_GROWTH: 'price_growth', STRIPE_TEST_PORTAL_CONFIGURATION_ID: 'bpc_fixture' });
    f.lib.pgFetch = async () => assert.fail('metadata is not email confirmation');
    const result = await invoke(f.load(route + '.js'), protectedRequest(route, liveJwt(), 'POST'));
    assert.equal(result.statusCode, 403, route); assert.equal(result.body.error, 'email_not_verified');
  }
  const updates = [], f = networkFixture(async () => Response.json({ id: subject, email: 'current@example.com' }));
  f.lib.pgFetch = async (table, options = {}) => { assert.equal(table, 'drivers');
    if (!options.method) return [{ id: subject, user_id: subject, name: 'Saved', vehicle_id: 'TRK-7', active: false }];
    updates.push(options.body); return [{ id: subject, ...options.body }]; };
  const result = await invoke(f.load('profile.js'), protectedRequest('profile', liveJwt(), 'POST'));
  assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{ email: 'current@example.com' }]);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.endsWith('/auth/v1/user'));
});

test('actual account deletion preserves fresh Auth and the same-token recent-AMR gate', async () => {
  for (const recent of [false, true]) {
    const token = liveJwt('ec', { claims: { session_id: subject, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - (recent ? 0 : 601) }] } });
    const f = networkFixture(async (url, options) => {
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: subject, last_sign_in_at: new Date().toISOString() });
      assert.equal(url, issuer + '/admin/users/' + subject); assert.equal(options.method, 'DELETE'); return new Response(null, { status: 204 });
    });
    const result = await invoke(f.load('account.js'), protectedRequest('account', token, 'DELETE', { confirm: 'DELETE' }));
    assert.equal(result.statusCode, recent ? 200 : 401);
    if (!recent) assert.equal(result.body.error, 'reauth_required');
    assert.equal(f.calls.length, recent ? 2 : 1);
  }
});

test('actual id-only session start uses signed identity and current owned driver rows, without Auth profile', async () => {
  const f = networkFixture(async url => { assert.ok(url.endsWith('/jwks.json')); return Response.json({ keys: [jwk('ec')] }); });
  const queries = [];
  f.lib.pgFetch = async (table, options) => { queries.push({ table, options });
    if (table === 'drivers') { assert.equal(options.params.user_id, 'eq.' + subject); return [{ id: subject, fleet_id: null }]; }
    assert.equal(table, 'sessions'); assert.equal(options.method, 'POST'); assert.equal(options.body.driver_id, subject);
    assert.equal(options.body.fleet_id, null); return [{ id: subject, ...options.body }]; };
  const result = await invoke(f.load('sessions.js'), protectedRequest('sessions', liveJwt(), 'POST', { driver_id: 'forged', fleet_id: 'forged' }));
  assert.equal(result.statusCode, 200); assert.equal(queries.length, 2); assert.equal(f.calls.length, 1);
});

test('JWKS response streaming is capped at 64KiB and cancellation never blocks safe Auth fallback', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65536)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const f = networkFixture(async url => url.endsWith('/jwks.json') ? new Response(stream) : Response.json({ id: subject }));
  assert.equal((await f.lib.verifyAccessToken(liveJwt(), { cachedIdentity: true })).id, subject);
  assert.equal(cancelled, true); assert.equal(f.calls.length, 2); assert.ok(f.calls[1].url.endsWith('/auth/v1/user'));
});

function fakeBudget() {
  let elapsed = 0;
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../api/_lib/provider-budget.js', import.meta.url), 'utf8'), { module,
    require: name => name === 'node:perf_hooks' ? { performance: { now: () => elapsed } } : require(name), console: { error() {} } });
  return { lib: module.exports, set: value => { elapsed = value; }, response: () => ({ statusCode: 200, setHeader() {} }) };
}

test('coalesced JWKS waiters retain individual request deadlines without cancelling another refresh', async () => {
  const budget = fakeBudget(), timers = new Map(), gate = deferred(), discovery = deferred(); let next = 0;
  const f = networkFixture(async url => { assert.ok(url.endsWith('/jwks.json')); return discovery.promise; }, { budget: budget.lib,
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const token = liveJwt();
  const short = budget.lib.withProviderBudget(async () => { await gate.promise; return f.lib.verifyAccessToken(token, { cachedIdentity: true }); })({}, budget.response());
  budget.set(11800);
  const long = budget.lib.withProviderBudget(() => f.lib.verifyAccessToken(token, { cachedIdentity: true }))({}, budget.response());
  await tick(); assert.equal(f.calls.length, 1);
  budget.set(11950); gate.resolve(); await tick();
  const shortTimer = [...timers.values()].find(timer => timer.ms === 50); assert.ok(shortTimer);
  budget.set(12000); shortTimer.fn(); await assert.rejects(short, error => error.status === 504);
  assert.equal(f.calls[0].options.signal.aborted, false, 'one waiter cannot abort the shared refresh');
  discovery.resolve(Response.json({ keys: [jwk('ec')] })); assert.equal((await long).id, subject);
  await tick(); assert.equal(timers.size, 0); assert.equal(f.calls.length, 1);
});

test('abort-ignoring stalled JWKS headers/body still bound discovery and use only remaining Auth allowance', async () => {
  for (const phase of ['headers', 'body']) {
    const budget = fakeBudget(), timers = new Map(), late = deferred(); let next = 0, read = false;
    const f = networkFixture(async url => {
      if (url.endsWith('/auth/v1/user')) {
        assert.ok([...timers.values()].some(timer => timer.ms === 4000), 'Auth receives only the remaining four seconds');
        return Response.json({ id: subject });
      }
      if (phase === 'headers') return late.promise;
      return { ok: true, body: { getReader: () => ({ read: () => { read = true; return late.promise; }, cancel() {}, releaseLock() {} }) } };
    }, { budget: budget.lib, setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
    const pending = budget.lib.withProviderBudget(() => f.lib.verifyAccessToken(liveJwt(), { cachedIdentity: true }))({}, budget.response());
    await tick(); if (phase === 'body') assert.equal(read, true);
    const transportTimer = [...timers.values()].find(timer => timer.ms === 8000); assert.ok(transportTimer);
    budget.set(8000); transportTimer.fn(); assert.equal((await pending).id, subject);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].options.signal.aborted, true);
    late.resolve(phase === 'headers' ? Response.json({ keys: [jwk('ec')] }) : { done: true });
    await tick(); assert.equal(timers.size, 0);
  }
});

test('expired discovery keys are never used through an outage or a fresh Auth denial', async () => {
  let now = clockStart, healthy = true;
  const time = class extends Date { static now() { return now; } };
  const f = networkFixture(async url => url.endsWith('/jwks.json')
    ? healthy ? Response.json({ keys: [jwk('ec')] }) : new Response('outage', { status: 503 })
    : new Response('{}', { status: 401 }), { Date: time, cacheClock: () => now - clockStart });
  const token = jwt();
  assert.equal((await f.lib.verifyAccessToken(token, { cachedIdentity: true })).id, subject);
  now += 600000; healthy = false;
  assert.equal(await f.lib.verifyAccessToken(token, { cachedIdentity: true }), null);
  assert.equal(await f.lib.verifyAccessToken(token, { cachedIdentity: true }), null);
  assert.deepEqual(f.calls.map(call => new URL(call.url).pathname), [
    '/auth/v1/.well-known/jwks.json', '/auth/v1/.well-known/jwks.json', '/auth/v1/user', '/auth/v1/user',
  ], 'outage backoff reuses neither the expired key nor a previously accepted user');
});
