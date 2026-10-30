import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../api/_lib/supabase.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.com', email_confirmed_at: '2026-01-01' };
function legacyToken() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:user.id,iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',session_id:user.id,amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}],exp:Math.floor(Date.now()/1000)+3600});
  return input+'.'+createHmac('sha256','fixture-only-secret').update(input).digest('base64url');
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function boot(fetch) {
  const timers = new Map(), calls = []; let next = 0;
  const context = { Buffer, require: createRequire(new URL('../api/_lib/supabase.js', import.meta.url)), module: { exports: {} }, process: { env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role' } }, URL, AbortController,
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    fetch(url, options) { calls.push({ url: String(url), options }); return fetch(url, options); },
  };
  vm.runInNewContext(source, context);
  return { lib: context.module.exports, context, timers, calls, expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } } };
}

test('storage configuration exposes only a Boolean and never makes a network request', () => {
  const b = boot(() => assert.fail('a presence check must not contact Auth or PostgREST'));
  assert.equal(b.lib.serverStorageConfigured(), true);
  delete b.context.process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(b.lib.serverStorageConfigured(), false);
  b.context.process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  assert.equal(b.lib.serverStorageConfigured(), false);
  b.context.process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role';
  delete b.context.process.env.SUPABASE_URL;
  assert.equal(b.lib.serverStorageConfigured(), false);
  assert.equal(b.calls.length, 0);
});

for (const status of [400, 401, 403, 429, 500, 503]) test(`token verification distinguishes status ${status} from confirmed invalid credentials`, async () => {
  const b = boot(() => json({ error: 'fixture-upstream' }, status));
  if ([400, 401, 403].includes(status)) assert.equal(await b.lib.verifyAccessToken('fixture-token'), null);
  else await assert.rejects(b.lib.verifyAccessToken('fixture-token'), error => error.message === 'supabase_auth_unavailable' && error.status === status);
  assert.equal(b.timers.size, 0);
});

test('successful token verification requires a valid complete user object', async () => {
  const b = boot(() => json(user)); assert.deepEqual(JSON.parse(JSON.stringify(await b.lib.verifyAccessToken('fixture-token'))), user);
  assert.equal(await b.lib.verifyAccessToken(null), null); assert.equal(b.calls.length, 1);
  for (const body of [{}, { id: null }, 'invalid']) { const malformed = boot(() => json(body)); await assert.rejects(malformed.lib.verifyAccessToken('fixture-token')); }
});

for (const operation of ['verifyAccessToken', 'pgFetch', 'deleteAuthUser']) {
  for (const phase of ['headers', 'body']) test(`${operation} deadline bounds ${phase}, aborts and ignores late completion`, async () => {
    const late = deferred(); let stream;
    const b = boot(() => phase === 'headers' ? late.promise : new Response(new ReadableStream({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('{')); } })));
    const pending = operation === 'pgFetch' ? b.lib.pgFetch('drivers', { method: 'POST', body: { name: 'fixture' } }) : b.lib[operation]('fixture');
    const rejected = assert.rejects(pending, error => error.message === 'supabase_unavailable' && error.status === 504);
    await tick(); assert.equal(b.timers.size, 1); assert.equal([...b.timers.values()][0].ms, 8000); b.expire(); await rejected;
    assert.equal(b.calls[0].options.signal.aborted, true); assert.equal(b.calls.length, 1, 'mutations are never retried automatically');
    if (phase === 'headers') late.resolve(json(user)); else { stream.enqueue(new TextEncoder().encode('}')); stream.close(); }
    await tick(); assert.equal(b.timers.size, 0);
  });
}

test('PostgREST preserves database error details for explicit route mappings and deletion reads its complete response', async () => {
  const b = boot(() => json({ code: '23505', message: 'fixture-conflict' }, 409));
  await assert.rejects(b.lib.pgFetch('drivers'), error => error.status === 409 && error.details.code === '23505');
  const deletion = boot(() => new Response(null, { status: 204 })); await deletion.lib.deleteAuthUser(user.id); assert.equal(deletion.timers.size, 0);
});

test('PostgREST keeps an HTML outage status without returning gateway content', async () => {
  const b = boot(() => new Response('<html>private gateway diagnostics</html>', { status: 503 }));
  await assert.rejects(b.lib.pgFetch('drivers'), error => {
    assert.equal(error.message, 'supabase_request_failed');
    assert.equal(error.provider, 'supabase');
    assert.equal(error.status, 503);
    assert.equal(error.details, null);
    assert.doesNotMatch(JSON.stringify(error), /private gateway/);
    return true;
  });
  assert.equal(b.calls.length, 1);
  assert.equal(b.timers.size, 0);
});

test('PostgREST refuses a streamed oversized body and cancels before reading the rest', async () => {
  let reads = 0, cancelled = false, released = false;
  const b = boot(() => ({ ok: true, status: 200, headers: new Headers(), body: { getReader() { return {
    async read() { reads++; return { done: false, value: Buffer.alloc(1024 * 1024, 32) }; },
    async cancel() { cancelled = true; }, releaseLock() { released = true; },
  }; } }, text() { assert.fail('a stream must never use the unbounded text reader'); } }));
  await assert.rejects(b.lib.pgFetch('drivers'), error => error.message === 'supabase_response_too_large' && error.provider === 'supabase');
  assert.equal(reads, 3, 'stop at the first chunk beyond the 2 MiB cap');
  assert.equal(cancelled, true);
  assert.equal(released, true);
  assert.equal(b.calls.length, 1);
  assert.equal(b.timers.size, 0);
});

test('successful malformed PostgREST JSON is a typed invalid response', async () => {
  const b = boot(() => new Response('<html>private upstream page</html>'));
  await assert.rejects(b.lib.pgFetch('drivers'), error => error.message === 'supabase_invalid_response' && error.provider === 'supabase' && !error.details);
});

for (const status of [200, 503]) test(`advertised oversized HTTP ${status} is rejected before consuming its body`, async () => {
  let cancelled = false;
  const b = boot(() => ({ ok: status === 200, status, headers: new Headers({ 'content-length': String(2 * 1024 * 1024 + 1) }),
    body: { cancel() { cancelled = true; }, getReader() { assert.fail('advertised excess needs no body read'); } },
    text() { assert.fail('advertised excess needs no buffering'); },
  }));
  await assert.rejects(b.lib.pgFetch('drivers'), error => error.message === 'supabase_response_too_large'
    && error.provider === 'supabase' && error.status === (status === 200 ? undefined : status));
  assert.equal(cancelled, true);
  assert.equal(b.calls[0].options.signal.aborted, true);
  assert.equal(b.timers.size, 0);
});

test('PostgREST accepts a complete roster larger than the smaller Auth cap', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `driver-${i}`, name: 'A'.repeat(160) }));
  assert.ok(Buffer.byteLength(JSON.stringify(rows)) > 64 * 1024);
  const b = boot(() => json(rows));
  assert.deepEqual(JSON.parse(JSON.stringify(await b.lib.pgFetch('drivers'))), rows);
});

test('PostgREST counts streamed UTF-8 bytes rather than characters and cancels an oversized HTTP 503', async () => {
  let cancelled = false, reads = 0;
  const b = boot(() => ({ ok: false, status: 503, headers: new Headers({ 'content-length': '1' }), body: { getReader() { return {
    async read() { reads++; return { done: false, value: Buffer.from('é'.repeat(1024 * 1024 + 1)) }; },
    cancel() { cancelled = true; }, releaseLock() {},
  }; } } }));
  await assert.rejects(b.lib.pgFetch('drivers'), error => error.message === 'supabase_response_too_large' && error.status === 503);
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
});

for (const operation of ['verifyAccessToken', 'pgFetch', 'deleteAuthUser']) {
  test(`${operation} tags a response-body network failure as unavailable without leaking it`, async () => {
    const b = boot(() => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private transport failure')); } })));
    await assert.rejects(b.lib[operation]('fixture'), error => error.message === 'supabase_unavailable' && error.provider === 'supabase' && error.status === 503);
    assert.equal(b.calls.length, 1);
    assert.equal(b.timers.size, 0);
  });
}

for (const operation of ['verifyAccessToken', 'deleteAuthUser']) test(`${operation} caps Auth bodies at 64 KiB`, async () => {
  let reads = 0, cancelled = false;
  const b = boot(() => ({ ok: true, status: 200, body: { getReader() { return {
    async read() { reads++; return { done: false, value: Buffer.alloc(32 * 1024, 32) }; },
    cancel() { cancelled = true; }, releaseLock() {},
  }; } } }));
  await assert.rejects(b.lib[operation]('fixture'), error => error.message === 'supabase_response_too_large');
  assert.equal(reads, 3);
  assert.equal(cancelled, true);
});

function loadRoute(filename, b) {
  const file = filename instanceof URL ? filename : new URL(`../${filename}`, import.meta.url);
  const routeRequire = createRequire(file), module = { exports: {} };
  vm.runInNewContext(readFileSync(file, 'utf8'), { ...b.context, module, require(name) {
    if (name.endsWith('/supabase')) return b.lib;
    if (name.endsWith('/billing-test') || name.endsWith('/stripe-test')) {
      return loadRoute(new URL(name + '.js', file), b);
    }
    return routeRequire(name);
  } });
  return module.exports;
}

const failures = [
  ['HTML 503', 503, () => new Response('<html>private gateway diagnostics</html>', { status: 503 })],
  ['JSON 500', 503, () => json({ message: 'private database diagnostics' }, 500)],
  ['HTTP 504', 504, () => new Response('gateway deadline', { status: 504 })],
  ['unreachable', 503, () => { throw new TypeError('private unreachable host'); }],
  ['deadline', 504, () => new Promise(() => {})],
  ['malformed success', 502, () => new Response('private malformed response')],
  ['oversized success', 502, () => new Response(' '.repeat(2 * 1024 * 1024 + 1))],
];
const routes = ['account', 'accept-invitation', 'events', 'fleet-followups', 'fleet-invitations', 'fleet-summary', 'fleets', 'profile', 'sessions',
  '_lib/routes/fleet-session-history', '_lib/routes/fleet-period-report', '_lib/routes/billing-status'];
for (const filename of routes) for (const phase of ['auth', 'database']) for (const [kind, status, fail] of failures) {
  test(`${filename} maps ${phase} ${kind} to ${status} with no retries`, async () => {
    let calls = 0, writes = 0;
    const b = boot(() => phase === 'database' && calls++ === 0 ? json(user) : fail());
    Object.assign(b.context.process.env, { STRIPE_TEST_SECRET_KEY: 'sk_test_Fixture', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_Fixture',
      STRIPE_TEST_PRICE_STARTER: 'price_Start', STRIPE_TEST_PRICE_GROWTH: 'price_Growth' });
    const handler = loadRoute(`api/${filename}.js`, b);
    const request = { method: filename === 'account' ? 'DELETE' : ['profile', 'events', 'sessions', 'accept-invitation'].includes(filename) ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + legacyToken(), 'content-type': 'application/json' },
      body: { confirm: 'DELETE', session_id: user.id, type: 'drowsy', token: 'a'.repeat(32) }, query: filename.endsWith('fleet-period-report') ? { days: '7' } : {} };
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { writes++; this.body = JSON.parse(value); } };
    const pending = handler(request, response);
    if (kind === 'deadline') { await tick(); b.expire(); }
    await pending;
    assert.equal(response.statusCode, status);
    assert.equal(response.body.ok, false);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(JSON.stringify(response.body), /private|gateway|diagnostics|fixture-service-role/);
    assert.equal(b.calls.length, phase === 'auth' ? 1 : 2);
    assert.equal(writes, 1);
    assert.equal(b.timers.size, 0);
  });
}

for (const operation of ['account deletion', 'fleet conflict recovery']) for (const [kind, status, fail] of failures) {
  // Admin deletion confirms success by HTTP status and also accepts empty 204.
  if (operation === 'account deletion' && kind === 'malformed success') continue;
  test(`${operation} preserves a later ${kind} failure without repeating a mutation`, async () => {
    let calls = 0;
    const b = boot(() => {
      calls++;
      if (calls === 1) return json(user);
      if (calls === 2) return json([]);
      if (operation === 'fleet conflict recovery' && calls === 3) return json({ code: '23505' }, 409);
      return fail();
    });
    const account = operation === 'account deletion';
    const handler = loadRoute(account ? 'api/account.js' : 'api/fleets.js', b);
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
    const pending = handler({ method: account ? 'DELETE' : 'POST',
      headers: { authorization: 'Bearer ' + legacyToken(), 'content-type': 'application/json' },
      body: account ? { confirm: 'DELETE' } : { company_name: 'Fixture Fleet' },
    }, response);
    if (kind === 'deadline') { await tick(); b.expire(); }
    await pending;
    assert.equal(response.statusCode, status);
    assert.equal(response.body.error, account ? 'account_deletion_failed' : 'supabase_error');
    assert.equal(b.calls.length, account ? 3 : 4);
    assert.equal(b.calls.filter(call => ['POST', 'DELETE', 'PATCH'].includes(call.options.method)).length, 1);
    assert.equal(b.timers.size, 0);
  });
}

for (const phase of ['rate limit', 'storage']) for (const [kind, status, fail] of failures) {
  test(`pilot leads maps ${phase} ${kind} to ${status} without another contact destination`, async () => {
    let calls = 0;
    const b = boot(() => phase === 'storage' && calls++ === 0 ? json([{ allowed: true }]) : fail());
    b.context.process.env.PILOT_LEADS_WEBHOOK_URL = 'https://private.example.invalid/contact';
    const handler = loadRoute('api/pilot-leads.js', b);
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
    const pending = handler({ method: 'POST', headers: { origin: 'https://www.occulert.com', 'content-type': 'application/json' }, body: {
      name: 'Fixture Driver', company: 'Fixture Fleet', email: 'fixture@example.invalid', startedAt: new Date(Date.now() - 3000).toISOString(), website: '',
    } }, response);
    if (kind === 'deadline') { await tick(); b.expire(); }
    await pending;
    assert.equal(response.statusCode, status);
    assert.equal(response.body.error, phase === 'rate limit' ? 'rate_limit_unavailable' : 'storage_unavailable');
    assert.equal(b.calls.length, phase === 'rate limit' ? 1 : 2);
    assert.ok(b.calls.every(call => new URL(call.url).hostname === 'example.supabase.co'));
    assert.equal(b.timers.size, 0);
  });
}
