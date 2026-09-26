import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../fleet-dashboard.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('/* fleet-refresh-policy:start */'));
assert.ok(script);
const historyKey = 'occulert-session-history', liveKey = 'occulert-live-session';
const live = { id: 'real-session', driverId: 'real-driver', name: 'Real driver', safetyScore: 82 };
function boot(values = {}) {
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
  vm.runInContext(script.replace('void boot();', '') + '\nrender=()=>{};toast=message=>globalThis.notices.push(message);', context);
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
