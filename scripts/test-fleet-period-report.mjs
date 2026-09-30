import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const libPath = require.resolve('../api/_lib/supabase.js');
const endpointPath = require.resolve('../api/_lib/routes/fleet-period-report.js');
const OWNER = '11111111-1111-4111-8111-111111111111';
const FLEET = '22222222-2222-4222-8222-222222222222';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
function report(overrides = {}) {
  return { version: 1, days: 30, window_start: '2026-08-28T12:00:00.000Z',
    window_end: '2026-09-27T12:00:00.000Z', complete_period: true,
    roster_total: 6, active_drivers: 5, reporting_active_drivers: 4,
    sessions: 150, completed: 100, no_recorded_end: 40, invalid_recorded_end: 10,
    scored: 120, unscored: 30, average_safety_score: 78,
    valid_alert_records: 140, missing_alert_records: 10, alerts: 42,
    reviewed: 25, without_reviewed_followup: 125,
    detector_pipelines: { web_mediapipe_ear: 90, ios_mlkit_eye_probability: 30,
      android_mlkit_eye_probability: 10, unknown: 20 },
    interruption_reasons_available: false, unrecorded_sessions_detectable: false, ...overrides };
}
function harness({ user = { id: OWNER }, fleets = [{ id: FLEET, company_name: 'Protected fleet' }],
  result = report(), failure = null } = {}) {
  const calls = [];
  require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
    verifyAccessToken: async () => user, bearerToken: () => 'fixture',
    pgFetch: async (table, options) => {
      calls.push({ table, options });
      if (failure) throw failure;
      if (table === 'fleets') return fleets;
      if (table === 'rpc/fleet_period_report') return result;
      throw new Error('Unexpected table');
    },
  } };
  delete require.cache[endpointPath];
  const handler = require(endpointPath);
  async function invoke(url = '/api/fleet-period-report?days=30', method = 'GET') {
    const headers = {};
    const response = { statusCode: 200, setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
      end(value) { this.body = JSON.parse(value); } };
    await handler({ method, url, headers: { authorization: 'Bearer fixture' } }, response);
    return { status: response.statusCode, body: response.body, headers };
  }
  return { calls, invoke };
}

test('complete period API derives owner and fleet, returns only aggregate fields and privacy metadata', async () => {
  const app = harness();
  const response = await app.invoke();
  assert.equal(response.status, 200);
  assert.equal(app.calls[0].table, 'fleets');
  assert.equal(app.calls[0].options.params.owner_user_id, 'eq.' + OWNER);
  assert.equal(app.calls[1].table, 'rpc/fleet_period_report');
  assert.deepEqual(app.calls[1].options.body, { p_actor_id: OWNER, p_fleet_id: FLEET, p_days: 30 });
  assert.equal(response.body.report.sessions, 150);
  assert.equal(response.body.report.complete_period, true);
  assert.equal(response.body.privacy.includes_location, false);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers.vary, 'Authorization');
  for (const key of ['driver_id', 'session_id', 'latitude', 'longitude', 'personal_media', 'raw_motion']) {
    assert.equal(Object.hasOwn(response.body.report, key), false);
  }
});

test('owner and query errors never access another fleet report', async () => {
  const unsigned = harness({ user: null });
  assert.equal((await unsigned.invoke()).status, 401);
  assert.equal(unsigned.calls.length, 0);
  const nonowner = harness({ fleets: [] });
  assert.equal((await nonowner.invoke()).status, 403);
  assert.equal(nonowner.calls.some(call => call.table.startsWith('rpc/')), false);
  const invalid = harness();
  for (const url of ['/api/fleet-period-report?days=90', '/api/fleet-period-report?days=7&days=30',
    '/api/fleet-period-report?days=30&fleet_id=' + FLEET]) {
    assert.equal((await invalid.invoke(url)).status, 400);
  }
  assert.equal(invalid.calls.length, 0);
  assert.equal((await invalid.invoke('/api/fleet-period-report?days=30', 'POST')).status, 405);
});

test('inconsistent aggregates fail closed and missing migration has an explicit status', async () => {
  for (const result of [report({ sessions: 50 }), report({ detector_pipelines: { unknown: 150 } }),
    report({ average_safety_score: 101 }), report({ unrecorded_sessions_detectable: true })]) {
    const app = harness({ result });
    assert.equal((await app.invoke()).status, 502);
  }
  const app = harness({ failure: { details: { code: 'PGRST202' } } });
  const response = await app.invoke();
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'period_report_not_enabled');
});

test('migration aggregates across the entire period and never selects identity fields into JSON', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260927010000_fleet_period_report.sql', import.meta.url), 'utf8');
  assert.match(sql, /s\.started_at >= v_start and s\.started_at <= v_as_of/);
  assert.match(sql, /s\.fleet_id = p_fleet_id/);
  assert.match(sql, /f\.owner_user_id = p_actor_id/);
  assert.match(sql, /count\(\*\)::integer as sessions/);
  assert.doesNotMatch(sql, /\blimit\s+50\b/i);
  assert.doesNotMatch(sql, /'driver_id'|'session_id'|'latitude'|'longitude'/);
  assert.match(sql, /grant execute on function public\.fleet_period_report\(uuid, uuid, integer\) to service_role/);
});
