import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('fleet-display.v54.js');
const context = { globalThis: {} };
context.globalThis.globalThis = context.globalThis;
vm.runInNewContext(source, context);
const display = context.globalThis.OcculertFleetDisplay;

test('TV display derives aggregate operations metrics without exposing identities', () => {
  const now = Date.parse('2026-09-24T18:00:00.000Z');
  const result = display.summarize({
    drivers: [
      { id: 'driver-a', name: 'Private Name', active: true, vehicle_id: 'Van 1' },
      { id: 'driver-b', name: 'Another Name', active: true, vehicle_id: 'Van 2' },
      { id: 'driver-c', name: 'Inactive Name', active: false },
    ],
    sessions: [
      { driver_id: 'driver-a', started_at: '2026-09-24T17:50:00.000Z', ended_at: null, alert_count: 0, safety_score: 90 },
      { driver_id: 'driver-b', started_at: '2026-09-24T16:30:00.000Z', ended_at: '2026-09-24T17:30:00.000Z', alert_count: 1, safety_score: 68 },
      { driver_id: 'driver-a', started_at: '2026-09-22T16:00:00.000Z', ended_at: '2026-09-22T17:00:00.000Z', alert_count: 0, safety_score: 92 },
      { driver_id: 'driver-c', started_at: '2026-09-23T16:00:00.000Z', ended_at: '2026-09-23T17:00:00.000Z', alert_count: 0, safety_score: 95 },
      { driver_id: 'driver-a', started_at: '2026-08-01T16:00:00.000Z', ended_at: '2026-08-01T17:00:00.000Z', alert_count: 4, safety_score: 20 },
    ],
  }, now);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    activeSessions: 1,
    activeDrivers: 2,
    recentSessions: 4,
    reviewSessions: 1,
    participatingDrivers: 2,
    coverage: 100,
    pulse: { now: 1, hour: 1, day: 0, month: 2 },
  });
  assert.equal(JSON.stringify(result).includes('Private Name'), false);
  assert.equal(JSON.stringify(result).includes('Van 1'), false);
});

test('TV refresh policy is active-aware, data-aware, and bounded after failures', () => {
  assert.equal(display.refreshDelay({ activeSessions: 1 }, 0, false), 30000);
  assert.equal(display.refreshDelay({ activeSessions: 0 }, 0, false), 90000);
  assert.equal(display.refreshDelay({ activeSessions: 0 }, 0, true), 180000);
  assert.equal(display.refreshDelay({ activeSessions: 0 }, 9, true), 900000);
});

test('TV surface requests the owner-scoped summary without raw events or local fallback', () => {
  const html = read('fleet-display.html');
  assert.match(source, /getFleetSummary\(\{ includeEvents: false \}\)/);
  assert.match(source, /No local or demo data is used here/);
  assert.match(html, /Driver names, vehicles, locations, individual scores, personal media, and raw events are not shown/);
  assert.doesNotMatch(html, /driverSearch|export|invite|latitude|longitude/i);
  assert.doesNotMatch(source, /localStorage|getItem\(|setItem\(|latitude|longitude|vehicle_id|\.name\b/);
});
