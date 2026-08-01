import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
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
});

test('dashboard keeps protected history separate from its local fallback', () => {
  const dashboard = read('fleet-dashboard.html');
  const start = dashboard.indexOf('/* protected-session-history:start */');
  const end = dashboard.indexOf('/* protected-session-history:end */');
  assert.ok(start >= 0 && end > start, 'protected session history block must be present');
  const history = dashboard.slice(start, end);

  assert.match(dashboard, /id="sessionHistory"/);
  assert.match(history, /if\(fleetMode\).*protectedSessions/s);
  assert.match(history, /return getJSON\('occulert-session-history',\[\]\)/);
  assert.match(history, /eventsForSession/);
  assert.match(history, /unverified_client_report/);
  assert.match(history, /OcculertSecurity\.csvCell/);
  assert.match(history, /value===null\|\|value===undefined/);
  assert.doesNotMatch(history, /latitude|longitude|\blocation\b|camera media|\baudio\b|raw motion/i);
});

test('roadmap and setup docs distinguish source completion from deployment', () => {
  const roadmap = read('APP_ROADMAP.md');
  const setup = read('BACKEND_SETUP.md');
  assert.match(roadmap, /protected session and event history implemented in source/i);
  assert.match(roadmap, /deployment verification pending/i);
  assert.match(setup, /manager-scoped session and event history excludes GPS/i);
});
