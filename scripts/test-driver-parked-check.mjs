import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const asset = html.match(/<script src="\/(driver-app\.v\d+\.js)"><\/script>/)?.[1];
assert.ok(asset, 'The driver page must load a versioned driver app');
const driver = readFileSync(new URL(`../${asset}`, import.meta.url), 'utf8');

function extract(start, end) {
  const first = driver.indexOf(start);
  const last = driver.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Expected ${start} before ${end}`);
  return driver.slice(first, last);
}

test('active monitoring shows status and alerts while parked diagnostics are hidden', () => {
  const parkedStart = html.indexOf('<section id="parkedControls"');
  const parkedEnd = html.indexOf('</section>', parkedStart);
  assert.ok(parkedStart > 0 && parkedEnd > parkedStart);
  const parked = html.slice(parkedStart, parkedEnd);
  const live = html.slice(0, parkedStart);
  assert.match(parked, /id="demoBtn"/);
  assert.match(parked, /id="report"/);
  assert.match(parked, /id="feedbackCard"/);
  assert.match(live, /id="startBtn"/);
  assert.match(live, /id="driveState"/);
  assert.match(live, /id="trackingBadge"/);
  assert.match(driver, /parkedControls\.hidden=active/);
});

test('parked output check leaves session telemetry untouched and is disabled while monitoring', () => {
  const check = extract('function demoAlert(){', '\nfunction onResults');
  const clearTest = extract('function clearParkedAlertTest(owner){', '\nfunction getAlertAudio');
  const output = { textContent: '' };
  const classes = new Set();
  const sound = [];
  const vibration = [];
  const timers = [];
  const context = {
    startupAllowsMonitoring: () => true,
    running: false,
    starting: false,
    sessionStart: 12345,
    localSessionId: 'saved-session',
    alerts: 2,
    fatigue: 40,
    confidence: 70,
    routePoints: [{ lat: 1, lng: 2 }],
    document: { getElementById: () => output },
    alertTitle: { textContent: 'DROWSY ALERT' },
    alertSub: { textContent: 'Pull over safely' },
    alertScreen: { style: {}, classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
    nightOpacity: { value: '72' },
    beginAlertAudioScope: () => 1,
    _alertAudioOwner: 1,
    _alertTestOwner: 0,
    releaseAlertAudioScope: () => {},
    tone: (...args) => sound.push(args),
    navigator: { vibrate: pattern => vibration.push(pattern) },
    setTimeout: callback => { timers.push(callback); },
  };
  vm.runInNewContext(`${clearTest}\n${check}\ndemoAlert();`, context);
  assert.equal(context.sessionStart, 12345);
  assert.equal(context.localSessionId, 'saved-session');
  assert.equal(context.alerts, 2);
  assert.equal(context.fatigue, 40);
  assert.equal(context.confidence, 70);
  assert.equal(context.routePoints.length, 1);
  assert.equal(sound.length, 1);
  assert.equal(vibration.length, 1);
  assert.equal(classes.has('show'), true);
  timers.forEach(callback => callback());
  assert.equal(classes.has('show'), false);
  assert.equal(context.alertTitle.textContent, 'DROWSY ALERT');
  context.running = true;
  vm.runInNewContext('demoAlert();', context);
  assert.equal(sound.length, 1);
  assert.equal(vibration.length, 1);
});

test('post-drive review writes only to matching local history', () => {
  const registration = extract("const feedbackForm=document.getElementById('feedbackForm');\nif(feedbackForm)feedbackForm.addEventListener", '\nasync function handleVisibilityChange');
  const session = { id: 'saved-session', alertCount: 2 };
  let stored = JSON.stringify([session, { id: 'other-session', alertCount: 3 }]);
  let submit;
  const status = { textContent: '' };
  const form = {
    addEventListener: (_event, callback) => { submit = callback; },
    querySelector: () => ({ value: 'missed' }),
  };
  const context = {
    document: { getElementById: id => ({ feedbackForm: form, feedbackStatus: status, feedbackNote: { value: 'No alert after an eye closure.' } })[id] },
    localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } },
    localSessionId: 'saved-session',
    running: false,
    starting: false,
    Date,
    JSON,
  };
  vm.runInNewContext(registration, context);
  submit({ preventDefault() {} });
  const rows = JSON.parse(stored);
  assert.equal(rows[0].alertReview, 'missed');
  assert.equal(rows[0].alertReviewNote, 'No alert after an eye closure.');
  assert.equal(rows[1].alertReview, undefined);
  assert.match(status.textContent, /personal observation/i);
});
