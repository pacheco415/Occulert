import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const OWNER = '11111111-1111-4111-8111-111111111111';
const FLEET = '22222222-2222-4222-8222-222222222222';
const route = '/api/fleet-time-of-day';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';

function report(days = 7) {
  return { version: 1, days, window_start: days === 7 ? '2026-11-01T12:00:00Z' : '2026-10-09T12:00:00Z',
    window_end: '2026-11-08T12:00:00Z', timezone: 'America/Los_Angeles',
    blocks: Array.from({ length: 6 }, (_, i) => ({ start_hour: i * 4, monitored_minutes: i ? 0 : 120,
      drowsy_alerts: i ? 0 : 3, distracted_alerts: 0, rate_available: !i,
      drowsy_alerts_per_hour: i ? null : 1.5 })) };
}

function harness({ user = { id: OWNER }, fleets = [{ id: FLEET, company_name: 'Private' }],
  result = report(), failure } = {}) {
  const supabase = require.resolve('../api/_lib/supabase.js');
  const endpoint = require.resolve('../api/_lib/routes/fleet-time-of-day.js');
  const calls = [];
  require.cache[supabase] = { id: supabase, filename: supabase, loaded: true, exports: {
    verifyAccessToken: async () => user, bearerToken: () => 'fixture',
    pgFetch: async (path, options) => {
      calls.push({ path, options });
      if (path === 'fleets') return fleets;
      assert.equal(path, 'rpc/fleet_time_of_day_report');
      if (failure) throw failure;
      return result;
    },
  } };
  delete require.cache[require.resolve('../api/_lib/fleet-period.js')];
  delete require.cache[endpoint];
  const handler = require(endpoint);
  async function invoke(search = '?days=7', method = 'GET') {
    const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      end(value) { this.body = JSON.parse(value); } };
    await handler({ url: route + search, method, headers: {} }, response);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers.vary, 'Authorization');
    return response;
  }
  return { invoke, calls };
}

test('both periods return only the verified owner’s fleet aggregates', async () => {
  for (const days of [7, 30]) {
    const result = report(days);
    const app = harness({ result });
    const response = await app.invoke('?days=' + days);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, report: result, telemetry_trust: 'unverified_client_report' });
    assert.equal(app.calls[0].options.params.owner_user_id, 'eq.' + OWNER);
    assert.deepEqual(app.calls[1].options, { method: 'POST', body: { p_actor_id: OWNER, p_fleet_id: FLEET, p_days: days } });
  }
});

test('configuration, method, query and owner checks precede the report call', async () => {
  const app = harness();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try { assert.equal((await app.invoke()).statusCode, 501); }
  finally { process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only'; }
  const post = await app.invoke('?days=7', 'POST');
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, 'GET');
  for (const search of ['', '?days=14', '?days=7&days=7', '?days=7&fleet_id=' + FLEET]) {
    assert.equal((await app.invoke(search)).statusCode, 400);
  }
  assert.equal(app.calls.length, 0);
  const unsigned = harness({ user: null });
  assert.equal((await unsigned.invoke()).statusCode, 401);
  assert.equal(unsigned.calls.length, 0);
  const nonowner = harness({ fleets: [] });
  assert.equal((await nonowner.invoke()).statusCode, 403);
  assert.deepEqual(nonowner.calls.map(c => c.path), ['fleets']);
});

test('malformed data and extra fields are never returned to the caller', async () => {
  for (const change of [
    r => { r.days = 30; }, r => { r.timezone = 'UTC'; }, r => { r.window_end = r.window_start; },
    r => { r.driver_id = OWNER; }, r => { r.blocks.pop(); }, r => { r.blocks.reverse(); },
    r => { r.blocks[2].latitude = 1; }, r => { r.blocks[3].distracted_alerts = -1; },
    r => { r.blocks[1].drowsy_alerts_per_hour = 0; }, r => { r.blocks[0].monitored_minutes = 119.99; },
    r => { r.blocks[0].drowsy_alerts_per_hour = 4; },
  ]) {
    const result = report();
    change(result);
    const response = await harness({ result }).invoke();
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, { ok: false, error: 'period_report_unavailable' });
  }
  const missing = await harness({ failure: { details: { code: 'PGRST202' } } }).invoke();
  assert.equal(missing.statusCode, 503);
});
