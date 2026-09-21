import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
try {
  await db.exec(`
    create table drivers (id uuid primary key, fleet_id uuid);
    create table sessions (id uuid primary key, fleet_id uuid, driver_id uuid, started_at timestamptz);
    create table events (id uuid primary key, session_id uuid, created_at timestamptz);
    create table fleet_invitations (id uuid primary key, invited_by uuid, accepted_by uuid);
    insert into drivers select md5('driver' || n)::uuid, md5('fleet' || (n % 100))::uuid from generate_series(1,20000) n;
    insert into sessions select md5('session' || n)::uuid, md5('fleet' || (n % 100))::uuid,
      md5('driver' || n)::uuid, '2026-01-01'::timestamptz + (n / 4) * interval '1 minute' from generate_series(1,20000) n;
    insert into events select md5('event' || n)::uuid, md5('session' || (n % 1000 + 1))::uuid,
      '2026-01-01'::timestamptz + n * interval '1 minute' from generate_series(1,20000) n;
    insert into fleet_invitations select md5('invite' || n)::uuid, md5('owner' || (n % 100))::uuid,
      case when n % 2 = 0 then md5('owner' || (n % 100))::uuid end from generate_series(1,20000) n;
    analyze;
  `);
  const queries = [
    ['drivers_fleet_id_idx', "select * from drivers where fleet_id=md5('fleet1')::uuid order by id"],
    ['sessions_fleet_started_id_idx', "select id,driver_id,started_at from sessions where fleet_id=md5('fleet1')::uuid order by started_at desc,id desc limit 50"],
    ['sessions_driver_id_idx', "select * from sessions where driver_id=md5('driver1')::uuid"],
    ['events_session_created_idx', "select * from events where session_id=md5('session1')::uuid order by created_at desc limit 200"],
    ['fleet_invitations_invited_by_idx', "select * from fleet_invitations where invited_by=md5('owner2')::uuid order by id"],
    ['fleet_invitations_accepted_by_idx', "select * from fleet_invitations where accepted_by=md5('owner2')::uuid order by id"],
  ];
  const before = await Promise.all(queries.map(async ([, sql]) => (await db.query(sql)).rows));
  const oldPlan = JSON.stringify((await db.query('explain (format json) ' + queries[1][1])).rows);
  assert.ok(oldPlan.includes('Seq Scan'), 'fixture must represent the unindexed baseline');
  const migration = readFileSync(new URL('../supabase/migrations/20260921042324_fleet_query_indexes.sql', import.meta.url), 'utf8');
  await db.exec('begin;' + migration + ';commit; analyze;');
  for (let i = 0; i < queries.length; i++) {
    const [index, sql] = queries[i];
    assert.deepEqual((await db.query(sql)).rows, before[i], 'index must preserve query results');
    const plan = JSON.stringify((await db.query('explain (format json) ' + sql)).rows);
    assert.ok(plan.includes(index), `planner should select ${index} without forcing index scans`);
    if (i === 1) assert.ok(!plan.includes('"Node Type":"Sort"'), 'recent trips should not require sorting the fleet history');
  }
  console.log('Fleet indexes passed: six query plans use their indexes on 20,000-row fixtures; query results are unchanged.');
} finally { await db.close(); }
