import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const OWNER = '11111111-1111-4111-8111-111111111111', FLEET = '22222222-2222-4222-8222-222222222222';
const hash = value => createHash('sha256').update(value).digest('hex');
const pref = 'fleet-digest-preferences', unsub = 'fleet-digest-unsubscribe';
const ok = { ok: true };
process.env.SUPABASE_URL = 'https://fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';

function harness(t, { owner = true, authenticated = true, limited = false, race = false } = {}) {
  const storage = require('../api/_lib/supabase');
  let tokenHash = null, newer = null;
  const calls = [], auth = [];
  t.mock.method(storage, 'verifyAccessToken', async (token, options) => {
    auth.push({ token, options });
    return authenticated && token === 'fixture' ? { id: OWNER } : null;
  });
  t.mock.method(storage, 'pgFetch', async (table, options) => {
    calls.push({ table, options });
    if (table === 'fleets') {
      assert.deepEqual(options.params, { select: 'id,fleet_digest_preferences(weekly_enabled)', owner_user_id: 'eq.' + OWNER, limit: '1' });
      return owner ? [{ id: FLEET, fleet_digest_preferences: tokenHash ? { weekly_enabled: true } : null }] : [];
    }
    if (table === 'rpc/reserve_account_write') {
      assert.deepEqual(options.body, { p_user_id: OWNER, p_operation: 'fleet' });
      return { allowed: !limited, user_id: OWNER, operation: 'fleet',
        ...(limited ? { error: 'account_write_rate_limited', retry_after: 29 } : {}) };
    }
    if (table === 'rpc/set_fleet_digest_preference') {
      assert.equal(options.body.p_actor_id, OWNER);
      assert.equal(options.body.p_fleet_id, FLEET);
      if (race) return null;
      tokenHash = options.body.p_token_hash;
      return options.body.p_enabled;
    }
    assert.equal(table, 'fleet_digest_preferences');
    assert.equal(options.params.weekly_enabled, 'eq.true');
    if (options.method !== 'PATCH') {
      const previousHash = tokenHash;
      if (newer) { tokenHash = newer; newer = null; }
      return previousHash && options.params.unsubscribe_token_hash === 'eq.' + previousHash
        ? [{ fleet_id: FLEET, unsubscribe_token_hash: previousHash }] : [];
    }
    assert.equal(options.params.fleet_id, 'eq.' + FLEET);
    assert.equal(options.params.select, 'weekly_enabled');
    assert.equal(options.body.weekly_enabled, false);
    assert.equal(options.body.unsubscribe_token_hash, null);
    if (tokenHash && options.params.unsubscribe_token_hash === 'eq.' + tokenHash) tokenHash = null;
    return [];
  });
  for (const file of ['../api/_lib/routes/' + pref, '../api/_lib/routes/' + unsub, '../api/[endpoint]']) delete require.cache[require.resolve(file)];
  const dispatch = require('../api/[endpoint]');
  async function invoke(path, method = 'GET', body, query = '', media = 'application/json') {
    const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      end(value) { this.body = JSON.parse(value); } };
    await dispatch({ url: '/api/' + path + query, method, body, headers: { authorization: 'Bearer fixture', 'content-type': media } }, response);
    assert.equal(response.headers['cache-control'], 'no-store');
    if (path === pref) assert.equal(response.headers.vary, 'Authorization');
    return response;
  }
  return { invoke, calls, auth, current: () => tokenHash, rotateDuringLookup: value => { newer = value; } };
}

test('owner opts in, rotates and disables; GET only reveals the boolean', async t => {
  const app = harness(t);
  assert.deepEqual((await app.invoke(pref)).body, { ...ok, weekly_enabled: false });
  const enable = () => app.invoke(pref, 'POST', { weekly_enabled: true });
  const first = (await enable()).body.unsubscribe_token;
  assert.match(first, /^[a-zA-Z0-9_-]{43}$/);
  assert.equal(app.current(), hash(first));
  const second = (await enable()).body.unsubscribe_token;
  assert.notEqual(first, second);
  assert.deepEqual((await app.invoke(pref)).body, { ...ok, weekly_enabled: true });
  assert.deepEqual((await app.invoke(pref, 'POST', { weekly_enabled: false })).body, { ...ok, weekly_enabled: false });
  assert.equal(app.current(), null);
  assert.equal(JSON.stringify(app.calls).includes(first), false);
  assert.deepEqual(app.auth.map(x => x.options.cachedIdentity), [true, false, false, true, false]);
});

test('strict bodies, media and queries reject caller-supplied identity and never reserve a write', async t => {
  const app = harness(t);
  for (const invalid of [{}, { weekly_enabled: 1 }, { weekly_enabled: 'true' }, { weekly_enabled: null },
    { weekly_enabled: true, fleet_id: FLEET }, { weekly_enabled: false, token: 'fixture' }]) {
    assert.equal((await app.invoke(pref, 'POST', invalid)).statusCode, 400);
  }
  assert.equal((await app.invoke(pref, 'POST', [], '')).statusCode, 415);
  assert.equal((await app.invoke(pref, 'POST', { weekly_enabled: true }, '', 'text/plain')).statusCode, 415);
  assert.equal((await app.invoke(pref, 'GET', undefined, '?fleet_id=' + FLEET)).statusCode, 400);
  assert.equal((await app.invoke(pref, 'PUT')).statusCode, 405);
  assert.equal(app.calls.length, 0);
});

for (const [name, options, status] of [['anonymous', { authenticated: false }, 401], ['member', { owner: false }, 403]]) {
  test(name + ' cannot read or change fleet digest preferences', async t => {
    const app = harness(t, options);
    for (const method of ['GET', 'POST']) assert.equal((await app.invoke(pref, method, { weekly_enabled: true })).statusCode, status);
    assert.equal(app.calls.some(c => c.table.startsWith('rpc/')), false);
  });
}

test('quota exhaustion prevents writes and ownership is rechecked by the mutation', async t => {
  await t.test('limited', async t => {
    const app = harness(t, { limited: true });
    const res = await app.invoke(pref, 'POST', { weekly_enabled: true });
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['retry-after'], '29');
    assert.equal(app.calls.some(c => c.table === 'rpc/set_fleet_digest_preference'), false);
  });
  await t.test('lost ownership', async t => {
    const app = harness(t, { race: true });
    assert.equal((await app.invoke(pref, 'POST', { weekly_enabled: true })).statusCode, 403);
  });
});

test('unknown, malformed, superseded, matched and reused tokens share one result; lookup never sends tokens to storage', async t => {
  const app = harness(t);
  const enable = async () => (await app.invoke(pref, 'POST', { weekly_enabled: true })).body.unsubscribe_token;
  const old = await enable(), token = await enable();
  for (const value of ['bad', 'A'.repeat(43), old, token, token]) {
    const res = await app.invoke(unsub, 'POST', { token: value });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, ok);
    if (value !== token) assert.equal(app.current(), hash(token));
  }
  assert.equal(app.current(), null);
  assert.equal(app.calls.filter(c => c.options.method === 'PATCH').length, 1);
  assert.equal(JSON.stringify(app.calls).includes(token), false);
  assert.equal(app.auth.length, 2);
  assert.equal((await app.invoke(unsub, 'GET')).statusCode, 405);
  assert.equal((await app.invoke(unsub, 'POST', { token }, '?token=invalid')).statusCode, 400);
  assert.equal((await app.invoke(unsub, 'POST', { token, fleet_id: FLEET })).statusCode, 400);
});

test('an overlapping opt-in survives a previously valid unsubscribe', async t => {
  const app = harness(t);
  const { unsubscribe_token: old } = (await app.invoke(pref, 'POST', { weekly_enabled: true })).body;
  const fresh = hash('new random choice');
  app.rotateDuringLookup(fresh);
  assert.deepEqual((await app.invoke(unsub, 'POST', { token: old })).body, ok);
  assert.equal(app.current(), fresh);
});
