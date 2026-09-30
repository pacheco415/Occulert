import { assetByStem } from './lib/current-assets.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL(`../${assetByStem('fleet-history-page.js')}`, import.meta.url), 'utf8');
const OWNER = '11111111-1111-4111-8111-111111111111';
const FLEET = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const OLDER_SESSION = '55555555-5555-4555-8555-555555555555';
class Element {
  constructor() { this.children = []; this.listeners = new Map(); this.value = ''; this.textContent = ''; this.hidden = false;
    this.disabled = false; this.validity = { badInput: false }; this.style = {}; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = [...children]; }
  get firstChild() { return this.children[0]; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  trigger(name) { return this.listeners.get(name)?.(); }
  setAttribute(name, value) { this[name] = value; }
  click() {}
  remove() {}
}
function harness(sessions = []) {
  const ids = ['historyStatus', 'historyAccess', 'recordsTitle', 'historyScope', 'historyList', 'historyBoundary',
    'historyRefresh', 'historyOlder', 'historyFilters', 'historyDriver', 'historyPeriod', 'historyCompletion',
    'historyFrom', 'historyTo', 'historyCustomDates', 'historyDateStatus', 'historySort', 'historyClearFilters',
    'historyMatches', 'historyEmpty', 'historyExport', 'historyExportStatus', 'historyPrint', 'historyPrintStatus', 'historyPrintReport'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  elements.get('historyPeriod').value = 'all';
  elements.get('historyCompletion').value = 'all';
  elements.get('historySort').value = 'newest';
  const requests = [], downloads = [], windowEvents = new Map(), documentEvents = new Map();
  const auth = { access_token: 'private-token', refresh_token: 'refresh-token', user: { id: OWNER } };
  const backend = { currentUser: () => auth.user, getSession: async () => auth,
    captureAuthContext: () => ({ auth }), requireAuthContext: () => {}, isAuthContextCurrent: () => true,
    fetchWithDeadline: async path => {
      requests.push(path);
      const params = new URL(path, 'https://www.occulert.com').searchParams;
      const filters = { driver_id: params.get('driver_id'), from: params.get('from'), to: params.get('to') };
      return { ok: true, json: async () => ({ ok: true, fleet: { id: FLEET, company_name: 'Example fleet' },
        sessions, drivers: [{ id: DRIVER, name: 'Driver One' }], driver_filter_complete: true,
        filters, has_more: false, next_cursor: null, telemetry_trust: 'unverified_client_report',
        privacy: { includes_location: false, includes_personal_media: false, includes_raw_motion: false } }) };
    } };
  const document = { hidden: false, getElementById: id => elements.get(id), createElement: () => new Element(),
    createDocumentFragment: () => new Element(), addEventListener: (name, fn) => documentEvents.set(name, fn),
    body: { appendChild() {} } };
  const window = { OcculertBackend: backend, OcculertSecurity: { csvCell: value => String(value ?? '') },
    addEventListener: (name, fn) => windowEvents.set(name, fn), print() {} };
  class TestURL extends URL {
    static createObjectURL(blob) { downloads.push(blob.parts.join('')); return 'blob:history'; }
    static revokeObjectURL() {}
  }
  class TestBlob { constructor(parts) { this.parts = parts; } }
  vm.runInNewContext(source, { window, document, AbortController,
    setTimeout: () => 0, clearTimeout: () => {}, Date, Intl, URL: TestURL, Blob: TestBlob });
  return { elements, requests, downloads };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('driver and recent-date selections request a new server-filtered browsing window', async () => {
  const app = harness(); await settle();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0], '/api/fleet-session-history');
  const driver = app.elements.get('historyDriver');
  assert.equal(driver.children.length, 2);
  driver.value = DRIVER;
  driver.trigger('change'); await settle();
  assert.equal(new URL(app.requests[1], 'https://www.occulert.com').searchParams.get('driver_id'), DRIVER);
  const period = app.elements.get('historyPeriod');
  period.value = '7'; period.trigger('change'); await settle();
  const params = new URL(app.requests[2], 'https://www.occulert.com').searchParams;
  assert.equal(params.get('driver_id'), DRIVER);
  assert.ok(Date.parse(params.get('from')) < Date.parse(params.get('to')));
  assert.match(app.elements.get('historyScope').textContent, /matching sessions loaded/);
});

test('history keeps safe detector provenance in its shown records and CSV', async () => {
  const app = harness([{ id: SESSION, driver_id: DRIVER, driver_name: 'Driver One', started_at: '2026-09-27T12:00:00Z',
    ended_at: '2026-09-27T12:30:00Z', average_fatigue: 20, max_fatigue: 30, safety_score: 82,
    alert_count: 1, head_nod_count: 0, detector_pipeline: 'ios_mlkit_eye_probability',
    detector_version: 'ios-eye-1.2', app_version: '2.0.1' },
  { id: OLDER_SESSION, driver_id: DRIVER, driver_name: 'Driver One', started_at: '2026-09-26T12:00:00Z',
    ended_at: null, detector_pipeline: '<script>', detector_version: '=HYPERLINK("bad")', app_version: '3.0/unsafe' }]);
  await settle();
  function visibleText(element) { return [element.textContent, ...element.children.map(visibleText)].join(' '); }
  const shown = visibleText(app.elements.get('historyList'));
  assert.match(shown, /Detector pipeline \(client declared\).*iPhone \(ML Kit eye probability\)/);
  assert.match(shown, /Detector version \(client declared\).*ios-eye-1\.2/);
  assert.match(shown, /App version \(client declared\).*2\.0\.1/);
  app.elements.get('historyExport').trigger('click');
  assert.equal(app.downloads.length, 1);
  assert.match(app.downloads[0], /"detector_pipeline","detector_version","app_version","detector_provenance_trust"/);
  assert.match(app.downloads[0], /"ios_mlkit_eye_probability","ios-eye-1\.2","2\.0\.1","client_declared"/);
  assert.match(app.downloads[0], /"","","","not_recorded"/);
  assert.doesNotMatch(app.downloads[0], /HYPERLINK|3\.0\/unsafe|<script>/);
});
