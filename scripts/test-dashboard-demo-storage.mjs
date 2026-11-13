import { fleetDashboardRuntime } from './lib/fleet-dashboard-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = fleetDashboardRuntime();
const historyKey = 'occulert-session-history', liveKey = 'occulert-live-session';
const live = { id: 'real-session', driverId: 'real-driver', name: 'Real driver', safetyScore: 82 };
function boot(values = {}, source = script) {
  const store = new Map(Object.entries(values)), mutations = [], notices = [];
  const context = { console, Date, Map, Set, URL, Number, Promise, Array, JSON,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null },
    navigator: {}, localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { mutations.push(['set', key]); store.set(key, value); },
      removeItem: key => { mutations.push(['remove', key]); store.delete(key); },
    }, addEventListener() {},
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(source.replace('void boot();', '') + '\nrender=()=>{};toast=message=>globalThis.notices.push(message);', context);
  context.notices = notices;
  return { context, store, mutations, notices, run: expression => vm.runInContext(expression, context) };
}
function json(value) { return JSON.parse(JSON.stringify(value)); }

test('demo load and clear preserve real canonical history and live snapshot byte-for-byte', () => {
  const history = JSON.stringify([live]), snapshot = JSON.stringify(live);
  const b = boot({ [historyKey]: history, [liveKey]: snapshot });
  b.run('seedDemoData()');
  assert.equal(b.store.get(historyKey), history); assert.equal(b.store.get(liveKey), snapshot);
  assert.equal(b.run('sessionHistoryRows().length'), 3);
  assert.ok(b.run('sessionHistoryRows().every(row=>row.driverId.startsWith("demo-"))'));
  b.run('seedDemoData(); clearDemoData()');
  assert.equal(b.store.get(historyKey), history); assert.equal(b.store.get(liveKey), snapshot);
  assert.deepEqual(b.mutations, []);
  assert.equal(b.run('sessionHistoryRows()[0].driverId'), 'real-driver');
});

test('demo controls neither read nor mutate storage that temporarily refuses access', () => {
  const b = boot({ [historyKey]: '{damaged', [liveKey]: '{damaged' });
  b.context.localStorage.getItem = () => { throw Error('storage unavailable'); };
  b.run('seedDemoData(); clearDemoData()');
  assert.equal(b.store.get(historyKey), '{damaged'); assert.equal(b.store.get(liveKey), '{damaged');
  assert.deepEqual(b.mutations, []);
});

test('local sessions saved while demo is visible are immediately available when demo clears', () => {
  const b = boot({ [historyKey]: '[]' }); b.run('seedDemoData()');
  const updated = JSON.stringify([{ ...live, id: 'new-real-session' }]); b.store.set(historyKey, updated);
  b.run('clearDemoData()');
  assert.equal(b.run('sessionHistoryRows()[0].id'), 'new-real-session');
  assert.equal(b.store.get(historyKey), updated); assert.deepEqual(b.mutations, []);
});

test('clear demo leaves protected fleet rows and history intact', () => {
  const b = boot(); b.run('seedDemoData(); fleetMode=true; cloudRows=[{driverId:"protected-driver"}]; protectedDrivers=[{id:"protected-driver",name:"Protected"}]; protectedSessions=[{id:"protected-session",driver_id:"protected-driver"}];');
  b.run('clearDemoData()');
  assert.equal(b.run('cloudRows[0].driverId'), 'protected-driver');
  assert.equal(b.run('sessionHistoryRows()[0].id'), 'protected-session');
  assert.deepEqual(b.mutations, []);
});

test('a signed-in owner cannot start demo even before protected boot completes', () => {
  const b = boot(); b.context.OcculertBackend = { currentUser: () => ({ id: 'owner' }) };
  b.run('seedDemoData()');
  assert.deepEqual(json(b.run('cloudRows')), []); assert.deepEqual(b.mutations, []);
});

test('invalid saved list shapes cannot crash local views or be rewritten by demo controls', () => {
  for (const bytes of ['{}', 'null', '"invalid"', '3']) {
    const b = boot({ [historyKey]: bytes, 'occulert-drivers': bytes });
    assert.equal(b.run('sessionHistoryRows().length'), 0);
    assert.equal(b.run('getDrivers().filter(row=>row.active!==false).length'), 0);
    b.run('seedDemoData(); clearDemoData()');
    assert.equal(b.store.get(historyKey), bytes); assert.equal(b.store.get('occulert-drivers'), bytes);
    assert.deepEqual(b.mutations, []);
  }
  const mixed = JSON.stringify([null, false, 'invalid', [], live]);
  const b = boot({ [historyKey]: mixed, 'occulert-drivers': mixed });
  assert.equal(b.run('sessionHistoryRows().length'), 1); assert.equal(b.run('getDrivers().length'), 1);
  assert.equal(b.store.get(historyKey), mixed); assert.deepEqual(b.mutations, []);
});

const currentSource = readFileSync(new URL('../src/fleet-dashboard.js', import.meta.url), 'utf8');
test('invalid local snapshot shapes are omitted without rewriting the stored bytes', () => {
  for (const bytes of ['[]', '[null]', '"saved incorrectly"', '7', 'true', 'null']) {
    const b = boot({ [liveKey]: bytes }, currentSource);
    assert.equal(b.run('getLocal()'), null);
    assert.equal(b.store.get(liveKey), bytes); assert.deepEqual(b.mutations, []);
  }
});

test('malformed local names cannot prevent the dashboard from reaching protected startup', () => {
  for (const name of [{ unexpected: 'object' }, [], 42, true, { toString: null }]) {
    for (const identity of [{ id: live.id, driverId: live.driverId }, {}]) {
      const bytes = JSON.stringify({ ...identity, name });
      const b = boot({ [liveKey]: bytes }, currentSource);
      assert.equal(b.run('normalize(getLocal()).name'), 'Local Driver');
      assert.equal(b.run('normalize(getLocal()).initials'), 'D');
      assert.equal(b.run('normalize(getLocal()).driverId'), identity.driverId || 'driver');
      assert.equal(b.store.get(liveKey), bytes); assert.deepEqual(b.mutations, []);
    }
  }
  const valid = boot({ [liveKey]: JSON.stringify({ ...live, name: 'Avery Driver' }) }, currentSource);
  assert.equal(valid.run('normalize(getLocal()).initials'), 'AD');
  assert.equal(valid.run('normalize(getLocal()).name'), 'Avery Driver');
});

test('malformed nested local events cannot crash history display or CSV counting', () => {
  const events = [null, false, 'bad', [], { type: 'drowsy' }, { session_id: 'different', type: 'yawn' }];
  const bytes = JSON.stringify([{ ...live, events }]);
  const b = boot({ [historyKey]: bytes }, currentSource);
  assert.deepEqual(json(b.run('eventsForSession(sessionHistoryRows()[0])')), [{ type: 'drowsy' }]);
  assert.equal(b.store.get(historyKey), bytes); assert.deepEqual(b.mutations, []);
});

test('malformed stored display fields cannot execute coercions in rows, events or exports', () => {
  const broken = { toString: null, valueOf: null };
  const record = { id: broken, driverId: broken, name: broken, route: broken, status: broken,
    lastUpdate: broken, location: { lat: broken, lng: broken }, alerts: broken, fatigue: broken,
    savedAt: broken, startedAt: broken, endedAt: broken, safetyScore: broken, avgFatigue: broken,
    maxFatigue: broken, headNods: broken, device: broken,
    events: [{ session_id: broken, type: 'mismatched' }, { type: broken, createdAt: broken }] };
  const bytes = JSON.stringify(record), history = JSON.stringify([record]);
  const b = boot({ [liveKey]: bytes, [historyKey]: history, 'occulert-drivers': history }, currentSource);
  const row = json(b.run('normalize(getLocal())'));
  assert.equal(row.driverId, 'driver'); assert.equal(row.route, 'Browser / Driver App');
  assert.equal(row.status, 'NO DATA'); assert.equal(row.location, null); assert.equal(row.stale, true);
  const session = json(b.run('sessionHistoryRows()[0]'));
  for (const key of ['id', 'driverId', 'startedAt', 'endedAt']) assert.equal(session[key], '');
  for (const key of ['safetyScore', 'averageFatigue', 'maxFatigue', 'alertCount', 'headNodCount']) assert.equal(session[key], null);
  assert.equal(session.driverName, 'Local Driver'); assert.equal(session.device, 'Not recorded');
  assert.equal(b.run('eventsForSession(sessionHistoryRows()[0]).length'), 1);
  assert.match(b.run('eventHistoryHtml(eventsForSession(sessionHistoryRows()[0])[0])'), /event/);
  assert.equal(b.run('pilotMetrics().rosterCount'), 1);
  assert.deepEqual(json(b.run('JSON.parse(dashboardDataSnapshot()).freshness')), [['', 0, false]]);
  assert.equal(b.store.get(liveKey), bytes); assert.equal(b.store.get(historyKey), history);
  assert.equal(b.store.get('occulert-drivers'), history);
  assert.deepEqual(b.mutations, []);
});

test('stored identifiers and descriptions retain bounded valid string values only', () => {
  const b = boot({}, currentSource);
  const result = json(b.run(`sessionView({id:'x'.repeat(200),driverId:'d'.repeat(200),
    name:'n'.repeat(200),device:'c'.repeat(200),safetyScore:0,alerts:0})`));
  assert.equal(result.id.length, 80); assert.equal(result.driverId.length, 80);
  assert.equal(result.driverName.length, 80); assert.equal(result.device.length, 120);
  assert.equal(result.safetyScore, 0); assert.equal(result.alertCount, 0);
  assert.equal(b.run('normalize({driverId:42,id:17,name:"Driver name"}).driverId'), 'Driver name');
  assert.equal(b.run('sessionView({safetyScore:"0"}).safetyScore'), '0');
  for (const value of ['Infinity', '', 'not recorded', {}, true]) {
    assert.equal(b.run(`sessionView({safetyScore:${JSON.stringify(value)}}).safetyScore`), null);
  }
});
