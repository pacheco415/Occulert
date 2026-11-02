import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMonitorHookFixture } from '../native-app/scripts/lib/monitor-hook-test-harness.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const eye = state => ({ ear: .01, perclos: .2, fatigueScore: 90, closedDurationMs: 0, state });
const face = { leftEyeOpenProbability: .03, rightEyeOpenProbability: .04,
  pitchAngle: 0, yawAngle: 0, rollAngle: 0, bounds: { x: 100, y: 80, width: 220, height: 260 } };
const accepted = (at, decisionId = 1, extra = {}) => ({ level: 'critical', decisionId,
  decisionAt: at, acceptedAt: at, channel: 'phone-haptic', ...extra });

function adapterFixture({ enabled = true } = {}) {
  const f = createMonitorHookFixture({ unansweredObservation: enabled });
  const { createUnansweredAlertObservation } = f.load('lib/unansweredAlertObservation.ts');
  let mono = 1_000, wall = 100_000;
  const observation = createUnansweredAlertObservation(undefined, { now: () => mono, wallNow: () => wall });
  observation.begin();
  return {
    observation,
    at(elapsed, { monoOffset = 0, wallOffset = 0 } = {}) { mono = 1_000 + elapsed + monoOffset; wall = 100_000 + elapsed + wallOffset; },
    sample(elapsed, extra = {}, clocks) {
      this.at(elapsed, clocks);
      observation.sample({ generation: observation.generation, sampledAt: wall,
        sourceAt: 50_000 + elapsed, state: 'closed', ...extra });
    },
    output(elapsed, decisionId = 1, extra = {}, owner = observation.generation, clocks) {
      this.at(elapsed, clocks);
      observation.criticalOutput(owner, accepted(wall, decisionId, extra));
    },
    get wall() { return wall; },
  };
}

async function mountedObservation({ enabled = true, platform = 'ios', queueBridge = false, observer } = {}) {
  const f = createMonitorHookFixture({ running: true, unansweredObservation: enabled, platform,
    captureBridge: true, queueBridge });
  const { createUnansweredAlertObservation } = f.load('lib/unansweredAlertObservation.ts');
  const observation = createUnansweredAlertObservation(undefined, { now: () => f.now, wallNow: () => f.now });
  const samples = [];
  const generation = observation.begin();
  if (enabled) {
    f.owner.unansweredGeneration = generation;
    f.owner.observeUnansweredSample = sample => {
      samples.push(plain(sample));
      observer?.(sample);
      observation.sample(sample);
    };
  }
  f.owner.getUnansweredAlertSnapshot = () => observation.snapshot();
  f.owner.processEyeOpenness = () => eye('closed');
  f.owner.processNoFace = () => eye('noFace');
  f.faces = [face];
  await f.mount();
  return { f, observation, samples,
    async frame(at, sourceAt = 50_000 + at, callback = f.api.analysis.frameProcessor) {
      await f.at(at, () => callback({ width: 640, height: 480,
        timestamp: sourceAt * (platform === 'android' ? 1_000_000 : 1) }));
    },
    output(decisionId = 1, owner = observation.generation, extra = {}) {
      observation.criticalOutput(owner, accepted(f.now, decisionId, extra));
    },
    async close() { observation.stop(); await f.unmount(); },
  };
}

test('actual frame bridge supplies primitive evidence with iOS milliseconds and Android nanoseconds normalized', async () => {
  for (const platform of ['ios', 'android']) {
    const m = await mountedObservation({ platform });
    try {
      await m.frame(1_000, 123_456.5);
      const args = m.f.bridgeCalls.at(-1);
      assert.equal(args.length, 16, platform);
      assert.ok(args.every(value => ['number', 'boolean'].includes(typeof value)), 'no frame/face/native object crosses the bridge');
      assert.deepEqual(args.slice(13), [1_000, m.observation.generation, 123_456.5]);
      assert.deepEqual(m.samples[0], { generation: m.observation.generation, sampledAt: 1_000,
        sourceAt: 123_456.5, state: 'watch' });
      m.f.faces = [];
      await m.frame(1_100, 123_556.5);
      assert.equal(m.f.bridgeCalls.at(-1).length, 16);
      assert.equal(m.samples.at(-1).state, 'noFace');
      assert.equal(m.samples.at(-1).sourceAt, 123_556.5);
    } finally { await m.close(); }
  }
});

test('mounted actual analysis counts only after six further seconds of fresh closed frame evidence', async () => {
  const m = await mountedObservation();
  try {
    for (let at = 1_000; at <= 2_200; at += 100) await m.frame(at);
    assert.equal(m.samples.at(-1).state, 'closed');
    m.output();
    for (let at = 2_700; at <= 7_700; at += 500) await m.frame(at);
    assert.equal(m.observation.snapshot().candidates, 0);
    await m.frame(8_200);
    assert.deepEqual(plain(m.observation.snapshot()), {
      version: 1, mode: 'observation-only', evidence: 'software-output-accepted', candidates: 1,
      byMotion: { unknown: 1, unavailable: 0, denied: 0, stale: 0, 'not-moving': 0, 'reported-activity': 0 },
    });
    await m.f.api.checkpoint(8_200);
    assert.deepEqual(plain(m.f.events.checkpoints.at(-1).unansweredAlerts), plain(m.observation.snapshot()));
  } finally { await m.close(); }
});

test('a delayed real worklet callback preserves its worklet-sample time and cannot count from fresh arrival time', async () => {
  const m = await mountedObservation({ queueBridge: true });
  try {
    for (let at = 1_000; at <= 2_200; at += 100) { await m.frame(at); await m.f.flushBridge(); }
    m.output();
    await m.frame(2_300);
    assert.equal(m.f.pendingBridge.length, 1);
    await m.f.at(2_901, () => m.f.flushBridge());
    assert.equal(m.samples.at(-1).sampledAt, 2_300, 'queued bridge must retain the old sample wall time');
    for (let at = 3_000; at <= 9_500; at += 500) { await m.frame(at); await m.f.flushBridge(); }
    m.output(1);
    assert.equal(m.observation.snapshot().candidates, 0);
    m.output(2);
    for (let at = 10_000; at <= 15_500; at += 500) { await m.frame(at); await m.f.flushBridge(); }
    assert.equal(m.observation.snapshot().candidates, 1, 'fresh output and renewed continuity can recover');
  } finally { await m.close(); }
});

test('duplicate native timestamps, source gaps and cumulative source-clock drift disarm adapter evidence', () => {
  for (const fault of ['duplicate', 'gap', 'drift']) {
    const f = adapterFixture();
    f.sample(0); f.output(0);
    for (let at = 100; at <= 1_000; at += 100) f.sample(at);
    if (fault === 'duplicate') f.sample(1_100, { sourceAt: 51_000 });
    else if (fault === 'gap') f.sample(1_100, { sourceAt: 52_000 });
    else for (let at = 1_100; at <= 1_600; at += 100) f.sample(at, { sourceAt: 51_000 + (at - 1_000) * 2 });
    for (let at = 2_000; at <= 9_000; at += 500) f.sample(at);
    f.output(9_000, 1);
    assert.equal(f.observation.snapshot().candidates, 0, fault);
    f.output(9_000, 2);
    for (let at = 9_500; at <= 15_000; at += 500) f.sample(at);
    assert.equal(f.observation.snapshot().candidates, 1, fault);
  }
});

test('stale/future sample wall times and invalid native timestamps fail closed without reusing an old accepted decision', () => {
  for (const extra of [{ sampledAt: 99_599 }, { sampledAt: 100_101 }, { sourceAt: NaN }, { sourceAt: -1 }]) {
    const f = adapterFixture();
    f.sample(0); f.output(0); f.sample(100, extra);
    for (let at = 500; at <= 7_000; at += 500) f.sample(at);
    f.output(7_000, 1);
    assert.equal(f.observation.snapshot().candidates, 0);
    f.output(7_000, 2);
    for (let at = 7_500; at <= 13_000; at += 500) f.sample(at);
    assert.equal(f.observation.snapshot().candidates, 1);
  }
});

test('invalid output timing/channel consumes that decision and cannot later arm through another phone channel', () => {
  for (const extra of [{ acceptedAt: 99_499 }, { acceptedAt: 100_001 },
    { decisionAt: 100_001 }, { decisionAt: Infinity }, { channel: 'watch' }]) {
    const f = adapterFixture();
    f.sample(0); f.output(0, 1, extra);
    f.output(0, 1, { channel: 'phone-audio' });
    for (let at = 500; at <= 6_000; at += 500) f.sample(at);
    assert.equal(f.observation.snapshot().candidates, 0);
    f.output(6_000, 2);
    for (let at = 6_500; at <= 12_000; at += 500) f.sample(at);
    assert.equal(f.observation.snapshot().candidates, 1);
  }
});

test('wall-clock changes never fast-forward the monotonic interval and reversed/invalid receiver clocks cannot count', () => {
  const f = adapterFixture();
  f.sample(0); f.output(0);
  f.sample(500, {}, { wallOffset: 10_000 });
  assert.equal(f.observation.snapshot().candidates, 0, 'wall jump is not ten seconds of closed-eye evidence');
  for (let at = 1_000; at <= 6_000; at += 500) f.sample(at, {}, { wallOffset: 10_000 });
  assert.equal(f.observation.snapshot().candidates, 1, 'continuous monotonic/native time remains valid across a wall adjustment');
  for (const clock of [{ monoOffset: -600 }, { monoOffset: NaN }, { wallOffset: NaN }]) {
    const broken = adapterFixture(); broken.sample(0); broken.output(0);
    const owner = broken.observation.generation;
    broken.sample(500, {}, clock);
    for (let at = 1_000; at <= 7_000; at += 500) broken.sample(at);
    broken.output(7_000, 1, {}, owner);
    assert.equal(broken.observation.snapshot().candidates, 0);
  }
});

test('Stop and a newer generation retain prior counts while rejecting queued old frame closures and late reports', async () => {
  const m = await mountedObservation({ queueBridge: true });
  try {
    for (let at = 1_000; at <= 2_200; at += 100) { await m.frame(at); await m.f.flushBridge(); }
    const oldGeneration = m.observation.generation, oldFrame = m.f.api.analysis.frameProcessor;
    m.output();
    for (let at = 2_700; at <= 8_200; at += 500) { await m.frame(at); await m.f.flushBridge(); }
    assert.equal(m.observation.snapshot().candidates, 1);
    await m.frame(8_300, undefined, oldFrame);
    m.observation.stop();
    await m.f.flushBridge();
    m.output(2, oldGeneration);
    assert.equal(m.observation.snapshot().candidates, 1);
    const newGeneration = m.observation.begin();
    assert.ok(newGeneration > oldGeneration);
    await m.f.update({ unansweredGeneration: newGeneration });
    await m.frame(8_500, undefined, oldFrame); await m.f.flushBridge();
    m.output(3, oldGeneration);
    assert.equal(m.observation.snapshot().candidates, 0);
    await m.frame(8_600, 0); await m.f.flushBridge();
    m.output(1);
    for (let at = 9_100; at <= 14_600; at += 500) { await m.frame(at, at - 8_600); await m.f.flushBridge(); }
    assert.equal(m.observation.snapshot().candidates, 1, 'new generation admits a reset native epoch and fresh decision identity');
  } finally { await m.close(); }
});

test('a first phone acceptance from before actual open/tracking loss/frame gap cannot arm a reacquired closed segment', async () => {
  for (const boundary of ['open', 'noFace', 'gap']) {
    const m = await mountedObservation();
    let state = 'closed';
    m.f.owner.processEyeOpenness = () => eye(state);
    await m.f.update();
    try {
      for (let at = 1_000; at <= 2_200; at += 100) await m.frame(at);
      const oldDecisionAt = 2_200;
      let acceptedAt;
      if (boundary === 'gap') {
        await m.frame(2_801);
        await m.frame(2_901);
        acceptedAt = 2_901;
      } else {
        if (boundary === 'open') state = 'open'; else m.f.faces = [];
        await m.frame(2_300);
        state = 'closed'; m.f.faces = [face];
        for (let at = 2_400; at <= 3_100; at += 100) await m.frame(at);
        acceptedAt = 3_100;
      }
      assert.equal(m.samples.at(-1).state, 'closed');
      m.output(1, m.observation.generation, { decisionAt: oldDecisionAt });
      for (let at = acceptedAt + 500; at <= acceptedAt + 6_500; at += 500) await m.frame(at);
      assert.equal(m.observation.snapshot().candidates, 0, boundary + ': old first acceptance is not new critical evidence');
      m.output(2);
      for (let at = acceptedAt + 7_000; at <= acceptedAt + 12_500; at += 500) await m.frame(at);
      assert.equal(m.observation.snapshot().candidates, 1, boundary + ': a current decision can arm after reacquisition');
    } finally { await m.close(); }
  }
});

test('default-off actual analysis reads no capture metadata, bridges no observation fields and persists no observation snapshot', async () => {
  const m = await mountedObservation({ enabled: false });
  try {
    let timestampReads = 0;
    const frame = { width: 640, height: 480, get timestamp() { timestampReads++; throw new Error('flag-off metadata read'); } };
    await m.f.at(1_000, () => m.f.api.analysis.frameProcessor(frame));
    m.f.faces = [];
    await m.f.at(1_100, () => m.f.api.analysis.frameProcessor(frame));
    m.output();
    assert.equal(timestampReads, 0);
    assert.equal(m.observation.generation, 0);
    assert.equal(m.observation.snapshot(), undefined);
    assert.equal(m.samples.length, 0);
    assert.ok(m.f.bridgeCalls.every(args => args.length === 13));
    await m.f.api.checkpoint(1_100);
    assert.equal(Object.hasOwn(m.f.events.checkpoints.at(-1), 'unansweredAlerts'), false);
  } finally { await m.close(); }
});

test('checked-in production build profile leaves unanswered-alert observation disabled', () => {
  const { build } = JSON.parse(readFileSync(new URL('../native-app/eas.json', import.meta.url), 'utf8'));
  const profiles = [], seen = new Set();
  let name = 'production';
  while (name) {
    assert.equal(seen.has(name), false, 'production profile inheritance must not cycle');
    seen.add(name);
    assert.ok(build[name], 'resolve every checked-in production parent');
    profiles.unshift(build[name]);
    name = build[name].extends;
  }
  const checkedInEnv = Object.assign({}, ...profiles.map(profile => profile.env));
  // This checks source defaults only, not remotely configured EAS variables.
  assert.notEqual(checkedInEnv.EXPO_PUBLIC_UNANSWERED_ALERT_OBSERVATION, '1');
});

test('observation callbacks, including a throwing callback, cannot change actual scoring, cadence or cloud-alert outcomes', async () => {
  const results = [];
  for (const options of [{ enabled: false }, { enabled: true }, { enabled: true, observer: () => { throw new Error('diagnostic failed'); } }]) {
    const m = await mountedObservation(options);
    try {
      for (const at of [1_000, 1_099, 1_100, 1_600, 2_200, 2_300]) await m.frame(at);
      await m.f.owner.cloudEventQueueRef.current;
      results.push(plain({ metrics: m.f.events.metrics, counts: m.f.events.counts, logs: m.f.events.logs,
        detections: m.f.detections, intervals: [...m.f.intervals.values()].map(item => item.delay),
        fatigueSamples: m.f.owner.fatigueSamplesRef.current, fatigueSum: m.f.owner.fatigueSumRef.current,
        maxFatigue: m.f.owner.maxFatigueRef.current, lastSample: m.f.owner.lastSampleAtRef.current,
        displayedLevel: m.f.owner.displayedAlertLevelRef.current }));
    } finally { await m.close(); }
  }
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
  assert.equal(results[0].detections, 5, '99ms frame remains throttled before detector inference');
});
