import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('fleet-display.v56.js');
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
    invalidEndSessions: 0,
    participatingDrivers: 2,
    coverage: 100,
    historyLimited: false,
    windowDays: 30,
    windowStart: now - 30 * 24 * 60 * 60 * 1000,
    windowEnd: now,
    pulse: { now: 1, hour: 1, day: 1, month: 2 },
  });
  assert.equal(JSON.stringify(result).includes('Private Name'), false);
  assert.equal(JSON.stringify(result).includes('Van 1'), false);
});

test('7/30-day windows use session starts, include exact boundaries, and exclude invalid or future history', () => {
  const now = Date.parse('2026-09-24T18:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  const session = (started, ended = started, extra = {}) => ({ driver_id: 'a', started_at: typeof started === 'number' ? new Date(started).toISOString() : started, ended_at: typeof ended === 'number' ? new Date(ended).toISOString() : ended, ...extra });
  const summary = {
    drivers: [{ id: 'a', active: true }, { id: 'b', active: true }],
    sessions: [
      session(now - 7 * day),
      session(now - 7 * day - 1, now - 60 * 60 * 1000),
      session(now - 30 * day),
      session(now - 30 * day - 1),
      session(now - 2 * day, now + 1),
      session(now + 1, null),
      session('invalid', null),
      session(null, null),
      session(now - day, 'invalid'),
      session(now - day, now - 2 * day),
      session(now - 40 * day, null),
      session(now - 1, null, { driver_id: 'b', safety_score: null }),
    ],
  };
  const seven = display.summarize(summary, now, 7);
  const thirty = display.summarize(summary, now, 30);
  assert.equal(seven.recentSessions, 5);
  assert.equal(thirty.recentSessions, 7);
  assert.equal(seven.invalidEndSessions, 3);
  assert.equal(seven.activeSessions, 2, 'unended record count does not use the selected participation window');
  assert.equal(seven.coverage, 100);
  assert.equal(seven.reviewSessions, 0, 'missing scores and missing events do not create a review flag');
  assert.equal(display.summarize(summary, now, '7').windowDays, 7);
  assert.equal(display.summarize(summary, now, 14).windowDays, 30);
  assert.equal(seven.pulse.day, 0, 'a recent completion does not bring an older start into the selected window');
  assert.equal(thirty.pulse.day, 1);
});

test('an invalid end excludes only completed activity while preserving started participation and review evidence', () => {
  const now = Date.parse('2026-09-24T18:00:00.000Z');
  const result = display.summarize({ drivers: [{ id: 'a', active: true }], sessions: [
    { driver_id: 'a', started_at: '2026-09-23T18:00:00.000Z', ended_at: 'invalid', alert_count: 1 },
  ] }, now, 7);
  assert.equal(result.recentSessions, 1);
  assert.equal(result.coverage, 100);
  assert.equal(result.reviewSessions, 1);
  assert.equal(result.invalidEndSessions, 1);
  assert.equal(result.activeSessions, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.pulse)), { now: 0, hour: 0, day: 0, month: 0 });
});

test('50-session summaries explicitly mark potentially incomplete window coverage', () => {
  const now = Date.parse('2026-09-24T18:00:00.000Z');
  const sessions = Array.from({ length: 50 }, () => ({ started_at: '2026-09-24T16:00:00.000Z', ended_at: null }));
  assert.equal(display.summarize({ sessions }, now, 7).historyLimited, true);
  assert.equal(display.summarize({ sessions: sessions.slice(1) }, now, 7).historyLimited, false);
  assert.equal(display.summarize({ sessions: [...sessions, ...sessions] }, now, 7).recentSessions, 50, 'unexpected extra rows cannot exceed the API history bound');
});

test('an old unended session is record state and the TV makes no live-monitoring claim', () => {
  const now = Date.parse('2026-09-24T18:00:00.000Z');
  const model = display.summarize({ sessions: [{ started_at: '2026-07-01T00:00:00.000Z', ended_at: null }] }, now, 7);
  assert.equal(model.activeSessions, 1);
  assert.equal(model.recentSessions, 0);
  const html = read('fleet-display.html');
  assert.match(html, /Sessions without recorded end/);
  assert.match(html, /No recorded end/);
  assert.match(html, /live device monitoring is not verified/);
  assert.doesNotMatch(html, /Monitoring now|protected active sessions/);
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
  assert.match(html, /fleet-display\.v56\.js/);
  assert.match(html, /fleet-display\.v56\.css/);
});

const NOW = Date.parse('2026-09-24T18:00:00.000Z');
function browser(summary, options = {}) {
  const elements = new Map();
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let calls = 0;
  let user = { id: 'owner-a' };
  let result = { ok: true, body: summary };
  class Element {
    constructor() { this.textContent = ''; this.hidden = false; this.disabled = false; this.style = {}; this.attributes = {}; this.listeners = {}; this.value = '30'; this.open = false; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    closest() { return elements.get('help'); }
    emit(type) { return this.listeners[type]?.({}); }
  }
  for (const match of read('fleet-display.html').matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element());
  elements.set('help', new Element());
  const html = new Element();
  const document = { hidden: false, fullscreenElement: null, documentElement: html, getElementById: id => elements.get(id), addEventListener: (key, fn) => listeners.set(`document:${key}`, fn) };
  if (options.fullscreen !== false) html.requestFullscreen = options.requestFullscreen || (async () => { document.fullscreenElement = html; });
  document.exitFullscreen = async () => { document.fullscreenElement = null; };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
  const root = {
    document, navigator: { onLine: true, connection: { saveData: false } },
    OcculertBackend: {
      getSession: async () => user ? { user } : null,
      currentUser: () => user,
      signOut: () => { user = null; },
      getFleetSummary: async settings => { calls++; assert.deepEqual(JSON.parse(JSON.stringify(settings)), { includeEvents: false }); return options.getFleetSummary ? options.getFleetSummary() : result; },
    },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => 1,
    addEventListener: (key, fn) => listeners.set(key, fn),
  };
  vm.runInNewContext(source, { window: root, Date: FixedDate });
  return {
    root, elements, timers, calls: () => calls,
    user: next => { user = next; }, result: next => { result = next; },
    emit: (type, event = {}) => listeners.get(type)?.(event),
    settle: () => new Promise(resolve => setImmediate(resolve)),
  };
}
const protectedSummary = () => ({
  fleet: { company_name: 'Protected Fleet' },
  drivers: [{ id: 'a', name: 'Private Driver', active: true }],
  sessions: [
    { driver_id: 'a', started_at: '2026-09-24T16:00:00.000Z', ended_at: '2026-09-24T17:30:00.000Z', alert_count: 1 },
    { driver_id: 'a', started_at: '2026-09-10T16:00:00.000Z', ended_at: '2026-09-10T17:30:00.000Z' },
  ],
});

test('window selection rerenders protected metrics and accessible labels without another request', async () => {
  const page = browser(protectedSummary());
  await page.settle();
  assert.equal(page.elements.get('recentSessions').textContent, '2');
  page.elements.get('windowDays').value = '7';
  page.elements.get('windowDays').emit('change');
  assert.equal(page.elements.get('recentSessions').textContent, '1');
  assert.match(page.elements.get('windowRange').textContent, /Past 7 days.*session start time/);
  assert.equal(page.elements.get('coverageTrack').getAttribute('aria-label'), 'Roster coverage in available 7-day history');
  assert.equal(page.calls(), 1);
  assert.equal(page.elements.get('displayContent').hidden, false);
  assert.equal([...page.elements.values()].some(el => el.textContent.includes('Private Driver')), false);
});

test('large text is reversible, exposes its pressed state, and needs no stored preference', async () => {
  const page = browser(protectedSummary());
  await page.settle();
  const button = page.elements.get('largeTextButton');
  button.emit('click');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(page.root.document.documentElement.getAttribute('data-display-size'), 'large');
  button.emit('click');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(page.root.document.documentElement.getAttribute('data-display-size'), 'standard');
});

test('window selection clears protected data after same-tab sign-out without a storage event', async () => {
  const page = browser(protectedSummary());
  await page.settle();
  page.user(null);
  page.elements.get('windowDays').value = '7';
  page.elements.get('windowDays').emit('change');
  assert.equal(page.elements.get('displayContent').hidden, true);
  assert.equal(page.elements.get('displayTitle').textContent, 'Fleet operations');
  assert.equal(page.elements.get('recentSessions').textContent, '0');
  assert.equal(page.timers.size, 0);
});

test('window selection loads a changed same-tab owner only after hiding the previous owner', async () => {
  let resolveRequest;
  let changed = false;
  const page = browser(protectedSummary(), { getFleetSummary: () => changed ? new Promise(resolve => { resolveRequest = resolve; }) : { ok: true, body: protectedSummary() } });
  await page.settle();
  changed = true;
  page.user({ id: 'owner-b' });
  page.elements.get('windowDays').value = '7';
  page.elements.get('windowDays').emit('change');
  assert.equal(page.elements.get('displayContent').hidden, true);
  assert.equal(page.elements.get('recentSessions').textContent, '0');
  await page.settle();
  resolveRequest({ ok: true, body: { fleet: { company_name: 'Next Owner' }, drivers: [], sessions: [] } });
  await page.settle();
  assert.equal(page.elements.get('displayTitle').textContent, 'Next Owner');
  assert.equal(page.elements.get('displayContent').hidden, false);
  assert.match(page.elements.get('sessionWindowLabel').textContent, /7 days/);
});

test('connection interruptions preserve a verified summary, report retries, and pause hidden refreshes', async () => {
  const page = browser(protectedSummary());
  await page.settle();
  page.result({ ok: false, status: 502, body: { error: 'supabase_error' } });
  page.elements.get('refreshButton').emit('click');
  await page.settle();
  assert.equal(page.elements.get('displayContent').hidden, false);
  assert.equal(page.elements.get('recentSessions').textContent, '2');
  assert.equal(page.elements.get('connectionStatus').getAttribute('data-state'), 'interrupted');
  assert.match(page.elements.get('connectionDetails').textContent, /Next automatic retry.*1 unsuccessful refresh.*last protected summary/);
  assert.equal([...page.timers.values()][0].delay, 180000);
  page.root.document.hidden = true;
  page.emit('document:visibilitychange');
  assert.equal(page.timers.size, 0);
  assert.match(page.elements.get('connectionDetails').textContent, /paused while this tab is hidden/);
});

test('account changes immediately hide protected data and discard responses from the old account', async () => {
  let resolveRequest;
  let pending = false;
  const page = browser(protectedSummary(), { getFleetSummary: () => pending ? new Promise(resolve => { resolveRequest = resolve; }) : { ok: true, body: protectedSummary() } });
  await page.settle();
  pending = true;
  page.elements.get('refreshButton').emit('click');
  await page.settle();
  page.user(null);
  page.emit('storage', { key: 'occulert-auth' });
  assert.equal(page.elements.get('displayContent').hidden, true);
  assert.equal(page.elements.get('displayTitle').textContent, 'Fleet operations');
  assert.equal(page.elements.get('recentSessions').textContent, '0');
  resolveRequest({ ok: true, body: protectedSummary() });
  await page.settle();
  assert.equal(page.elements.get('displayContent').hidden, true);
  assert.equal(page.timers.size, 0);
  page.elements.get('windowDays').value = '7';
  page.elements.get('windowDays').emit('change');
  assert.equal(page.elements.get('displayContent').hidden, true, 'changing window cannot restore cleared owner data');
});

test('a new owner replaces previous data only after the new protected summary returns', async () => {
  let resolveRequest;
  let requestCount = 0;
  const next = { fleet: { company_name: 'Next Fleet' }, drivers: [], sessions: [] };
  const page = browser(protectedSummary(), { getFleetSummary: () => {
    requestCount++;
    if (requestCount === 2) return new Promise(resolve => { resolveRequest = resolve; });
    return { ok: true, body: requestCount === 1 ? protectedSummary() : next };
  } });
  await page.settle();
  page.elements.get('refreshButton').emit('click');
  await page.settle();
  page.user({ id: 'owner-b' });
  page.emit('storage', { key: 'occulert-auth' });
  assert.equal(page.elements.get('displayContent').hidden, true);
  resolveRequest({ ok: true, body: protectedSummary() });
  await page.settle();
  assert.equal(page.elements.get('displayTitle').textContent, 'Next Fleet');
  assert.equal(page.elements.get('recentSessions').textContent, '0');
  assert.equal(page.elements.get('displayContent').hidden, false);
});

test('lost fleet ownership or authentication clears previous protected aggregate data', async () => {
  for (const denied of [
    { ok: false, status: 403, body: { error: 'fleet_not_found' } },
    { ok: false, status: 403, body: { error: 'forbidden' } },
    { ok: false, status: 401, body: { error: 'unauthorized' } },
  ]) {
    const page = browser(protectedSummary());
    await page.settle();
    page.result(denied);
    page.elements.get('refreshButton').emit('click');
    await page.settle();
    assert.equal(page.elements.get('displayContent').hidden, true);
    assert.equal(page.elements.get('displayTitle').textContent, 'Fleet operations');
    assert.equal(page.elements.get('recentSessions').textContent, '0');
    page.elements.get('windowDays').value = '7';
    page.elements.get('windowDays').emit('change');
    assert.equal(page.elements.get('displayContent').hidden, true);
  }
});

test('full-screen rejection gives guidance and unsupported browsers keep large text available', async () => {
  const rejected = browser(protectedSummary(), { requestFullscreen: async () => { throw new Error('denied'); } });
  await rejected.settle();
  rejected.elements.get('fullscreenButton').emit('click');
  await rejected.settle();
  assert.match(rejected.elements.get('fullscreenFeedback').textContent, /could not open.*Large text/);
  assert.equal(rejected.elements.get('help').open, true);
  const unsupported = browser(protectedSummary(), { fullscreen: false });
  await unsupported.settle();
  assert.equal(unsupported.elements.get('fullscreenButton').disabled, true);
  assert.match(unsupported.elements.get('fullscreenFeedback').textContent, /does not offer full screen.*browser.*Large text/);
  assert.equal(unsupported.elements.get('largeTextButton').disabled, false);
});
