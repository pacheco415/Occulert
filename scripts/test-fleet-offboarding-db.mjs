import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';
const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333', driver = '44444444-4444-4444-8444-444444444444';
const fleet = '55555555-5555-4555-8555-555555555555', next = '66666666-6666-4666-8666-666666666666';
const session = '77777777-7777-4777-8777-777777777777', later = '88888888-8888-4888-8888-888888888888';
const foreign = '99999999-9999-4999-8999-999999999999';
const startQuery = 'select start_offboarding_aware_session($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text) as result';
const startArgs = (id = session) => [user, id, 'phone', 'browser', 'web_mediapipe_ear', 'test-1', 'web-test'];
function bootRoute(path, supabase, env) {
  const module = { exports: {} };
  vm.runInNewContext(read(path), { URL, module, process: { env }, require: name => {
    if (name.endsWith('/supabase')) return supabase;
    const prefix = path.startsWith('api/_lib/routes/') ? '../api/_lib/routes/' : '../api/';
    return require(prefix + name);
  } });
  return module.exports;
}
async function invoke(handler, method, path, body, extra = {}) {
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
  await handler({ method, url: path, query: {}, headers: { 'content-type': 'application/json' }, body, ...extra }, response);
  return response;
}

test('canonical offboarding migration preserves membership/session semantics and denies browser roles', async t => {
  const db = new PGlite();
  let actor = owner;
  const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', OCCULERT_FLEET_OFFBOARDING_ENABLED: 'true' };
  const start = async args => (await db.query(startQuery, args || startArgs())).rows[0].result;
  const supabase = { bearerToken: () => 'fixture', verifyAccessToken: async () => ({ id: actor }), pgFetch: async (table, options) => {
    const b = options?.body;
    if (table === 'drivers') return (await db.query('select id,fleet_id from drivers where user_id=$1', [actor])).rows;
    if (table === 'rpc/remove_fleet_driver') return (await db.query('select remove_fleet_driver($1::uuid,$2::uuid,$3::uuid) as result', [b.p_owner_user_id, b.p_driver_id, b.p_expected_fleet_id])).rows[0].result;
    if (table === 'rpc/leave_fleet') return (await db.query('select leave_fleet($1::uuid,$2::uuid) as result', [b.p_user_id, b.p_expected_fleet_id])).rows[0].result;
    assert.equal(table, 'rpc/start_offboarding_aware_session');
    return start([b.p_user_id, b.p_session_id, b.p_device, b.p_browser, b.p_detector_pipeline, b.p_detector_version, b.p_app_version]);
  } };
  const route = bootRoute('api/_lib/routes/fleet-offboarding.js', supabase, env);
  const sessions = bootRoute('api/sessions.js', supabase, env);
  try {
    await initializeTestSchema(db);
    await db.exec('grant usage on schema public to anon,authenticated,service_role');
    await t.test('no-default-grant catalog and actual client denial', async () => {
      for (const role of ['anon', 'authenticated']) {
        const { rows: [acl] } = await db.query(`select has_table_privilege($1,'fleet_membership_removals','SELECT,INSERT,UPDATE,DELETE') as table_access,
          has_function_privilege($1,'remove_fleet_driver(uuid,uuid,uuid)','EXECUTE') as remove,
          has_function_privilege($1,'leave_fleet(uuid,uuid)','EXECUTE') as leave,
          has_function_privilege($1,'start_offboarding_aware_session(uuid,uuid,text,text,text,text,text)','EXECUTE') as start`, [role]);
        assert.deepEqual(acl, { table_access: false, remove: false, leave: false, start: false });
        await db.exec(`set role ${role}`);
        await assert.rejects(db.query('select remove_fleet_driver($1::uuid,$2::uuid,$3::uuid)', [owner, driver, fleet]), /permission denied/);
        await assert.rejects(db.query('select leave_fleet($1::uuid,$2::uuid)', [user, fleet]), /permission denied/);
        await assert.rejects(start(), /permission denied/);
        await db.exec('reset role');
      }
      const publicExecution = await db.query(`select p.proname from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.proname in ('remove_fleet_driver','leave_fleet','start_offboarding_aware_session')
          and acl.grantee=0 and acl.privilege_type='EXECUTE'`);
      assert.deepEqual(publicExecution.rows, [], 'PUBLIC cannot execute any offboarding RPC');
      const { rows: [acl] } = await db.query(`select has_table_privilege('service_role','fleet_membership_removals','SELECT') as read,
        has_table_privilege('service_role','fleet_membership_removals','INSERT') as insert,
        has_table_privilege('service_role','fleet_membership_removals','UPDATE') as update,
        has_table_privilege('service_role','fleet_membership_removals','DELETE') as delete`);
      assert.deepEqual(acl, { read: true, insert: true, update: true, delete: true });
    });
    await db.exec(`insert into auth.users values('${owner}'),('${other}'),('${user}');
      insert into fleets(id,owner_user_id,company_name) values('${fleet}','${owner}','First'),('${next}','${other}','Next');
      insert into drivers(id,user_id,fleet_id,name) values('${driver}','${user}','${fleet}','Fixture');`);
    await db.exec('set role service_role');
    let initial;
    await t.test('start and owned replay preserve all supplied fields and session identity', async () => {
      actor = user;
      const response = await invoke(sessions, 'POST', '/api/sessions', { session_id: session, fleet_id: next, driver_id: other,
        device: 'phone', browser: 'browser', detector_pipeline: 'web_mediapipe_ear', detector_version: 'test-1', app_version: 'web-test' });
      assert.equal(response.statusCode, 200); initial = response.body.session;
      assert.equal(initial.fleet_id, fleet); assert.equal(initial.driver_id, driver);
      assert.equal(initial.device, 'phone'); assert.equal(initial.browser, 'browser');
      assert.equal(initial.detector_pipeline, 'web_mediapipe_ear'); assert.equal(initial.detector_version, 'test-1'); assert.equal(initial.app_version, 'web-test');
      assert.ok(Number.isFinite(Date.parse(initial.started_at)));
      assert.deepEqual((await start(startArgs().map((v, i) => i === 2 ? 'changed' : v))).session, initial);
      assert.equal(response.headers['Cache-Control'], 'no-store');
    });
    await t.test('owner authority, confirmation, removal audit and active/history preservation', async () => {
      actor = other;
      assert.equal((await invoke(route, 'DELETE', '/api/fleet-drivers', { driver_id: driver, fleet_id: next, confirm: true })).statusCode, 404);
      actor = owner;
      assert.equal((await invoke(route, 'DELETE', '/api/fleet-drivers', { driver_id: driver, fleet_id: next, confirm: true })).statusCode, 409, 'stale displayed fleet cannot authorize a replacement fleet');
      assert.equal((await invoke(route, 'DELETE', '/api/fleet-drivers', { driver_id: driver })).statusCode, 400);
      assert.equal((await invoke(route, 'DELETE', '/api/fleet-drivers', { driver_id: driver, fleet_id: fleet, confirm: true, owner_user_id: other })).statusCode, 200);
      assert.deepEqual((await db.query('select fleet_id,active,name from drivers')).rows[0], { fleet_id: null, active: true, name: 'Fixture' });
      assert.equal((await db.query('select fleet_id from sessions where id=$1', [session])).rows[0].fleet_id, fleet);
      assert.equal((await start()).session.fleet_id, fleet, 'replay does not re-scope an existing session');
      assert.equal((await start(startArgs(later))).session.fleet_id, null, 'subsequent start uses current detached membership');
      await db.query('insert into events(session_id,type) values($1,$2)', [session, 'drowsy']);
      assert.equal((await db.query('select s.fleet_id from events e join sessions s on s.id=e.session_id')).rows[0].fleet_id, fleet,
        'later events of an already running session remain associated with its original fleet');
    });
    await t.test('new invitation, stale leave guard, repeat leave and actor identity', async () => {
      await db.query(`insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at) values($1,'fixture@example.com',$2,$3,clock_timestamp()+interval '1 day')`, [next, 'a'.repeat(64), other]);
      const accepted = (await db.query('select accept_fleet_invitation($1,$2::uuid,$3) as result', ['a'.repeat(64), user, 'fixture@example.com'])).rows[0].result;
      assert.equal(accepted.fleet_id, next);
      actor = user;
      assert.equal((await invoke(route, 'GET', '/api/fleet-membership')).body.membership.fleet_id, next);
      assert.equal((await invoke(route, 'POST', '/api/fleet-membership', { confirm: true, fleet_id: fleet })).statusCode, 409);
      assert.equal((await invoke(route, 'POST', '/api/fleet-membership', { confirm: true, fleet_id: next, user_id: owner })).body.left, true);
      assert.equal((await invoke(route, 'POST', '/api/fleet-membership', { confirm: true, fleet_id: next })).body.left, false);
      const audit = (await db.query('select removed_by,reason from fleet_membership_removals order by removed_at,id')).rows;
      assert.deepEqual(audit, [{ removed_by: owner, reason: 'owner_removed' }, { removed_by: user, reason: 'driver_left' }]);
    });
    await t.test('start rejects null, invalid provenance, unknown users and another driver UUID', async () => {
      assert.equal((await start(startArgs().map((v, i) => i === 0 ? null : v))).error, 'invalid_session');
      assert.equal((await start(startArgs().map((v, i) => i === 5 ? '<invalid>' : v))).error, 'invalid_session');
      assert.equal((await start(startArgs().map((v, i) => i === 0 ? other : v))).error, 'driver_profile_not_found');
      await db.exec('reset role');
      await db.query('insert into drivers(id,user_id,name) values($1,$2,$3)', [foreign, other, 'Other']);
      await db.query('insert into sessions(id,driver_id) values($1,$2)', [foreign, foreign]);
      await db.exec('set role service_role');
      assert.equal((await start(startArgs(foreign))).error, 'session_id_conflict');
      const legacyGenerated = await start(startArgs(null)); assert.ok(legacyGenerated.session.id); assert.equal(legacyGenerated.session.fleet_id, null);
    });
    await t.test('RLS remains closed even if a browser role is accidentally granted SELECT', async () => {
      await db.exec('reset role;grant select on fleet_membership_removals to authenticated;set role authenticated');
      assert.deepEqual((await db.query('select * from fleet_membership_removals')).rows, []);
      await db.exec('reset role;revoke select on fleet_membership_removals from authenticated;set role service_role');
    });
    await t.test('strict JSON/query validation and disabled gate never mutate', async () => {
      assert.equal((await invoke(route, 'DELETE', '/api/fleet-drivers', { driver_id: driver, fleet_id: fleet, confirm: true }, { headers: { 'content-type': 'application/jsonp' } })).statusCode, 415);
      assert.equal((await invoke(route, 'GET', '/api/fleet-membership?unexpected=1')).statusCode, 400);
      assert.equal((await invoke(route, 'GET', '/api/fleet-membership', undefined, { query: { unexpected: '1' } })).statusCode, 400);
      env.OCCULERT_FLEET_OFFBOARDING_ENABLED = 'false';
      assert.equal((await invoke(route, 'DELETE', '/api/fleet-drivers', { driver_id: driver, fleet_id: fleet, confirm: true })).statusCode, 501);
    });
  } finally { await db.close(); }
});

test('gated session API validates inputs, derives identity, preserves conflicts and fails closed', async () => {
  const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture', OCCULERT_FLEET_OFFBOARDING_ENABLED: 'true' };
  let calls = [], result = { session: { id: session, driver_id: driver, fleet_id: fleet } }, failure;
  const route = bootRoute('api/sessions.js', { bearerToken: () => 'fixture', verifyAccessToken: async () => ({ id: user }),
    pgFetch: async (table, options) => { calls.push({ table, body: options.body }); if (failure) throw failure; return result; } }, env);
  assert.equal((await invoke(route, 'POST', '/api/sessions', { session_id: 'invalid' })).statusCode, 400);
  assert.equal((await invoke(route, 'POST', '/api/sessions', [], { headers: { 'content-type': 'application/json' } })).statusCode, 415);
  assert.equal((await invoke(route, 'POST', '/api/sessions', {}, { headers: { 'content-type': 'application/jsonp' } })).statusCode, 415);
  assert.equal(calls.length, 0);
  let response = await invoke(route, 'POST', '/api/sessions', { session_id: session, user_id: other, driver_id: other, fleet_id: next,
    device: 'd'.repeat(130), browser: 'b'.repeat(250), detector_pipeline: 'untrusted', detector_version: '<invalid>', app_version: '  test-1  ' });
  assert.equal(response.statusCode, 200); assert.equal(response.body.session_start_protocol, 'client_uuid_v1');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ table: 'rpc/start_offboarding_aware_session', body: {
    p_user_id: user, p_session_id: session, p_device: 'd'.repeat(120), p_browser: 'b'.repeat(240),
    p_detector_pipeline: null, p_detector_version: null, p_app_version: 'test-1',
  } }]);
  for (const [error, status] of [['driver_profile_not_found', 403], ['session_id_conflict', 409], ['membership_changed', 409], ['invalid_session', 400]]) {
    result = { error }; response = await invoke(route, 'POST', '/api/sessions', { session_id: session });
    assert.equal(response.statusCode, status); assert.equal(response.body.error, error);
  }
  for (const bad of [null, {}, { session: { id: foreign, driver_id: driver } }, { session: { id: session, driver_id: null } }]) {
    result = bad; assert.equal((await invoke(route, 'POST', '/api/sessions', { session_id: session })).statusCode, 502);
  }
  failure = Object.assign(new Error('fixture-provider-unavailable'), { provider: 'supabase', status: 503 });
  assert.equal((await invoke(route, 'POST', '/api/sessions', { session_id: session })).statusCode, 503);
});

test('default-off session API keeps the existing driver read and direct insert contract', async () => {
  for (const flag of [undefined, 'false']) {
    const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture', ...(flag ? { OCCULERT_FLEET_OFFBOARDING_ENABLED: flag } : {}) };
    const calls = [];
    const route = bootRoute('api/sessions.js', { bearerToken: () => 'fixture', verifyAccessToken: async () => ({ id: user }),
      pgFetch: async (table, options) => {
        calls.push({ table, options });
        if (table === 'drivers') return [{ id: driver, fleet_id: fleet }];
        assert.equal(table, 'sessions');
        return [{ id: session, ...options.body }];
      } }, env);
    const response = await invoke(route, 'POST', '/api/sessions', { driver_id: other, fleet_id: next, device: 'phone', browser: 'browser' });
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { table: 'drivers', options: { params: { select: 'id,fleet_id', user_id: 'eq.' + user, limit: '1' } } });
    const body = calls[1].options.body;
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(body.driver_id, driver); assert.equal(body.fleet_id, fleet);
    assert.equal(body.device, 'phone'); assert.equal(body.browser, 'browser');
    assert.equal(body.detector_pipeline, null); assert.equal(body.detector_version, null); assert.equal(body.app_version, null);
    assert.ok(Number.isFinite(Date.parse(body.started_at)));
    assert.equal(response.body.session.fleet_id, fleet);
    assert.equal(calls.some(call => call.table.startsWith('rpc/')), false);
  }
});
