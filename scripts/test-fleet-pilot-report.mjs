import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../fleet-pilot-report.v56.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../fleet-dashboard.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../fleet-pilot-report.v56.css', import.meta.url), 'utf8');
const privacy = { includes_location: false, includes_personal_media: false, includes_raw_motion: false };
const now = Date.parse('2026-09-25T12:00:00.000Z');
function fixture(overrides = {}, at = now) {
  return { fleetMode: true, userId: 'owner', currentUserId: 'owner', fleetName: 'Example fleet', days: 7,
    lastSuccessfulAt: at, refreshFailures: 0, telemetryTrust: 'unverified_client_report', privacy, summaryValid: true,
    drivers: [{ id: 'driver', active: true }], sessions: [], ...overrides };
}
function library() {
  const context = { window: {}, document: { getElementById: () => null } };
  vm.runInNewContext(source, context);
  return context.window.OcculertPilotReport;
}
const api = library();

test('protected report requires current owner, successful fresh source and explicit trust/privacy metadata', () => {
  const cases = [
    { fleetMode: false }, { userId: '' }, { currentUserId: 'another-owner' }, { lastSuccessfulAt: 0 },
    { refreshFailures: 1 }, { lastSuccessfulAt: now - 300001 }, { lastSuccessfulAt: now + 1 },
    { telemetryTrust: '' }, { telemetryTrust: 'verified' }, { privacy: null }, { summaryValid: false }, { sessions: null }, { drivers: null },
    { privacy: { ...privacy, includes_location: true } }, { privacy: { ...privacy, includes_personal_media: true } },
    { privacy: { ...privacy, includes_raw_motion: true } }, { privacy: {} },
  ];
  for (const overrides of cases) {
    const summary = api.summarize(fixture({ sessions: [{ started_at: '2026-09-24', safety_score: 88 }], ...overrides }), null, now);
    assert.equal(summary.available, false, JSON.stringify(overrides));
    assert.equal(summary.sessions, undefined, 'unavailable must not expose fabricated counts');
  }
  assert.equal(api.summarize(fixture(), null, now).available, true);
});

test('windows count recorded completions, preserve real zero scores and avoid inferring interruptions or live state', () => {
  const sessions = [
    { id: 'zero', driver_id: 'driver', started_at: '2026-09-24T12:00:00Z', ended_at: '2026-09-24T12:30:00Z', safety_score: 0, alert_count: 0 },
    { id: 'null', driver_id: 'driver', started_at: '2026-09-23T12:00:00Z', ended_at: null, safety_score: null, alert_count: null },
    { id: 'redacted', driver_id: 'inactive', started_at: '2026-09-22T12:00:00Z', ended_at: '', safety_score: 'redacted', alert_count: 2 },
    { id: 'badend', driver_id: 'driver', started_at: '2026-09-21T12:00:00Z', ended_at: 'invalid', safety_score: false, alert_count: -2 },
    { id: 'beforestart', driver_id: 'driver', started_at: '2026-09-20T12:00:00Z', ended_at: '2026-09-19T12:00:00Z', safety_score: ' ', alert_count: 1.2 },
    { id: 'futureend', driver_id: 'driver', started_at: '2026-09-19T12:00:00Z', ended_at: '2026-09-26T12:00:00Z', safety_score: 101, alert_count: 1 },
    { id: 'old', driver_id: 'driver', started_at: '2026-09-10T12:00:00Z', ended_at: '2026-09-10T12:30:00Z', safety_score: 100, alert_count: 3 },
    { id: 'future', driver_id: 'driver', started_at: '2026-09-26T12:00:00Z', safety_score: 95, alert_count: 0 },
    { id: 'invalid', driver_id: 'driver', started_at: 'missing', safety_score: 95, alert_count: 0 },
  ];
  const summary = api.summarize(fixture({ sessions, drivers: [{ id: 'driver', active: true }, { id: 'inactive', active: false }, { id: 'no-session', active: true }] }), null, now);
  assert.equal(summary.sessions, 6);
  assert.equal(summary.completed, 1);
  assert.equal(summary.noEnd, 2);
  assert.equal(summary.invalidEnds, 3);
  assert.equal(summary.interrupted, null);
  assert.equal(summary.unscored, 5);
  assert.equal(summary.scored, 1);
  assert.equal(summary.average, 0);
  assert.equal(summary.alerts, 3);
  assert.equal(summary.missingAlerts, 3);
  assert.equal(summary.invalidStarts, 2);
  assert.equal(summary.reportingDrivers, 1);
  assert.equal(summary.activeDrivers, 2);
  assert.equal(summary.coverage, 50);
  const month = api.summarize(fixture({ days: 30, sessions }), null, now);
  assert.equal(month.sessions, 7);
  assert.equal(month.completed, 2);
  assert.equal(month.average, 50);
  assert.match(api.reportNotes(summary).join('\n'), /No end time does not prove an active or interrupted session/);
});

test('report preserves the last-50 cap and never exports raw session or driver fields', () => {
  const sessions = Array.from({ length: 55 }, (_, index) => ({ id: `private-session-${index}`, driver_id: 'private-driver',
    started_at: '2026-09-24T12:00:00Z', ended_at: null, safety_score: 80, alert_count: 2,
    name: 'Private Driver Name', latitude: 37.771234, longitude: -122.418765, audio: 'private-audio', raw_motion: 'private-motion' }));
  const summary = api.summarize(fixture({ sessions }), null, now);
  assert.equal(summary.sessions, 50);
  assert.equal(summary.sourceCount, 50);
  assert.equal(summary.capped, true);
  const report = JSON.stringify([summary, api.reportRows(summary), api.reportNotes(summary)]);
  assert.doesNotMatch(report, /private-session|private-driver|Private Driver Name|37\.771234|-122\.418765|private-audio|private-motion/);
  assert.match(report, /50-record cap was reached/);
});

test('alert report distinguishes entirely missing counts from valid measured zero', () => {
  const missing = [null, undefined, '', false, 'withheld', -1, 1.5].map((alert_count, index) => ({
    id: String(index), driver_id: 'driver', started_at: '2026-09-24T12:00:00Z', alert_count,
  }));
  const label = 'Client-reported alerts';
  const summary = api.summarize(fixture({ sessions: missing }), null, now);
  assert.equal(summary.missingAlerts, 7);
  assert.equal(api.reportRows(summary).find(row => row[0] === label)[1], 'Not recorded');
  const measuredZero = api.summarize(fixture({ sessions: [...missing, {
    id: 'zero', driver_id: 'driver', started_at: '2026-09-24T12:00:00Z', alert_count: 0,
  }] }), null, now);
  assert.equal(api.reportRows(measuredZero).find(row => row[0] === label)[1], '0 across 1 records with valid alert counts');
  const empty = api.summarize(fixture(), null, now);
  assert.equal(api.reportRows(empty).find(row => row[0] === label)[1], '0 across 0 records with valid alert counts', 'known empty window is not missing data');
});

test('missing-review counts require fresh matched session markers; errors and unmatched rows remain unavailable', () => {
  const sessions = ['reviewed', 'open', 'progress'].map(id => ({ id, driver_id: 'driver', started_at: '2026-09-24T12:00:00Z' }));
  const review = { status: 'ready', ownerId: 'owner', loadedAt: now, sessions: [
    { id: 'reviewed', followup: { status: 'reviewed', version: 3 } },
    { id: 'open', followup: { status: 'open', version: 0 } },
    { id: 'progress', followup: { status: 'in_progress', version: 1 } },
  ] };
  const complete = api.summarize(fixture({ sessions }), review, now);
  assert.equal(complete.review.reviewed, 1);
  assert.equal(complete.review.missing, 2);
  for (const changes of [{ status: 'error', message: 'Unavailable' }, { ownerId: 'other' }, { loadedAt: now - 300001 }, { sessions: review.sessions.slice(1) },
    { sessions: [{ id: 'reviewed', followup: { status: 'reviewed', version: 0 } }, ...review.sessions.slice(1)] }]) {
    const summary = api.summarize(fixture({ sessions }), { ...review, ...changes }, now);
    assert.equal(summary.review.missing, null);
    assert.equal(summary.review.reviewed, null);
    assert.ok(summary.review.unknown > 0);
  }
  assert.match(complete.review.message, /does not prove a tester review or validate telemetry/);
  assert.equal(api.summarize(fixture(), null, now).review.missing, 0, 'known empty window is distinct from missing source');
});

class Element {
  constructor() { this.children = []; this.listeners = new Map(); this.textContent = ''; this.disabled = false; this.open = false; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children = [...children]; this.textContent = ''; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  trigger(type, event = {}) { return this.listeners.get(type)?.(event); }
  text() { return this.textContent + this.children.map(child => child.text()).join(' '); }
}
function browser(initial = fixture({ lastSuccessfulAt: Date.now() }, Date.now())) {
  let input = initial, user = { id: 'owner' }, prints = 0, requests = [], clockNow = Date.now();
  const elements = new Map(['pilotQualityPanel', 'pilotPrintableReport', 'pilotQualityStatus', 'qualityCompleted', 'qualityInterrupted', 'qualityUnscored',
    'qualityMissingReview', 'pilotReviewStatus', 'pilotReportPrint', 'pilotReviewRefresh', 'pilotReportPreview'].map(id => [id, new Element()]));
  const events = new Map(), documentEvents = new Map();
  let fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, sessions: [] }) });
  const window = { addEventListener: (name, fn) => events.set(name, fn), getProtectedPilotSnapshot: () => input,
    print: () => { prints += 1; }, OcculertBackend: { currentUser: () => user, getSession: async () => ({ user, access_token: 'private-token' }) } };
  const document = { hidden: false, getElementById: id => elements.get(id), createElement: () => new Element(), addEventListener: (name, fn) => documentEvents.set(name, fn) };
  class ClockDate extends Date { static now() { return clockNow; } }
  const context = { window, document, AbortController, setTimeout, clearTimeout, Date: ClockDate,
    fetch: (...args) => { requests.push(args); return fetchImpl(...args); } };
  vm.runInNewContext(source, context);
  return { elements, events, documentEvents, document, api: window.OcculertPilotReport, clock: value => { clockNow = value; }, now: () => clockNow,
    input: value => { input = value; }, user: value => { user = value; }, fetch: value => { fetchImpl = value; }, requests,
    prints: () => prints, report: () => elements.get('pilotPrintableReport').text() };
}

test('print button rechecks account and source; direct browser print hides private dashboard and stale reports', () => {
  const app = browser();
  assert.equal(app.elements.get('pilotReportPrint').disabled, false);
  app.elements.get('pilotReportPrint').trigger('click');
  assert.equal(app.prints(), 1);
  app.events.get('beforeprint')();
  assert.equal(app.elements.get('pilotReportPreview').open, true);
  assert.match(app.report(), /Example fleet/);
  app.user(null);
  app.events.get('storage')({ key: 'occulert-auth' });
  assert.doesNotMatch(app.report(), /Example fleet/);
  assert.equal(app.elements.get('pilotReportPrint').disabled, true);
  app.events.get('afterprint')();
  assert.equal(app.elements.get('pilotReportPreview').open, false);
  app.elements.get('pilotReportPrint').trigger('click');
  assert.equal(app.prints(), 1);
  app.user({ id: 'owner' });
  app.input(fixture({ lastSuccessfulAt: Date.now() - 600000 }));
  app.events.get('beforeprint')();
  assert.match(app.report(), /stale/);
  assert.doesNotMatch(app.report(), /Example fleet/);
  assert.match(css, /body>\*:not\(#main-content\)\{display:none!important\}/);
  assert.match(css, /#main-content>\*:not\(#pilotQualityPanel\)\{display:none!important\}/);
});

test('review fetch is protected, minimal, bounded, and late responses cannot restore signed-out records', async () => {
  const app = browser();
  let resolve;
  app.fetch(() => new Promise(done => { resolve = done; }));
  app.input(fixture({ lastSuccessfulAt: app.now(), sessions: [{ id: 'secret-session', driver_id: 'driver', started_at: new Date(app.now() - 1000).toISOString() }] }));
  app.api.update();
  await new Promise(done => setImmediate(done));
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0][0], '/api/fleet-followups');
  assert.equal(app.requests[0][1].method, 'GET');
  assert.equal(app.requests[0][1].cache, 'no-store');
  assert.equal(app.requests[0][1].headers.Authorization, 'Bearer private-token');
  app.user(null); app.events.get('storage')({ key: 'occulert-auth' });
  assert.equal(app.requests[0][1].signal.aborted, true);
  resolve({ ok: true, json: async () => ({ ok: true, sessions: [{ id: 'secret-session', followup: { status: 'reviewed', version: 1 } }] }) });
  await new Promise(done => setImmediate(done));
  assert.doesNotMatch(app.report(), /Example fleet|secret-session|1 saved Reviewed/);
  assert.equal(app.elements.get('qualityMissingReview').textContent, 'Unavailable');
});

test('review endpoint failure stays unavailable while protected aggregate PDF remains usable', async () => {
  const app = browser();
  app.fetch(async () => ({ ok: false, json: async () => ({ error: 'followups_not_enabled' }) }));
  app.input(fixture({ lastSuccessfulAt: app.now(), sessions: [{ id: 'session', driver_id: 'driver', started_at: new Date(app.now() - 1000).toISOString() }] }));
  app.api.update();
  await new Promise(done => setImmediate(done));
  assert.equal(app.elements.get('qualityMissingReview').textContent, 'Unavailable');
  assert.match(app.elements.get('pilotReviewStatus').textContent, /not enabled/);
  assert.equal(app.elements.get('pilotReportPrint').disabled, false);
  assert.match(app.report(), /missing-review counts are unavailable/);
  assert.equal(app.requests.length, 1, 'an error should not immediately retry in a render loop');
});

test('current saved review counts refresh at a bounded interval and never poll in a hidden tab', async () => {
  const at = Date.now(), app = browser(fixture({ lastSuccessfulAt: at }, at));
  app.fetch(async () => ({ ok: true, json: async () => ({ ok: true, sessions: [{ id: 'session', driver_name: 'Private driver',
    followup: { status: 'reviewed', version: 1 } }] }) }));
  app.input(fixture({ lastSuccessfulAt: at, sessions: [{ id: 'session', driver_id: 'driver', started_at: new Date(at - 1000).toISOString() }] }, at));
  app.api.update();
  await new Promise(done => setImmediate(done));
  assert.equal(app.requests.length, 1);
  assert.equal(app.elements.get('qualityMissingReview').textContent, 0);
  assert.doesNotMatch(app.report(), /Private driver|session_id/);
  app.api.update(); app.api.update();
  assert.equal(app.requests.length, 1);
  app.clock(at + 120001); app.api.update();
  await new Promise(done => setImmediate(done));
  assert.equal(app.requests.length, 2);
  app.document.hidden = true; app.clock(at + 240002); app.api.update();
  assert.equal(app.requests.length, 2);
  app.document.hidden = false; app.documentEvents.get('visibilitychange')();
  await new Promise(done => setImmediate(done));
  assert.equal(app.requests.length, 3);
});

test('dashboard passes returned metadata, clears it on reset, and gates the protected CSV before local fallback metrics', () => {
  assert.match(dashboard, /protectedTelemetryTrust=String\(result\.body\.telemetry_trust\|\|''\)/);
  assert.match(dashboard, /protectedReportPrivacy=result\.body\.privacy\|\|null/);
  assert.match(dashboard, /function clearProtectedFleetCache\(\).*OcculertPilotReport\?\.reset\(\);protectedTelemetryTrust='';protectedReportPrivacy=null/);
  const exporter = dashboard.slice(dashboard.indexOf('function exportPilotReport()'), dashboard.indexOf('function eventHistoryHtml('));
  assert.ok(exporter.indexOf('if(!permission?.available)') < exporter.indexOf('let metrics=pilotMetrics()'));
  assert.match(dashboard, /\/fleet-pilot-report\.v56\.js/);
  assert.match(dashboard, /\/fleet-pilot-report\.v56\.css/);
});
