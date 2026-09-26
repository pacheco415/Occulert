import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../api/_lib/supabase.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.com', email_confirmed_at: '2026-01-01' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function boot(fetch) {
  const timers = new Map(), calls = []; let next = 0;
  const context = { module: { exports: {} }, process: { env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role' } }, URL, AbortController,
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    fetch(url, options) { calls.push({ url: String(url), options }); return fetch(url, options); },
  };
  vm.runInNewContext(source, context);
  return { lib: context.module.exports, context, timers, calls, expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } } };
}

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

for (const filename of ['account', 'accept-invitation', 'events', 'fleet-followups', 'fleet-invitations', 'fleet-summary', 'fleets', 'profile', 'sessions']) test(`${filename} returns a finite JSON upstream failure instead of 401 or an unhandled rejection`, async () => {
  const b = boot(() => json({ error: 'fixture-outage' }, 503));
  const route = readFileSync(new URL(`../api/${filename}.js`, import.meta.url), 'utf8');
  const routeContext = { ...b.context, module: { exports: {} }, require: name => name === './_lib/supabase' ? b.lib : require(name) };
  vm.runInNewContext(route, routeContext);
  const request = { method: filename === 'account' ? 'DELETE' : ['profile', 'events', 'sessions', 'accept-invitation'].includes(filename) ? 'POST' : 'GET', headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' }, body: { confirm: 'DELETE' }, query: {} };
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
  await routeContext.module.exports(request, response);
  assert.equal(response.statusCode, 502); assert.equal(response.body.ok, false); assert.equal(response.headers['Cache-Control'], 'no-store'); assert.equal(b.calls.length, 1);
});
