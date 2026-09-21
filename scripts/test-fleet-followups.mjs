import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = require.resolve('../api/_lib/supabase');
const path = require.resolve('../api/fleet-followups');
const owner = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.invalid', email_confirmed_at: '2026-09-01' };
const session = '33333333-3333-4333-8333-333333333333';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
let user = owner, calls = [], rpcResult = [], failure = null, fleet = [{ id: 'fleet-owned' }];
require.cache[lib] = { id: lib, filename: lib, loaded: true, exports: {
  verifyAccessToken: async () => user, bearerToken: () => 'fixture',
  pgFetch: async (table, options) => {
    calls.push({ table, options });
    if (failure) throw failure;
    if (table === 'fleets') return fleet;
    if (table === 'sessions') return [{ id: session, driver_id: 'driver', started_at: '2026-09-01', alert_count: 1 }];
    if (table === 'drivers') return [{ id: 'driver', name: '<script>Driver</script>' }];
    if (table === 'fleet_session_followups') return [];
    if (table.startsWith('rpc/')) return rpcResult;
    throw new Error('Unexpected table');
  },
} };
delete require.cache[path];
const handler = require(path);
async function invoke(method, body) {
  calls = [];
  const headers = {};
  const response = { setHeader: (key, value) => { headers[key] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler({ method, body, headers: { 'content-type': 'application/json' } }, response);
  return { status: response.statusCode, body: response.body, headers };
}
user = null;
assert.equal((await invoke('GET')).status, 401);
assert.equal(calls.length, 0);
user = { ...owner, email_confirmed_at: null };
assert.equal((await invoke('POST')).status, 403);
user = owner;
fleet = [];
assert.equal((await invoke('GET')).status, 403);
fleet = [{ id: 'fleet-owned' }];
const loaded = await invoke('GET');
assert.equal(loaded.status, 200);
assert.equal(loaded.headers['Cache-Control'], 'no-store');
assert.equal(loaded.body.sessions[0].followup.version, 0);
assert.equal(calls.find(call => call.table === 'fleets').options.params.owner_user_id, 'eq.' + owner.id);
assert.equal(calls.find(call => call.table === 'sessions').options.params.fleet_id, 'eq.fleet-owned');
assert.equal(calls.find(call => call.table === 'fleet_session_followups').options.params.session_id, 'in.(' + session + ')');
const valid = { session_id: session, status: 'reviewed', expected_version: 0 };
for (const invalid of [{ ...valid, actor_id: 'other' }, { ...valid, expected_version: -1 }, { ...valid, status: 'safe' }, { ...valid, session_id: 'id' }, []]) {
  assert.equal((await invoke('POST', invalid)).status, 400);
  assert.ok(!calls.some(call => call.table.startsWith('rpc/')));
}
assert.equal((await invoke('POST', valid)).status, 409);
rpcResult = [{ session_id: session, status: 'reviewed', version: 1, updated_at: 'now', updated_by: owner.id }];
const saved = await invoke('POST', valid);
assert.equal(saved.status, 200);
assert.equal(saved.body.followup.updated_by, undefined);
assert.equal(calls.at(-1).options.body.p_actor_id, owner.id);
for (const [code, status] of [['P0002', 404], ['42P01', 503], ['PGRST202', 503], ['unexpected', 502]]) {
  failure = { details: { code } };
  assert.equal((await invoke('POST', valid)).status, status);
}
console.log('Fleet follow-up API passed: authentication, owner scoping, validation, conflicts, and rollout failures.');
