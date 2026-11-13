import { fleetDashboardContract, fleetDashboardRuntime } from './lib/fleet-dashboard-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const script = fleetDashboardRuntime();
const OWNER = '11111111-1111-4111-8111-111111111111';
const DRIVER = '22222222-2222-4222-8222-222222222222';
const OTHER_DRIVER = '33333333-3333-4333-8333-333333333333';
const session = (n, extra = {}) => ({
  id: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`, driver_id: DRIVER,
  started_at: `2026-11-0${n}T10:00:00+00:00`, ended_at: `2026-11-0${n}T10:45:00+00:00`,
  safety_score: 80, alert_count: 2, detector_pipeline: 'web_mediapipe_ear', ...extra,
});

function element(id) {
  const attributes = new Map();
  return { id, hidden: true, textContent: '', children: [], focused: 0,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
    removeAttribute: name => attributes.delete(name),
    replaceChildren(...nodes) { this.children = nodes; },
    append(...nodes) { this.children.push(...nodes); },
    focus() { this.focused += 1; }, scrollIntoView() {} };
}

function boot({ reply, auth } = {}) {
  const elements = new Map(['driverDetail', 'driverDetailTitle', 'driverDetailStatus', 'driverDetailSummary', 'driverDetailList']
    .map(id => [id, element(id)]));
  const requests = [], trigger = element('trigger');
  trigger.setAttribute('data-driver-detail', encodeURIComponent(DRIVER));
  const state = { user: OWNER, auth: auth || { access_token: 'access', refresh_token: 'refresh', user: { id: OWNER } } };
  const context = { console, Date, Map, Set, URL, Number, Promise, Array, JSON, Object, Error, Math, AbortController,
    encodeURIComponent, decodeURIComponent,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    document: { addEventListener() {}, getElementById: id => elements.get(id) || null, querySelector: () => null,
      querySelectorAll: selector => selector === '[data-driver-detail]' ? [trigger] : [],
      createElement: tag => Object.assign(element(''), { tagName: tag }) },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {},
    OcculertBackend: {
      currentUser: () => state.user ? { id: state.user } : null,
      getSession: async () => state.auth,
      captureAuthContext: () => ({ auth: state.auth }),
      requireAuthContext() {}, isAuthContextCurrent: () => true,
      fetchWithDeadline: async (path, options) => {
        requests.push({ path, options });
        const value = typeof reply === 'function' ? await reply(path, state) : reply;
        return { ok: value.status === undefined || value.status === 200, status: value.status || 200, json: async () => value.body };
      },
    },
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(script.replace('void boot();', ''), context);
  vm.runInContext(`fleetMode=true;protectedUserId='${OWNER}';lastRows=[{driverId:'${DRIVER}',name:'Dana <b>Driver</b>'},{driverId:'local-driver',name:'Local'}];`, context);
  const text = id => elements.get(id).textContent;
  return { context, elements, requests, trigger, state, text, run: expression => vm.runInContext(expression, context),
    open: (id = DRIVER) => vm.runInContext(`openDriverDetail(${JSON.stringify(encodeURIComponent(id))})`, context) };
}
const page = (sessions, hasMore = false) => ({ body: { ok: true, sessions, has_more: hasMore } });

test('opening a driver requests only that driver through the existing owner-scoped history route', async () => {
  const b = boot({ reply: page([session(2), session(1)]) });
  await b.open();
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].path, `/api/fleet-session-history?driver_id=${DRIVER}`);
  assert.equal(b.requests[0].options.method, 'GET');
  assert.equal(b.requests[0].options.headers.Authorization, 'Bearer access');
  assert.equal(b.requests[0].options.cache, 'no-store');
  assert.equal(b.elements.get('driverDetail').hidden, false);
  assert.equal(b.text('driverDetailTitle'), 'Recent sessions: Dana <b>Driver</b>', 'names are written as text, never markup');
  assert.equal(b.elements.get('driverDetailList').children.length, 2);
  assert.equal(b.text('driverDetailSummary'),
    '2 sessions loaded. 2 completed. Average score 80/100 across 2 scored. Reported alerts 4 across 2 with a recorded count.');
  assert.match(b.text('driverDetailStatus'), /Client-reported and unverified/);
  assert.equal(b.elements.get('driverDetail').getAttribute('aria-busy'), null);
});

test('missing scores, counts and end times stay unknown instead of becoming zero', async () => {
  const b = boot({ reply: page([
    session(3, { safety_score: null, alert_count: null, ended_at: null, detector_pipeline: 'forged' }),
    session(2, { safety_score: '', alert_count: -1 }),
    session(1, { safety_score: 0, alert_count: 0 }),
  ]) });
  await b.open();
  assert.equal(b.text('driverDetailSummary'),
    '3 sessions loaded. 2 completed. Average score 0/100 across 1 scored. Reported alerts 0 across 1 with a recorded count.');
  const [open, unknown, zero] = b.elements.get('driverDetailList').children.map(item => item.children.map(child => child.textContent));
  assert.deepEqual(open.slice(1), ['No recorded end time', 'Score not recorded', 'Alerts not recorded', 'Not recorded']);
  assert.deepEqual(unknown.slice(2, 4), ['Score not recorded', 'Alerts not recorded']);
  assert.deepEqual(zero.slice(1, 4), ['Duration 45 min', 'Score 0/100', 'Alerts 0'], 'a recorded zero is shown as zero');
});

test('an empty history and a truncated history are described without implying completeness', async () => {
  const empty = boot({ reply: page([]) });
  await empty.open();
  assert.equal(empty.text('driverDetailSummary'), 'No protected sessions are recorded for this driver.');
  const more = boot({ reply: page([session(1)], true) });
  await more.open();
  assert.match(more.text('driverDetailSummary'), /^1 most recent session loaded; older sessions are in History\./);
});

for (const [name, body] of [
  ['another driver’s session', { ok: true, has_more: false, sessions: [session(1), session(2, { driver_id: OTHER_DRIVER })] }],
  ['a duplicated session', { ok: true, has_more: false, sessions: [session(1), session(1)] }],
  ['an array-valued session ID', { ok: true, has_more: false, sessions: [session(1, { id: [session(1).id] })] }],
  ['an object-valued session ID', { ok: true, has_more: false, sessions: [session(1, { id: { toString: null, valueOf: null } })] }],
  ['an invalid start time', { ok: true, has_more: false, sessions: [session(1, { started_at: 'yesterday' })] }],
  ['an object-valued start time', { ok: true, has_more: false, sessions: [session(1, { started_at: { toString: null, valueOf: null } })] }],
  ['an oversized page', { ok: true, has_more: false, sessions: Array.from({ length: 51 }, (_, i) => session(1, { id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}` })) }],
  ['a missing completeness flag', { ok: true, sessions: [session(1)] }],
  ['a refusal body', { ok: false, error: 'fleet_not_found' }],
]) {
  test(`a response containing ${name} shows nothing rather than a partial list`, async () => {
    const b = boot({ reply: { body } });
    assert.equal(b.run(`driverDetailSessions(${JSON.stringify(body)},${JSON.stringify(DRIVER)})`), null,
      'malformed response fields are rejected without invoking object coercion');
    await b.open();
    assert.equal(b.elements.get('driverDetailList').children.length, 0);
    assert.equal(b.text('driverDetailSummary'), '');
    assert.match(b.text('driverDetailStatus'), /could not be loaded/);
  });
}

test('authorization failures ask for the verified owner and server errors show no data', async () => {
  for (const [status, message] of [[401, /Sign in as the verified fleet owner/], [403, /Sign in as the verified fleet owner/], [503, /could not be loaded/]]) {
    const b = boot({ reply: { status, body: { ok: false } } });
    await b.open();
    assert.match(b.text('driverDetailStatus'), message);
    assert.equal(b.elements.get('driverDetailList').children.length, 0);
  }
});

test('no request is made outside a protected view, for a local ID, an unknown driver or a changed owner', async () => {
  const b = boot({ reply: page([session(1)]) });
  await b.open('local-driver');
  await b.open(OTHER_DRIVER);
  b.run('fleetMode=false'); await b.open(); b.run('fleetMode=true');
  b.state.user = OTHER_DRIVER; await b.open(); b.state.user = OWNER;
  assert.equal(b.requests.length, 0);
  assert.equal(b.elements.get('driverDetail').hidden, true);
});

test('a session token that belongs to another account is refused before any request', async () => {
  const b = boot({ reply: page([session(1)]), auth: { access_token: 'access', refresh_token: 'refresh', user: { id: OTHER_DRIVER } } });
  await b.open();
  assert.equal(b.requests.length, 0);
  assert.match(b.text('driverDetailStatus'), /Sign in as the verified fleet owner/);
});

test('closing, or leaving the protected view, discards the loaded sessions and a late reply', async () => {
  const b = boot({ reply: page([session(1)]) });
  await b.open();
  b.run('closeDriverDetail()');
  assert.equal(b.elements.get('driverDetail').hidden, true);
  assert.equal(b.elements.get('driverDetailList').children.length, 0);
  assert.equal(b.text('driverDetailSummary'), '');
  assert.equal(b.text('driverDetailTitle'), 'Recent sessions');
  assert.equal(b.trigger.focused, 1, 'focus returns to the control that opened the panel');

  await b.open();
  b.run('clearProtectedFleetCache()');
  assert.equal(b.elements.get('driverDetail').hidden, true);
  assert.equal(b.elements.get('driverDetailList').children.length, 0);
  assert.equal(b.text('driverDetailTitle'), 'Recent sessions', 'the previous driver name is discarded with protected data');

  let release;
  const late = boot({ reply: () => new Promise(resolve => { release = () => resolve(page([session(1)])); }) });
  const pending = late.open();
  await new Promise(resolve => setImmediate(resolve));
  late.run('clearProtectedFleetCache()');
  release(); await pending;
  assert.equal(late.elements.get('driverDetail').hidden, true);
  assert.equal(late.elements.get('driverDetailList').children.length, 0, 'a reply for a discarded view is never rendered');
  assert.equal(late.text('driverDetailTitle'), 'Recent sessions');
});

test('the Sessions control exists only on protected rows and the panel markup is present', () => {
  const b = boot({ reply: page([]) });
  const row = { driverId: DRIVER, name: 'Dana', status: 'SAFE', initials: 'D', route: 'Van 1', hasSession: false, hasSafetyScore: false };
  assert.match(b.run(`driverRow(${JSON.stringify(row)})`), /data-driver-detail="22222222-2222-4222-8222-222222222222"[^>]*aria-controls="driverDetail">Sessions<\/button>/);
  b.run('fleetMode=false');
  assert.doesNotMatch(b.run(`driverRow(${JSON.stringify(row)})`), /data-driver-detail/);
  const contract = fleetDashboardContract();
  for (const id of ['driverDetail', 'driverDetailTitle', 'driverDetailStatus', 'driverDetailSummary', 'driverDetailList', 'driverDetailClose']) {
    assert.match(contract, new RegExp(`id="${id}"`));
  }
  assert.match(contract, /<section id="driverDetail"[^>]*hidden>/, 'the panel starts hidden');
  assert.doesNotMatch(script.slice(script.indexOf('fleet-driver-detail:start'), script.indexOf('fleet-driver-detail:end')), /innerHTML|latitude|longitude/);
});
