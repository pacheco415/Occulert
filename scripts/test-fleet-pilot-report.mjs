import { fleetDashboardContract, fleetDashboardRuntime } from './lib/fleet-dashboard-source.mjs';
import { assetByStem } from './lib/current-assets.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(`../${assetByStem('fleet-pilot-report.js')}`, import.meta.url), 'utf8');
const dashboard = fleetDashboardContract();
const css = readFileSync(new URL(`../${assetByStem('fleet-pilot-report.css')}`, import.meta.url), 'utf8');
const privacy = { includes_location: false, includes_personal_media: false, includes_raw_motion: false };
const FLEET = '22222222-2222-4222-8222-222222222222';
const now = Date.now();
function input(overrides = {}) {
  return { fleetMode: true, userId: 'owner', currentUserId: 'owner', fleetId: FLEET,
    fleetName: 'Example fleet', days: 7, lastSuccessfulAt: now, refreshFailures: 0,
    telemetryTrust: 'unverified_client_report', privacy, summaryValid: true,
    drivers: [{ id: 'driver', active: true }], sessions: [{ id: 'private-session', driver_id: 'private-driver' }], ...overrides };
}
function report(overrides = {}) {
  return { version: 1, days: 7, window_start: new Date(now - 7 * 86400000).toISOString(),
    window_end: new Date(now).toISOString(), complete_period: true,
    roster_total: 6, active_drivers: 5, reporting_active_drivers: 4, sessions: 150,
    completed: 100, no_recorded_end: 40, invalid_recorded_end: 10,
    scored: 120, unscored: 30, average_safety_score: 78,
    valid_alert_records: 140, missing_alert_records: 10, alerts: 42,
    reviewed: 25, without_reviewed_followup: 125,
    detector_pipelines: { web_mediapipe_ear: 90, ios_mlkit_eye_probability: 30,
      android_mlkit_eye_probability: 10, unknown: 20 },
    interruption_reasons_available: false, unrecorded_sessions_detectable: false, ...overrides };
}
function state(overrides = {}) {
  return { status: 'ready', ownerId: 'owner', fleetId: FLEET, days: 7, loadedAt: now, report: report(), ...overrides };
}
function library() {
  const context = { window: {}, document: { getElementById: () => null } };
  vm.runInNewContext(source, context);
  return context.window.OcculertPilotReport;
}
const api = library();

test('complete report uses database aggregates beyond 50 and omits identities', () => {
  const summary = api.summarize(input(), state(), now);
  assert.equal(summary.available, true);
  assert.equal(summary.sessions, 150);
  assert.equal(summary.sourceCount, 150);
  assert.equal(summary.completed, 100);
  assert.equal(summary.noEnd, 40);
  assert.equal(summary.invalidEnds, 10);
  assert.equal(summary.unscored, 30);
  assert.equal(summary.reportingDrivers, 4);
  assert.equal(summary.coverage, 80);
  assert.equal(summary.review.missing, 125);
  const printed = JSON.stringify([summary, api.reportRows(summary), api.reportNotes(summary)]);
  assert.match(printed, /no latest-50 cap/i);
  assert.match(printed, /not directly comparable/i);
  assert.doesNotMatch(printed, /private-session|private-driver/);
});

test('report is withheld on account change, stale source, failed refresh, or privacy mismatch', () => {
  for (const overrides of [
    { fleetMode: false }, { userId: '' }, { currentUserId: 'other' }, { fleetId: '' },
    { lastSuccessfulAt: now - 300001 }, { refreshFailures: 1 }, { summaryValid: false },
    { privacy: { ...privacy, includes_location: true } }, { telemetryTrust: 'verified' },
  ]) {
    assert.equal(api.summarize(input(overrides), state(), now).available, false, JSON.stringify(overrides));
  }
  assert.equal(api.summarize(input(), state({ ownerId: 'other' }), now).available, false);
  assert.equal(api.summarize(input(), state({ fleetId: 'other' }), now).available, false);
  assert.equal(api.summarize(input(), state({ loadedAt: now - 300001 }), now).available, false);
});

test('inconsistent or privacy-ambiguous aggregate is rejected rather than printed', () => {
  for (const changes of [
    { complete_period: false }, { sessions: 50 }, { reviewed: 151 },
    { missing_alert_records: -1 }, { detector_pipelines: { web_mediapipe_ear: 150 } },
    { average_safety_score: 101 }, { unrecorded_sessions_detectable: true },
  ]) {
    const invalid = report(changes);
    assert.equal(api.validPeriodReport(invalid, 7), false, JSON.stringify(changes));
    assert.equal(api.summarize(input(), state({ report: invalid }), now).available, false);
  }
});

test('no recorded alerts differs from a valid zero and missing end is not called an interruption', () => {
  const noAlerts = api.summarize(input(), state({ report: report({ valid_alert_records: 0, missing_alert_records: 150,
    alerts: 0 }) }), now);
  assert.equal(api.reportRows(noAlerts).find(row => row[0] === 'Client-reported alerts')[1], 'Not recorded');
  const validZero = api.summarize(input(), state({ report: report({ alerts: 0 }) }), now);
  assert.match(api.reportRows(validZero).find(row => row[0] === 'Client-reported alerts')[1], /^0 across 140/);
  assert.match(api.reportNotes(validZero).join(' '), /No end time does not prove an active or interrupted session/);
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
function browser(fetchImpl) {
  let snapshot = input({ lastSuccessfulAt: Date.now() }), user = { id: 'owner' }, prints = 0;
  const downloads = [];
  const elements = new Map(['pilotQualityPanel', 'pilotPrintableReport', 'pilotQualityStatus', 'qualityCompleted', 'qualityInterrupted', 'qualityUnscored',
    'qualityMissingReview', 'pilotReviewStatus', 'pilotReportPrint', 'pilotReportCSV', 'pilotReviewRefresh', 'pilotReportPreview'].map(id => [id, new Element()]));
  const events = new Map(), documentEvents = new Map(), requests = [];
  const window = { addEventListener: (name, fn) => events.set(name, fn), getProtectedPilotSnapshot: () => snapshot,
    print: () => { prints += 1; }, OcculertSecurity: { csvCell: value => String(value) },
    OcculertBackend: { currentUser: () => user, getSession: async () => ({ user, access_token: 'private-token' }) } };
  const document = { hidden: false, getElementById: id => elements.get(id), createElement: () => new Element(), addEventListener: (name, fn) => documentEvents.set(name, fn) };
  vm.runInNewContext(source, { window, document, AbortController, setTimeout, clearTimeout, Date,
    requestDashboardCSVDownload: (csv, filename, protectedOnly) => downloads.push({ csv, filename, protectedOnly }),
    fetch: (...args) => { requests.push(args); return fetchImpl(...args); } });
  return { api: window.OcculertPilotReport, elements, events, documentEvents, document, requests, downloads,
    snapshot: value => { snapshot = value; }, user: value => { user = value; }, prints: () => prints,
    report: () => elements.get('pilotPrintableReport').text() };
}
function response(reportValue = report({ window_end: new Date().toISOString(), window_start: new Date(Date.now() - 7 * 86400000).toISOString() })) {
  return { ok: true, json: async () => ({ ok: true, fleet: { id: FLEET }, report: reportValue,
    telemetry_trust: 'unverified_client_report', privacy }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('fresh owner loads one aggregate, can print, and sign-out clears cached report', async () => {
  const app = browser(async () => response());
  await settle();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0][0], '/api/fleet-period-report?days=7');
  assert.equal(app.requests[0][1].headers.Authorization, 'Bearer private-token');
  assert.equal(app.elements.get('pilotReportPrint').disabled, false);
  app.elements.get('pilotReportPrint').trigger('click');
  assert.equal(app.prints(), 1);
  app.elements.get('pilotReportCSV').trigger('click');
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].protectedOnly, true);
  assert.match(app.downloads[0].csv, /complete_stored_period_aggregate/);
  assert.doesNotMatch(app.downloads[0].csv, /private-session|private-driver/);
  assert.match(app.report(), /150/);
  app.user(null); app.events.get('storage')({ key: 'occulert-auth' });
  assert.equal(app.elements.get('pilotReportPrint').disabled, true);
  assert.doesNotMatch(app.report(), /Example fleet|150 stored sessions/);
  app.elements.get('pilotReportPrint').trigger('click');
  app.elements.get('pilotReportCSV').trigger('click');
  assert.equal(app.prints(), 1);
  assert.equal(app.downloads.length, 1);
  assert.match(css, /#main-content>\*:not\(#pilotQualityPanel\)\{display:none!important\}/);
});

test('late aggregate response cannot restore a signed-out report', async () => {
  let resolve;
  const app = browser(() => new Promise(done => { resolve = done; }));
  await settle();
  assert.equal(app.requests.length, 1);
  app.user(null); app.events.get('storage')({ key: 'occulert-auth' });
  assert.equal(app.requests[0][1].signal.aborted, true);
  resolve(response()); await settle();
  assert.equal(app.elements.get('pilotReportPrint').disabled, true);
  assert.doesNotMatch(app.report(), /Example fleet/);
});

test('unavailable database report disables printing and explains migration requirement', async () => {
  const app = browser(async () => ({ ok: false, json: async () => ({ error: 'period_report_not_enabled' }) }));
  await settle();
  assert.equal(app.elements.get('pilotReportPrint').disabled, true);
  assert.match(app.report(), /not enabled yet/);
});

test('dashboard passes owner and fleet identity to the aggregate gate', () => {
  assert.match(dashboard, /fleetId:protectedFleetId/);
  assert.match(dashboard, /protectedFleetId=String\(result\.body\.fleet\.id\|\|''\)/);
  assert.match(dashboard, /function allowProtectedShare\(\).*sourceAccess/);
  assert.match(dashboard, /id="pilotReviewRefresh"[^>]*>Refresh complete report/);
});
