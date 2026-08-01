import assert from 'node:assert/strict';
import test from 'node:test';
import { HeadNodDetector } from '../native-app/lib/headNodDetector.ts';

function calibrate(detector, startAt = 0, pitch = 2) {
  let result;
  for (let i = 0; i < 15; i += 1) {
    result = detector.update({
      at: startAt + i * 100,
      faceFound: true,
      pitchAngle: pitch,
      yawAngle: 0,
      rollAngle: 0,
    });
  }
  assert.equal(result.calibrated, true);
  return startAt + 1_500;
}

test('a pitch excursion and return creates one observation', () => {
  const detector = new HeadNodDetector();
  const at = calibrate(detector);

  assert.equal(detector.update({
    at,
    faceFound: true,
    pitchAngle: 16,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, false);
  assert.equal(detector.update({
    at: at + 250,
    faceFound: true,
    pitchAngle: 3,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, true);
  assert.equal(detector.update({
    at: at + 400,
    faceFound: true,
    pitchAngle: 2,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, false);
});

test('small movements, face loss, and side turns do not create observations', () => {
  const detector = new HeadNodDetector();
  const at = calibrate(detector);

  for (const [offset, pitch] of [[0, 7], [250, -3], [500, 5]]) {
    assert.equal(detector.update({
      at: at + offset,
      faceFound: true,
      pitchAngle: pitch,
      yawAngle: 0,
      rollAngle: 0,
    }).observed, false);
  }

  detector.update({ at: at + 800, faceFound: true, pitchAngle: 16, yawAngle: 0, rollAngle: 0 });
  detector.update({ at: at + 900, faceFound: false });
  assert.equal(detector.update({
    at: at + 1_100,
    faceFound: true,
    pitchAngle: 2,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, false);

  detector.update({ at: at + 1_400, faceFound: true, pitchAngle: 17, yawAngle: 30, rollAngle: 0 });
  assert.equal(detector.update({
    at: at + 1_700,
    faceFound: true,
    pitchAngle: 2,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, false);
});

test('slow posture changes update the baseline without counting a nod', () => {
  const detector = new HeadNodDetector();
  let at = calibrate(detector);

  for (let i = 0; i < 40; i += 1) {
    at += 100;
    const result = detector.update({
      at,
      faceFound: true,
      pitchAngle: 2 + i * 0.1,
      yawAngle: 0,
      rollAngle: 0,
    });
    assert.equal(result.observed, false);
  }
});

test('an excursion that does not return promptly is discarded', () => {
  const detector = new HeadNodDetector();
  const at = calibrate(detector);

  detector.update({ at, faceFound: true, pitchAngle: 16, yawAngle: 0, rollAngle: 0 });
  detector.update({ at: at + 1_600, faceFound: true, pitchAngle: 16, yawAngle: 0, rollAngle: 0 });
  assert.equal(detector.update({
    at: at + 1_800,
    faceFound: true,
    pitchAngle: 2,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, false);
});

test('the cooldown prevents rapid duplicate observations', () => {
  const detector = new HeadNodDetector();
  const at = calibrate(detector);

  detector.update({ at, faceFound: true, pitchAngle: 16, yawAngle: 0, rollAngle: 0 });
  assert.equal(detector.update({
    at: at + 250,
    faceFound: true,
    pitchAngle: 2,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, true);

  detector.update({ at: at + 700, faceFound: true, pitchAngle: 16, yawAngle: 0, rollAngle: 0 });
  assert.equal(detector.update({
    at: at + 950,
    faceFound: true,
    pitchAngle: 2,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, false);

  detector.update({ at: at + 2_400, faceFound: true, pitchAngle: 16, yawAngle: 0, rollAngle: 0 });
  assert.equal(detector.update({
    at: at + 2_650,
    faceFound: true,
    pitchAngle: 2,
    yawAngle: 0,
    rollAngle: 0,
  }).observed, true);
});
