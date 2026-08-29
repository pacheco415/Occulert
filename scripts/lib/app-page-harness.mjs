// Deterministic harness for the driver app's detection pipeline.
// Loads the REAL external driver-app.js into a Node vm
// sandbox with a controllable clock and a minimal DOM stub, so the
// shipped calibration / PERCLOS / fatigue / alert logic can be tested
// without a camera, MediaPipe, or a browser.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const DRIVER_APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'driver-app.js');

function makeClassList(el) {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : !!force;
      on ? set.add(c) : set.delete(c);
      return on;
    },
    _set: set,
  };
}

function makeElement(id) {
  const el = {
    id,
    textContent: '',
    className: '',
    title: '',
    value: '60',
    checked: false,
    disabled: false,
    dataset: {},
    style: {},
    parentNode: null,
    children: [],
  };
  el.classList = makeClassList(el);
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  el.setAttribute = () => {};
  el.getAttribute = () => null;
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.prepend = (c) => { c.parentNode = el; el.children.unshift(c); return c; };
  el.remove = () => {
    if (el.parentNode) {
      const i = el.parentNode.children.indexOf(el);
      if (i >= 0) el.parentNode.children.splice(i, 1);
      el.parentNode = null;
    }
  };
  Object.defineProperty(el, 'lastChild', {
    get: () => el.children[el.children.length - 1] || null,
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => '',
    set: () => { el.children = []; },
  });
  el.getContext = () => ({
    clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    closePath: () => {}, stroke: () => {}, strokeStyle: '', lineWidth: 0,
  });
  el.play = async () => {};
  return el;
}

export function createAppHarness({ startAt = 1_700_000_000_000 } = {}) {
  const clock = {
    now: startAt,
    advance(ms) { this.now += ms; },
    set(t) { this.now = t; },
  };

  class FakeDate extends Date {
    constructor(...args) {
      args.length ? super(...args) : super(clock.now);
    }
    static now() { return clock.now; }
  }

  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };

  const documentElement = makeElement('html');
  const body = makeElement('body');
  const document = {
    getElementById: byId,
    createElement: (tag) => makeElement('<' + tag + '>'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement,
    body,
    hidden: false,
    visibilityState: 'visible',
    readyState: 'complete',
  };

  const sandbox = {
    document,
    localStorage,
    navigator: { userAgent: 'occulert-harness', platform: 'harness', maxTouchPoints: 0 },
    Date: FakeDate,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    confirm: () => true,
    matchMedia: () => ({ matches: false, addListener: () => {}, addEventListener: () => {} }),
    console,
    Math, JSON, Object, Array, Number, String, Boolean, Promise, Set, Map, Error,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.removeEventListener = () => {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const code = readFileSync(DRIVER_APP, 'utf8');
  vm.runInContext(code, sandbox, { filename: 'driver-app.js' });

  const run = (code) => vm.runInContext(code, sandbox, { filename: 'harness-eval' });

  return {
    clock,
    run,
    get: (name) => run(name),
    set: (name, value) => run(name + ' = ' + JSON.stringify(value)),
    el: byId,
    // Reset session state the same way start() does, without camera/model.
    startSession() {
      run(`running = true; sessionStart = Date.now();
        fatigue = 0; confidence = 0; alerts = 0; headNods = 0; microsleeps = 0;
        maxFatigue = 0; fatigueSamples = []; noseYHistory = []; earHistory = [];
        perclosWindow = []; eyesClosedSince = 0; turnedSince = 0; totalDistractionMs = 0;
        escalationLevel = 0; lastEscalation = 0; lastAlert = 0; lastRender = 0;
        noFaceSince = 0; lastFaceSeen = 0; distanceMeters = 0; routePoints = [];
        lastPosition = null; calibrating = true; calibrated = false;
        calibrationSamples = []; calibrationUntil = Date.now() + CALIBRATION_MS;
        baselineEAR = .28; eyeClosedThreshold = .18; eyeWatchThreshold = .22;`);
    },

    // Build a synthetic MediaPipe landmark array producing a target EAR.
    // Eye geometry: horizontal span 0.1, vertical distances scaled so
    // calcEAR returns exactly `ear`. Nose at noseX controls headTurn
    // (centered = not turned; >= 0.68 with cheeks at .25/.75 = turned).
    landmarks({ ear = 0.30, noseX = 0.5, noseY = 0.55 } = {}) {
      const lm = [];
      for (let i = 0; i < 468; i += 1) lm.push({ x: 0.5, y: 0.5 });
      const eye = (idx, cx) => {
        const half = (ear * 0.1) / 2;
        lm[idx[0]] = { x: cx - 0.05, y: 0.5 };          // p1
        lm[idx[3]] = { x: cx + 0.05, y: 0.5 };          // p4
        lm[idx[1]] = { x: cx - 0.02, y: 0.5 - half };   // p2
        lm[idx[5]] = { x: cx - 0.02, y: 0.5 + half };   // p6
        lm[idx[2]] = { x: cx + 0.02, y: 0.5 - half };   // p3
        lm[idx[4]] = { x: cx + 0.02, y: 0.5 + half };   // p5
      };
      eye([362, 385, 387, 263, 373, 380], 0.62); // LEFT
      eye([33, 160, 158, 133, 153, 144], 0.38);  // RIGHT
      lm[4] = { x: noseX, y: noseY };   // nose tip
      lm[234] = { x: 0.25, y: 0.6 };    // left cheek
      lm[454] = { x: 0.75, y: 0.6 };    // right cheek
      return lm;
    },

    // Feed one processed frame through the real onResults() pipeline,
    // advancing the fake clock by stepMs first (default PROCESS_INTERVAL).
    frame({ ear = 0.30, face = true, noseX = 0.5, noseY = 0.55, stepMs = 135 } = {}) {
      clock.advance(stepMs);
      sandbox.__frame = face
        ? { multiFaceLandmarks: [this.landmarks({ ear, noseX, noseY })] }
        : { multiFaceLandmarks: [] };
      run('onResults(__frame)');
    },

    // Feed identical frames for a duration of fake time.
    feed(spec, durationMs, stepMs = 135) {
      const frames = Math.ceil(durationMs / stepMs);
      for (let i = 0; i < frames; i += 1) this.frame({ ...spec, stepMs });
      return frames;
    },

    state() {
      return run(`({
        running, calibrating, calibrated, baselineEAR,
        eyeClosedThreshold, eyeWatchThreshold, fatigue, confidence,
        alerts, escalationLevel, microsleeps, headNods,
        perclosSamples: perclosWindow.length,
        perclos: Number(document.getElementById('perclos').textContent.replace('%','')) || 0,
        earHistoryLength: earHistory.length,
        noseYHistoryLength: noseYHistory.length,
        fatigueSamplesLength: fatigueSamples.length,
        risk: riskText()[0],
        noFaceSince, eyesClosedSince, lastAlert,
      })`);
    },
  };
}
