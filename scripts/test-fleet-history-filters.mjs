import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const libPath = require.resolve('../api/_lib/supabase.js');
const endpointPath = require.resolve('../api/fleet-session-history.js');
const OWNER = '11111111-1111-4111-8111-111111111111';
const FLEET = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
function row(id = SESSION, started = '2026-09-25T12:00:00.000Z', driver = DRIVER) {
  return { id, driver_id: driver, started_at: started, ended_at: null,
    average_fatigue: 12, max_fatigue: 25, safety_score: 80, alert_count: 1, head_nod_count: 0 };
}
function harness({ user = { id: OWNER }, fleet = FLEET, roster = [{ id: DRIVER, name: 'Driver One' }],
  exact = [], pages = [[row()], []] } = {}) {
  const calls = [];
  let sessionCalls = 0;
  require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: {
    verifyAccessToken: async () => user, bearerToken: () => 'fixture',
    pgFetch: async (table, options) => {
      calls.push({ table, options });
      if (table === 'fleets') return [{ id: fleet, company_name: 'Protected fleet' }];
      if (table === 'drivers') return options.params.id?.startsWith('eq.') ? exact :
        options.params.id?.startsWith('in.') && exact.length ? exact : roster;
      if (table === 'sessions') return pages[sessionCalls++] || [];
      throw new Error('Unexpected table ' + table);
    },
  } };
  delete require.cache[endpointPath];
  const endpoint = require(endpointPath);
  async function invoke(url) {
    const response = { statusCode: 200, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    await endpoint({ method: 'GET', url, headers: { authorization: 'Bearer fixture' } }, response);
    return { status: response.statusCode, body: response.body };
  }
  return { calls, invoke };
}
const filter = 'driver_id=' + DRIVER + '&from=2026-09-20T00%3A00%3A00.000Z&to=2026-09-27T00%3A00%3A00.000Z';

test('driver and date filters run at the database before pagination and stay owner-scoped', async () => {
  const app = harness();
  const result = await app.invoke('/api/fleet-session-history?' + filter);
  assert.equal(result.status, 200);
  assert.equal(result.body.sessions.length, 1);
  assert.equal(result.body.sessions[0].driver_name, 'Driver One');
  assert.equal(result.body.filters.driver_id, DRIVER);
  assert.equal(result.body.filters.from, '2026-09-20T00:00:00.000Z');
  assert.equal(result.body.has_more, false);
  const main = app.calls.find(call => call.table === 'sessions' && call.options.params.select.includes('driver_id'));
  assert.equal(main.options.params.fleet_id, 'eq.' + FLEET);
  assert.equal(main.options.params.driver_id, 'eq.' + DRIVER);
  assert.match(main.options.params.and, /started_at\.gte\./);
  assert.match(main.options.params.and, /started_at\.lt\./);
  assert.equal(app.calls.find(call => call.table === 'fleets').options.params.owner_user_id, 'eq.' + OWNER);
  assert.doesNotMatch(JSON.stringify(result.body), /latitude|longitude|camera|audio/);
});

test('unknown driver and malformed date are rejected before reading sessions', async () => {
  const app = harness();
  const invalidDriver = '55555555-5555-4555-8555-555555555555';
  assert.equal((await app.invoke('/api/fleet-session-history?driver_id=' + invalidDriver)).status, 400);
  assert.equal(app.calls.some(call => call.table === 'sessions'), false);
  const bad = harness();
  assert.equal((await bad.invoke('/api/fleet-session-history?from=2026-02-30T00%3A00%3A00Z')).status, 400);
  assert.equal(bad.calls.length, 0);
});

test('cursor retains exact server filters and never carries authority', async () => {
  const olderId = '66666666-6666-4666-8666-666666666666';
  const app = harness({ pages: [[row()], [{ id: olderId, started_at: '2026-09-24T12:00:00.000Z' }],
    [row(olderId, '2026-09-24T12:00:00.000Z', DRIVER)], []] });
  const first = await app.invoke('/api/fleet-session-history?' + filter);
  assert.equal(first.status, 200);
  assert.equal(first.body.has_more, true);
  const second = await app.invoke('/api/fleet-session-history?cursor=' + encodeURIComponent(first.body.next_cursor));
  assert.equal(second.status, 200);
  assert.equal(second.body.sessions.length, 1);
  assert.equal(second.body.has_more, false);
  const secondMain = app.calls.filter(call => call.table === 'sessions' && call.options.params.select.includes('driver_id'))[1];
  assert.equal(secondMain.options.params.driver_id, 'eq.' + DRIVER);
  assert.equal(secondMain.options.params.fleet_id, 'eq.' + FLEET);
  assert.match(secondMain.options.params.and, /started_at\.gte\./);
  assert.match(secondMain.options.params.and, /id\.lt\./);
  const mixed = await app.invoke('/api/fleet-session-history?cursor=' + first.body.next_cursor + '&driver_id=' + DRIVER);
  assert.equal(mixed.status, 400);
});

test('selected owner driver beyond first 1000 roster rows remains valid', async () => {
  const roster = Array.from({ length: 1001 }, (_, index) => ({ id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`, name: 'Driver ' + index }));
  const selected = '88888888-8888-4888-8888-888888888888';
  const app = harness({ roster, exact: [{ id: selected, name: 'Selected driver' }], pages: [[row(SESSION, '2026-09-25T12:00:00.000Z', selected)], []] });
  const result = await app.invoke('/api/fleet-session-history?driver_id=' + selected);
  assert.equal(result.status, 200);
  assert.equal(result.body.driver_filter_complete, false);
  assert.equal(result.body.drivers.length, 1000);
  assert.ok(result.body.drivers.some(driver => driver.id === selected));
  assert.equal(result.body.sessions[0].driver_name, 'Selected driver');
  const exactCall = app.calls.find(call => call.table === 'drivers' && call.options.params.id?.startsWith('eq.'));
  assert.equal(exactCall.options.params.fleet_id, 'eq.' + FLEET);
});
