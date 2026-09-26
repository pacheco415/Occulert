import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const driver = readFileSync(new URL('../driver-app.v60.js', import.meta.url), 'utf8');
const guard = html.match(/<script\b[^>]*\bid=["']driver-startup-guard["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(guard, 'The real startup guard must be present in app.html');

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ callback, once: Boolean(options?.once) });
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback));
  }
  dispatch(type, detail = {}) {
    const event = { type, target: this, ...detail };
    for (const item of [...(this.listeners.get(type) || [])]) {
      if (item.once) this.removeEventListener(type, item.callback);
      item.callback(event);
    }
    return event;
  }
}

class Element extends EventTarget {
  constructor(id, tagName, text = '') {
    super();
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.onclick = null;
    this.disabledWrites = [];
    this._disabled = false;
    const classes = new Set();
    this.classList = { add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value), toggle: (value, force) => {
        const enabled = force === undefined ? !classes.has(value) : Boolean(force);
        enabled ? classes.add(value) : classes.delete(value);
        return enabled;
      } };
  }
  set disabled(value) { this._disabled = Boolean(value); this.disabledWrites.push(this._disabled); }
  get disabled() { return this._disabled; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  click() {
    if (this.disabled) return;
    this.onclick?.({ target: this });
    this.dispatch('click');
  }
}

function startup({ missingDOM = false, reloadFailure = false } = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>([^<]*)/gi)) {
    const element = new Element(match[3], match[1], match[4].trim());
    element.disabled = /\bdisabled(?:\s|=|$)/.test(match[2]);
    element.hidden = /\bhidden(?:\s|=|$)/.test(match[2]);
    elements.set(element.id, element);
  }
  let time = 0, timerId = 0, domPresent = !missingDOM, reloads = 0;
  const timers = new Map(), calls = [], observers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    notify() { if (this.connected) this.callback([], this); }
  }
  const document = new EventTarget();
  Object.assign(document, { readyState: 'loading',
    getElementById: id => domPresent ? elements.get(id) || null : null,
    querySelector: selector => selector.startsWith('#') ? document.getElementById(selector.slice(1)) : null,
    querySelectorAll: selector => domPresent && selector === 'button'
      ? [...elements.values()].filter(element => element.tagName === 'BUTTON') : [],
    body: new Element('body', 'body'), documentElement: new Element('html', 'html') });
  const window = new EventTarget();
  const location = { href: 'https://www.occulert.com/app.html', origin: 'https://www.occulert.com',
    reload: () => { reloads += 1; if (reloadFailure) throw new Error('Browser refused reload'); } };
  class ClockDate extends Date { static now() { return time; } }
  const context = vm.createContext({ window, document, location, URL, MutationObserver, Date: ClockDate,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: time + Number(delay) }); return id; },
    clearTimeout: id => timers.delete(id), console, performance: { now: () => time } });
  Object.assign(window, { document, location });
  vm.runInContext(guard, context, { filename: 'driver-startup-guard.js' });
  function advance(ms) {
    const target = time + ms;
    let iterations = 0;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++iterations < 1000, 'The startup guard must not spin or schedule unbounded retries');
      timers.delete(next[0]); time = next[1].at; next[1].callback();
    }
    time = target;
  }
  function capability(overrides = {}, { frozen = true, bindStart = true } = {}) {
    context.recordCall = name => calls.push(name);
    const core = vm.runInContext(`({ version: 'v60', start: () => recordCall('start'),
      stop: () => recordCall('stop'), findCameraChoices: () => recordCall('findCameraChoices'),
      initModel: () => recordCall('initModel') })`, context);
    Object.assign(core, overrides);
    if (bindStart) elements.get('startBtn').onclick = core.start;
    return frozen ? Object.freeze(core) : core;
  }
  return { api: window.OcculertStartup, window, document, elements, calls, timers, observers, advance, capability,
    notifyDOM: () => observers.forEach(observer => observer.notify()),
    el: id => elements.get(id), showDOM: () => { domPresent = true; }, reloads: () => reloads };
}

function assertBlocked(app) {
  assert.equal(app.api.isReady(), false);
  assert.equal(app.el('startBtn').disabled, true);
  assert.equal(app.el('driverControls').disabled, true);
  assert.doesNotMatch(app.el('driveState').textContent, /^(?:READY|MONITORING)$/i);
  assert.equal(app.calls.length, 0, 'Startup checks must never invoke monitoring, camera, or model capabilities');
}

test('startup remains blocked until an explicit complete core handshake', () => {
  const app = startup();
  assertBlocked(app);
  app.document.dispatch('DOMContentLoaded');
  app.window.dispatch('load');
  app.window.dispatch('load', { target: { tagName: 'SCRIPT', src: 'https://www.occulert.com/driver-app.v60.js' } });
  assertBlocked(app);
  app.advance(7999);
  assertBlocked(app);
});

test('malformed, mutable, and wrong-version core capabilities cannot unlock Start', () => {
  const cases = [null, undefined, false, 'v60', [], {},
    app => app.capability({}, { frozen: false }),
    app => app.capability({ version: 'v57' }),
    app => app.capability({ version: undefined }),
    ...['start', 'stop', 'findCameraChoices', 'initModel'].map(name => app => app.capability({ [name]: undefined })),
    ...['start', 'stop', 'findCameraChoices', 'initModel'].map(name => app => app.capability({ [name]: 'callable' })),
  ];
  for (const candidate of cases) {
    const app = startup();
    const core = typeof candidate === 'function' ? candidate(app) : candidate;
    app.api.ready(core);
    assertBlocked(app);
  }
});

test('a valid core also requires the actual Start click handler to be callable', () => {
  for (const handler of [null, undefined, 'start']) {
    const app = startup();
    const core = app.capability({}, { bindStart: false });
    app.el('startBtn').onclick = handler;
    app.api.ready(core);
    assertBlocked(app);
  }
});

test('healthy handshake unlocks once, clears the deadline, and starts no work', () => {
  const app = startup();
  const core = app.capability();
  const start = app.el('startBtn');
  start.disabledWrites = [];
  app.api.ready(core);
  assert.equal(app.api.isReady(), true);
  assert.equal(start.disabled, false);
  assert.equal(start.disabledWrites.filter(value => value === false).length, 1);
  assert.equal(app.calls.length, 0);
  assert.equal(app.timers.size, 0);
  assert.equal(app.observers.every(observer => !observer.connected), true);
  app.api.ready(core);
  assert.equal(start.disabledWrites.filter(value => value === false).length, 1, 'A duplicate handshake must not re-enable controls');
  app.advance(8000);
  assert.equal(app.api.isReady(), true);
  assert.equal(start.disabled, false);
  assert.equal(app.calls.length, 0);
});

test('the eight-second failure is terminal even when a healthy core arrives late', () => {
  const app = startup();
  app.advance(8000);
  assertBlocked(app);
  assert.equal(app.el('startupTitle').textContent, 'App could not load');
  assert.equal(app.el('startupNotice').getAttribute('role'), 'alert');
  assert.equal(app.el('startupNotice').getAttribute('aria-live'), 'assertive');
  assert.equal(app.el('startupReload').hidden, false);
  const core = app.capability();
  app.api.ready(core);
  assertBlocked(app);
  app.advance(30000);
  assertBlocked(app);
});

for (const [name, event] of [
  ['script resource failure', { target: { tagName: 'SCRIPT', src: 'https://www.occulert.com/driver-app.v60.js' } }],
  ['versioned script resource failure', { target: { tagName: 'SCRIPT', src: '/driver-app.v60.js?offline=1#cached' } }],
  ['syntax error', { target: null, filename: 'https://www.occulert.com/driver-app.v60.js', message: 'Unexpected token', error: new SyntaxError('Unexpected token') }],
  ['runtime error', { target: null, filename: 'https://www.occulert.com/driver-app.v60.js', message: 'Storage unavailable', error: new Error('Storage unavailable') }],
]) {
  test(`targeted core ${name} fails immediately and rejects late readiness`, () => {
    const app = startup();
    app.window.dispatch('error', event);
    assertBlocked(app);
    assert.equal(app.el('startupTitle').textContent, 'App could not load', 'Targeted failures must surface recovery immediately');
    assert.equal(app.el('startupReload').hidden, false);
    app.api.ready(app.capability());
    assertBlocked(app);
  });
}

test('backend, security, and unrelated resource/errors do not reject local core readiness', () => {
  for (const path of ['/occulert-backend.v60.js', '/security-utils.v47.js', '/lang.v47.js',
    '/driver-app.v47.css', '/driver-app.v57.js', '/unrelated-driver-app.v60.js']) {
    for (const event of [
      { target: { tagName: 'SCRIPT', src: 'https://www.occulert.com' + path } },
      { target: null, filename: 'https://www.occulert.com' + path, message: 'Failed to initialize', error: new Error('Failed to initialize') },
    ]) {
      const app = startup();
      app.window.dispatch('error', event);
      app.advance(7999);
      app.api.ready(app.capability());
      assert.equal(app.api.isReady(), true, `${path} must not fail local startup`);
      assert.equal(app.el('startBtn').disabled, false);
      assert.equal(app.calls.length, 0);
    }
  }
});

test('early deadline remains neutral and disabled when the real controls arrive later', () => {
  const app = startup({ missingDOM: true });
  app.advance(8000);
  app.showDOM();
  app.document.dispatch('DOMContentLoaded');
  assertBlocked(app);
  app.api.ready(app.capability());
  assertBlocked(app);
});

test('streamed controls after the deadline show terminal recovery without waiting for DOMContentLoaded', () => {
  const app = startup({ missingDOM: true });
  app.advance(8000);
  assert.equal(app.api.isReady(), false);
  assert.equal(app.observers.some(observer => observer.connected), true);
  app.showDOM();
  app.notifyDOM();
  assertBlocked(app);
  assert.equal(app.el('startupTitle').textContent, 'App could not load');
  assert.equal(app.el('startupReload').hidden, false);
  assert.equal(app.el('status').textContent, 'APP UNAVAILABLE');
  assert.equal(app.el('driveState').textContent, 'NOT MONITORING');
  assert.equal(app.observers.every(observer => !observer.connected), true);
  app.api.ready(app.capability());
  assertBlocked(app);
});

test('refresh repairs partial-script DOM changes after terminal failure', () => {
  const app = startup();
  app.advance(8000);
  app.el('startBtn').disabled = false;
  app.el('driverControls').disabled = false;
  app.el('driveState').textContent = 'READY';
  app.el('calibration').textContent = '100%';
  app.el('risk').textContent = 'LOW';
  app.el('riskDetail').textContent = 'All good';
  app.el('status').textContent = 'MONITORING';
  app.el('startupNotice').hidden = true;
  app.api.refresh();
  assertBlocked(app);
  assert.equal(app.el('driveState').textContent, 'NOT MONITORING');
  assert.equal(app.el('calibration').textContent, 'NOT STARTED');
  assert.equal(app.el('risk').textContent, '--');
  assert.equal(app.el('riskDetail').textContent, '--');
  assert.equal(app.el('status').textContent, 'APP UNAVAILABLE');
  assert.equal(app.el('startupNotice').hidden, false);
  assert.equal(app.reloads(), 0, 'Refreshing the neutral state must not silently reload the page');
});

test('a browser reload failure leaves the failed page neutral and Start disabled', () => {
  const app = startup({ reloadFailure: true });
  app.advance(8000);
  assertBlocked(app);
  assert.throws(() => app.el('startupReload').click(), /Browser refused reload/);
  assert.equal(app.reloads(), 1);
  assertBlocked(app);
  app.api.ready(app.capability());
  assertBlocked(app);
});

test('duplicate readiness, DOMContentLoaded, and refresh cannot reset an active session', () => {
  const app = startup();
  const core = app.capability();
  app.api.ready(core);
  app.el('startBtn').disabled = true;
  app.el('startBtn').textContent = 'STOP MONITORING';
  app.el('driveState').textContent = 'MONITORING';
  app.el('risk').textContent = 'HIGH';
  app.el('calibration').textContent = '100%';
  app.el('status').textContent = 'ONLINE';
  app.document.dispatch('DOMContentLoaded');
  app.api.refresh();
  app.api.ready(core);
  app.advance(8000);
  assert.equal(app.api.isReady(), true);
  assert.equal(app.el('startBtn').disabled, true);
  assert.equal(app.el('startBtn').textContent, 'STOP MONITORING');
  assert.equal(app.el('driveState').textContent, 'MONITORING');
  assert.equal(app.el('risk').textContent, 'HIGH');
  assert.equal(app.el('calibration').textContent, '100%');
  assert.equal(app.el('status').textContent, 'ONLINE');
  assert.equal(app.calls.length, 0);
});

test('the real driver permission gate requires a present guard with explicit true readiness', () => {
  const start = driver.indexOf('function startupAllowsMonitoring(');
  assert.ok(start >= 0, 'The driver permission gate must be present');
  const open = driver.indexOf('{', start);
  let end = open + 1, depth = 1;
  while (depth && end < driver.length) {
    if (driver[end] === '{') depth += 1;
    if (driver[end] === '}') depth -= 1;
    end += 1;
  }
  const source = driver.slice(start, end);
  for (const guard of [undefined, null, {}, { isReady: true },
    { isReady: () => false }, { isReady: () => undefined }, { isReady: () => 'true' }, { isReady: () => 1 }]) {
    const context = { window: { OcculertStartup: guard } };
    vm.runInNewContext(source, context);
    assert.equal(context.startupAllowsMonitoring(), false, 'Missing or incomplete startup cannot allow camera/keyboard entry points');
  }
  const context = { window: { OcculertStartup: { isReady: () => true } } };
  vm.runInNewContext(source, context);
  assert.equal(context.startupAllowsMonitoring(), true);
});
