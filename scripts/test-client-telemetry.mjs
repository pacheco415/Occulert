import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { insertOnce, timestamp } = require('../api/_lib/client-telemetry');
const { readFleetReport } = require('../api/_lib/fleet-report');

test('idempotent insertion returns only rows in the authenticated ownership scope', async () => {
  let stored;
  const pg = async (_table, options) => {
    if (options.method === 'POST') {
      if (stored) throw Object.assign(new Error('duplicate'), { status: 409, details: { code: '23505' } });
      stored = options.body; return [stored];
    }
    return options.params.driver_id === 'eq.' + stored.driver_id ? [stored] : [];
  };
  const body = { id: 'id', driver_id: 'a', started_at: 'original' };
  await insertOnce(pg, 'sessions', body, { driver_id: 'eq.a' });
  assert.deepEqual(await insertOnce(pg, 'sessions', { ...body, started_at: 'retry' }, { driver_id: 'eq.a' }), [body]);
  await assert.rejects(insertOnce(pg, 'sessions', { ...body, driver_id: 'b' }, { driver_id: 'eq.b' }));
});

test('client timestamps reject impossible or future values', () => {
  assert.equal(timestamp('not a date'), null);
  assert.equal(timestamp('1999-01-01'), null);
  assert.equal(timestamp(new Date(Date.now() + 600000).toISOString()), null);
  assert.equal(timestamp('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z');
});

test('fleet reports use one bounded database snapshot and explicit window', async () => {
  let calls = 0;
  const rows = Array.from({ length: 125 }, (_, i) => ({ id: String(125 - i), started_at: '2026-09-11T00:00:00.000Z' }));
  const result = await readFleetReport(async (table, options) => {
    calls += 1;
    assert.equal(table, 'rpc/fleet_session_report_v1');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.p_fleet_id, 'owner-fleet');
    assert.match(options.body.p_from, /^2026-08-13/);
    assert.match(options.body.p_through, /^2026-09-12/);
    return { sessions: rows, complete: true };
  }, 'owner-fleet', 30, Date.parse('2026-09-12T00:00:00Z'));
  assert.equal(calls, 1);
  assert.equal(result.sessions.length, 125);
  assert.equal(result.complete, true);
  assert.equal(result.compatibility, 'snapshot_v1');
});

test('reports at the work limit are explicitly partial', async () => {
  const result = await readFleetReport(async () => ({
    sessions: Array.from({ length: 2001 }, (_, index) => ({ id: String(index) })),
    complete: true,
  }), 'fleet', 30);
  assert.equal(result.sessions.length, 2000); assert.equal(result.complete, false);
});

test('fleet reporting fails closed to a partial legacy response while its snapshot function is staged', async () => {
  let calls = 0;
  const result = await readFleetReport(async (table, options) => {
    calls += 1;
    if (table === 'rpc/fleet_session_report_v1') {
      throw Object.assign(new Error('function missing'), {
        status: 404,
        details: { code: 'PGRST202', message: 'fleet_session_report_v1 was not found' },
      });
    }
    assert.equal(table, 'sessions');
    assert.equal(options.params.limit, '50');
    assert.equal(options.params.ended_at, 'not.is.null');
    assert.equal(Object.hasOwn(options.params, 'ingest_sequence'), false);
    return [{ id: 'legacy', started_at: '2026-09-11T01:00:00Z' }];
  }, 'owner-fleet', 30, Date.parse('2026-09-12T00:00:00Z'));
  assert.equal(calls, 2);
  assert.deepEqual(result.sessions.map(row => row.id), ['legacy']);
  assert.equal(result.complete, false);
  assert.equal(result.compatibility, 'legacy_schema');
});

test('session and event endpoints preserve timestamps on retries and reject another driver', async () => {
  process.env.SUPABASE_URL = 'https://test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  let owner = 'a'; const data = {
    sessions: new Map(), events: new Map(), cancellations: new Set(), tokenCancellations: new Set(),
  };
  const libPath = require.resolve('../api/_lib/supabase');
  const pgFetch = async (table, options = {}) => {
    if (table === 'drivers') return [{
      id: owner,
      fleet_id: 'fleet-' + owner,
      fleet_sync_token: owner === 'a'
        ? '77777777-7777-4777-8777-777777777777'
        : '88888888-8888-4888-8888-888888888888',
      session_cleanup_token: owner === 'a'
        ? '99999999-9999-4999-8999-999999999999'
        : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }];
    if (table === 'rpc/start_session_sync_v1') {
      const body = options.body;
      const cancellationKey = `${body.p_session_id}|${body.p_driver_id}`;
      if (data.cancellations.has(cancellationKey)) return { cancelled: true };
      if (data.tokenCancellations.has(`${body.p_session_id}|${body.p_cancel_token}`)) return { cancelled: true };
      if (!data.sessions.has(body.p_session_id)) {
        const expectedToken = body.p_driver_id === 'a'
          ? '77777777-7777-4777-8777-777777777777'
          : '88888888-8888-4888-8888-888888888888';
        data.sessions.set(body.p_session_id, {
          id: body.p_session_id,
          driver_id: body.p_driver_id,
          fleet_id: body.p_fleet_sync_token === expectedToken ? 'fleet-' + body.p_driver_id : null,
          sync_cancel_token: body.p_cancel_token,
          started_at: body.p_started_at,
          server_internal: true,
        });
      }
      return { cancelled: false, conflict: false, session: data.sessions.get(body.p_session_id) };
    }
    if (table === 'rpc/cancel_session_sync_v1') {
      const body = options.body;
      const session = data.sessions.get(body.p_session_id);
      const deleted = Boolean(session && session.driver_id === body.p_driver_id && !session.ended_at);
      if (deleted) data.sessions.delete(body.p_session_id);
      data.cancellations.add(`${body.p_session_id}|${body.p_driver_id}`);
      return { deleted, cancellation_recorded: true };
    }
    if (table === 'rpc/cancel_session_sync_token_v1') {
      const body = options.body;
      const expectedCleanupToken = owner === 'a'
        ? '99999999-9999-4999-8999-999999999999'
        : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      if (body.p_cleanup_token !== expectedCleanupToken) {
        return { settled: false, deleted: false, invalid_capability: true };
      }
      const cancellationKey = `${body.p_session_id}|${body.p_cancel_token}`;
      if (data.tokenCancellations.has(cancellationKey)) return { settled: true, deleted: false };
      const session = data.sessions.get(body.p_session_id);
      const matches = Boolean(session && session.sync_cancel_token === body.p_cancel_token);
      if (session && !matches) return { settled: false, deleted: false, conflict: true };
      const deleted = matches;
      if (deleted) data.sessions.delete(body.p_session_id);
      data.tokenCancellations.add(cancellationKey);
      return { settled: true, deleted };
    }
    const rows = data[table];
    if (options.method === 'POST') {
      if (rows.has(options.body.id)) throw Object.assign(new Error('duplicate'), { status: 409, details: { code: '23505' } });
      rows.set(options.body.id, { ...options.body }); return [rows.get(options.body.id)];
    }
    const selected = [...rows.values()].filter(row => Object.entries(options.params || {}).every(([key, val]) =>
      key === 'select' || key === 'limit' || (val === 'is.null' ? row[key] == null : val === 'eq.' + row[key])));
    if (options.method === 'PATCH') selected.forEach(row => Object.assign(row, options.body));
    if (options.method === 'DELETE') {
      selected.forEach(row => rows.delete(row.id));
      if (table === 'sessions') {
        for (const [eventId, eventRow] of data.events) {
          if (selected.some(row => row.id === eventRow.session_id)) data.events.delete(eventId);
        }
      }
    }
    return selected;
  };
  require.cache[libPath] = { id: libPath, filename: libPath, loaded: true,
    exports: { pgFetch, verifyAccessToken: async () => ({ id: owner }), bearerToken: () => 'test' } };
  const sessionPath = require.resolve('../api/sessions'); const eventPath = require.resolve('../api/events');
  const syncPath = require.resolve('../api/session-sync-v1'); const eventSyncPath = require.resolve('../api/event-sync-v1');
  const cancelPath = require.resolve('../api/session-cancel-v1');
  delete require.cache[sessionPath]; delete require.cache[eventPath]; delete require.cache[syncPath]; delete require.cache[eventSyncPath]; delete require.cache[cancelPath];
  const sessionHandler = require(sessionPath), eventHandler = require(eventPath);
  const syncHandler = require(syncPath), eventSyncHandler = require(eventSyncPath), cancelHandler = require(cancelPath);
  async function call(handler, method, body) {
    const response = { statusCode: 200, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    await handler({ method, body, headers: { 'content-type': 'application/json' } }, response);
    return response;
  }
  const id = '11111111-1111-4111-8111-111111111111';
  const start = { client_session_id: id, started_at: '2026-01-01T00:00:00Z' };
  assert.equal((await call(sessionHandler, 'PATCH', { session_id: 'not-a-uuid' })).statusCode, 400);
  assert.equal((await call(eventHandler, 'POST', { session_id: 'not-a-uuid', type: 'drowsy' })).statusCode, 400);
  const missingEventId = await call(eventSyncHandler, 'POST', {
    session_id: id,
    type: 'drowsy',
    created_at: '2026-01-01T00:01:00Z',
  });
  assert.equal(missingEventId.statusCode, 400);
  assert.equal(missingEventId.body.error, 'missing_client_event_id');
  const missingEventTime = await call(eventSyncHandler, 'POST', {
    client_event_id: '33333333-3333-4333-8333-333333333333',
    session_id: id,
    type: 'drowsy',
  });
  assert.equal(missingEventTime.statusCode, 400);
  assert.equal(missingEventTime.body.error, 'invalid_client_event');
  assert.equal((await call(sessionHandler, 'POST', start)).statusCode, 200);
  assert.equal(data.sessions.get(id).fleet_id, null, 'client-timestamp sessions must stay outside the fleet');
  const syncId = '66666666-6666-4666-8666-666666666666';
  const syncCancelToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const synced = await call(syncHandler, 'POST', {
    client_session_id: syncId,
    cancel_token: syncCancelToken,
    started_at: '2026-01-01T00:00:01Z',
  });
  assert.equal(synced.body.session.id, syncId);
  assert.equal(synced.body.session.fleet_id, null, 'recovered native sessions must stay outside the fleet');
  assert.equal(Object.hasOwn(synced.body.session, 'server_internal'), false);
  assert.equal(Object.hasOwn(synced.body.session, 'sync_cancel_token'), false);
  const observedId = '55555555-5555-4555-8555-555555555555';
  const observedCancelToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const observed = await call(syncHandler, 'POST', {
    client_session_id: observedId,
    cancel_token: observedCancelToken,
    started_at: '2025-12-31T23:59:59Z',
    fleet_sync_token: '77777777-7777-4777-8777-777777777777',
  });
  assert.equal(observed.body.session.id, observedId);
  assert.equal(observed.body.session.fleet_id, 'fleet-a');
  assert.equal(observed.body.session.started_at, '2025-12-31T23:59:59.000Z');
  const cancelled = await call(syncHandler, 'DELETE', { session_id: syncId });
  assert.equal(cancelled.body.cancellation_recorded, true);
  assert.equal((await call(syncHandler, 'POST', {
    client_session_id: syncId,
    cancel_token: syncCancelToken,
    started_at: '2026-01-01T00:00:01Z',
  })).statusCode, 410);
  const tokenSessionId = '99999999-9999-4999-8999-999999999999';
  const tokenSecret = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  assert.equal((await call(syncHandler, 'POST', {
    client_session_id: tokenSessionId,
    cancel_token: tokenSecret,
    started_at: '2026-01-01T00:00:02Z',
  })).statusCode, 200);
  assert.equal((await call(cancelHandler, 'DELETE', {
    session_id: tokenSessionId,
    cancel_token: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    cleanup_token: '99999999-9999-4999-8999-999999999999',
  })).body.settled, false, 'a different cleanup capability cannot delete the session');
  const tokenCleanup = await call(cancelHandler, 'DELETE', {
    session_id: tokenSessionId,
    cancel_token: tokenSecret,
    cleanup_token: '99999999-9999-4999-8999-999999999999',
  });
  assert.equal(tokenCleanup.body.settled, true);
  assert.equal(tokenCleanup.body.deleted, true);
  assert.equal(data.sessions.has(tokenSessionId), false);
  assert.equal((await call(cancelHandler, 'DELETE', {
    session_id: tokenSessionId,
    cancel_token: tokenSecret,
    cleanup_token: '99999999-9999-4999-8999-999999999999',
  })).body.settled, true, 'a retried cleanup remains confirmed after the first response is lost');
  assert.equal((await call(syncHandler, 'POST', {
    client_session_id: tokenSessionId,
    cancel_token: tokenSecret,
    started_at: '2026-01-01T00:00:02Z',
  })).statusCode, 410, 'a late duplicate start cannot recreate a token-cancelled session');
  const absentSessionId = '12121212-1212-4212-8212-121212121212';
  const absentSecret = '13131313-1313-4313-8313-131313131313';
  assert.equal((await call(cancelHandler, 'DELETE', {
    session_id: absentSessionId,
    cancel_token: absentSecret,
    cleanup_token: '14141414-1414-4414-8414-141414141414',
  })).statusCode, 410, 'an unknown driver capability cannot create cancellation receipts');
  const absentCleanup = await call(cancelHandler, 'DELETE', {
    session_id: absentSessionId,
    cancel_token: absentSecret,
    cleanup_token: '99999999-9999-4999-8999-999999999999',
  });
  assert.equal(absentCleanup.body.settled, true, 'a valid driver capability settles a create that never inserted');
  assert.equal(absentCleanup.body.deleted, false);
  assert.equal((await call(syncHandler, 'POST', {
    client_session_id: absentSessionId,
    cancel_token: absentSecret,
    started_at: '2026-01-01T00:00:03Z',
  })).statusCode, 410, 'an absent-row cancellation blocks a late start');
  assert.equal((await call(sessionHandler, 'POST', { ...start, started_at: '2026-02-01T00:00:00Z' })).body.session.started_at, '2026-01-01T00:00:00.000Z');
  const event = { client_event_id: '22222222-2222-4222-8222-222222222222', session_id: id, type: 'drowsy', created_at: '2026-01-01T00:01:00Z' };
  await call(eventHandler, 'POST', event); await call(eventHandler, 'POST', event);
  assert.deepEqual([...data.events.keys()], [event.client_event_id]);
  assert.equal((await call(sessionHandler, 'PATCH', { session_id: id, ended_at: '2026-01-01T00:10:00Z', alert_count: 1 })).statusCode, 200);
  assert.equal((await call(sessionHandler, 'PATCH', { session_id: id, ended_at: '2026-01-01T00:20:00Z', alert_count: 9 })).body.session.alert_count, 1);
  const unfinishedId = '33333333-3333-4333-8333-333333333333';
  const unfinishedEventId = '44444444-4444-4444-8444-444444444444';
  await call(sessionHandler, 'POST', { client_session_id: unfinishedId, started_at: '2026-01-01T01:00:00Z' });
  assert.equal((await call(eventHandler, 'POST', { ...event, session_id: unfinishedId })).statusCode, 409);
  await call(eventHandler, 'POST', { client_event_id: unfinishedEventId, session_id: unfinishedId, type: 'drowsy', created_at: '2026-01-01T01:01:00Z' });
  owner = 'b';
  assert.equal((await call(sessionHandler, 'DELETE', { session_id: unfinishedId })).body.deleted, false);
  assert.equal(data.sessions.has(unfinishedId), true);
  owner = 'a';
  assert.equal((await call(sessionHandler, 'DELETE', { session_id: id })).body.deleted, false);
  assert.equal(data.sessions.has(id), true);
  assert.equal((await call(sessionHandler, 'DELETE', { session_id: unfinishedId })).body.deleted, true);
  assert.equal(data.sessions.has(unfinishedId), false);
  assert.equal(data.events.has(unfinishedEventId), false);
  assert.equal((await call(sessionHandler, 'DELETE', { session_id: unfinishedId })).body.deleted, false);
  owner = 'b';
  assert.equal((await call(sessionHandler, 'POST', start)).statusCode, 502);
  assert.equal((await call(sessionHandler, 'PATCH', { session_id: id, ended_at: '2026-01-01T00:30:00Z' })).statusCode, 404);
  assert.equal((await call(eventHandler, 'POST', event)).statusCode, 404);
  assert.deepEqual(new Set(data.sessions.keys()), new Set([id, observedId]));
});
