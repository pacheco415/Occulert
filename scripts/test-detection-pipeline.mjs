// Deterministic tests for the driver app's shipped detection pipeline.
// Runs the current external driver app logic (via scripts/lib/app-page-harness.mjs)
// against synthetic landmark frames and a fake clock. No camera, no
// MediaPipe, no browser, no labeled dataset required.
//
// Covered: calibration, PERCLOS windowing, microsleep timing, no-face
// grace/recovery, alert cooldown + escalation, long-session stability.
// NOT covered (needs ground-truth data, issue #65): real-world detection
// accuracy, missed-alert / false-alert rates.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppHarness } from './lib/app-page-harness.mjs';

const OPEN = 0.30;
const CLOSED = 0.08;

function calibrated(h = createAppHarness()) {
  h.startSession();
  h.feed({ ear: OPEN }, 3_400); // CALIBRATION_MS is 3200
  assert.equal(h.state().calibrating, false);
  return h;
}

test('calibration personalizes thresholds from open-eye EAR', () => {
  const h = calibrated();
  const s = h.state();
  assert.equal(s.calibrated, true);
  assert.ok(Math.abs(s.baselineEAR - OPEN) < 0.005, 'baseline ~= fed EAR, got ' + s.baselineEAR);
  assert.ok(Math.abs(s.eyeClosedThreshold - OPEN * 0.66) < 0.005);
  assert.ok(Math.abs(s.eyeWatchThreshold - OPEN * 0.82) < 0.005);
});

test('calibration falls back to defaults when no valid samples arrive', () => {
  const h = createAppHarness();
  h.startSession();
  h.feed({ ear: 0.10 }, 3_400); // below the .16 validity floor -> filtered out
  const s = h.state();
  assert.equal(s.calibrating, false);
  assert.equal(s.calibrated, false);
  assert.equal(s.eyeClosedThreshold, 0.18);
  assert.equal(s.eyeWatchThreshold, 0.22);
});

test('no alerts or microsleeps can fire during calibration', () => {
  const h = createAppHarness();
  h.startSession();
  h.feed({ ear: CLOSED }, 3_000); // eyes closed for nearly the whole window
  const s = h.state();
  assert.equal(s.calibrating, true);
  assert.equal(s.alerts, 0);
  assert.equal(s.microsleeps, 0);
  assert.equal(s.risk, 'CALIBRATING');
});

test('PERCLOS reflects the closed fraction of a rolling 60s window', () => {
  const h = calibrated();
  h.feed({ ear: CLOSED }, 20_000);
  h.feed({ ear: OPEN }, 40_000);
  const s = h.state();
  assert.ok(s.perclos >= 28 && s.perclos <= 38, '20s/60s closed -> ~33%, got ' + s.perclos);
});

test('PERCLOS window prunes samples older than 60s', () => {
  const h = calibrated();
  h.feed({ ear: OPEN }, 300_000); // 5 minutes
  const s = h.state();
  const maxSamples = Math.ceil(60_000 / 135) + 5;
  assert.ok(s.perclosSamples <= maxSamples, 'window bounded, got ' + s.perclosSamples);
  assert.equal(s.perclos, 0);
});

test('microsleep requires >1.5s of continuous closure', () => {
  // The 6-frame EAR smoothing buffer delays closure onset by ~0.4s,
  // so raw closure must run ~1.9s before the 1.5s rule is satisfied.
  const h = calibrated();
  h.feed({ ear: CLOSED }, 1_200);
  assert.equal(h.state().microsleeps, 0, 'sub-threshold closure must not count');
  h.feed({ ear: CLOSED }, 1_000); // smoothed closure now past 1.5s continuous
  assert.equal(h.state().microsleeps, 1);
});

test('sustained closure re-fires a microsleep at most every 3s', () => {
  const h = calibrated();
  h.feed({ ear: CLOSED }, 5_000);
  assert.equal(h.state().microsleeps, 2, '5s of closure -> 2 events (1.5s + 3s refractory)');
});

test('low confidence suppresses alerts even at maximum fatigue', () => {
  const h = calibrated();
  h.run('confidence = 20; fatigue = 95;');
  h.frame({ ear: CLOSED }); // frame adds +5 confidence -> still < 45
  const s = h.state();
  assert.equal(s.alerts, 0);
});

test('alerts respect the 12s cooldown and escalate to a max of 4', () => {
  const h = calibrated();
  h.feed({ ear: CLOSED }, 5_000);
  let s = h.state();
  assert.equal(s.alerts, 1, 'first alert fires once fatigue >= 80 and confidence >= 45');
  assert.equal(s.escalationLevel, 1);

  h.feed({ ear: CLOSED }, 6_000); // still inside the 12s cooldown
  assert.equal(h.state().alerts, 1, 'cooldown must hold');

  h.feed({ ear: CLOSED }, 55_000); // ~60s more of continuous closure
  s = h.state();
  assert.ok(s.alerts >= 4 && s.alerts <= 6, '12s spacing -> ~5 alerts/min, got ' + s.alerts);
  assert.equal(s.escalationLevel, 4, 'escalation caps at 4');
});

test('escalation resets after 90s without an alert', () => {
  const h = calibrated();
  h.feed({ ear: CLOSED }, 30_000);
  assert.ok(h.state().escalationLevel >= 2);
  // Recovery: PERCLOS lags ~60s, so alerts continue into the open-eye
  // phase (see next test). 160s of open eyes guarantees > 90s of quiet
  // after the last lagging alert.
  h.feed({ ear: OPEN }, 160_000);
  const quietSince = h.state().lastAlert;
  h.feed({ ear: CLOSED }, 5_000);
  const s = h.state();
  assert.ok(s.lastAlert > quietSince, 'a new alert fired');
  assert.equal(s.escalationLevel, 1, 'first new alert restarts escalation at 1');
});

test('alerts lag into recovery while the PERCLOS window drains', () => {
  const h = calibrated();
  h.feed({ ear: CLOSED }, 30_000);
  const during = h.state().alerts;
  h.feed({ ear: OPEN }, 30_000); // eyes fully open, but 60s window still ~50% closed
  const s = h.state();
  assert.ok(s.alerts > during, 'lagging PERCLOS keeps fatigue high shortly after recovery');
  h.feed({ ear: OPEN }, 90_000); // window fully drained, fatigue decayed
  const settled = h.state().alerts;
  h.feed({ ear: OPEN }, 60_000);
  assert.equal(h.state().alerts, settled, 'alerts stop once the window drains');
});

test('face loss enters NO FACE only after a 2.5s grace period', () => {
  const h = calibrated();
  h.feed({ face: false }, 2_000);
  assert.notEqual(h.state().risk, 'NO FACE', 'inside grace period');
  h.feed({ face: false }, 1_000);
  assert.equal(h.state().risk, 'NO FACE');
});

test('face loss decays confidence and never counts as drowsiness', () => {
  const h = calibrated();
  const before = h.state();
  h.feed({ face: false }, 4_000);
  const s = h.state();
  assert.equal(s.confidence, 0);
  assert.ok(s.fatigue <= before.fatigue, 'fatigue must not rise while face is lost');
  assert.equal(s.alerts, 0);
  assert.equal(s.microsleeps, 0);
});

test('sustained tracking loss warns separately without counting a fatigue alert', () => {
  const h = calibrated();
  h.feed({ face: false }, 6_000);
  assert.equal(h.state().alerts, 0);
  const warnings = h.run("document.getElementById('log').children.filter(entry => entry.textContent.includes('Tracking lost'))");
  assert.equal(warnings.length, 1);
  h.feed({ face: false }, 10_000);
  assert.equal(h.run("document.getElementById('log').children.filter(entry => entry.textContent.includes('Tracking lost')).length"), 1);
});

test('recovery after tracking loss cannot fire an instant alert', () => {
  const h = calibrated();
  h.feed({ ear: CLOSED }, 500);         // eyes closing as tracking drops
  assert.equal(h.state().alerts, 0);
  h.feed({ face: false }, 10_000);      // long loss -> confidence 0
  h.feed({ ear: CLOSED }, 1_000);       // face returns, eyes still closed
  const s = h.state();
  assert.equal(s.alerts, 0, 'confidence must rebuild to 45 before any alert');
  assert.equal(s.microsleeps, 0, 'stale closure timing must not fire through low confidence');
  assert.equal(s.noFaceSince, 0, 'tracking recovered');
});

test('risk states map to documented fatigue thresholds', () => {
  const h = calibrated();
  const risk = (fatigue, confidence) => {
    h.run('fatigue = ' + fatigue + '; confidence = ' + confidence + ';');
    return h.run('riskText()[0]');
  };
  assert.equal(risk(0, 60), 'SAFE');
  assert.equal(risk(34, 60), 'SAFE');
  assert.equal(risk(35, 60), 'WATCH');
  assert.equal(risk(60, 60), 'HIGH');
  assert.equal(risk(80, 60), 'ALERT');
  assert.equal(risk(80, 30), 'HIGH', 'ALERT additionally requires confidence >= 45');
});

test('a 30-minute session keeps every rolling buffer bounded', () => {
  const h = calibrated();
  // 60 cycles of 5s closed / 25s open = 30 minutes of driving.
  for (let i = 0; i < 60; i += 1) {
    h.feed({ ear: CLOSED }, 5_000);
    h.feed({ ear: OPEN }, 25_000);
  }
  const s = h.state();
  assert.equal(s.running, true);
  assert.ok(s.fatigue >= 0 && s.fatigue <= 100);
  assert.ok(s.confidence >= 0 && s.confidence <= 100);
  assert.ok(s.earHistoryLength <= 6, 'EAR smoothing buffer bounded');
  assert.ok(s.noseYHistoryLength <= 10, 'nod buffer bounded');
  assert.ok(s.perclosSamples <= Math.ceil(60_000 / 135) + 5, 'PERCLOS window bounded');
  assert.ok(s.alerts > 0, 'repeated drowsy episodes must keep alerting');
  const logChildren = h.run("document.getElementById('log').children.length");
  assert.ok(logChildren <= 15, 'event log bounded');
  assert.ok(s.fatigueSampleCount > 10000, 'long drive records every valid sample');
  assert.ok(Number.isFinite(s.fatigueSampleSum));
  assert.equal(h.run('fleetPayload().avgFatigue'), Math.round(s.fatigueSampleSum / s.fatigueSampleCount));

});

test('running fatigue summary preserves the average of the same processed samples', () => {
  const h = createAppHarness();
  h.startSession();
  h.feed({ ear: OPEN }, 4_000);
  const baselineSum = h.get('fatigueSampleSum'), baselineCount = h.get('fatigueSampleCount');
  const samples = [];
  for (let i = 0; i < 100; i++) {
    h.frame({ ear: i % 3 === 0 ? CLOSED : OPEN });
    samples.push(h.state().fatigue);
  }
  assert.equal(h.get('fatigueSampleSum'), baselineSum + samples.reduce((sum, value) => sum + value, 0));
  assert.equal(h.get('fatigueSampleCount'), baselineCount + samples.length);
});

// Use the shipped lifecycle, stubbing only camera/model/cloud boundaries.
async function startRealSession(h) {
  h.run(`navigator.mediaDevices = { getUserMedia: async () => ({}) };
    initModel = async () => {};
    verifyFirstInference = async () => {};
    openSelectedCamera = async () => ({getTracks:()=>[]});
    attachCameraTrackGuards = () => {};
    initCloud = async () => {};
    startGPS = () => {};
    initChart = () => {};
    updateCameraSourceHint = () => {};
    refreshCameraChoices = async () => [];
    requestSessionWakeLock = async () => {};
    startTimer = () => {};`);
  await h.run('start()');
  assert.equal(h.state().running, true);
}

test('real stop/start clears preceding driver personal base thresholds', async () => {
 const h=createAppHarness();
 await startRealSession(h);
 h.feed({ear:.34},3400);
 assert.equal(h.state().calibrated,true);
 assert.ok(h.state().eyeClosedThreshold > .18);
 await h.run('stop()');
 await startRealSession(h);
 h.feed({ear:.10},3400);
 assert.equal(h.state().calibrated,false);
 assert.equal(h.state().baselineEAR,.28);
 assert.equal(h.state().eyeClosedThreshold,.18);
 assert.equal(h.state().eyeWatchThreshold,.22);
});

test('Recalibrate clears personal thresholds before fallback', () => {
 const h=calibrated();
 h.el('recalBtn').onclick();
 assert.equal(h.state().baselineEAR,.28);
 assert.equal(h.state().eyeClosedThreshold,.18);
 assert.equal(h.state().eyeWatchThreshold,.22);
 h.feed({ear:.10},3400);
 assert.equal(h.state().calibrated,false);
 assert.equal(h.state().eyeClosedThreshold,.18);
 assert.equal(h.state().eyeWatchThreshold,.22);
});

for (const [search, minimum] of [['',1],['?calibration-min=12',12],['?calibration-min=12&calibration-min=12',1],['?calibration-min=012',1]]) {
 test(`parked calibration sample minimum ${search || 'default'}`, () => {
  const h=createAppHarness({sandboxOverrides:{location:{search},URLSearchParams}});
  h.startSession();
  h.frame({ear:.30});
  h.feed({ear:.10},3400);
  assert.equal(h.state().calibrated,minimum===1);
  if(minimum===12) {
   assert.equal(h.state().eyeClosedThreshold,.18);
   assert.equal(h.state().eyeWatchThreshold,.22);
   h.el('recalBtn').onclick();
   h.feed({ear:.30},3400);
   assert.equal(h.state().calibrated,true);
  }
 });
}

test('parked sample minimum accepts twelve and rejects eleven samples', () => {
 for (const accepted of [11,12]) {
  const h=createAppHarness({sandboxOverrides:{location:{search:'?calibration-min=12'},URLSearchParams}});
  h.startSession();
  for(let n=0;n<accepted;n++) h.run('updateCalibration(.30)');
  h.clock.advance(3400);
  h.run('updateCalibration(.10)');
  assert.equal(h.state().calibrated,accepted===12);
 }
});
