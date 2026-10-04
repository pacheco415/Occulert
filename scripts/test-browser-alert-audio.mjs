import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { assetByStem } from './lib/current-assets.mjs';
import { browserAlertBytes } from './generate-browser-alert.mjs';

const driver = readFileSync(assetByStem('driver-app.js'), 'utf8');
const audioCode = driver.slice(driver.indexOf('let _ac=null,'), driver.indexOf('function trigger(reason'));
assert.ok(audioCode.includes('function tone('), 'Test the active driver audio implementation');

function harness({ state = 'running', noContext = false, runningAfterResume = false, rejectResume = false, neverResume = false, rejectPlay = false, rejectPrime = false, session = {} } = {}) {
  const timers = new Map(), listeners = new Map(), contexts = [], media = [], oscillators = [];
  let timerId = 0;
  class Context {
    constructor() { this.state = state; this.resumeCalls = 0; this.destination = {}; contexts.push(this); }
    resume() {
      this.resumeCalls++;
      if (rejectResume) return Promise.reject(new Error('Audio interrupted'));
      if (neverResume) return new Promise(() => {});
      if (runningAfterResume) this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() { const o = { frequency: {}, connect() {}, start() { o.started = true; }, stop() { o.stopped = true; } }; oscillators.push(o); return o; }
    createGain() { return { gain: {}, connect() {} }; }
  }
  class Media {
    constructor(src) { this.src = src; this.currentTime = 0; this.paused = true; this.calls = []; media.push(this); }
    play() { this.calls.push({ muted: this.muted, volume: this.volume }); this.paused = false; return (rejectPlay || (rejectPrime && this.muted)) ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const document = { hidden: false, addEventListener(name, callback) { listeners.set(name, callback); } };
  const context = vm.createContext({
    experimentFlags: {any:false,noface:false}, experimentController: null,
    document, navigator: { audioSession: session }, window: { AudioContext: noContext ? undefined : Context },
    Audio: Media, Promise,
    setTimeout(callback, duration) { const id = ++timerId; timers.set(id, { callback, duration }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(audioCode, context);
  return {
    context, document, contexts, media, oscillators, timers, session,
    run(code) { return vm.runInContext(code, context); },
    event(name) { listeners.get(name)(); },
    expire(duration) { for (const [id, timer] of [...timers]) if (timer.duration === duration) { timers.delete(id); timer.callback(); } },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('the Start gesture requests playback before asynchronous camera/model work', () => {
  const h = harness({ state: 'interrupted' });
  const firstStart = driver.slice(driver.indexOf('async function start(){'), driver.indexOf('async function stop('));
  Object.assign(h.context, {
    startupAllowsMonitoring: () => true, starting: false, detectorFailureStopping: false,
    cameraFailureStopping: false, startBtn: {}, setMonitoringUi() {}, setCameraControlsDisabled() {},
    setOverlay() {}, navigator: { audioSession: h.session, mediaDevices: { getUserMedia() {} } },
    initModel() { assert.equal(h.session.type, 'playback'); return new Promise(() => {}); },
  });
  vm.runInContext(`${firstStart}\nvoid start();`, h.context);
  assert.equal(h.session.type, 'playback');
  assert.equal(h.contexts[0].resumeCalls, 1);
  assert.equal(h.media[0].calls[0].muted, true);
  assert.equal(h.oscillators.length, 0);
});

test('interrupted and suspended contexts resume without producing a priming alert', async () => {
  for (const state of ['interrupted', 'suspended']) {
    const h = harness({ state });
    h.run('beginAlertAudioScope();');
    assert.equal(h.contexts[0].resumeCalls, 1);
    assert.equal(h.session.type, 'playback');
    assert.equal(h.media[0].loop, false);
    assert.equal(h.media[0].src, '/audio/alert.v1.wav');
    assert.equal(h.media[0].calls[0].muted, true);
    h.expire(150);
    assert.equal(h.media[0].paused, true);
    assert.equal(h.oscillators.length, 0);
    await settle();
  }
});

test('a resumed running context keeps the existing oscillator frequency, gain and duration', async () => {
  const h = harness({ state: 'interrupted', runningAfterResume: true });
  h.run('beginAlertAudioScope();tone(1100,900,.35);');
  assert.equal(h.oscillators.length, 1);
  assert.equal(h.oscillators[0].frequency.value, 1100);
  assert.equal(h.oscillators[0].started, true);
  assert.equal(h.media[0].calls.filter(call => !call.muted).length, 0);
  h.expire(900);
  assert.equal(h.oscillators[0].stopped, true);
  await settle();
});

test('unavailable or still interrupted Web Audio uses one bounded fallback for actual tones', async () => {
  for (const options of [{ noContext: true }, { state: 'interrupted' }, { state: 'suspended', rejectResume: true }]) {
    const h = harness(options);
    h.run('beginAlertAudioScope();tone(880,450,.2);');
    assert.equal(h.media.length, 1);
    assert.equal(h.media[0].calls.at(-1).muted, false);
    assert.equal(h.media[0].volume, .2);
    assert.equal(h.oscillators.length, 0, 'Never schedule a delayed oscillator in an interrupted context');
    h.expire(450);
    assert.equal(h.media[0].paused, true);
    h.run('tone(1100,5000,.35);tone(880,450,.2);');
    assert.equal(h.media.length, 1, 'Reuse and restart the single element instead of stacking players');
    assert.ok([...h.timers.values()].every(timer => timer.duration <= 1000));
    h.expire(450);
    assert.equal(h.media[0].paused, true);
    await settle();
  }
});

test('returning visible and the next tap recover audio without replaying an alert', async () => {
  const h = harness({ state: 'interrupted' });
  h.event('visibilitychange');
  h.event('pointerdown');
  assert.equal(h.contexts.length, 0, 'Do not request audio before a deliberate Start/test gesture');
  h.run('beginAlertAudioScope();tone(880,450,.2);');
  h.document.hidden = true; h.event('visibilitychange');
  assert.equal(h.media[0].paused, true);
  await settle();
  const audibleBefore = h.media[0].calls.filter(call => !call.muted).length;
  h.document.hidden = false; h.event('visibilitychange');
  await settle();
  h.event('pointerdown');
  assert.equal(h.contexts[0].resumeCalls, 3);
  assert.equal(h.media[0].calls.filter(call => !call.muted).length, audibleBefore);
  assert.equal(h.media[0].calls.at(-1).muted, true);
  assert.equal(h.oscillators.length, 0);
  h.expire(150);
  assert.equal(h.media[0].paused, true);
});

test('a stuck resume remains single-flight until its bounded preparation timeout', () => {
  const h = harness({ state: 'interrupted', neverResume: true });
  h.run('beginAlertAudioScope();beginAlertAudioScope();');
  assert.equal(h.contexts[0].resumeCalls, 1);
  h.expire(1000); h.expire(150);
  h.event('pointerdown');
  assert.equal(h.contexts[0].resumeCalls, 2);
});

test('missing or denied AudioSession/media APIs and playback rejection stay contained', async () => {
  const session = {}; Object.defineProperty(session, 'type', { set() { throw Error('Unsupported'); } });
  const h = harness({ noContext: true, rejectPlay: true, session });
  assert.doesNotThrow(() => h.run('beginAlertAudioScope();tone(880,450,.25);'));
  await settle();
  assert.equal(h.media[0].paused, true);
  assert.equal(h.timers.size, 0);
  const missing = harness({ noContext: true, session: null });
  assert.doesNotThrow(() => missing.run('beginAlertAudioScope();'));
  missing.document.hidden = true;
  missing.event('visibilitychange');
  const count = missing.media[0].calls.length;
  missing.run('tone(880,450,.2);beginAlertAudioScope();');
  assert.equal(missing.media[0].calls.length, count);
});

async function offlineInstall(failAudio = false) {
  const listeners = new Map(), cached = new Map(), added = [], deleted = [];
  const cache = {
    async add(request) {
      const url = typeof request === 'string' ? request : new URL(request.url).pathname;
      added.push({ url, integrity: request.integrity || '' });
      if (failAudio && url === '/audio/alert.v1.wav') throw Error('Audio integrity mismatch');
      cached.set(url, {});
    },
    async match(url) { return cached.get(url); },
  };
  const context = vm.createContext({
    URL, Request, WebAssembly, Uint8Array, Map, Set,
    self: { location: { origin: 'https://occulert.test' }, addEventListener(name, callback) { listeners.set(name, callback); }, async skipWaiting() {} },
    caches: { async open() { return cache; }, async delete(name) { deleted.push(name); } },
  });
  vm.runInContext(readFileSync('sw.js', 'utf8'), context);
  let install;
  listeners.get('install')({ waitUntil(promise) { install = promise; } });
  return { install, added, deleted };
}

test('a rejected muted preparation cannot cancel a newer actual fallback alert', async () => {
  const h = harness({ noContext: true, rejectPrime: true });
  h.run('beginAlertAudioScope();tone(880,450,.2);');
  await settle();
  assert.equal(h.media[0].paused, false);
  assert.equal(h.media[0].calls.at(-1).muted, false);
  assert.equal([...h.timers.values()].filter(timer => timer.duration === 450).length, 1);
  h.expire(450);
  assert.equal(h.media[0].paused, true);
});

test('a scheduled low pulse is discarded if the context interrupts before delivery', () => {
  const h = harness();
  Object.assign(h.context, {
    Date: { now: () => 1_000_000 }, lastAlert: 0, calibrating: false, confidence: 70, alerts: 0,
    alertsEl: {}, lastEscalation: 0, escalationLevel: 0, alertTitle: {}, alertSub: {},
    alertScreen: { style: {}, classList: { add() {}, remove() {} } }, nightOpacity: { value: '70' },
    log() {}, pushFleet() {},
  });
  const trigger = driver.slice(driver.indexOf('function trigger(reason'), driver.indexOf('function demoAlert()'));
  vm.runInContext(`${trigger}\nbeginAlertAudioScope();trigger('Fatigue');`, h.context);
  assert.equal(h.oscillators.length, 1, 'The main tone starts immediately while running');
  h.contexts[0].state = 'interrupted';
  h.expire(0); h.expire(300);
  assert.equal(h.oscillators.length, 1, 'Do not queue low pulses for much later recovery');
});

function attachDriverLifecycle(h) {
  const output = {}, screenClasses = new Set();
  h.document.getElementById = id => id === 'alertCheckResult' ? output : null;
  Object.assign(h.context, {
    startupAllowsMonitoring: () => true, starting: false, running: false,
    detectorFailureStopping: false, cameraFailureStopping: false, startCancelled: false,
    startBtn: {}, setMonitoringUi() {}, setCameraControlsDisabled() {}, setOverlay() {},
    initModel: async () => { throw Error('Model not ready'); },
    cameraRecoveryGuidance: () => ({ title: 'Unavailable', text: 'Try again', hint: 'Park first' }),
    stream: null, video: {}, render() {}, log() {},
    stopTimer() {}, clearCameraTrackGuards() {}, wakeLock: null, raf: null, stopGPS() {},
    ctx: { clearRect() {} }, canvas: { width: 1, height: 1 }, refreshCameraChoices: async () => [],
    fleetPayload: () => ({ status: 'WATCH', safetyScore: 0, perclos: 0, distractionSeconds: 0, avgFatigue: 0, maxFatigue: 0, gpsEnabled: false, distanceMiles: 0 }),
    saveLocalSessionHistory: payload => payload, sessionStart: 0, pushFleet() {}, reportEl: { style: {} },
    calibrated: false, baselineEAR: .28, eyeClosedThreshold: .18,
    alerts: 0, headNods: 0, microsleeps: 0, escalationLevel: 0,
    cloudConsent: { checked: false }, cloudReady: false, Date,
    alertTitle: {}, alertSub: {}, nightOpacity: { value: '70' },
    alertScreen: { style: {}, classList: { add: value => screenClasses.add(value), remove: value => screenClasses.delete(value) } },
  });
  h.context.navigator.mediaDevices = { getUserMedia() {} };
  const start = driver.slice(driver.indexOf('async function start(){'), driver.indexOf('async function stop('));
  const stop = driver.slice(driver.indexOf('async function stop('), driver.indexOf('const startLocalSession=start;'));
  const demo = driver.slice(driver.indexOf('function demoAlert(){'), driver.indexOf('\nfunction onResults'));
  vm.runInContext(`${start}\n${stop}\n${demo}`, h.context);
  return { screenClasses };
}

test('actual Stop restores prior routing, cancels fallback and disables all later tap recovery', async () => {
  const h = harness({ noContext: true, session: { type: 'ambient' } });
  attachDriverLifecycle(h);
  h.run('running=true;beginAlertAudioScope();tone(880,450,.2);');
  assert.equal(h.session.type, 'playback');
  await h.run('stop();');
  assert.equal(h.session.type, 'ambient');
  assert.equal(h.run('_alertAudioRequested'), false);
  assert.equal(h.media[0].paused, true);
  const plays = h.media[0].calls.length;
  h.event('pointerdown'); h.event('visibilitychange'); h.run('tone(880,450,.2);');
  assert.equal(h.media[0].calls.length, plays);
  assert.equal(h.session.type, 'ambient');
});

test('actual failed Start and parked-test completion restore routing and release ownership', async () => {
  const failed = harness({ noContext: true, session: { type: 'auto' } });
  attachDriverLifecycle(failed);
  await failed.run('start();');
  assert.equal(failed.session.type, 'auto');
  assert.equal(failed.run('_alertAudioRequested'), false);
  assert.equal(failed.media[0].paused, true);
  const demo = harness({ noContext: true, session: { type: 'transient' } });
  attachDriverLifecycle(demo);
  demo.run('demoAlert();');
  assert.equal(demo.session.type, 'playback');
  demo.expire(1800);
  assert.equal(demo.session.type, 'transient');
  assert.equal(demo.run('_alertAudioRequested'), false);
  const plays = demo.media[0].calls.length;
  demo.event('pointerdown');
  assert.equal(demo.media[0].calls.length, plays);
});

test('an old demo timeout cannot release audio owned by a newer actual monitoring Start', () => {
  const h = harness({ noContext: true, session: { type: 'auto' } });
  const lifecycle = attachDriverLifecycle(h);
  h.run('demoAlert();');
  assert.equal(lifecycle.screenClasses.has('show'), true);
  h.context.initModel = () => new Promise(() => {});
  h.run('void start();');
  assert.equal(lifecycle.screenClasses.has('show'), false, 'Start dismisses only the old parked-test overlay');
  h.context.alertTitle.textContent = 'NEWER ALERT';
  lifecycle.screenClasses.add('show');
  const owner = h.run('_alertAudioOwner');
  h.expire(1800);
  assert.equal(h.run('_alertAudioOwner'), owner);
  assert.equal(lifecycle.screenClasses.has('show'), true, 'Old test timeout preserves newer alert UI');
  assert.equal(h.context.alertTitle.textContent, 'NEWER ALERT');
  assert.equal(h.run('_alertAudioRequested'), true);
  assert.equal(h.session.type, 'playback');
  h.expire(450);
  h.event('pointerdown');
  assert.equal(h.media[0].calls.at(-1).muted, true, 'Active Start retains silent gesture recovery');
  h.run('releaseAlertAudioScope();');
  assert.equal(h.session.type, 'auto');
});

test('release does not overwrite a routing setting changed outside the owned playback scope', () => {
  const h = harness({ noContext: true, session: { type: 'ambient' } });
  h.run('beginAlertAudioScope();');
  h.session.type = 'transient';
  h.run('releaseAlertAudioScope();');
  assert.equal(h.session.type, 'transient');
});

test('the original short alert is integrity-pinned, immutable and required for offline install', async () => {
  const bytes = readFileSync('audio/alert.v1.wav');
  assert.deepEqual(bytes, browserAlertBytes());
  assert.equal(bytes.length, 28_844);
  assert.equal(bytes.readUInt32LE(24), 16_000);
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.parse(readFileSync('asset-integrity.json', 'utf8'));
  assert.equal(manifest['audio/alert.v1.wav'], digest);
  const { install, added } = await offlineInstall();
  await install;
  assert.equal(added.find(asset => asset.url === '/audio/alert.v1.wav').integrity, `sha256-${Buffer.from(digest, 'hex').toString('base64')}`);
  const headers = JSON.parse(readFileSync('vercel.json', 'utf8')).headers;
  assert.ok(headers.some(rule => rule.source === '/audio/alert.v1.wav' && rule.headers.some(header => header.key === 'Cache-Control' && header.value.includes('immutable'))));
  const failed = await offlineInstall(true);
  await assert.rejects(failed.install, /Critical offline assets were not cached/);
  assert.equal(failed.deleted.length, 1, 'A failed audio integrity install cannot advertise a complete offline cache');
});
