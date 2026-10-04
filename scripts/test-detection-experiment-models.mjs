import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { createTimePerclos, createElapsedRate, pitchRatio, createParkedBaseline, createNoFaceEvidence, matrixPose, parseFlags, parseTasksResult, createTraceStore } = require('../'+JSON.parse(readFileSync(new URL('../asset-versions.json',import.meta.url),'utf8'))['detection-experiments.js']);

function oracle(samples, windowMs = 60000, gapMs = 1000) {
  let previous = null, rows = [], watermark = null;
  for (const [now, state] of samples) {
    if (!Number.isFinite(now) || now < 0) { previous = null; continue; }
    if (watermark !== null && now < watermark) { rows = []; previous = null; watermark = now; continue; }
    if (watermark === now) continue;
    watermark = now;
    if (typeof state === 'boolean' && previous && now - previous.now <= gapMs) rows.push({ start: previous.now, end: now, closed: previous.state });
    previous = typeof state === 'boolean' ? { now, state } : null;
  }
  const now = watermark ?? 0, cutoff = now - windowMs;
  let total = 0, closed = 0;
  for (const row of rows) {
    const dt = Math.max(0, Math.min(now, row.end) - Math.max(cutoff, row.start));
    total += dt; if (row.closed) closed += dt;
  }
  return { observedMs: total, closedMs: closed, perclos: total ? 100 * closed / total : null };
}

function compare(samples, options) {
  const window = createTimePerclos(options), prefix = [];
  for (const entry of samples) {
    prefix.push(entry); window.update(...entry);
    const expected = oracle(prefix, options?.windowMs);
    const actual = window.snapshot();
    assert.equal(actual.observedMs, expected.observedMs);
    assert.equal(actual.closedMs, expected.closedMs);
    assert.equal(actual.perclos, expected.perclos);
  }
  return window;
}

test('observed time is 90% for an uneven closure that is only 33% of frames', () => {
  const w = compare([[0, true], [900, false], [1000, false]]);
  assert.equal(w.snapshot().perclos, 90);
  assert.equal(w.snapshot().observedMs, 1000);
  assert.equal(Math.round(1 / 3 * 100), 33);
});

test('only two usable endpoints at gaps up to 1000ms grant support', () => {
  const w = compare([[0, true], [1000, false], [2001, false], [2201, true], [2301, null], [2401, true], [2501, true], [2601, NaN], [2701, false], [2801, false]]);
  assert.equal(w.snapshot().observedMs, 1400);
  assert.equal(w.snapshot().closedMs, 1100);
});

test('all-open measured zero stays zero; unsupported frames and expired support stay unknown', () => {
  const w = compare([[0, false], [135, false], [60000, null], [60135, null]]);
  assert.equal(w.snapshot().perclos, null);
  w.reset(); assert.equal(w.update(0, false), null);
  assert.equal(w.update(135, false), 0);
  assert.equal(w.snapshot().closedMs, 0);
});

test('clips the oldest open and closed intervals exactly at and within the window', () => {
  for (const state of [false, true]) {
    const samples = [[0, state], [500, !state], [900, state], [1000, state], [1050, null], [1400, null], [1900, null], [2000, null]];
    compare(samples, { windowMs: 1000 });
  }
  const w = compare([[0, true], [1000, true], [60000, null], [60500, null], [61000, null]]);
  assert.equal(w.snapshot().observedMs, 0);
});

test('duplicate frames add no time and backward clocks invalidate continuity and support', () => {
  const w = compare([[0, true], [200, true], [200, false], [400, false], [100, true], [200, true], [200, null], [400, false]]);
  assert.equal(w.snapshot().observedMs, 200);
  assert.equal(w.snapshot().closedMs, 200);
});

test('many mixed observations and multiple evictions agree with an independent integration oracle', () => {
  let random = 7, now = 0;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
  const samples = [];
  for (let i = 0; i < 1500; i++) {
    now += [0, 50, 135, 300, 1000, 1001, 3500][next() % 7];
    samples.push([now, next() % 7 === 0 ? null : next() % 2 === 0]);
  }
  compare(samples);
});

test('ring overflow is explicit and coalescing preserves bounded backing storage', () => {
  const w = createTimePerclos({ capacity: 2 }), buffers = w.buffers;
  for (let i = 0; i < 6; i++) w.update(i * 100, i % 2 === 0);
  assert.equal(w.snapshot().intervalCount, 2);
  assert.equal(w.snapshot().droppedIntervals, 3);
  assert.equal(w.snapshot().truncated, true);
  assert.equal(w.snapshot(61000).truncated, false);
  assert.equal(w.buffers, buffers);
  w.reset();
  for (let i = 0; i < 10000; i++) w.update(i * 135, true);
  assert.equal(w.snapshot().intervalCount, 1);
  assert.equal(w.snapshot().droppedIntervals, 0);
  assert.equal(w.snapshot().observedMs, 60000);
  assert.equal(w.snapshot().perclos, 100);
});

test('actual deque updates never rebuild an Array or replace its typed backing buffers', () => {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(new URL('../'+JSON.parse(readFileSync(new URL('../asset-versions.json',import.meta.url),'utf8'))['detection-experiments.js'],import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(`const w = module.exports.createTimePerclos();
    const buffers = w.buffers;
    const saved = [];
    for (const name of ['filter','map','slice','splice','shift']) {
      saved.push([name,Array.prototype[name]]);
      Array.prototype[name] = function(){throw Error('Array rebuilding: '+name)};
    }
    const arrayFrom = Array.from;
    Array.from = function(){throw Error('Array allocation')};
    try {
      for(let i=0;i<200000;i++)w.update(i*135,(i%9)<4);
      if(w.buffers!==buffers || w.buffers.starts!==buffers.starts || w.buffers.ends!==buffers.ends || w.buffers.closed!==buffers.closed)throw Error('Backing storage replaced');
      if(w.snapshot().droppedIntervals!==0)throw Error('Supported cadence truncated');
    } finally {
      for(const [name,fn] of saved)Array.prototype[name]=fn;
      Array.from=arrayFrom;
    }`, sandbox);
});

test('elapsed accumulation starts without credit, clamps stalls and resets missing continuity', () => {
  const r = createElapsedRate();
  assert.equal(r.scale(0, true), 0); assert.equal(r.scale(135, true), 1);
  assert.equal(r.scale(10135, true), 500 / 135);
  r.scale(10270, false); assert.equal(r.scale(12000, true), 0);
  assert.equal(r.scale(11000, true), 0);
  r.reset(); assert.equal(r.scale(20000, true), 0);
});

function face(noseY = .5) {
  const f = Array.from({ length: 468 }, () => ({ x: .5, y: .5 }));
  f[33] = { x: .3, y: .35 }; f[263] = { x: .7, y: .35 };
  f[1] = { x: .5, y: noseY }; f[152] = { x: .5, y: .75 };
  return f;
}

test('2D pitch is dimensionless and distinguishes synthetic neutral from looking down', () => {
  assert.ok(Math.abs(pitchRatio(face()) - .375) < 1e-12);
  assert.ok(pitchRatio(face(.6)) > pitchRatio(face()) + .12);
  for (const missing of [1, 33, 152, 263]) { const f = face(); f[missing] = null; assert.equal(pitchRatio(f), null); }
  const f = face(); f[152].y = .35; assert.equal(pitchRatio(f), null);
  f[152].y = .75; f[1].y = NaN; assert.equal(pitchRatio(f), null);
});

test('parked baseline needs contiguous valid frontal/open-compatible evidence and minimum samples', () => {
  const b = createParkedBaseline();
  b.add(0, .3, .375, true); b.add(10000, .3, .375, true);
  assert.equal(b.finish().usable, false); assert.equal(b.finish().samples, 1);
  b.reset();
  for (let i = 0; i < 25; i++) b.add(i * 135, i === 0 ? .8 : .3, .375, true);
  assert.equal(b.finish().usable, true); assert.ok(Math.abs(b.finish().eyeBaseline - .3) < 1e-12);
  assert.ok(Math.abs(b.finish().pitchBaseline - .375) < 1e-12);
  b.add(3375, .3, .375, false); assert.equal(b.finish().usable, false);
  b.add(3510, .3, null, true); assert.equal(b.finish().pitchBaseline, null);
});

test('no-face experiment qualifies all three recent signals, never the no-prior or stale case', () => {
  for (const evidence of [{ eyesClosed: true }, { fatigue: 35 }, { downward: true }]) {
    const h = createNoFaceEvidence(); h.observe(1000, evidence);
    const result = h.loss(4000); assert.equal(result.qualified, true);
    assert.equal(h.loss(5000), result);
    h.reset(); h.observe(1000, evidence); assert.equal(h.loss(4001).qualified, false);
  }
  const h = createNoFaceEvidence(); h.observe(0, { fatigue: 34.999 });
  assert.equal(h.loss(1).qualified, false);
  h.reset(); assert.equal(h.loss(100).qualified, false);
  h.observe(200, { eyesClosed: true }); assert.equal(h.loss(199).qualified, false);
});

function rotation(pitch = 0, yaw = 0, roll = 0, scales = [1, 1, 1]) {
  const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180, r = roll * Math.PI / 180;
  const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y), cr = Math.cos(r), sr = Math.sin(r);
  return { rows: 4, columns: 4, data: [cr*cy, sr*cy, -sy, 0,
    cr*sy*sp-sr*cp, sr*sy*sp+cr*cp, cy*sp, 0,
    cr*sy*cp+sr*sp, sr*sy*cp-cr*sp, cy*cp, 0, 1, 2, 3, 1].map((v,i) => i < 12 ? v * scales[Math.floor(i/4)] : v) };
}

test('column-major matrix pose preserves known signed rotations and removes column scale', () => {
  for (const expected of [[0, 0, 0], [20, 0, 0], [-20, 0, 0], [0, 35, 0], [0, -35, 0], [12, -23, 17]]) {
    for (const scale of [[1, 1, 1], [2, 3, 4]]) {
      const actual = matrixPose(rotation(...expected, scale));
      assert.ok(Math.abs(actual.pitchDeg - expected[0]) < 1e-10);
      assert.ok(Math.abs(actual.yawDeg - expected[1]) < 1e-10);
      assert.ok(Math.abs(actual.rollDeg - expected[2]) < 1e-10);
    }
  }
  const g = matrixPose(rotation(20, 90, 30));
  assert.equal(g.pitchDeg, null); assert.equal(g.rollDeg, null); assert.equal(g.gimbal, true);
});

test('pose rejects missing, non-finite, wrong-shape, sheared and reflected matrices', () => {
  for (const value of [null, {}, { ...rotation(), rows: 3 }, { ...rotation(), data: [1] }]) assert.equal(matrixPose(value), null);
  const nan = rotation(); nan.data[4] = NaN; assert.equal(matrixPose(nan), null);
  const zero = rotation(); zero.data[0] = 0; assert.equal(matrixPose(zero), null);
  const shear = rotation(); shear.data[4] = .5; assert.equal(matrixPose(shear), null);
  const reflected = rotation(); reflected.data[0] = -1; assert.equal(matrixPose(reflected), null);
});


test('flags require unique exact values; combinations and delegate stay explicit', () => {
  assert.equal(parseFlags('').any, false);
  assert.equal(parseFlags('?detector=Tasks&pitch-gate=true&perclos=Time').any, false);
  assert.equal(parseFlags('?detector=tasks&detector=tasks').any, false);
  assert.equal(parseFlags('?tasks-delegate=cpu').any, false);
  const flags = parseFlags('?detector=tasks&tasks-delegate=cpu&perclos=time&noface-escalation=1&ear-units=pixels&fatigue-timing=elapsed&pitch-gate=1');
  assert.deepEqual(flags.names, ['elapsed','noface','pitch','pixels','tasks','timePerclos']);
  assert.equal(flags.delegate, 'CPU'); assert.equal(flags.primary, true);
  assert.equal(parseFlags('?detector=tasks').primary, false);
  assert.equal(parseFlags('?detector=tasks&tasks-delegate=cpu&tasks-delegate=gpu').delegate, 'GPU');
  assert.ok(Object.isFrozen(flags)); assert.ok(Object.isFrozen(flags.names));
});

test('Tasks parsing records unsupported signals as null and rejects duplicate or invalid coefficients', () => {
  const result = { faceLandmarks: [[{}]], faceBlendshapes: [{ categories: [
    {categoryName:'eyeBlinkLeft',score:.2},{categoryName:'eyeBlinkRight',score:.8},{categoryName:'jawOpen',score:.3}
  ] }], facialTransformationMatrixes: [rotation(12,-23,17)] };
  const parsed = parseTasksResult(result);
  assert.equal(parsed.tasksUsable, true); assert.equal(parsed.eyeBlinkLeft, .2); assert.equal(parsed.jawOpen,.3);
  assert.ok(Math.abs(parsed.pitchDeg-12)<1e-10); assert.ok(Math.abs(parsed.yawDeg+23)<1e-10);
  result.faceBlendshapes[0].categories.push({categoryName:'eyeBlinkLeft',score:.2});
  assert.equal(parseTasksResult(result).eyeBlinkLeft, null); assert.equal(parseTasksResult(result).tasksUsable, false);
  result.faceBlendshapes[0].categories = [{categoryName:'eyeBlinkLeft',score:0},{categoryName:'eyeBlinkRight',score:1},{categoryName:'jawOpen',score:NaN}];
  assert.equal(parseTasksResult(result).tasksUsable, true); assert.equal(parseTasksResult(result).jawOpen, null);
  result.faceLandmarks = [[]]; assert.equal(parseTasksResult(result).tasksUsable,false); assert.equal(parseTasksResult(result).pitchDeg,null);
  assert.equal(parseTasksResult(null).eyeBlinkLeft,null);
});

test('trace retains only bounded scalar measurements with honest unknowns, unique frames and explicit drops', () => {
  const trace = createTraceStore({capacity:2,alertCapacity:2});
  const extra = {coordinates:[1,2], landmarks:[{}], email:'private', token:'secret', media:'private'};
  assert.equal(trace.add({frameId:1,atMs:0,mediaTime:0,rawEar:.3,legacyUsable:true,...extra}),true);
  assert.equal(trace.add({frameId:1,atMs:1,mediaTime:1}),false);
  assert.equal(trace.add({frameId:2,atMs:10,mediaTime:0}),false);
  assert.equal(trace.add({frameId:2,atMs:10,mediaTime:.1,eyeBlinkLeft:0,tasksUsable:true}),true);
  assert.equal(trace.add({frameId:3,atMs:20,mediaTime:.2,rawEar:NaN,eyeBlinkRight:Infinity}),true);
  const rows=trace.samples(); assert.equal(rows.length,2); assert.equal(rows[0].eyeBlinkLeft,0);
  assert.equal(rows[1].rawEar,null); assert.equal(rows[1].eyeBlinkRight,null);
  for(const row of rows)for(const key of Object.keys(extra))assert.ok(!(key in row));
  trace.recordAlert(10,'Fatigue');trace.recordAlert(20,'Distraction');trace.recordAlert(30,'Face lost after fatigue');
  assert.equal(trace.recordAlert(1,'Fatigue'),false);
  assert.deepEqual(trace.alerts(),[{atMs:20,reason:'distraction'},{atMs:30,reason:'noface_after_fatigue'}]);
  const summary=trace.summary();assert.equal(summary.droppedFrames,1);assert.equal(summary.droppedAlerts,1);
  assert.equal(summary.totalFrames,3);assert.equal(summary.legacyUsableFrames,1);assert.equal(summary.tasksUsableFrames,1);
  assert.equal(summary.retainedStartMs,10);assert.equal(summary.retainedEndMs,20);
  assert.equal(summary.backingBytes,2*22*8+2*9);assert.equal(summary.tasksEventMetricsAvailable,false);
  assert.equal(JSON.stringify({rows,summary}).includes('private'),false);
});
