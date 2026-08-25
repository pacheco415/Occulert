import assert from 'node:assert/strict';
import test from 'node:test';
import { RollingClosedFraction } from '../native-app/lib/rollingClosedFraction.ts';

test('rolling closed fraction reports the active window', () => {
  const window = new RollingClosedFraction(1_000);
  assert.equal(window.add(0, true), 1);
  assert.equal(window.add(200, false), 0.5);
  assert.equal(window.add(400, false), 1 / 3);
  assert.equal(window.sampleCount, 3);
});

test('samples expire at the same strict rolling-window boundary', () => {
  const window = new RollingClosedFraction(1_000);
  window.add(0, true);
  window.add(500, false);
  assert.equal(window.add(1_000, false), 0, 'the sample at the cutoff is expired');
  assert.equal(window.sampleCount, 2);
});

test('long monitoring sessions keep the hot-path buffer bounded', () => {
  const window = new RollingClosedFraction(10_000);
  for (let at = 0; at < 3_600_000; at += 100) {
    window.add(at, at % 500 === 0);
  }
  assert.equal(window.sampleCount, 100);
  assert.equal(window.add(3_600_000, false), 0.19);
  assert.equal(window.sampleCount, 100);
});

test('reset removes every prior sample', () => {
  const window = new RollingClosedFraction(1_000);
  window.add(0, true);
  window.reset();
  assert.equal(window.sampleCount, 0);
  assert.equal(window.add(100, false), 0);
});

test('invalid windows are rejected', () => {
  assert.throws(() => new RollingClosedFraction(0), RangeError);
  assert.throws(() => new RollingClosedFraction(Number.POSITIVE_INFINITY), RangeError);
});
