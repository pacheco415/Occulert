import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function markedBlock(source, name) {
  const startMarker = `/* ${name}:start */`;
  const endMarker = `/* ${name}:end */`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, `${name} block must be present`);
  return source.slice(start + startMarker.length, end);
}

test('manager history is scoped through fleet sessions and excludes location fields', () => {
  const api = read('api/fleet-summary.js');
  assert.match(api, /owner_user_id: "eq\." \+ user\.id/);
  assert.match(api, /fleet_id: "eq\." \+ fleet\.id/);
  assert.match(api, /session_id: "in\.\(" \+ sessionIds\.join\(","\) \+ "\)"/);
  assert.match(api, /select: "id,session_id,type,fatigue_score,confidence,created_at"/);
  assert.doesNotMatch(api, /select: "[^"]*(?:latitude|longitude)/i);
  assert.match(api, /includes_location: false/);
  assert.match(api, /includes_personal_media: false/);
  assert.match(api, /includes_raw_motion: false/);
  assert.match(api, /Promise\.all\(\[pgFetch\("drivers"/);
  assert.match(api, /includeEvents && sessionIds\.length/);
  assert.match(api, /events_included: includeEvents/);
});

test('dashboard keeps protected history separate from its local fallback', () => {
  const dashboard = read('fleet-dashboard.html');
  const history = markedBlock(dashboard, 'protected-session-history');

  assert.match(dashboard, /id="sessionHistory"/);
  assert.match(history, /if\(fleetMode\).*protectedSessions/s);
  assert.match(history, /return getJSON\('occulert-session-history',\[\]\)/);
  assert.match(history, /eventsForSession/);
  assert.match(history, /unverified_client_report/);
  assert.match(history, /OcculertSecurity\.csvCell/);
  assert.match(history, /value===null\|\|value===undefined/);
  assert.doesNotMatch(history, /latitude|longitude|\blocation\b|camera media|\baudio\b|raw motion/i);
  assert.match(dashboard, /getFleetSummary\(\{includeEvents\}\)/);
  assert.match(dashboard, /loadProtectedFleet\(\{includeEvents:true\}\)/);
  assert.match(dashboard, /includeEvents:protectedHistoryOpen\(\)/);
});

test('fleet projection preserves inactive and unmeasured driver states', () => {
  const dashboard = read('fleet-dashboard.html');
  const projection = markedBlock(dashboard, 'fleet-summary-projection');
  const context = {};
  vm.runInNewContext(`${projection};globalThis.rowsFromFleetForTest=rowsFromFleet`, context);

  const rows = JSON.parse(JSON.stringify(context.rowsFromFleetForTest({
    drivers: [
      { id: 'no-session', name: 'No Session', active: true },
      { id: 'inactive', name: 'Inactive Driver', active: false },
      { id: 'measured', name: 'Measured Driver', active: true },
    ],
    sessions: [
      { id: 'session-1', driver_id: 'measured', started_at: '2026-08-15T17:00:00.000Z', ended_at: null, safety_score: 64, max_fatigue: 58, alert_count: 1 },
      { id: 'session-2', driver_id: 'inactive', started_at: '2026-08-14T17:00:00.000Z', ended_at: '2026-08-14T18:00:00.000Z', safety_score: 91, max_fatigue: 12, alert_count: 0 },
    ],
  })));

  assert.deepEqual(rows.map(({ driverId, status, safetyScore, hasSafetyScore, hasSession, active, sessionActive }) => ({
    driverId,
    status,
    safetyScore,
    hasSafetyScore,
    hasSession,
    active,
    sessionActive,
  })), [
    { driverId: 'no-session', status: 'NO DATA', safetyScore: null, hasSafetyScore: false, hasSession: false, active: true, sessionActive: false },
    { driverId: 'inactive', status: 'INACTIVE', safetyScore: 91, hasSafetyScore: true, hasSession: true, active: false, sessionActive: false },
    { driverId: 'measured', status: 'WATCH', safetyScore: 64, hasSafetyScore: true, hasSession: true, active: true, sessionActive: true },
  ]);

  assert.match(dashboard, /scoreRows=activeRows\.filter\(d=>d\.hasSafetyScore\)/);
  assert.match(dashboard, /activeRows=rows\.filter\(d=>d\.active!==false\)/);
  assert.match(dashboard, /events=rows\.filter\(d=>d\.hasSession\)/);
  assert.match(dashboard, /GPS is not included/);
  assert.doesNotMatch(projection, /!s\?'SAFE'/);
});

test('roadmap and setup docs distinguish source completion from deployment', () => {
  const roadmap = read('APP_ROADMAP.md');
  const setup = read('BACKEND_SETUP.md');
  assert.match(roadmap, /protected session history.*production-verified/i);
  assert.match(roadmap, /Signed-in Preview verified.*two-driver no-session fleet/i);
  assert.match(roadmap, /production verification after merge remains pending/i);
  assert.match(setup, /manager-scoped session and event history excludes GPS/i);
  const backendRoadmap = read('BACKEND_ROADMAP.md');
  assert.match(backendRoadmap, /formula-safe report export/i);
  assert.match(backendRoadmap, /passed signed-in Preview review[\s\S]*two active drivers and no recorded sessions/i);
});
