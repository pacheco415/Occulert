import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const FLEET = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const sql = readFileSync(new URL('../supabase/migrations/20260927010000_fleet_period_report.sql', import.meta.url), 'utf8');

test('database aggregate counts 150 records without exposing rows across owners', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.fleets(id uuid primary key, owner_user_id uuid not null);
      create table public.drivers(id uuid primary key, fleet_id uuid not null, active boolean not null);
      create table public.sessions(id uuid primary key, driver_id uuid not null, fleet_id uuid not null,
        started_at timestamptz not null, ended_at timestamptz, safety_score numeric,
        alert_count integer, detector_pipeline text);
      create table public.fleet_session_followups(session_id uuid primary key,
        status text not null, version integer not null);
    `);
    await db.exec(sql);
    await db.query('insert into public.fleets(id,owner_user_id) values($1,$2)', [FLEET, OWNER]);
    await db.query('insert into public.drivers(id,fleet_id,active) values($1,$2,true)', [DRIVER, FLEET]);
    await db.query(`insert into public.sessions(id,driver_id,fleet_id,started_at,ended_at,safety_score,alert_count,detector_pipeline)
      select gen_random_uuid(), $1::uuid, $2::uuid,
        now() - interval '1 day' - n * interval '1 minute',
        case when n % 3 = 0 then null
          when n % 3 = 1 then now() - interval '1 day' - n * interval '1 minute' + interval '30 minutes'
          else now() - interval '1 day' - n * interval '1 minute' - interval '1 minute' end,
        case when n % 5 = 0 then null else 80 end,
        case when n % 10 = 0 then null else 1 end,
        case when n % 2 = 0 then 'web_mediapipe_ear' else 'ios_mlkit_eye_probability' end
      from generate_series(1,150) n`, [DRIVER, FLEET]);
    await db.exec(`insert into public.fleet_session_followups(session_id,status,version)
      select id,'reviewed',1 from public.sessions order by started_at desc limit 25`);
    const value = await db.query('select public.fleet_period_report($1::uuid,$2::uuid,30) as report', [OWNER, FLEET]);
    const report = value.rows[0].report;
    assert.equal(report.sessions, 150);
    assert.equal(report.completed, 50);
    assert.equal(report.no_recorded_end, 50);
    assert.equal(report.invalid_recorded_end, 50);
    assert.equal(report.scored, 120);
    assert.equal(report.unscored, 30);
    assert.equal(report.valid_alert_records, 135);
    assert.equal(report.missing_alert_records, 15);
    assert.equal(report.alerts, 135);
    assert.equal(report.reviewed, 25);
    assert.equal(report.without_reviewed_followup, 125);
    assert.equal(report.detector_pipelines.web_mediapipe_ear, 75);
    assert.equal(report.detector_pipelines.ios_mlkit_eye_probability, 75);
    assert.equal(report.reporting_active_drivers, 1);
    assert.equal(Object.hasOwn(report, 'driver_id'), false);
    const denied = await db.query('select public.fleet_period_report($1::uuid,$2::uuid,30) as report', [OTHER, FLEET]);
    assert.equal(denied.rows[0].report, null);
  } finally { await db.close(); }
});
