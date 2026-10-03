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
function harness(sessions = [], options = {}) {
  const ids = ['historyStatus', 'historyAccess', 'recordsTitle', 'historyScope', 'historyList', 'historyBoundary',
    'historyRefresh', 'historyOlder', 'historyFilters', 'historyDriver', 'historyPeriod', 'historyCompletion',
    'historyFrom', 'historyTo', 'historyCustomDates', 'historyDateStatus', 'historySort', 'historyClearFilters',
    'historyMatches', 'historyEmpty', 'historyExport', 'historyExportStatus', 'historyPrint', 'historyPrintStatus', 'historyPrintReport'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  elements.get('historyPeriod').value = 'all';
  elements.get('historyCompletion').value = 'all';
  elements.get('historySort').value = 'newest';
  const requests = [], downloads = [], windowEvents = new Map(), documentEvents = new Map();
  const auth = { access_token: 'private-token', refresh_token: 'refresh-token', user: { id: options.owner || OWNER } };
  const backend = { currentUser: () => auth.user, getSession: async () => auth,
    captureAuthContext: () => ({ auth }), requireAuthContext: () => { if (options.stale) throw Object.assign(Error('Account changed'), {code:'auth_session_changed'}); }, isAuthContextCurrent: () => !options.stale,
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
  const storage = options.storage || new Map();
  const window = { localStorage: { getItem: key => { if (options.storageDenied) throw Error('Denied'); return storage.get(key) ?? null; }, setItem: (key,value) => { if (options.storageDenied) throw Error('Denied'); storage.set(key,value); }, removeItem: key => storage.delete(key) }, OcculertBackend: backend, OcculertSecurity: { csvCell: value => String(value ?? '') },
    addEventListener: (name, fn) => windowEvents.set(name, fn), print() {} };
  class TestURL extends URL {
    static createObjectURL(blob) { downloads.push(blob.parts.join('')); return 'blob:history'; }
    static revokeObjectURL() {}
  }
  class TestBlob { constructor(parts) { this.parts = parts; } }
  vm.runInNewContext(source, { window, document, AbortController,
    setTimeout: () => 0, clearTimeout: () => {}, Date, Intl, URL: TestURL, Blob: TestBlob });
  return { elements, requests, downloads, storage, windowEvents };
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

const preferenceKey = 'occulert-history-view-v1:' + OWNER + ':' + FLEET;
const preferences = (overrides = {}) => JSON.stringify({version:1,period:'all',completion:'all',sort:'newest',from:'',to:'',...overrides});

test('History restores a saved range only after access and requests that range from the server', async () => {
  const storage = new Map([[preferenceKey, preferences({period:'7',completion:'completed',sort:'alerts'})]]);
  const app = harness([], {storage}); await settle(); await settle();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[0], '/api/fleet-session-history');
  assert.ok(new URL(app.requests[1], 'https://www.occulert.com').searchParams.get('from'));
  assert.equal(app.elements.get('historyCompletion').value, 'completed');
  assert.equal(app.elements.get('historySort').value, 'alerts');
  assert.equal(app.elements.get('historyDriver').value, '');
});

test('History persists only validated date, sort and end-status choices; clear removes saved values', async () => {
  const app = harness(); await settle();
  app.elements.get('historyDriver').value = DRIVER;
  app.elements.get('historySort').value = 'duration'; app.elements.get('historySort').trigger('change');
  const saved = JSON.parse(app.storage.get(preferenceKey));
  assert.deepEqual(Object.keys(saved).sort(), ['completion','from','period','sort','to','version']);
  assert.equal(saved.sort, 'duration'); assert.doesNotMatch(JSON.stringify(saved), new RegExp(DRIVER));
  app.elements.get('historyClearFilters').trigger('click'); await settle();
  assert.equal(app.storage.has(preferenceKey), false);
  assert.equal(app.elements.get('historySort').value, 'newest');
});

test('History ignores other-owner, future-version and invalid-calendar preferences', async () => {
  for (const [key, value] of [
    [preferenceKey.replace(OWNER, DRIVER), preferences({period:'30'})],
    [preferenceKey, preferences({version:2,period:'30'})],
    [preferenceKey, preferences({period:'custom',from:'2026-02-30'})],
    [preferenceKey, preferences({period:'custom',from:'2026-10-03',to:'2026-10-01'})],
    [preferenceKey, '{broken'],
  ]) {
    const app = harness([], {storage:new Map([[key,value]])}); await settle();
    assert.equal(app.requests.length, 1); assert.equal(app.elements.get('historyPeriod').value, 'all');
  }
});

test('History storage denial preserves browsing and an account change clears active preferences', async () => {
  const denied = harness([], {storageDenied:true}); await settle();
  denied.elements.get('historySort').value = 'alerts'; denied.elements.get('historySort').trigger('change');
  assert.equal(denied.elements.get('historySort').value, 'alerts');
  const app = harness(); await settle();
  app.elements.get('historySort').value = 'alerts'; app.elements.get('historySort').trigger('change');
  app.windowEvents.get('storage')({key:'occulert-auth'});
  assert.equal(app.storage.has(preferenceKey), false);
  assert.equal(app.elements.get('historySort').value, 'newest');
  assert.equal(app.elements.get('historyList').children.length, 0);
});

test('invalid and future History ranges can be corrected without losing verified controls', async () => {
 const app=harness();await settle();
 app.elements.get('historyPeriod').value='custom';app.elements.get('historyPeriod').trigger('change');
 app.elements.get('historyFrom').value='2026-02-30';app.elements.get('historyFrom').trigger('change');await settle();
 assert.equal(app.requests.length,1);assert.equal(app.elements.get('historyFilters').disabled,false);
 assert.match(app.elements.get('historyDateStatus').textContent,/valid From/);
 app.elements.get('historyFrom').value='2099-01-01';app.elements.get('historyFrom').trigger('change');await settle();
 assert.equal(app.requests.length,1);assert.equal(app.storage.has(preferenceKey),false);
 assert.match(app.elements.get('historyDateStatus').textContent,/today or earlier/);
 app.elements.get('historyFrom').value='2026-01-01';app.elements.get('historyFrom').trigger('change');await settle();
 assert.equal(app.requests.length,2);assert.equal(app.elements.get('historyFilters').disabled,false);
});
