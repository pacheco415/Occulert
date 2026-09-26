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
  assert.match(dashboard, /refreshProtectedFleetNow\(\{forceEvents:true\}\)/);
  assert.match(dashboard, /shouldRefreshProtectedEvents\(\{historyOpen:protectedHistoryOpen\(\),lastLoadedAt:protectedEventsLoadedAt\}/);
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

function dashboardShareHarness(overrides = {}) {
  const dashboard = read('fleet-dashboard.html'), downloads = [], copies = [], notices = [];
  const now = Date.parse('2026-09-26T12:00:00Z');
  class ClockDate extends Date { static now() { return now; } }
  const row = { id: 'session', driver_id: 'driver', started_at: '2026-09-25T12:00:00Z',
    ended_at: '2026-09-25T12:30:00Z', safety_score: 80, alert_count: 0 };
  let user = { id: 'owner' }, csv = '';
  const context = {
    Date: ClockDate, demoRows: [], fleetMode: true, protectedUserId: 'owner', protectedFleetName: 'Private Fleet',
    protectedFleetPlan: 'trial', protectedDrivers: [{ id: 'driver', name: 'Private Driver', active: true }],
    protectedSessions: [row], protectedEvents: [], protectedTelemetryTrust: 'unverified_client_report',
    protectedReportPrivacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false },
    protectedReportShape: true, protectedLastSuccessfulAt: now, protectedRefreshFailures: 0,
    lastRows: [{ driverId: 'driver', name: 'Private Driver', status: 'SAFE', hasSafetyScore: true,
      safetyScore: 80, hasSession: true, fatigue: 20, alerts: 0 }], lastOpsSummary: 'Private Driver needs review',
    getJSON: () => [{ ...row, name: 'Local Demo Driver', driverId: 'demo-driver' }], getDrivers: () => [],
    toast: message => notices.push(message), fromArg: value => value, ageLabel: () => 'recent',
    navigator: { clipboard: { writeText: text => copies.push(text) } }, alert: text => copies.push(text),
    OcculertSecurity: { csvCell: value => String(value ?? '') },
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: blob => { csv = blob.parts.join(''); return 'blob:test'; }, revokeObjectURL() {} },
    document: { getElementById: id => id === 'pilotRange' ? { value: '30' } : null,
      createElement: () => ({ click() { downloads.push({ name: this.download, csv }); }, remove() {} }),
      body: { appendChild() {} } },
    window: { OcculertBackend: { currentUser: () => user } }, ...overrides,
  };
  vm.runInNewContext(read('fleet-pilot-report.v56.js'), context);
  vm.runInNewContext(markedBlock(dashboard, 'protected-session-history') + markedBlock(dashboard, 'dashboard-sharing'), context);
  return { context, downloads, copies, notices, user: value => { user = value; } };
}

test('every protected CSV and copy action rechecks the owner, freshness, and privacy at the action', () => {
  const denied = [
    { user: null }, { user: { id: 'another-owner' } }, { protectedRefreshFailures: 1 },
    { protectedLastSuccessfulAt: Date.parse('2026-09-26T11:54:59Z') }, { protectedTelemetryTrust: '' },
    { protectedReportPrivacy: { includes_location: true, includes_personal_media: false, includes_raw_motion: false } },
    { protectedReportShape: false },
  ];
  for (const { user, ...overrides } of denied) {
    const app = dashboardShareHarness(overrides);
    if (user !== undefined) app.user(user);
    // Records remain cached: the action must gate before reading or downloading them.
    app.context.exportSessionHistoryCSV(); app.context.exportFleetCSV(); app.context.exportPilotReport();
    app.context.copyDriver('driver'); app.context.copyOpsSummary();
    assert.equal(app.downloads.length, 0, JSON.stringify({ user, ...overrides }));
    assert.equal(app.copies.length, 0);
    assert.equal(app.notices.length, 5);
  }
  const fresh = dashboardShareHarness();
  fresh.context.exportSessionHistoryCSV(); fresh.context.exportFleetCSV(); fresh.context.exportPilotReport();
  fresh.context.copyDriver('driver'); fresh.context.copyOpsSummary();
  assert.equal(fresh.downloads.length, 3);
  assert.equal(fresh.copies.length, 2);
  assert.ok(fresh.downloads.every(download => download.csv.includes('Private Driver')));
  fresh.user(null);
  fresh.context.exportSessionHistoryCSV(); fresh.context.exportFleetCSV(); fresh.context.exportPilotReport();
  assert.equal(fresh.downloads.length, 3, 'same-tab sign-out blocks cached data without waiting for a refresh');
  fresh.user({ id: 'another-owner' });
  fresh.context.copyDriver('driver'); fresh.context.copyOpsSummary();
  assert.equal(fresh.copies.length, 2, 'same-tab account switch blocks cached protected copies');
});

test('local fallback exports are explicitly labeled and never become a protected trial report', () => {
  const app = dashboardShareHarness({ fleetMode: false, protectedUserId: '', lastRows: [{ name: 'Local Demo Driver' }] });
  app.user(null);
  app.context.exportSessionHistoryCSV(); app.context.exportFleetCSV(); app.context.exportPilotReport();
  assert.deepEqual(app.downloads.map(download => download.name), [
    'occulert-local-demo-session-history.csv', 'occulert-local-demo-fleet-dashboard.csv',
  ]);
  assert.ok(app.downloads.every(download => download.csv.includes('Local Demo Driver')));
  assert.ok(app.downloads.every(download => !download.csv.includes('Private Driver')));
});

test('local session history preserves the saved mean fatigue instead of the final sample', () => {
  const app = dashboardShareHarness();
  assert.equal(app.context.sessionView({ avgFatigue: 24, fatigue: 70 }).averageFatigue, 24);
  assert.equal(app.context.sessionView({ avgFatigue: 0, fatigue: 70 }).averageFatigue, 0);
  assert.equal(app.context.sessionView({ average_fatigue: 18, avgFatigue: 24, fatigue: 70 }).averageFatigue, 18);
});

function csvRows(csv) {
  const rows = [[]];
  let field = '', quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      rows.at(-1).push(field); field = '';
      if (char === '\n') rows.push([]);
    } else field += char;
  }
  assert.equal(quoted, false, 'CSV quotes must be closed');
  rows.at(-1).push(field);
  return rows;
}

test('fleet/history/trial downloads contain parseable CSV rows and copies contain real line breaks', () => {
  const app = dashboardShareHarness(), name = 'Private, "Driver"';
  app.context.protectedDrivers[0].name = name;
  app.context.lastRows[0].name = name;
  app.context.exportFleetCSV(); app.context.exportSessionHistoryCSV(); app.context.exportPilotReport();
  for (const download of app.downloads) {
    const rows = csvRows(download.csv);
    assert.equal(rows.length, 2, download.name);
    assert.equal(rows[0].length, rows[1].length, download.name);
    assert.ok(rows[1].includes(name), 'commas and quotes round-trip in driver names');
    assert.ok(!download.csv.includes('\\n'), 'row separators must be actual newlines');
  }
  app.context.copyDriver('driver');
  assert.equal(app.copies[0].split('\n').length, 3);
  const assignment = read('fleet-dashboard.html').match(/^  lastOpsSummary=(.*);$/m);
  assert.ok(assignment);
  app.context.actions = [{ label: 'Review one', value: 'Driver one' }, { label: 'Review two', value: 'Driver two' }];
  vm.runInNewContext(`lastOpsSummary=${assignment[1]}`, app.context);
  app.context.copyOpsSummary();
  assert.deepEqual(app.copies[1].split('\n'), ['Review one: Driver one', 'Review two: Driver two']);
});

test('completion and event samples preserve unavailable recorded state instead of claiming live or absent events', () => {
  const app = dashboardShareHarness(), classify = app.context.sessionCompletionState;
  const start = '2026-09-25T12:00:00Z';
  assert.equal(classify({ startedAt: start, endedAt: '2026-09-25T12:30:00Z' }), 'Completed');
  assert.equal(classify({ startedAt: start, endedAt: null }), 'No recorded end time');
  for (const endedAt of ['invalid', '2026-09-24T12:00:00Z', '2026-09-27T12:00:00Z']) {
    assert.equal(classify({ startedAt: start, endedAt }), 'Invalid recorded dates');
    assert.equal(app.context.durationLabel(start, endedAt), 'Not recorded');
  }
  app.context.protectedSessions.push(...[null, 'invalid', '2026-09-24T12:00:00Z', '2026-09-27T12:00:00Z'].map((ended_at, index) => ({
    id: `unknown-${index}`, driver_id: 'driver', started_at: start, ended_at,
  })));
  assert.equal(app.context.pilotMetrics().completed, 1);
  const history = { innerHTML: '' };
  app.context.esc = value => String(value ?? '');
  app.context.document.getElementById = id => id === 'sessionHistory' ? history : { value: '30' };
  app.context.document.querySelector = () => ({ open: true });
  app.context.renderSessionHistory();
  assert.match(history.innerHTML, /No recorded end time/);
  assert.match(history.innerHTML, /Invalid recorded dates/);
  assert.match(history.innerHTML, /No alert events in the available sample/);
  assert.match(history.innerHTML, /up to 20 per session from up to 200 recent fleet events/);
  assert.doesNotMatch(history.innerHTML, />Active<|No alert events were recorded/);
  app.context.protectedEvents = Array.from({ length: 25 }, () => ({ session_id: 'session' }));
  app.context.exportSessionHistoryCSV();
  assert.match(app.downloads[0].csv, /"available_event_count"/);
  assert.match(app.downloads[0].csv, /"20","unverified_client_report"/);
});

test('roadmap and setup docs distinguish source completion from deployment', () => {
  const roadmap = read('docs/APP_ROADMAP.md');
  const setup = read('BACKEND_SETUP.md');
  assert.match(roadmap, /Shipped web.*merged and production-verified/i);
  assert.match(roadmap, /Manager reporting and follow-ups \| Shipped web/i);
  assert.match(roadmap, /latest 50 protected sessions/i);
  assert.match(roadmap, /Source tests cannot close those gaps/i);
  assert.match(roadmap, /Record Preview, merged\s+source, production, installed binary, and device evidence separately/i);
  assert.match(setup, /manager-scoped session and event history excludes GPS/i);
  const backendRoadmap = read('docs/BACKEND_ROADMAP.md');
  assert.match(backendRoadmap, /owner-scoped records/i);
  assert.match(backendRoadmap, /latest-50-session snapshot/i);
  assert.match(backendRoadmap, /release verification is separate from real-pilot operating evidence/i);
});
