import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UNANSWERED_ALERT_VERSION, UNANSWERED_ALERT_WAIT_MS, UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS,
  createUnansweredAlertTracker, isUnansweredAlertSnapshot, copyUnansweredAlertSnapshot,
} from '../native-app/lib/unansweredAlertPolicy.ts';

const sample = (tracker, at, state = 'closed', extra = {}) => tracker.sample({ generation: 1, at, state, ...extra });
const output = (tracker, at, decisionId = 1, generation = 1, decisionAt = at) => tracker.criticalOutput({ generation, at, decisionAt, decisionId });
function freshClosed(tracker, from, until, extra = {}) {
  for (let at = from; at <= until; at += 500) sample(tracker, at, 'closed', extra);
}
function beginClosed() {
  const tracker = createUnansweredAlertTracker();
  tracker.begin(1);
  sample(tracker, 0);
  return tracker;
}

test('six further seconds require accepted critical output and fresh real closed samples', () => {
  assert.equal(UNANSWERED_ALERT_VERSION, 1);
  assert.equal(UNANSWERED_ALERT_WAIT_MS, 6_000);
  assert.equal(UNANSWERED_ALERT_MAX_SAMPLE_GAP_MS, 500);
  const tracker = beginClosed();
  freshClosed(tracker, 500, 7_000);
  assert.equal(tracker.snapshot().candidates, 0, 'closed state alone never establishes critical delivery');
  output(tracker, 7_000);
  freshClosed(tracker, 7_500, 12_500);
  assert.equal(tracker.snapshot().candidates, 0);
  sample(tracker, 12_999);
  assert.equal(tracker.snapshot().candidates, 0);
  sample(tracker, 13_000);
  assert.equal(tracker.snapshot().candidates, 1);
  assert.equal(tracker.snapshot().byMotion.unknown, 1);
  assert.equal(isUnansweredAlertSnapshot(tracker.snapshot()), true);
});

test('delivery needs a fresh closed sample and ineligible decision channels stay consumed', () => {
  for (const state of ['open', 'watch', 'noFace', 'tracking', 'invalid']) {
    const tracker = createUnansweredAlertTracker();
    tracker.begin(1);
    sample(tracker, 0, state);
    output(tracker, 0);
    sample(tracker, 100);
    output(tracker, 100);
    freshClosed(tracker, 500, 7_000);
    assert.equal(tracker.snapshot().candidates, 0, state);
    output(tracker, 7_000, 2);
    freshClosed(tracker, 7_500, 13_000);
    assert.equal(tracker.snapshot().candidates, 1, state);
  }
  const noSample = createUnansweredAlertTracker();
  noSample.begin(1);
  output(noSample, 0);
  freshClosed(noSample, 0, 6_000);
  assert.equal(noSample.snapshot().candidates, 0);
  const stale = beginClosed();
  output(stale, 501);
  freshClosed(stale, 501, 7_001);
  assert.equal(stale.snapshot().candidates, 0, 'stale delivery cannot arm from cached closed state');
});

test('open, watch, tracking loss and malformed states cancel the pending six-second interval', () => {
  for (const state of ['open', 'watch', 'noFace', 'tracking', undefined, 'invalid']) {
    const tracker = beginClosed();
    output(tracker, 0);
    freshClosed(tracker, 500, 3_000);
    tracker.sample({ generation: 1, at: 3_100, state });
    freshClosed(tracker, 3_500, 9_500);
    output(tracker, 9_500, 1);
    assert.equal(tracker.snapshot().candidates, 0, String(state));
    output(tracker, 9_500, 2);
    freshClosed(tracker, 10_000, 15_500);
    assert.equal(tracker.snapshot().candidates, 1, String(state));
  }
});

test('a gap beyond 500 ms or a reversed/invalid clock requires new critical evidence', () => {
  for (const interruption of ['gap', -1, 2_999, NaN, Infinity]) {
    const tracker = beginClosed();
    output(tracker, 0);
    freshClosed(tracker, 500, 3_000);
    sample(tracker, interruption === 'gap' ? 3_501 : interruption);
    freshClosed(tracker, 4_000, 10_000);
    assert.equal(tracker.snapshot().candidates, 0, String(interruption));
    output(tracker, 10_000, 2);
    freshClosed(tracker, 10_500, 16_000);
    assert.equal(tracker.snapshot().candidates, 1, String(interruption));
  }
  const tracker = beginClosed();
  output(tracker, 0);
  freshClosed(tracker, 500, 3_000);
  output(tracker, 2_999, 2);
  freshClosed(tracker, 3_500, 9_000);
  assert.equal(tracker.snapshot().candidates, 0, 'backward output also disarms pending evidence');
});

test('duplicate channels and newer critical repeats neither renew onset nor recount a closed episode', () => {
  const tracker = beginClosed();
  output(tracker, 0);
  freshClosed(tracker, 500, 3_000);
  output(tracker, 0, 1);
  output(tracker, 3_000, 2);
  freshClosed(tracker, 3_500, 6_000);
  assert.equal(tracker.snapshot().candidates, 1, 'newer critical output does not restart the original six seconds');
  output(tracker, 6_000, 3);
  freshClosed(tracker, 6_500, 13_000);
  sample(tracker, 13_100, 'noFace');
  sample(tracker, 13_200);
  output(tracker, 13_200, 4);
  freshClosed(tracker, 13_500, 20_000);
  assert.equal(tracker.snapshot().candidates, 1, 'uncertainty does not reopen a counted episode');
  sample(tracker, 20_100, 'open');
  sample(tracker, 20_200);
  output(tracker, 20_200, 4);
  freshClosed(tracker, 20_500, 27_000);
  assert.equal(tracker.snapshot().candidates, 1, 'old decision cannot arm after explicit open');
  output(tracker, 27_000, 5);
  freshClosed(tracker, 27_500, 33_000);
  assert.equal(tracker.snapshot().candidates, 2);
});

test('an unseen old decision completing across open, tracking loss or a gap cannot arm a new closed segment', () => {
  for (const boundary of ['open', 'noFace', 'watch', 'tracking', 'gap']) {
    const tracker = beginClosed();
    freshClosed(tracker, 500, 1_000);
    // Decision 1 was created at 1,000, but no software output has resolved yet.
    if (boundary !== 'gap') sample(tracker, 1_100, boundary);
    sample(tracker, 1_600);
    output(tracker, 1_600, 1, 1, 1_000);
    freshClosed(tracker, 2_000, 8_000);
    output(tracker, 8_000, 1, 1, 1_000);
    assert.equal(tracker.snapshot().candidates, 0, boundary);
    output(tracker, 8_000, 2);
    freshClosed(tracker, 8_500, 14_000);
    assert.equal(tracker.snapshot().candidates, 1, boundary);
  }
});

test('critical decision time must be finite and inside the current closed segment before acceptance', () => {
  for (const decisionAt of [undefined, NaN, Infinity, -1, 999, 1_101]) {
    const tracker = createUnansweredAlertTracker();
    tracker.begin(1);
    sample(tracker, 1_000);
    tracker.criticalOutput({ generation: 1, at: 1_100, decisionAt, decisionId: 1 });
    freshClosed(tracker, 1_500, 7_500);
    assert.equal(tracker.snapshot().candidates, 0, String(decisionAt));
    output(tracker, 7_500, 2);
    freshClosed(tracker, 8_000, 13_500);
    assert.equal(tracker.snapshot().candidates, 1, String(decisionAt));
  }
  const tracker = createUnansweredAlertTracker();
  tracker.begin(1);
  sample(tracker, 1_000);
  output(tracker, 1_100, 1, 1, 1_000);
  freshClosed(tracker, 1_500, 7_000);
  sample(tracker, 7_100);
  assert.equal(tracker.snapshot().candidates, 1, 'a decision at the inclusive closed-segment boundary can arm');
});

test('stop retains aggregate counts, disarms pending work and only a newer valid generation resets', () => {
  const tracker = beginClosed();
  output(tracker, 0);
  freshClosed(tracker, 500, 6_000);
  tracker.stop();
  sample(tracker, 6_100, 'open');
  output(tracker, 6_200, 2);
  freshClosed(tracker, 6_500, 13_000);
  assert.equal(tracker.snapshot().candidates, 1);
  for (const generation of [0, -1, 1, NaN, Infinity, 1.5, '2']) tracker.begin(generation);
  assert.equal(tracker.snapshot().candidates, 1);
  tracker.begin(2);
  assert.equal(tracker.snapshot().candidates, 0);
  sample(tracker, 0, 'closed', { generation: 2 });
  output(tracker, 0, 1, 2);
  tracker.begin(1);
  sample(tracker, Infinity, 'open');
  output(tracker, 0, 9, 1);
  freshClosed(tracker, 500, 6_000, { generation: 2 });
  assert.equal(tracker.snapshot().candidates, 1, 'late older-session work cannot cancel or count in the new session');
  const pending = beginClosed();
  output(pending, 0);
  freshClosed(pending, 500, 3_000);
  pending.stop();
  freshClosed(pending, 3_500, 9_000);
  assert.equal(pending.snapshot().candidates, 0);
});

test('motion observations remain separately labeled without arming, blocking or authorizing output', () => {
  const categories = ['unknown', 'unavailable', 'denied', 'stale', 'not-moving', 'reported-activity'];
  const tracker = createUnansweredAlertTracker();
  tracker.begin(1);
  for (const [index, motion] of categories.entries()) {
    const start = index * 7_000;
    sample(tracker, start, 'open');
    sample(tracker, start + 1);
    output(tracker, start + 1, index + 1);
    freshClosed(tracker, start + 500, start + 6_000, { motion });
    sample(tracker, start + 6_001, 'closed', { motion });
  }
  assert.equal(tracker.snapshot().candidates, 6);
  assert.deepEqual(tracker.snapshot().byMotion, Object.fromEntries(categories.map(category => [category, 1])));
  const malformed = beginClosed();
  output(malformed, 0);
  freshClosed(malformed, 500, 6_000, { motion: 'moving-for-sure' });
  assert.equal(malformed.snapshot().byMotion.unknown, 1);
});

test('snapshot shape is fixed, deeply copied and rejects invalid aggregates or raw evidence', () => {
  const tracker = beginClosed();
  output(tracker, 0);
  freshClosed(tracker, 500, 6_000);
  const snapshot = tracker.snapshot();
  const copy = copyUnansweredAlertSnapshot(snapshot);
  copy.byMotion.unknown = 99;
  snapshot.byMotion.unknown = 88;
  assert.equal(tracker.snapshot().byMotion.unknown, 1);
  assert.deepEqual(Object.keys(tracker.snapshot()), ['version', 'mode', 'evidence', 'candidates', 'byMotion']);
  assert.equal(isUnansweredAlertSnapshot(JSON.parse(JSON.stringify(tracker.snapshot()))), true);
  for (const mutation of [
    value => { value.version = 2; }, value => { value.mode = 'enabled'; },
    value => { value.evidence = 'delivered'; }, value => { value.candidates = 2; },
    value => { value.at = 12; }, value => { value.byMotion.extra = 0; },
    value => { delete value.byMotion.stale; }, value => { value.byMotion = []; },
    value => { value.byMotion.unknown = -1; }, value => { value.byMotion.unknown = 0.5; },
    value => { value.byMotion.unknown = Infinity; }, value => { value.candidates = 1_000_001; },
    value => { value[Symbol('raw')] = []; },
  ]) {
    const invalid = tracker.snapshot();
    mutation(invalid);
    assert.equal(isUnansweredAlertSnapshot(invalid), false);
    assert.throws(() => copyUnansweredAlertSnapshot(invalid), TypeError);
  }
  for (const invalid of [null, undefined, [], 'observed', 1]) assert.equal(isUnansweredAlertSnapshot(invalid), false);
  const limit = tracker.snapshot();
  limit.candidates = limit.byMotion.unknown = 1_000_000;
  assert.equal(isUnansweredAlertSnapshot(limit), true);
});

test('aggregate counting saturates at one million rather than overflowing or growing a timeline', () => {
  const tracker = createUnansweredAlertTracker();
  tracker.begin(1);
  for (let episode = 0; episode <= 1_000_000; episode++) {
    const at = episode * 7_000;
    sample(tracker, at, 'open');
    sample(tracker, at + 1);
    output(tracker, at + 1, episode + 1);
    freshClosed(tracker, at + 500, at + 6_000);
    sample(tracker, at + 6_001);
  }
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.candidates, 1_000_000);
  assert.equal(snapshot.byMotion.unknown, 1_000_000);
  assert.equal(isUnansweredAlertSnapshot(snapshot), true);
});
