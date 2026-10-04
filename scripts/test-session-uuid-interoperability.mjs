import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const libPath = require.resolve('../api/_lib/supabase.js');
const originalLib = require.cache[libPath];
const paths = ['sessions', 'fleet-summary', 'fleet-followups', '_lib/routes/fleet-session-history'];
const originalHandlers = new Map(paths.map(path => {
  const resolved = require.resolve(`../api/${path}.js`);
  return [resolved, require.cache[resolved]];
}));
const originalEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
const { isUuid, decodeCursor } = require('../api/_lib/fleet-history-cursor.js');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const fleet = '33333333-3333-4333-8333-333333333333';
const otherFleet = '44444444-4444-4444-8444-444444444444';
const driver = '55555555-5555-4555-8555-555555555555';
const otherDriver = '66666666-6666-4666-8666-666666666666';
const sessionId = '01890f80-7237-7c38-893d-026c203e47b8';
const foreignId = '01890f80-7237-7c38-893d-026c203e47b9';
const db = new PGlite();
let actor = owner, writes = 0, injectMalformedRows = false;
const calls = [];
const rows = async (sql, values = []) => {
  const statement = /^(insert|update) /i.test(sql)
    ? `with fixture as (${sql}) select to_jsonb(fixture) as row from fixture`
    : `select to_jsonb(fixture) as row from (${sql}) fixture`;
  return (await db.query(statement, values)).rows.map(result => result.row);
};
async function pgFetch(table, options = {}) {
  calls.push({ table, options });
  const params = options.params || {};
  if (table === 'fleets') {
    assert.equal(params.owner_user_id, 'eq.' + actor);
    return rows(`select ${params.select} from fleets where owner_user_id=$1`, [actor]);
  }
  if (table === 'drivers') {
    if (params.user_id) {
      assert.equal(params.user_id, 'eq.' + actor);
      return rows(`select ${params.select} from drivers where user_id=$1`, [actor]);
    }
    assert.equal(params.fleet_id, 'eq.' + fleet);
    return rows(`select ${params.select} from drivers where fleet_id=$1`, [fleet]);
  }
  if (table === 'sessions') {
    if (options.method === 'POST') {
      writes++;
      const fields = Object.keys(options.body);
      try {
        return await rows(`insert into sessions (${fields.join(',')}) values (${fields.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(options.body));
      } catch (error) { throw { details: { code: error.code } }; }
    }
    if (options.method === 'PATCH') {
      writes++;
      assert.equal(params.ended_at, 'is.null');
      assert.equal(params.driver_id, 'eq.' + driver);
      const fields = Object.keys(options.body), values = Object.values(options.body);
      return rows(`update sessions set ${fields.map((field, i) => field + '=$' + (i + 1)).join(',')} where id=$${values.length + 1} and driver_id=$${values.length + 2} and ended_at is null returning *`, [...values, params.id.slice(3), driver]);
    }
    if (params.id) {
      assert.equal(params.driver_id, 'eq.' + (actor === owner ? driver : otherDriver));
      return rows(`select ${params.select} from sessions where id=$1 and driver_id=$2`, [params.id.slice(3), params.driver_id.slice(3)]);
    }
    assert.equal(params.fleet_id, 'eq.' + fleet);
    assert.equal(params.order, 'started_at.desc,id.desc');
    assert.ok(['1', '50', '51'].includes(params.limit));
    const values = [fleet], conditions = ['fleet_id=$1'];
    if (params.and) {
      const upper = /started_at\.eq\."([^"]+)",id\.lte\.([0-9a-f-]+)/i.exec(params.and);
      const before = /started_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]+)/i.exec(params.and);
      assert.ok(upper && before, 'pagination must retain both snapshot and exclusive before bounds');
      assert.ok(isUuid(upper[2]) && isUuid(before[2]));
      values.push(upper[1], upper[2], before[1], before[2]);
      conditions.push('(started_at,id)<=($2::timestamptz,$3::uuid)', '(started_at,id)<($4::timestamptz,$5::uuid)');
    }
    values.push(Number(params.limit));
    const selected = await rows(`select ${params.select} from sessions where ${conditions.join(' and ')} order by started_at desc,id desc limit $${values.length}`, values);
    return injectMalformedRows && params.limit === '50'
      ? [...selected, { id: sessionId + '\n' }, { id: [sessionId] }, { id: 'not-a-uuid' }]
      : selected;
  }
  if (table === 'events' || table === 'fleet_session_followups') {
    const ids = params.session_id.slice(4, -1).split(',');
    assert.ok(ids.length && ids.every(isUuid), 'only exact canonical IDs may enter the PostgREST filter');
    assert.ok(ids.includes(sessionId), 'the created UUIDv7 must reach event and followup selection');
    assert.ok(!ids.includes(foreignId), 'only the owned fleet session selection is used');
    assert.doesNotMatch(params.select, /latitude|longitude|personal|raw_motion/);
    return rows(`select ${params.select} from ${table} where session_id=any($1::uuid[])`, [ids]);
  }
  assert.equal(table, 'rpc/save_fleet_session_followup');
  writes++;
  assert.equal(options.body.p_actor_id, actor, 'the verified actor, not a request identity, reaches the real RPC');
  try {
    return await rows('select * from save_fleet_session_followup($1::uuid,$2::uuid,$3::text,$4::integer)',
      [actor, options.body.p_session_id, options.body.p_status, options.body.p_expected_version]);
  } catch (error) { throw { details: { code: error.code } }; }
}
function load(path) {
  const resolved = require.resolve(`../api/${path}.js`);
  delete require.cache[resolved];
  return require(resolved);
}
function request(method, body, query = {}) {
  return { method, body, query, headers: { 'content-type': 'application/json', authorization: 'Bearer fixture' } };
}
async function invoke(handler, req) {
  const headers = {}, response = { statusCode: 200,
    setHeader(key, value) { headers[key.toLowerCase()] = value; }, end(value) { this.body = JSON.parse(value); } };
  await handler(req, response);
  return { status: response.statusCode, body: response.body, headers };
}
try {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-server-key';
  await db.exec(`set timezone to 'UTC'; create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create table fleets(id uuid primary key, owner_user_id uuid references auth.users, company_name text, plan text);
    create table drivers(id uuid primary key, user_id uuid, fleet_id uuid references fleets, name text, active boolean, vehicle_id text);
    create table sessions(id uuid primary key default gen_random_uuid(), driver_id uuid references drivers, fleet_id uuid references fleets,
      started_at timestamptz, ended_at timestamptz, device text, browser text, detector_pipeline text, detector_version text, app_version text,
      average_fatigue numeric, max_fatigue numeric, safety_score numeric, alert_count integer, head_nod_count integer);
    create table events(id uuid primary key, session_id uuid references sessions, type text, fatigue_score numeric, confidence numeric, created_at timestamptz);
    insert into auth.users values ('${owner}'),('${other}');
    insert into fleets values ('${fleet}','${owner}','Owned Fleet','trial'),('${otherFleet}','${other}','Other Fleet','trial');
    insert into drivers values ('${driver}','${owner}','${fleet}','Owned Driver',true,null),('${otherDriver}','${other}','${otherFleet}','Other Driver',true,null);`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260921040303_fleet_session_followups.sql', import.meta.url), 'utf8'));
  require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
    pgFetch, bearerToken: () => 'fixture',
    verifyAccessToken: async () => ({ id: actor, email: 'fixture@example.invalid', email_confirmed_at: '2026-01-01' }),
  } };
  const sessions = load('sessions'), summary = load('fleet-summary'), followups = load('fleet-followups'), history = load('_lib/routes/fleet-session-history');
  const created = await invoke(sessions, request('POST', { session_id: sessionId, driver_id: otherDriver, fleet_id: otherFleet }));
  assert.equal(created.status, 200);
  assert.equal(created.body.session.id, sessionId);
  assert.equal(created.body.session.driver_id, driver);
  assert.equal(created.body.session.fleet_id, fleet);
  const recovered = await invoke(sessions, request('GET', undefined, { session_id: sessionId, driver_id: otherDriver }));
  assert.equal(recovered.status, 200);assert.equal(recovered.body.session.id, sessionId);
  assert.equal((await invoke(sessions, request('GET', undefined, { session_id: sessionId.toUpperCase() }))).body.session.id, sessionId, 'SQL UUID comparisons retain case-insensitive recovery');
  const finalized = await invoke(sessions, request('PATCH', { session_id: sessionId, average_fatigue: 0, max_fatigue: 0, safety_score: 0, alert_count: 0, head_nod_count: 0 }));
  assert.equal(finalized.status, 200);
  for (const field of ['average_fatigue', 'max_fatigue', 'safety_score', 'alert_count', 'head_nod_count']) assert.equal(finalized.body.session[field], 0);
  // General SQL syntax remains supported, including a future version/non-RFC variant and the nil UUID.
  for (const id of ['01890f80-7237-8c38-093d-026c203e47b8', '00000000-0000-0000-0000-000000000000']) {
    assert.equal((await invoke(sessions, request('POST', { session_id: id }))).status, 200);
    assert.equal((await db.query('select $1::uuid as id', [id])).rows[0].id, id);
  }
  await db.query(`insert into sessions(id,driver_id,fleet_id,started_at)
    select ('01890f80-7237-7c38-893d-' || lpad(to_hex(n),12,'0'))::uuid,$1::uuid,$2::uuid,'2026-10-03T10:00:00.123456Z'::timestamptz
    from generate_series(1,50) n`, [driver, fleet]);
  await db.query('update sessions set started_at=$1 where fleet_id=$2', ['2026-10-03T10:00:00.123456Z', fleet]);
  await db.query('update sessions set started_at=$1 where id=$2', ['2026-10-03T10:00:01.123456Z', sessionId]);
  actor = other;
  assert.equal((await invoke(sessions, request('POST', { session_id: foreignId }))).status, 200);
  actor = owner;
  const beforeCollision = (await db.query('select count(*)::integer as n from sessions')).rows[0].n;
  assert.equal((await invoke(sessions, request('POST', { session_id: foreignId, driver_id: otherDriver }))).status, 409);
  assert.equal((await invoke(sessions, request('GET', undefined, { session_id: foreignId }))).body.session, null);
  assert.equal((await invoke(sessions, request('PATCH', { session_id: foreignId, safety_score: 100 }))).status, 404);
  assert.equal((await db.query('select count(*)::integer as n from sessions')).rows[0].n, beforeCollision);
  await db.query('insert into events values($1,$2,$3,0,0,now())', ['77777777-7777-4777-8777-777777777777', sessionId, 'drowsy']);
  const first = await invoke(history, request('GET'));
  assert.equal(first.status, 200);assert.equal(first.body.sessions.length, 50);assert.equal(first.body.has_more, true);
  assert.equal(first.body.sessions[0].id, sessionId);
  assert.equal(first.body.sessions[0].started_at, '2026-10-03T10:00:01.123456+00:00');
  assert.equal(decodeCursor(first.body.next_cursor).snapshot.id, sessionId);
  const second = await invoke(history, request('GET', undefined, { cursor: first.body.next_cursor }));
  assert.equal(second.status, 200);assert.equal(second.body.has_more, false);
  const all = [...first.body.sessions, ...second.body.sessions];
  assert.equal(all.length, 53);assert.equal(new Set(all.map(row => row.id)).size, 53);
  assert.ok(!all.some(row => row.id === foreignId));
  assert.ok(all.some(row => row.id === '00000000-0000-0000-0000-000000000000'));
  for (const field of ['average_fatigue', 'max_fatigue', 'safety_score', 'alert_count', 'head_nod_count']) assert.equal(first.body.sessions[0][field], 0);
  const notice = await invoke(summary, request('GET'));
  assert.equal(notice.status, 200);assert.equal(notice.body.events[0].session_id, sessionId);
  assert.deepEqual(Object.keys(notice.body.events[0]).sort(), ['confidence', 'created_at', 'fatigue_score', 'id', 'session_id', 'type']);
  const saved = await invoke(followups, request('POST', { session_id: sessionId, status: 'reviewed', expected_version: 0 }));
  assert.equal(saved.status, 200);assert.equal(saved.body.followup.session_id, sessionId);assert.equal(saved.body.followup.version, 1);
  assert.equal(saved.body.followup.updated_by, undefined);
  assert.equal((await invoke(followups, request('POST', { session_id: foreignId, status: 'reviewed', expected_version: 0 }))).status, 404);
  const loaded = await invoke(followups, request('GET'));
  assert.equal(loaded.status, 200);assert.equal(loaded.body.sessions.find(row => row.id === sessionId).followup.status, 'reviewed');
  // Bad IDs and trailing delimiters must be denied before mutations; canonical UUIDs are exactly 36 characters.
  for (const id of [sessionId + '\n', sessionId + '\r\n', ' ' + sessionId, sessionId.slice(1), 'not-a-uuid', [sessionId], { id: sessionId }]) {
    const before = writes;
    for (const method of ['POST', 'GET', 'PATCH']) {
      const denied = await invoke(sessions, method === 'GET' ? request('GET', undefined, { session_id: id }) : request(method, { session_id: id }));
      assert.equal(denied.status, 400);
    }
    assert.equal((await invoke(followups, request('POST', { session_id: id, status: 'reviewed', expected_version: 0 }))).status, 400);
    assert.equal(writes, before, 'malformed IDs must not insert, finalize or save a followup');
  }
  const badCursor = decodeCursor(first.body.next_cursor);
  badCursor.before.id += '\n';
  const databaseCalls = calls.length;
  const deniedCursor = await invoke(history, request('GET', undefined, { cursor: Buffer.from(JSON.stringify(badCursor)).toString('base64url') }));
  assert.equal(deniedCursor.status, 400);assert.equal(deniedCursor.body.error, 'invalid_cursor');
  assert.equal(calls.length, databaseCalls, 'malformed cursor cannot reach a fleet/storage query');
  injectMalformedRows = true;
  assert.equal((await invoke(summary, request('GET'))).status, 200);
  assert.equal((await invoke(followups, request('GET'))).status, 200);
  assert.ok(calls.filter(call => ['events', 'fleet_session_followups'].includes(call.table)).every(call => !call.options.params.session_id.includes('\n')));
  console.log('Session UUID interoperability passed: SQL-backed creation/recovery/finalization, bounded history, events, real followup ownership, malformed IDs and zero metrics.');
} finally {
  await db.close();
  if (originalLib) require.cache[libPath] = originalLib; else delete require.cache[libPath];
  for (const [path, entry] of originalHandlers) { if (entry) require.cache[path] = entry; else delete require.cache[path]; }
  for (const [name, value] of [['SUPABASE_URL', originalEnv.url], ['SUPABASE_SERVICE_ROLE_KEY', originalEnv.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
