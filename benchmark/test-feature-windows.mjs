import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseTable } from './csv.mjs';
import { toCsv } from './prepare-dataset.mjs';
import { writeFeatureWindows } from './feature-windows.mjs';
import { acceptedYawnFrames, comparisonColumns, traceContract } from './parked-detection-trace.mjs';

async function fixture(t, { id = 's1', participant = 'p1', split = 'train', change = () => ({}),
  flags = ['observer'], yawnFile = true, pixels = false, duration = 63000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'occulert-features-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'adapter');
  await mkdir(dir);
  const frames = [];
  for (let at = 0; at <= Math.min(duration, 63000); at += 250) {
    frames.push({ session_id: id, frame_id: frames.length + 1, at_ms: at,
      smoothed_ear: .30, raw_ear: .30, legacy_usable: 1, tasks_usable: 0, calibrating: 0, pitch_down: 0, ...change(at) });
  }
  const sample = { session_id: id, participant, platform: 'web', detector_version: 'fixture', split, duration_ms: duration };
  async function csv(name, headers, rows) { await writeFile(join(dir, name + '.csv'), toCsv(headers, rows) + '\n'); }
  await csv('sessions', Object.keys(sample), [sample]);
  await csv('episodes', ['session_id','start_ms','end_ms','label'],
    duration >= 62000 ? [{ session_id: id, start_ms: 60000, end_ms: 62000, label: 'drowsy' }] : []);
  await csv('comparison', comparisonColumns, frames);
  if (yawnFile) await csv('accepted-yawns', ['session_id','frame_id','accepted_yawn'],
    frames.map(frame => ({ ...frame, accepted_yawn: Number(frame.at_ms === 59250) })));
  await writeFile(join(dir, 'trace-provenance.json'), JSON.stringify({ experimentFlags: flags,
    geometryUnits: pixels ? 'pixels-reference-3x4' : 'normalized' }));
  const output = join(root, 'features');
  async function run() {
    const manifest = await writeFeatureWindows([dir], output);
    return { rows: parseTable(await readFile(join(output, 'windows.csv'), 'utf8')).rows, manifest };
  }
  return { dir, output, run };
}

test('emits full, causal 30/60-second windows with observer labels and exact usable intervals', async t => {
  const base = await fixture(t, { change: at => at === 59500 ? { smoothed_ear: .12 } : {} });
  const future = await fixture(t, { change: at => at === 59500 || at >= 60000 ? { smoothed_ear: .12 } : {} });
  const a = await base.run(), b = await future.run();
  assert.deepEqual(a.rows[0], b.rows[0]);
  assert.notEqual(a.rows[1].ear_mean_60s, b.rows[1].ear_mean_60s);
  assert.deepEqual(a.rows.map(row => row.label), ['1','1','0','0']);
  const first = a.rows[0];
  assert.equal(first.end_ms, '60000');
  assert.equal(first.blink_count_30s, '1');
  assert.equal(first.closure_mean_ms_30s, '250');
  assert.equal(Number(first.perclos_60s), 250 / 59750 * 100);
  assert.equal(Number(first.usable_fraction_30s), 29750 / 30000);
  assert.equal(first.ear_min_60s, '0.12');
  assert.equal(first.tasks_blink_mean_30s, '');
  assert.equal(first.tasks_blink_max_60s, '');
  assert.equal(first.pitch_down_fraction_60s, '');
  assert.equal(first.yawn_count_30s, '1');
  assert.deepEqual(a.manifest.counts, { warmup: 59, lowUsableFraction: 0, included: 4 });
  assert.equal(a.manifest.features.length, 24);
  for (const hash of Object.values(a.manifest.inputs[0].inputHashes)) assert.match(hash, /^[a-f0-9]{64}$/);
  await assert.rejects(base.run(), { code: 'EEXIST' });
});

test('exclusion accounting includes gaps and warmup, even after the last observation', async t => {
  const thin = await fixture(t, { change: at => ({ legacy_usable: Number(at < 20000) }), duration: 2000000 });
  const { rows, manifest } = await thin.run();
  assert.deepEqual(rows, []);
  assert.deepEqual(manifest.counts, { warmup: 59, lowUsableFraction: 1941, included: 0 });
});

test('participant-level split leakage is refused before creating any output', async t => {
  const a = await fixture(t), b = await fixture(t, { id: 's2', split: 'test' });
  await assert.rejects(writeFeatureWindows([a.dir, b.dir], a.output), /participant/i);
  await assert.rejects(access(a.output), { code: 'ENOENT' });
});

test('missing yawn evidence stays unknown and usable Tasks observations are bilateral', async t => {
  const input = await fixture(t, { flags: ['observer','tasks','pitch'], yawnFile: false,
    change: at => ({ tasks_usable: Number(at % 1000 === 0), eye_blink_left: .2, eye_blink_right: .6,
      legacy_usable: Number(at !== 50000), pitch_down: Number(at === 50000) }) });
  const { rows } = await input.run();
  assert.equal(rows[0].yawn_count_30s, '');
  assert.equal(Number(rows[0].tasks_blink_max_60s), .4);
  assert.ok(Math.abs(Number(rows[0].tasks_blink_mean_30s) - .4) < 1e-12);
  assert.equal(Number(rows[0].pitch_down_fraction_60s), 250 / 59750);
});

test('recorded accepted-yawn flags come from aligned version-three scoring frames only', () => {
  const trace = { session: { sessionId: 'session' }, version: 3, samples: [{ frameId: 1 }, { frameId: 2 }, { frameId: 3 }],
    scoringReplay: { frames: [{ frameId: 2, hasFace: true, yawn: false }, { frameId: 3, hasFace: true, yawn: true }] } };
  assert.deepEqual(acceptedYawnFrames(trace).map(row => row.accepted_yawn), [null, 0, 1]);
  assert.deepEqual(acceptedYawnFrames({ ...trace, version: 2 }).map(row => row.accepted_yawn), [null, null, null]);
  trace.scoringReplay.frames[1].hasFace = false;
  assert.throws(() => acceptedYawnFrames(trace));
});

test('an interrupted closure contributes supported time only and cannot count as a blink', async t => {
  const input = await fixture(t, { change: at => at >= 59000 && at < 59750
    ? { legacy_usable: Number(at !== 59250), smoothed_ear: .10 } : {} });
  const { rows } = await input.run();
  assert.equal(rows[0].blink_count_30s, '0');
  assert.equal(rows[0].closure_mean_ms_30s, '');
  assert.equal(Number(rows[0].perclos_30s), 100 * 250 / (29750 - 500));
});


test('swapping valid episode files between two selected sessions cannot mislabel either one', async t => {
  const a = await fixture(t), b = await fixture(t, { id: 's2', participant: 'p2' });
  const pathA = join(a.dir, 'episodes.csv'), pathB = join(b.dir, 'episodes.csv');
  const bytesA = await readFile(pathA), bytesB = await readFile(pathB);
  await writeFile(pathA, bytesB);
  await writeFile(pathB, bytesA);
  await assert.rejects(writeFeatureWindows([a.dir, b.dir], a.output), /unknown session/i);
  await assert.rejects(access(a.output), { code: 'ENOENT' });
});


test('the parked conversion and window command interoperate on a scalar-only observer export', async t => {
  const root = await mkdtemp(join(tmpdir(), 'occulert-window-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = 'cli-session';
  const samples = Array.from({ length: 241 }, (_, i) => ({ frameId: i + 1, atMs: i * 250,
    rawEar: .3, smoothedEar: .3, legacyUsable: true, tasksUsable: false, pitchDown: false, calibrating: false }));
  const trace = { schema: 'occulert.parked-detection-trace', version: 1, samples, legacyAlerts: [],
    session: { sessionId, durationMs: 60000, platform: 'web', detectorVersion: traceContract.detectorPrefix + 'observer',
      experimentFlags: ['observer'], geometryUnits: 'normalized', runtimeVersion: traceContract.runtimeVersion,
      runtimePins: traceContract.runtimePins, helperIntegrity: traceContract.helperIntegrity, modelIntegrity: traceContract.modelIntegrity } };
  const raw = join(root, 'trace.json'), labels = join(root, 'labels.csv'), adapter = join(root, 'adapter'), windows = join(root, 'windows');
  await writeFile(raw, JSON.stringify(trace));
  await writeFile(labels, 'session_id,start_ms,end_ms,label\n');
  execFileSync(process.execPath, ['benchmark/parked-detection-trace.mjs', '--trace', raw, '--episodes', labels,
    '--participant', 'fixture', '--split', 'test', '--out', adapter]);
  execFileSync(process.execPath, ['benchmark/feature-windows.mjs', adapter, '--out', windows]);
  const { rows } = parseTable(await readFile(join(windows, 'windows.csv'), 'utf8'));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].session_id, rows[0].participant, rows[0].split, rows[0].label, rows[0].yawn_count_60s],
    [sessionId, 'fixture', 'test', '0', '']);
});
