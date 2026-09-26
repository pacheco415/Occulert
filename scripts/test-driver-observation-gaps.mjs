import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppHarness } from './lib/app-page-harness.mjs';

function ready() {
  const h = createAppHarness();
  h.startSession(); h.feed({ ear: 0.30 }, 6_000);
  assert.equal(h.state().calibrated, true);
  assert.equal(h.state().confidence, 100);
  return h;
}

test('missing face interrupts continuous closure even while confidence remains high', () => {
  const h = ready();
  h.feed({ ear: 0.08 }, 700);
  assert.equal(h.state().microsleeps, 0);
  h.frame({ face: false });
  h.frame({ face: false, stepMs: 1_800 });
  h.frame({ ear: 0.08 });
  assert.ok(h.state().confidence > 45);
  assert.equal(h.state().microsleeps, 0, 'unobserved time cannot complete closure');
  h.feed({ ear: 0.08 }, 1_700);
  assert.equal(h.state().microsleeps, 1, 'fresh sustained closure still counts');
});

test('a tracking gap clears EAR smoothing and ends only observed distraction time', () => {
  const h = ready();
  h.feed({ ear: 0.08, noseX: 0.75 }, 1_000);
  const known = h.run('lastFaceSeen - turnedSince');
  h.frame({ face: false, stepMs: 4_000 });
  assert.equal(h.run('turnedSince'), 0);
  assert.equal(h.run('totalDistractionMs'), known);
  assert.equal(h.state().eyesClosedSince, 0);
  assert.equal(h.state().earHistoryLength, 0);
  h.frame({ ear: 0.30, noseX: 0.75 });
  assert.equal(h.run('Date.now() - turnedSince'), 0);
  assert.equal(h.run('totalDistractionMs'), known);
  assert.equal(h.state().microsleeps, 0);
  assert.equal(h.state().earHistoryLength, 1);
});

function mouthFrame(h, open, stepMs = 135) {
  const landmarks = h.landmarks();
  landmarks[13] = { x: 0.5, y: 0.4, z: 0 };
  landmarks[14] = { x: 0.5, y: open ? 0.56 : 0.4, z: 0 };
  landmarks[61] = { x: 0.4, y: 0.5, z: 0 };
  landmarks[291] = { x: 0.6, y: 0.5, z: 0 };
  h.clock.advance(stepMs);
  h.run('onResults(' + JSON.stringify({ multiFaceLandmarks: [landmarks] }) + ')');
}

test('missing face interrupts mouth duration and MAR smoothing without changing yawn cooldown', () => {
  const h = ready();
  h.run('_marHist = []; _mouthOpenSince = 0;');
  for (let i = 0; i < 4; i++) mouthFrame(h, true);
  assert.equal(h.run('yawnCount'), 0);
  h.run('lastYawn = Date.now() - 9_000;');
  const cooldown = h.run('lastYawn');
  h.frame({ face: false, stepMs: 2_000 });
  mouthFrame(h, true);
  assert.equal(h.run('yawnCount'), 0, 'gap cannot complete a mouth-open episode');
  assert.equal(h.run('_marHist.length'), 1);
  assert.equal(h.run('lastYawn'), cooldown);
  for (let i = 0; i < 10; i++) mouthFrame(h, true);
  assert.equal(h.run('yawnCount'), 1, 'new continuous episode still counts');
});

test('a head nod cannot combine its dip and recovery across missing landmarks', () => {
  const h = ready(); h.run('noseYHistory = [];');
  h.feed({ noseY: 0.55 }, 405);
  h.feed({ noseY: 0.61 }, 270);
  h.frame({ face: false, stepMs: 1_000 });
  h.feed({ noseY: 0.55 }, 405);
  assert.equal(h.state().headNods, 0);
  assert.equal(h.state().noseYHistoryLength, 3);
  h.run('noseYHistory = [];');
  h.feed({ noseY: 0.55 }, 405); h.feed({ noseY: 0.61 }, 270); h.feed({ noseY: 0.55 }, 405);
  assert.equal(h.state().headNods, 1, 'an observed complete nod still counts');
});

test('tracking gaps preserve alert counters, cooldowns, thresholds and observed PERCLOS samples', () => {
  const h = ready();
  h.run('alerts=2; microsleeps=1; headNods=1; yawnCount=1; lastAlert=Date.now(); lastMicro=Date.now(); lastNod=Date.now(); lastYawn=Date.now();');
  const before = h.run('({alerts,microsleeps,headNods,yawnCount,lastAlert,lastMicro,lastNod,lastYawn,eyeClosedThreshold,eyeWatchThreshold,perclos:perclosWindow.length})');
  h.frame({ face: false });
  const after = h.run('({alerts,microsleeps,headNods,yawnCount,lastAlert,lastMicro,lastNod,lastYawn,eyeClosedThreshold,eyeWatchThreshold,perclos:perclosWindow.length})');
  assert.deepEqual(after, before);
});
