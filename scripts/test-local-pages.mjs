import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const versions = JSON.parse(readFileSync(new URL('../asset-versions.json', import.meta.url), 'utf8'));
function harness(asset, initial = {}) {
  const storage = new Map(Object.entries(initial));
  const elements = new Map(), alerts = [], timers = new Map();
  let timerId = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', hidden: true,
      style: {}, options: [], setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {}, select() {} });
    return elements.get(id);
  };
  const localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const context = vm.createContext({ document: { getElementById: element, querySelectorAll: () => [],
    querySelector: () => element('selector') }, localStorage, alert: message => alerts.push(message),
    confirm: () => true, crypto: { randomUUID: () => 'unique-id-' + (++timerId) },
    location: { search: '' }, URLSearchParams, AbortController, Date,
    setInterval() {}, setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id), fetch: () => { throw Error('Unexpected network request'); } });
  if (asset === 'pilot-signup-page-2.js') {
    element('plan').value = 'conversation';
    element('plan').form = { elements: { fleet: element('fleet') } };
  }
  if (asset === 'session-history-page-2.js') {
    context.window=context;
    vm.runInContext(readFileSync(new URL('../'+versions['local-history.js'],import.meta.url),'utf8'),context);
  }
  vm.runInContext(readFileSync(new URL('../' + versions[asset], import.meta.url), 'utf8'), context);
  return { context, storage, elements, element, localStorage, alerts, timers };
}

test('driver profiles tolerate malformed saved values and members', () => {
  for (const value of ['"bad"', '{"length":2}', '[null,7,{"id":"bad","name":55}]']) {
    const app = harness('driver-profiles-page-2.js', { 'occulert-drivers': value });
    assert.match(app.element('drivers').innerHTML, /No drivers yet/);
  }
});

test('driver removal follows its stable identifier when another tab changes the order', () => {
  const first = { id: 'a', name: 'First' }, second = { id: 'b', name: 'Second' };
  const app = harness('driver-profiles-page-2.js', { 'occulert-drivers': JSON.stringify([first, second]) });
  app.storage.set('occulert-drivers', JSON.stringify([{ id: 'c', name: 'New' }, first, second]));
  app.context.removeDriver('b');
  assert.deepEqual(JSON.parse(app.storage.get('occulert-drivers')).map(row => row.id), ['c', 'a']);
});

test('failed profile saves keep the entered fields and explain the failure', () => {
  const app = harness('driver-profiles-page-2.js');
  app.element('name').value = 'Keep this name'; app.element('route').value = 'Keep this route';
  app.localStorage.setItem = () => { throw Error('QuotaExceededError'); };
  assert.doesNotThrow(() => app.context.addDriver());
  assert.equal(app.element('name').value, 'Keep this name');
  assert.match(app.alerts.join(' '), /could not|unable|couldn't/i);
});

test('an unreadable profile snapshot cannot overwrite existing data', () => {
  const original = JSON.stringify([{ id: 'a', name: 'Keep me' }]);
  const app = harness('driver-profiles-page-2.js', { 'occulert-drivers': original });
  app.localStorage.getItem = () => { throw Error('Storage temporarily inaccessible'); };
  app.element('name').value = 'New name';
  app.context.addDriver(); app.context.seedDrivers(); app.context.removeDriver('a');
  assert.equal(app.storage.get('occulert-drivers'), original);
  assert.equal(app.element('name').value, 'New name');
  assert.match(app.alerts.join(' '), /could not be read/);
});

test('profile mutations preserve stored rows excluded from display', () => {
  const app = harness('driver-profiles-page-2.js', { 'occulert-drivers': JSON.stringify([{ id: 'a', name: 'Keep me' }, null]) });
  app.element('name').value = 'New name'; app.context.addDriver();
  const saved = JSON.parse(app.storage.get('occulert-drivers'));
  assert.equal(saved.length, 3); assert.equal(saved[2], null);
  app.context.removeDriver('a');
  assert.equal(JSON.parse(app.storage.get('occulert-drivers'))[1], null);
});

test('profile creation remains available without randomUUID', () => {
  const app = harness('driver-profiles-page-2.js'); app.context.crypto = {};
  app.element('name').value = 'First'; app.context.addDriver();
  app.element('name').value = 'Second'; app.context.addDriver();
  const ids = JSON.parse(app.storage.get('occulert-drivers')).map(row => row.id);
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]);
});

test('successful lead submission preserves fields edited while sending', async () => {
  const app = harness('pilot-signup-page-2.js');
  for (const [id, value] of Object.entries({ name: 'Tester', company: 'Test fleet', email: 'test@example.com' })) app.element(id).value = value;
  let complete;
  app.context.fetch = () => new Promise(resolve => { complete = resolve; });
  const pending = app.context.saveLead({ preventDefault() {} });
  app.element('name').value = 'Edited while sending';
  complete({ ok: true, json: async () => ({ stored: true }) }); await pending;
  assert.equal(app.element('name').value, 'Edited while sending');
  assert.equal(app.element('email').value, '');
  assert.equal(app.element('success').style.display, 'block');
  assert.equal(app.element('saveBtn').disabled, false);
  assert.equal(app.timers.size, 0);
});

test('a corrupt live record does not hide valid saved history', () => {
  const app = harness('session-history-page-2.js', { 'occulert-session-history': JSON.stringify([{ id: 'saved', name: 'Preserved', safetyScore: 80 }]), 'occulert-live-session': '{bad' });
  assert.equal(app.context.getHistory().length, 1);
  assert.match(app.element('table').innerHTML, /Preserved/);
});

test('history totals coerce valid numeric strings and omit missing safety scores from averages', () => {
  const app = harness('session-history-page-2.js', { 'occulert-session-history': JSON.stringify([
    { id: 'a', alerts: '2', headNods: '3', safetyScore: '80' }, { id: 'b', alerts: '4', headNods: '5' }]) });
  assert.equal(String(app.element('alerts').textContent), '6');
  assert.equal(String(app.element('nods').textContent), '8');
  assert.equal(String(app.element('avgScore').textContent), '80');
  assert.doesNotMatch(app.element('table').innerHTML, />SAFE</);
});

test('history CSV neutralizes spreadsheet formulas while preserving commas and quotes', () => {
  const app = harness('session-history-page-2.js', { 'occulert-session-history': JSON.stringify([
    { id: 'a', name: '=1+1', driverId: '\t=1+2' }, { id: 'b', name: 'A, "B"' }]) });
  const csv = app.context.buildCSV();
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'\t=1+2"'));
  assert.ok(csv.includes('"A, ""B"""'));
});

for (const stalledPart of ['headers', 'body']) test(`lead submission recovers from stalled ${stalledPart} and ignores late success`, async () => {
  const app = harness('pilot-signup-page-2.js');
  for (const [id, value] of Object.entries({ name: 'Tester', company: 'Test fleet', email: 'test@example.com' })) app.element(id).value = value;
  let finish, signal, calls = 0;
  const stalled = new Promise(resolve => { finish = resolve; });
  app.context.fetch = async (_url, options) => { calls += 1; signal = options.signal;
    return stalledPart === 'headers' ? stalled : { ok: true, json: () => stalled }; };
  const pending = app.context.saveLead({ preventDefault() {} });
  await Promise.resolve(); await Promise.resolve();
  const duplicate = app.context.saveLead({ preventDefault() {} });
  assert.equal(calls, 1, 'a pending submission must not send a duplicate');
  await duplicate;
  assert.equal(app.element('saveBtn').disabled, true);
  for (const callback of [...app.timers.values()]) callback();
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(app.element('saveBtn').disabled, false);
  assert.match(app.element('error').textContent, /could not confirm/i);
  assert.equal(app.element('name').value, 'Tester');
  finish(stalledPart === 'headers' ? { ok: true, json: async () => ({ stored: true }) } : { stored: true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(app.element('success').style.display, 'none');
  assert.equal(app.element('name').value, 'Tester');
});


test('history missing and invalid counts stay unknown while genuine zeros remain recorded', () => {
  const app = harness('session-history-page-2.js', { 'occulert-session-history': JSON.stringify([
    {id:'valid-zero',alerts:0,headNods:'0',safetyScore:0,avgFatigue:0,maxFatigue:0,savedAt:'2026-10-03T12:00:00Z'},
    {id:'partial',alerts:2,headNods:1.2,safetyScore:101,avgFatigue:false,maxFatigue:'',savedAt:'2026-02-30T12:00:00Z',recoveredInterrupted:true},
    {id:'unknown',alerts:false,headNods:-1,confidence:'not a measurement'}
  ]) });
  assert.equal(String(app.element('alerts').textContent), '2 (partial)');
  assert.equal(String(app.element('nods').textContent), '0 (partial)');
  assert.equal(String(app.element('avgScore').textContent), '0');
  assert.match(app.element('table').innerHTML, /Partial session/);
  assert.match(app.element('table').innerHTML, /Not recorded/);
  assert.doesNotMatch(app.element('table').innerHTML, /Invalid Date/);
  const csv=app.context.buildCSV();
  assert.doesNotMatch(csv, /2026-02-30|not a measurement|false/);
  assert.equal(app.context.count(1.2),null);
  assert.equal(app.context.score(101),null);
  assert.equal(app.context.dateValue('2026-02-30T12:00:00Z'),null);
  assert.equal(app.context.dateValue('2024-02-29T12:00:00Z'),Date.parse('2024-02-29T12:00:00Z'));
});

test('history summaries do not change unknown or partial saved measurements', () => {
  const initial=[{id:'unknown',unknown:{keep:true},alerts:null,headNods:null,savedAt:'invalid'}];
  const app=harness('session-history-page-2.js',{'occulert-session-history':JSON.stringify(initial)});
  assert.equal(String(app.element('alerts').textContent),'--');
  assert.equal(String(app.element('nods').textContent),'--');
  const row=app.context.getHistory()[0];
  assert.equal(row.alerts,null);assert.equal(row.headNods,null);assert.equal(row.savedAt,'invalid');
  assert.equal(row.unknown.keep,true);
});
