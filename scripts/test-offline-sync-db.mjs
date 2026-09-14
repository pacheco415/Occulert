import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { insertOnce } = require('../api/_lib/client-telemetry');
const reportMigration = readFileSync(new URL('../db/migrations/20260913_session_report_snapshot.sql', import.meta.url), 'utf8');
const syncGuardMigration = readFileSync(new URL('../db/migrations/20260913_native_sync_guards.sql', import.meta.url), 'utf8');
const sessionStartFunction = syncGuardMigration.slice(
  syncGuardMigration.indexOf('create or replace function public.start_session_sync_v1'),
  syncGuardMigration.indexOf('create or replace function public.cancel_session_sync_v1'),
);
const authenticatedCancelFunction = syncGuardMigration.slice(
  syncGuardMigration.indexOf('create or replace function public.cancel_session_sync_v1'),
  syncGuardMigration.indexOf('drop function if exists public.cancel_session_sync_token_v1'),
);
const tokenCancelFunction = syncGuardMigration.slice(
  syncGuardMigration.indexOf('create function public.cancel_session_sync_token_v1'),
  syncGuardMigration.indexOf('revoke all on function public.start_session_sync_v1'),
);

assert.match(sessionStartFunction, /for share/i, 'session start must lock the membership row through insert');
assert.match(sessionStartFunction, /p_fleet_sync_token is distinct from current_fleet_sync_token/i);
assert.doesNotMatch(sessionStartFunction, /p_fleet_id/i, 'the API must not supply a precomputed fleet assignment');
assert.match(authenticatedCancelFunction, /drivers[\s\S]*for key share/i, 'authenticated cleanup must lock the parent driver before deleting a session');
assert.match(tokenCancelFunction, /drivers[\s\S]*for key share/i, 'token cleanup must lock the parent driver before deleting a session');

test('native sync cancellation is atomic and restricted to the service role', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE drivers (
        id uuid PRIMARY KEY,
        fleet_id uuid,
        user_id uuid,
        name text,
        email text,
        vehicle_id text,
        active boolean default true,
        created_at timestamptz default now()
      );
      CREATE TABLE sessions (
        id uuid PRIMARY KEY, driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
        fleet_id uuid, started_at timestamptz NOT NULL, ended_at timestamptz,
        average_fatigue numeric, max_fatigue numeric, safety_score numeric,
        alert_count integer, head_nod_count integer, device text, browser text
      );
      INSERT INTO drivers(id,fleet_id) VALUES
      ('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
    `);
    await db.exec(syncGuardMigration);
    const originalGrant = (await db.query('SELECT fleet_sync_token FROM drivers')).rows[0].fleet_sync_token;
    const cleanupGrant = (await db.query('SELECT session_cleanup_token FROM drivers')).rows[0].session_cleanup_token;
    await db.exec("UPDATE drivers SET fleet_id = NULL WHERE id = '33333333-3333-4333-8333-333333333333'");
    const rotatedGrant = (await db.query('SELECT fleet_sync_token FROM drivers')).rows[0].fleet_sync_token;
    assert.notEqual(rotatedGrant, originalGrant, 'changing fleet membership must invalidate the captured grant');
    await db.exec("UPDATE drivers SET fleet_id = '44444444-4444-4444-8444-444444444444' WHERE id = '33333333-3333-4333-8333-333333333333'");
    const currentGrant = (await db.query('SELECT fleet_sync_token FROM drivers')).rows[0].fleet_sync_token;
    assert.notEqual(currentGrant, rotatedGrant);
    const otherDriverId = 'abababab-abab-4bab-8bab-abababababab';
    await db.query('INSERT INTO drivers(id,fleet_id) VALUES ($1,NULL)', [otherDriverId]);
    const otherCleanupGrant = (await db.query(
      'SELECT session_cleanup_token FROM drivers WHERE id=$1', [otherDriverId],
    )).rows[0].session_cleanup_token;
    await db.exec('SET ROLE authenticated');
    assert.equal((await db.query('SELECT id FROM drivers')).rows.length, 2);
    await assert.rejects(db.query('SELECT fleet_sync_token FROM drivers'));
    await assert.rejects(db.query('SELECT session_cleanup_token FROM drivers'));
    await assert.rejects(db.query('SELECT sync_cancel_token FROM sessions'));
    await assert.rejects(db.query('SELECT * FROM session_sync_token_cancellations'));
    await db.exec('RESET ROLE');

    const driverId = '33333333-3333-4333-8333-333333333333';
    const fleetId = '44444444-4444-4444-8444-444444444444';
    const cancelledId = '11111111-1111-4111-8111-111111111111';
    const cancelledToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.query('SELECT cancel_session_sync_v1($1,$2)', [cancelledId, driverId]);
    const cancelled = (await db.query(
      'SELECT start_session_sync_v1($1,$2,$3,$4,now(),NULL,NULL) AS result',
      [cancelledId, driverId, currentGrant, cancelledToken],
    )).rows[0].result;
    assert.equal(cancelled.cancelled, true);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 0);

    const staleGrantId = '55555555-5555-4555-8555-555555555555';
    const staleGrantCancelToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const staleGrantStart = (await db.query(
      'SELECT start_session_sync_v1($1,$2,$3,$4,now(),NULL,NULL) AS result',
      [staleGrantId, driverId, originalGrant, staleGrantCancelToken],
    )).rows[0].result;
    assert.equal(staleGrantStart.session.fleet_id, null, 'a token read before membership changed must fail closed inside session start');
    await db.query('SELECT cancel_session_sync_v1($1,$2)', [staleGrantId, driverId]);

    const startedId = '22222222-2222-4222-8222-222222222222';
    const startedCancelToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const started = (await db.query(
      'SELECT start_session_sync_v1($1,$2,$3,$4,now(),NULL,NULL) AS result',
      [startedId, driverId, currentGrant, startedCancelToken],
    )).rows[0].result;
    assert.equal(started.session.id, startedId);
    assert.equal(started.session.fleet_id, fleetId);
    const removed = (await db.query(
      'SELECT cancel_session_sync_v1($1,$2) AS result',
      [startedId, driverId],
    )).rows[0].result;
    assert.equal(removed.deleted, true);
    assert.equal(removed.cancellation_recorded, true);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 0);

    const tokenCancelledId = '66666666-6666-4666-8666-666666666666';
    const tokenCancelToken = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db.query(
      'SELECT start_session_sync_v1($1,$2,$3,$4,now(),NULL,NULL)',
      [tokenCancelledId, driverId, currentGrant, tokenCancelToken],
    );
    const wrongToken = (await db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3) AS result',
      [tokenCancelledId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', cleanupGrant],
    )).rows[0].result;
    assert.equal(wrongToken.settled, false);
    const tokenRemoved = (await db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3) AS result',
      [tokenCancelledId, tokenCancelToken, cleanupGrant],
    )).rows[0].result;
    assert.equal(tokenRemoved.settled, true);
    assert.equal(tokenRemoved.deleted, true);
    const tokenRemovedRetry = (await db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3) AS result',
      [tokenCancelledId, tokenCancelToken, cleanupGrant],
    )).rows[0].result;
    assert.equal(tokenRemovedRetry.settled, true, 'a lost cleanup response must remain idempotently confirmed');
    assert.equal(tokenRemovedRetry.deleted, false);
    const cancelledReplay = (await db.query(
      'SELECT start_session_sync_v1($1,$2,$3,$4,now(),NULL,NULL) AS result',
      [tokenCancelledId, driverId, currentGrant, tokenCancelToken],
    )).rows[0].result;
    assert.equal(cancelledReplay.cancelled, true, 'a delayed duplicate start cannot recreate a token-cancelled session');

    const absentId = '77777777-7777-4777-8777-777777777777';
    const absentToken = '12121212-1212-4212-8212-121212121212';
    const invalidCapability = (await db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3) AS result',
      [absentId, absentToken, '13131313-1313-4313-8313-131313131313'],
    )).rows[0].result;
    assert.equal(invalidCapability.invalid_capability, true);
    const otherDriverReceipt = (await db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3) AS result',
      [absentId, absentToken, otherCleanupGrant],
    )).rows[0].result;
    assert.equal(otherDriverReceipt.settled, true);
    const absentSettled = (await db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3) AS result',
      [absentId, absentToken, cleanupGrant],
    )).rows[0].result;
    assert.equal(absentSettled.settled, true, 'a driver-bound cleanup must settle a create that never inserted');
    assert.equal(absentSettled.deleted, false);
    assert.equal((await db.query(
      'SELECT count(*)::int AS count FROM session_sync_token_cancellations WHERE session_id=$1 AND cancel_token=$2',
      [absentId, absentToken],
    )).rows[0].count, 2, 'another driver receipt must not suppress the owner receipt');
    const absentReplay = (await db.query(
      'SELECT start_session_sync_v1($1,$2,$3,$4,now(),NULL,NULL) AS result',
      [absentId, driverId, currentGrant, absentToken],
    )).rows[0].result;
    assert.equal(absentReplay.cancelled, true, 'the absent-row receipt must block a late create');

    const completedId = '99999999-9999-4999-8999-999999999999';
    const completedToken = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await db.query(
      'SELECT start_session_sync_v1($1,$2,$3,$4,now(),NULL,NULL)',
      [completedId, driverId, currentGrant, completedToken],
    );
    await db.query('UPDATE sessions SET ended_at=now() WHERE id=$1', [completedId]);
    const completedRemoved = (await db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3) AS result',
      [completedId, completedToken, cleanupGrant],
    )).rows[0].result;
    assert.equal(completedRemoved.settled, true);
    assert.equal(completedRemoved.deleted, true, 'revocation must undo a final PATCH that committed while cleanup was in flight');

    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query(
      'SELECT cancel_session_sync_v1($1,$2)',
      [startedId, driverId],
    ));
    await assert.rejects(db.query(
      'SELECT cancel_session_sync_token_v1($1,$2,$3)',
      [tokenCancelledId, tokenCancelToken, cleanupGrant],
    ));
    await db.exec('RESET ROLE');
    assert.ok((await db.query('SELECT count(*)::int AS count FROM session_sync_token_cancellations')).rows[0].count > 0);
    await db.query('DELETE FROM drivers WHERE id=$1', [driverId]);
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM session_sync_token_cancellations')).rows[0].count,
      1,
      'account deletion must cascade only that driver\'s token-cleanup receipts',
    );
    await db.query('DELETE FROM drivers WHERE id=$1', [otherDriverId]);
    assert.equal((await db.query(
      'SELECT count(*)::int AS count FROM session_sync_token_cancellations',
    )).rows[0].count, 0);
  } finally { await db.close(); }
});

test('report snapshot migration returns a bounded report from one restricted database function', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE sessions (
        id uuid PRIMARY KEY, driver_id uuid NOT NULL, fleet_id uuid,
        started_at timestamptz NOT NULL, ended_at timestamptz,
        average_fatigue numeric, max_fatigue numeric, safety_score numeric,
        alert_count integer, head_nod_count integer, device text, browser text
      );
    `);
    await db.exec(reportMigration);
    await db.exec(`
      INSERT INTO sessions(id,driver_id,fleet_id,started_at,ended_at) VALUES
      ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','2026-09-11T02:00:00Z','2026-09-11T02:10:00Z'),
      ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','2026-09-11T01:00:00Z','2026-09-11T01:10:00Z'),
      ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','2026-09-11T03:00:00Z',NULL);
    `);
    const report = (await db.query(
      'SELECT fleet_session_report_v1($1,$2,$3) AS value',
      ['44444444-4444-4444-8444-444444444444', '2026-09-01T00:00:00Z', '2026-09-12T00:00:00Z'],
    )).rows[0].value;
    assert.deepEqual(
      report.sessions.map(row => row.id),
      ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    );
    assert.equal(report.complete, true);
    assert.equal((await db.query(
      "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='sessions' AND column_name='ingest_sequence'",
    )).rows[0].count, 0);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query(
      'SELECT fleet_session_report_v1($1,$2,$3)',
      ['44444444-4444-4444-8444-444444444444', '2026-09-01T00:00:00Z', '2026-09-12T00:00:00Z'],
    ));
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('Postgres primary keys make simultaneous retry inserts unique and owner-scoped', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE sessions (id uuid PRIMARY KEY, driver_id uuid NOT NULL, started_at timestamptz NOT NULL)');
    const pg = async (_table, options) => {
      try {
        if (options.method === 'POST') {
          const {id, driver_id, started_at} = options.body;
          return (await db.query('INSERT INTO sessions VALUES ($1,$2,$3) RETURNING *', [id,driver_id,started_at])).rows;
        }
        return (await db.query('SELECT * FROM sessions WHERE id=$1 AND driver_id=$2', [options.params.id.slice(3),options.params.driver_id.slice(3)])).rows;
      } catch (error) { throw Object.assign(error, { status: error.code === '23505' ? 409 : 500, details: { code: error.code } }); }
    };
    const id = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222';
    const body = {id, driver_id:owner, started_at:'2026-01-01T00:00:00Z'};
    const results = await Promise.all(Array.from({length:5}, () => insertOnce(pg,'sessions',body,{driver_id:'eq.'+owner})));
    assert.equal(results.length,5);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count,1);
    await assert.rejects(insertOnce(pg,'sessions',body,{driver_id:'eq.33333333-3333-4333-8333-333333333333'}));
  } finally { await db.close(); }
});

test('unfinished session cleanup is owner-scoped and cascades queued event rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        driver_id uuid NOT NULL,
        started_at timestamptz NOT NULL,
        ended_at timestamptz
      );
      CREATE TABLE events (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const ownerId = '22222222-2222-4222-8222-222222222222';
    const otherOwnerId = '33333333-3333-4333-8333-333333333333';
    const eventId = '44444444-4444-4444-8444-444444444444';
    await db.query('INSERT INTO sessions VALUES ($1,$2,$3,NULL)', [sessionId, ownerId, '2026-01-01T00:00:00Z']);
    await db.query('INSERT INTO events VALUES ($1,$2)', [eventId, sessionId]);
    assert.equal((await db.query('DELETE FROM sessions WHERE id=$1 AND driver_id=$2 AND ended_at IS NULL RETURNING id', [sessionId, otherOwnerId])).rows.length, 0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM events')).rows[0].count, 1);
    assert.equal((await db.query('DELETE FROM sessions WHERE id=$1 AND driver_id=$2 AND ended_at IS NULL RETURNING id', [sessionId, ownerId])).rows.length, 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM events')).rows[0].count, 0);
  } finally { await db.close(); }
});
