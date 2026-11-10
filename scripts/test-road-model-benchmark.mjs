import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createRoadReport,
  MAX_INPUT_BYTES,
  scoreRoadModels,
  validateRoadBundle,
} from '../benchmark/run-road-model-benchmark.mjs';

const runner = fileURLToPath(new URL('../benchmark/run-road-model-benchmark.mjs', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const lane = () => ({ state: 'present', leftX: 0.25, rightX: 0.75 });
const lead = () => ({ state: 'present', box: [0.25, 0.25, 0.5, 0.5] });
const absent = () => ({ state: 'absent' });
const unavailable = () => ({ state: 'unavailable' });
const unlabeled = () => ({ state: 'unlabeled' });

// Independent scalar examples. No model, image, clip, or permission is implied.
function bundle() {
  const truth = index => index < 5 ? 'present' : index < 9 ? 'absent' : 'unlabeled';
  const frame = (index, atMs) => ({
    id: `f${index}`,
    atMs,
    lane: truth(index) === 'present' ? lane() : { state: truth(index) },
    leadVehicle: truth(index) === 'present' ? lead() : { state: truth(index) },
  });
  const input = {
    schemaVersion: 1,
    kind: 'synthetic-road-fixture',
    dataset: {
      id: 'independent-road-scalars',
      version: '1',
      origin: 'hand-authored-synthetic-scalars',
      license: 'NOASSERTION',
    },
    evaluation: { laneReferenceY: 0.75, laneTolerance: 0.05, leadIoUThreshold: 0.5 },
    models: [
      { id: 'lane-a', task: 'lane', version: 'fixture-1', origin: 'synthetic-predictions', license: 'NOASSERTION', declaredSizeBytes: 123456 },
      { id: 'lead-a', task: 'lead-vehicle', version: 'fixture-1', origin: 'synthetic-predictions', license: 'NOASSERTION', declaredSizeBytes: 654321 },
    ],
    clips: [
      { id: 'day', sourceGroup: 'source-day', split: 'test', lighting: 'day', weather: 'dry', durationMs: 1000, license: 'NOASSERTION', frames: Array.from({ length: 6 }, (_, i) => frame(i, i * 100)) },
      { id: 'night', sourceGroup: 'source-night', split: 'train', lighting: 'night', weather: 'rain', durationMs: 1000, license: 'NOASSERTION', frames: Array.from({ length: 6 }, (_, i) => frame(i + 6, i * 100)) },
    ],
    predictions: [],
  };
  // f4/f8/f11 are omitted; f3/f7/f10 explicitly unavailable. The bad
  // localization at f1 is both a false output and a missed labeled object.
  const rows = [
    [0, 'present', 0], [1, 'bad', 10], [2, 'absent', null],
    [3, 'unavailable', 20], [5, 'present', 30], [6, 'absent', 40],
    [7, 'unavailable', null], [9, 'present', 50], [10, 'unavailable', null],
  ];
  for (const model of input.models) {
    for (const [index, state, simulatedLatencyMs] of rows) {
      let result = state === 'absent' ? absent() : state === 'unavailable' ? unavailable() : model.task === 'lane' ? lane() : lead();
      if (state === 'bad') result = model.task === 'lane'
        ? { state: 'present', leftX: 0.4, rightX: 0.75 }
        : { state: 'present', box: [0, 0, 0.1, 0.1] };
      input.predictions.push({ modelId: model.id, clipId: index < 6 ? 'day' : 'night', frameId: `f${index}`, result, simulatedLatencyMs });
    }
  }
  return input;
}

function singleFrame(truth, prediction, task = 'lane', simulatedLatencyMs = 0) {
  const input = bundle();
  input.models = [input.models[task === 'lane' ? 0 : 1]];
  input.clips = [{ ...input.clips[0], frames: [{ id: 'only', atMs: 0, lane: task === 'lane' ? truth : unlabeled(), leadVehicle: task === 'lead-vehicle' ? truth : unlabeled() }] }];
  input.predictions = prediction === undefined ? [] : [{ modelId: input.models[0].id, clipId: 'day', frameId: 'only', result: prediction, simulatedLatencyMs }];
  return input;
}

const countKeys = [
  'frames', 'labeledFrames', 'unlabeledFrames', 'positiveFrames', 'negativeFrames',
  'coveredLabeledFrames', 'coveredPositiveFrames', 'coveredNegativeFrames',
  'missingPredictions', 'unavailablePredictions', 'unlabeledOutputs',
  'truePositives', 'falsePositives', 'falseNegatives', 'trueNegatives',
  'falsePositivesOnNegativeFrames', 'localizationErrors',
];
const rateKeys = ['coverage', 'recall', 'coveredRecall', 'precision', 'f1', 'falsePositiveRateOnCoveredNegatives'];

function assertEmptyMetrics(metrics) {
  for (const key of countKeys) assert.equal(metrics[key], 0, key);
  for (const key of rateKeys) assert.equal(metrics[key], null, key);
  assert.deepEqual(metrics.simulatedLatencyMs, { samples: 0, missing: 0, mean: null, median: null, p95: null });
}

test('lane and lead scoring retain misses, false localization, abstention, and declared latency denominators', () => {
  const input = bundle();
  const before = clone(input);
  validateRoadBundle(input);
  const models = scoreRoadModels(input);
  assert.deepEqual(models.map(model => [model.id, model.task]), [['lane-a', 'lane'], ['lead-a', 'lead-vehicle']]);
  for (const model of models) {
    const metrics = model.overall;
    assert.deepEqual(Object.fromEntries(countKeys.map(key => [key, metrics[key]])), {
      frames: 12, labeledFrames: 9, unlabeledFrames: 3, positiveFrames: 5, negativeFrames: 4,
      coveredLabeledFrames: 5, coveredPositiveFrames: 3, coveredNegativeFrames: 2,
      missingPredictions: 3, unavailablePredictions: 3, unlabeledOutputs: 1,
      truePositives: 1, falsePositives: 2, falseNegatives: 4, trueNegatives: 1,
      falsePositivesOnNegativeFrames: 1, localizationErrors: 1,
    });
    assert.equal(metrics.coverage, 5 / 9);
    assert.equal(metrics.recall, 1 / 5);
    assert.equal(metrics.coveredRecall, 1 / 3);
    assert.equal(metrics.precision, 1 / 3);
    assert.equal(metrics.f1, 1 / 4);
    assert.equal(metrics.falsePositiveRateOnCoveredNegatives, 1 / 2);
    assert.deepEqual(metrics.simulatedLatencyMs, { samples: 6, missing: 3, mean: 25, median: 25, p95: 47.5 });
  }
  assert.deepEqual(input, before, 'validation and scoring must not rewrite the source fixture');
});

test('slices retain zero support and aggregate counts rather than averaging slice rates', () => {
  for (const model of scoreRoadModels(bundle())) {
    assert.deepEqual(model.slices.lighting.map(slice => slice.value).sort(), ['dawn-dusk', 'day', 'night', 'unknown']);
    assert.deepEqual(model.slices.weather.map(slice => slice.value).sort(), ['dry', 'fog', 'rain', 'snow', 'unknown']);
    const day = model.slices.lighting.find(slice => slice.value === 'day');
    const night = model.slices.lighting.find(slice => slice.value === 'night');
    assert.equal(day.frames, 6);
    assert.equal(day.coverage, 4 / 6);
    assert.equal(night.frames, 6);
    assert.equal(night.coverage, 1 / 3);
    assert.notEqual(model.overall.coverage, (day.coverage + night.coverage) / 2);
    assert.equal(model.overall.coveredLabeledFrames, day.coveredLabeledFrames + night.coveredLabeledFrames);
    assert.equal(model.overall.labeledFrames, day.labeledFrames + night.labeledFrames);
    assertEmptyMetrics(model.slices.lighting.find(slice => slice.value === 'unknown'));
    assertEmptyMetrics(model.slices.weather.find(slice => slice.value === 'fog'));
  }
});

test('train/test selection retains models and rejects a vacuous held-out report', () => {
  const input = bundle();
  const selected = scoreRoadModels(input, { split: 'test' });
  assert.equal(selected.length, 2);
  assert.equal(selected[0].overall.frames, 6);
  assert.equal(selected[0].overall.positiveFrames, 5);
  assert.equal(selected[0].overall.missingPredictions, 1);
  assert.equal(selected[0].overall.recall, 1 / 5);
  input.clips = input.clips.filter(clip => clip.split === 'test');
  input.predictions = input.predictions.filter(row => row.clipId === 'day');
  assert.throws(() => scoreRoadModels(input, { split: 'train' }), /No clips selected/);
  assert.throws(() => scoreRoadModels(input, { split: 'validation' }));
});

test('model results are independent even when two candidates share a task', () => {
  const input = bundle();
  input.models.push({ ...input.models[0], id: 'lane-missing', version: 'fixture-2' });
  const result = scoreRoadModels(input);
  assert.equal(result.length, 3);
  const missing = result.find(model => model.id === 'lane-missing').overall;
  assert.equal(missing.frames, 12);
  assert.equal(missing.missingPredictions, 12);
  assert.equal(missing.falseNegatives, 5);
  assert.equal(missing.trueNegatives, 0);
  assert.equal(missing.recall, 0);
  assert.equal(missing.coverage, 0);
  assert.equal(missing.coveredRecall, null);
  assert.equal(result.find(model => model.id === 'lane-a').overall.recall, 1 / 5);
});

test('inclusive lane tolerance checks both edges and inclusive lead IoU uses normalized xywh', () => {
  const boundary = singleFrame(lane(), { state: 'present', leftX: 0.375, rightX: 0.625 });
  boundary.evaluation.laneTolerance = 0.125;
  assert.equal(scoreRoadModels(boundary)[0].overall.truePositives, 1);
  for (const edge of ['leftX', 'rightX']) {
    const outside = clone(boundary);
    outside.predictions[0].result[edge] += edge === 'leftX' ? 1e-8 : -1e-8;
    const metrics = scoreRoadModels(outside)[0].overall;
    assert.equal(metrics.truePositives, 0);
    assert.equal(metrics.falsePositives, 1);
    assert.equal(metrics.falseNegatives, 1);
    assert.equal(metrics.localizationErrors, 1);
    assert.equal(metrics.falsePositiveRateOnCoveredNegatives, null);
  }
  const boxBoundary = singleFrame({ state: 'present', box: [0, 0, 1, 0.5] }, { state: 'present', box: [0.5, 0, 0.5, 0.5] }, 'lead-vehicle');
  assert.equal(scoreRoadModels(boxBoundary)[0].overall.truePositives, 1);
  boxBoundary.predictions[0].result.box = [0.500001, 0, 0.499999, 0.5];
  assert.equal(scoreRoadModels(boxBoundary)[0].overall.localizationErrors, 1);
});

test('tiny IoU thresholds do not turn disjoint or negligible overlap into a match', () => {
  const input = singleFrame(
    { state: 'present', box: [0, 0, 0.5, 0.5] },
    { state: 'present', box: [0.75, 0.75, 0.25, 0.25] },
    'lead-vehicle',
  );
  input.evaluation.leadIoUThreshold = 1e-16;
  for (const box of [[0.75, 0.75, 0.25, 0.25], [0.49999999999999994, 0.49999999999999994, 0.5, 0.5]]) {
    input.predictions[0].result.box = box;
    const metrics = scoreRoadModels(input)[0].overall;
    assert.equal(metrics.truePositives, 0);
    assert.equal(metrics.falsePositives, 1);
    assert.equal(metrics.falseNegatives, 1);
    assert.equal(metrics.localizationErrors, 1);
  }
});

test('resolved tiny-box corners match themselves at IoU one and adjacent boxes stay disjoint', () => {
  const tiny = { state: 'present', box: [0.5, 0.5, 6e-17, 6e-17] };
  const input = singleFrame(clone(tiny), clone(tiny), 'lead-vehicle');
  input.evaluation.leadIoUThreshold = 1;
  const identical = scoreRoadModels(input)[0].overall;
  assert.equal(identical.truePositives, 1);
  assert.equal(identical.falsePositives, 0);
  assert.equal(identical.falseNegatives, 0);
  input.predictions[0].result.box = [0.5000000000000001, 0.5, 6e-17, 6e-17];
  input.evaluation.leadIoUThreshold = 1e-16;
  const adjacent = scoreRoadModels(input)[0].overall;
  assert.equal(adjacent.truePositives, 0);
  assert.equal(adjacent.falsePositives, 1);
  assert.equal(adjacent.falseNegatives, 1);
});

test('zero-support ratios differ from supported zero performance', () => {
  const negative = scoreRoadModels(singleFrame(absent(), absent()))[0].overall;
  assert.equal(negative.trueNegatives, 1);
  assert.equal(negative.coverage, 1);
  assert.equal(negative.falsePositiveRateOnCoveredNegatives, 0);
  assert.equal(negative.recall, null);
  assert.equal(negative.precision, null);
  assert.equal(negative.f1, null);

  const miss = scoreRoadModels(singleFrame(lane(), absent()))[0].overall;
  assert.equal(miss.recall, 0);
  assert.equal(miss.coveredRecall, 0);
  assert.equal(miss.f1, 0);
  assert.equal(miss.precision, null);
  const abstention = scoreRoadModels(singleFrame(lane(), unavailable()))[0].overall;
  assert.equal(abstention.recall, 0);
  assert.equal(abstention.coverage, 0);
  assert.equal(abstention.coveredRecall, null);
  assert.equal(abstention.falseNegatives, 1);
  const missingNegative = scoreRoadModels(singleFrame(absent(), undefined))[0].overall;
  assert.equal(missingNegative.trueNegatives, 0);
  assert.equal(missingNegative.coverage, 0);
  assert.equal(missingNegative.falsePositiveRateOnCoveredNegatives, null);
  const falseOutput = scoreRoadModels(singleFrame(absent(), lane()))[0].overall;
  assert.equal(falseOutput.precision, 0);
  assert.equal(falseOutput.f1, 0);
  assert.equal(falseOutput.falsePositiveRateOnCoveredNegatives, 1);
});

test('unlabeled truth never enters confusion counts and timing zero is a real sample', () => {
  for (const prediction of [lane(), absent(), unavailable(), undefined]) {
    const metrics = scoreRoadModels(singleFrame(unlabeled(), prediction))[0].overall;
    assert.equal(metrics.frames, 1);
    assert.equal(metrics.unlabeledFrames, 1);
    assert.equal(metrics.labeledFrames, 0);
    for (const key of ['truePositives', 'falsePositives', 'falseNegatives', 'trueNegatives', 'localizationErrors']) assert.equal(metrics[key], 0, key);
    for (const key of rateKeys) assert.equal(metrics[key], null, key);
    assert.equal(metrics.unlabeledOutputs, prediction && prediction.state !== 'unavailable' ? 1 : 0);
  }
  assert.deepEqual(scoreRoadModels(singleFrame(lane(), lane(), 'lane', 0))[0].overall.simulatedLatencyMs, { samples: 1, missing: 0, mean: 0, median: 0, p95: 0 });
  assert.deepEqual(scoreRoadModels(singleFrame(lane(), lane(), 'lane', null))[0].overall.simulatedLatencyMs, { samples: 0, missing: 1, mean: null, median: null, p95: null });
});

test('strict schema rejects malformed metadata, states, geometries, and nonfinite values', async t => {
  const cases = [
    ['unknown root field', input => { input.mediaPath = 'invented.mp4'; }],
    ['unsupported schema', input => { input.schemaVersion = 2; }],
    ['real evidence kind', input => { input.kind = 'real-road-evaluation'; }],
    ['non-synthetic dataset', input => { input.dataset.origin = 'camera'; }],
    ['unknown dataset field', input => { input.dataset.consent = true; }],
    ['missing dataset license', input => { delete input.dataset.license; }],
    ['empty model version', input => { input.models[0].version = ''; }],
    ['non-synthetic model', input => { input.models[0].origin = 'executed-model'; }],
    ['negative declared size', input => { input.models[0].declaredSizeBytes = -1; }],
    ['fractional declared size', input => { input.models[0].declaredSizeBytes = 1.5; }],
    ['unknown model field', input => { input.models[0].verifiedSizeBytes = 1; }],
    ['unknown task', input => { input.models[0].task = 'distance'; }],
    ['invalid reference y', input => { input.evaluation.laneReferenceY = 2; }],
    ['negative tolerance', input => { input.evaluation.laneTolerance = -0.1; }],
    ['invalid IoU threshold', input => { input.evaluation.leadIoUThreshold = 1.1; }],
    ['unknown lighting', input => { input.clips[0].lighting = 'sunset'; }],
    ['unknown weather', input => { input.clips[0].weather = 'ice'; }],
    ['zero duration', input => { input.clips[0].durationMs = 0; }],
    ['negative frame time', input => { input.clips[0].frames[0].atMs = -1; }],
    ['frame beyond duration', input => { input.clips[0].frames[0].atMs = 1001; }],
    ['out-of-order frame times', input => { input.clips[0].frames[2].atMs = 50; }],
    ['unavailable truth', input => { input.clips[0].frames[0].lane = unavailable(); }],
    ['unlabeled prediction', input => { input.predictions[0].result = unlabeled(); }],
    ['crossed lane edges', input => { input.predictions[0].result.leftX = 0.9; }],
    ['out-of-range lane edge', input => { input.clips[0].frames[0].lane.leftX = -0.1; }],
    ['nonfinite lane edge', input => { input.clips[0].frames[0].lane.leftX = NaN; }],
    ['absent geometry contradiction', input => { input.predictions[2].result.leftX = 0.25; }],
    ['unavailable geometry contradiction', input => { input.predictions[3].result.box = [0, 0, 1, 1]; }],
    ['lead box beyond bounds', input => { input.clips[0].frames[0].leadVehicle.box = [0.8, 0, 0.3, 0.5]; }],
    ['zero lead width', input => { input.clips[0].frames[0].leadVehicle.box[2] = 0; }],
    ['wrong box length', input => { input.clips[0].frames[0].leadVehicle.box = [0, 0, 1]; }],
    ['sparse box coordinates', input => { input.clips[0].frames[0].leadVehicle.box = [0, , 1, 1]; }],
    ['underflowed positive box area', input => { input.clips[0].frames[0].leadVehicle.box = [0, 0, 1e-200, 1e-200]; }],
    ['nonrepresentable translated box width', input => { input.clips[0].frames[0].leadVehicle.box = [0.5, 0, 1e-200, 0.25]; }],
    ['wrong task geometry', input => { input.predictions[0].result = lead(); }],
    ['missing timing field', input => { delete input.predictions[0].simulatedLatencyMs; }],
    ['negative timing', input => { input.predictions[0].simulatedLatencyMs = -1; }],
    ['infinite timing', input => { input.predictions[0].simulatedLatencyMs = Infinity; }],
    ['string timing', input => { input.predictions[0].simulatedLatencyMs = '0'; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = bundle();
      mutate(input);
      assert.throws(() => validateRoadBundle(input));
      assert.throws(() => scoreRoadModels(input));
    });
  }
});

test('references, duplicates, and source-group leakage are validated before split selection', async t => {
  const cases = [
    ['duplicate model', input => { input.models.push(clone(input.models[0])); }],
    ['duplicate clip', input => { input.clips.push(clone(input.clips[0])); }],
    ['duplicate frame', input => { input.clips[0].frames[1].id = input.clips[0].frames[0].id; }],
    ['duplicate prediction', input => { input.predictions.push(clone(input.predictions[0])); }],
    ['unknown model', input => { input.predictions[0].modelId = 'unknown'; }],
    ['unknown clip', input => { input.predictions[0].clipId = 'unknown'; }],
    ['unknown frame', input => { input.predictions[0].frameId = 'unknown'; }],
    ['frame in wrong clip', input => { input.predictions[0].frameId = 'f6'; }],
    ['source group crosses splits', input => { input.clips[1].sourceGroup = input.clips[0].sourceGroup; }],
    ['malformed excluded frame', input => { input.clips[1].frames[0].leadVehicle.box = [0, 0, -1, 1]; }],
    ['malformed excluded timing', input => { input.predictions.find(row => row.clipId === 'night').simulatedLatencyMs = -1; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = bundle();
      mutate(input);
      assert.throws(() => validateRoadBundle(input));
      assert.throws(() => scoreRoadModels(input, { split: 'test' }));
    });
  }
});

test('direct API rejects oversized model, clip, frame, and prediction collections', async t => {
  const cases = [
    ['models', input => { input.models.push(...Array.from({ length: 7 }, (_, index) => ({ ...input.models[0], id: `model-${index}` }))); }],
    ['clips', input => { input.clips.push(...Array.from({ length: 31 }, (_, index) => ({ ...clone(input.clips[0]), id: `clip-${index}`, sourceGroup: `source-${index}` }))); }],
    ['frames', input => {
      input.clips[0].durationMs = 2000;
      input.clips[0].frames = Array.from({ length: 1001 }, (_, index) => ({ id: `f${index}`, atMs: index, lane: lane(), leadVehicle: lead() }));
    }],
    ['predictions', input => { input.predictions = Array.from({ length: 8001 }, () => clone(input.predictions[0])); }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const input = bundle();
      mutate(input);
      assert.throws(() => validateRoadBundle(input), /array length/);
    });
  }
});

test('prototype-like identifiers are ordinary IDs and never combine model evidence', () => {
  const input = singleFrame(lane(), lane());
  input.models[0].id = '__proto__';
  input.clips[0].id = 'constructor';
  input.clips[0].frames[0].id = 'toString';
  Object.assign(input.predictions[0], { modelId: '__proto__', clipId: 'constructor', frameId: 'toString' });
  const result = scoreRoadModels(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '__proto__');
  assert.equal(result[0].overall.truePositives, 1);
});

async function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-road-benchmark-'));
  try { return await run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function cli(args, cwd) {
  return spawnSync(process.execPath, [runner, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
}

test('report hashes exact input bytes and configuration, retaining synthetic metadata without a real-model claim', () => {
  const input = bundle();
  const inputBytes = Buffer.from(`${JSON.stringify(input, null, 2)}\n`);
  const report = createRoadReport(input, { inputBytes, split: 'all', ranAt: '2026-11-03T00:00:00.000Z' });
  assert.equal(report.kind, 'synthetic-road-contract-report');
  assert.deepEqual(report.evidence, {
    syntheticFixtureOnly: true,
    realModelsExecuted: false,
    realRoadAccuracyEstablished: false,
    onDeviceLatencyMeasured: false,
    appIntegrationAuthorized: false,
  });
  assert.equal(report.provenance.inputSha256, sha256(inputBytes));
  assert.equal(report.provenance.ranAt, '2026-11-03T00:00:00.000Z');
  assert.match(report.provenance.configSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.modelResults.length, 2);
  for (const model of report.modelResults) {
    const declared = input.models.find(candidate => candidate.id === model.id);
    assert.equal(model.metadata.origin, 'synthetic-predictions');
    assert.equal(model.metadata.licenseDeclaration, 'NOASSERTION');
    assert.equal(model.metadata.declaredSizeBytes, declared.declaredSizeBytes);
    assert.equal(model.metadata.sizeEvidence, 'fictional-fixture-declaration');
    assert.equal(model.metadata.measuredModelSizeBytes, null);
    assert.equal(model.metadata.verifiedArtifactSha256, null);
    assert.match(model.metadata.metadataSha256, /^[0-9a-f]{64}$/);
  }
  const alternateBytes = Buffer.from(JSON.stringify(input));
  const reformatted = createRoadReport(input, { inputBytes: alternateBytes });
  assert.notEqual(reformatted.provenance.inputSha256, report.provenance.inputSha256);
  assert.equal(reformatted.provenance.configSha256, report.provenance.configSha256);
  const changed = clone(input);
  changed.evaluation.laneTolerance = 0.1;
  assert.notEqual(createRoadReport(changed, { inputBytes: Buffer.from(JSON.stringify(changed)) }).provenance.configSha256, report.provenance.configSha256);
  const revisedModel = clone(input);
  revisedModel.models[0].version = 'fixture-2';
  revisedModel.models[0].license = 'different-unverified-declaration';
  revisedModel.models[0].declaredSizeBytes += 1;
  const revisedReport = createRoadReport(revisedModel);
  assert.notEqual(revisedReport.modelResults[0].metadata.metadataSha256, report.modelResults[0].metadata.metadataSha256);
  assert.equal(revisedReport.modelResults[1].metadata.metadataSha256, report.modelResults[1].metadata.metadataSha256);
  assert.equal(revisedReport.provenance.configSha256, report.provenance.configSha256);
  assert.equal(revisedReport.modelResults[0].metadata.licenseDeclaration, 'different-unverified-declaration');
  assert.equal(revisedReport.modelResults[0].metadata.measuredModelSizeBytes, null);
  assert.equal(revisedReport.modelResults[0].metadata.verifiedArtifactSha256, null);
  assert.equal(revisedReport.evidence.realModelsExecuted, false);
  assert.throws(() => createRoadReport(input, { inputBytes: Buffer.from(JSON.stringify(changed)) }), /do not match/);
  assert.throws(() => createRoadReport(input, { inputBytes: Buffer.from([0xff]) }));
  assert.throws(() => createRoadReport(input, { ranAt: 'not-a-timestamp' }));
});

test('report rejects caller properties omitted from the JSON evidence it would hash', () => {
  const input = singleFrame(lane(), lane());
  Object.defineProperty(input.evaluation, 'laneTolerance', { value: 0.05, enumerable: false });
  validateRoadBundle(input);
  assert.throws(() => createRoadReport(input));
});

test('checked-in synthetic example remains valid and shows separate reference and sparse candidates', () => {
  const input = JSON.parse(readFileSync(new URL('../benchmark/fixtures/road-model-synthetic.json', import.meta.url), 'utf8'));
  validateRoadBundle(input);
  const result = createRoadReport(input);
  assert.equal(result.evidence.syntheticFixtureOnly, true);
  assert.equal(result.evidence.realModelsExecuted, false);
  assert.equal(result.evidence.onDeviceLatencyMeasured, false);
  assert.equal(result.modelResults.length, input.models.length);
  for (const id of ['lane-reference', 'lead-reference']) {
    const reference = result.modelResults.find(model => model.id === id);
    assert.equal(reference.overall.recall, 1);
    assert.equal(reference.metadata.licenseDeclaration, 'NOASSERTION');
    assert.equal(reference.metadata.measuredModelSizeBytes, null);
  }
  const sparse = result.modelResults.find(model => model.id === 'lane-sparse');
  assert.ok(sparse.overall.coverage < 1);
  assert.ok(sparse.overall.missingPredictions + sparse.overall.unavailablePredictions > 0);
});

test('CLI runs from an unrelated cwd and records the actual runner source hash', () => withTemporaryDirectory(directory => {
  const input = join(directory, 'input.json');
  const output = join(directory, 'report.json');
  const inputBytes = Buffer.from(`${JSON.stringify(bundle(), null, 2)}\n`);
  writeFileSync(input, inputBytes);
  const result = cli(['--input', input, '--split', 'test', '--json', output], directory);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), report);
  assert.equal(report.modelResults[0].overall.frames, 6);
  assert.equal(report.provenance.inputSha256, sha256(inputBytes));
  assert.equal(report.provenance.sourceHashes['benchmark/run-road-model-benchmark.mjs'], sha256(readFileSync(runner)));
  assert.equal(report.provenance.sourceHashes['benchmark/provenance.mjs'], sha256(readFileSync(new URL('../benchmark/provenance.mjs', import.meta.url))));
  assert.match(report.provenance.runnerCommit, /^[0-9a-f]{40}$/);
}));

test('CLI rejects malformed or excluded data without printing a report or creating output', async t => {
  const cases = [
    ['malformed JSON', Buffer.from('{')],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe])],
    ['non-synthetic input', Buffer.from(JSON.stringify({ ...bundle(), kind: 'camera-evaluation' }))],
    ['invalid training row when selecting test', (() => { const input = bundle(); input.clips[1].frames[0].leadVehicle.box = [0, 0, -1, 1]; return Buffer.from(JSON.stringify(input)); })()],
  ];
  for (const [name, bytes] of cases) {
    await t.test(name, () => withTemporaryDirectory(directory => {
      const input = join(directory, 'bad.json');
      const output = join(directory, 'report.json');
      writeFileSync(input, bytes);
      const result = cli(['--input', input, '--split', 'test', '--json', output], directory);
      assert.equal(result.error, undefined, result.error?.message);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
      assert.equal(existsSync(output), false);
    }));
  }
});

test('CLI accepts the exact UTF-8 byte limit and rejects one byte beyond it', () => withTemporaryDirectory(directory => {
  const limit = 2 * 1024 * 1024;
  assert.equal(MAX_INPUT_BYTES, limit);
  const json = Buffer.from(JSON.stringify(singleFrame(lane(), lane())));
  const bounded = Buffer.concat([json, Buffer.alloc(limit - json.length, 0x20)]);
  const input = join(directory, 'bounded.json');
  writeFileSync(input, bounded);
  const accepted = cli(['--input', input], directory);
  assert.equal(accepted.error, undefined, accepted.error?.message);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).provenance.inputSha256, sha256(bounded));
  writeFileSync(input, Buffer.concat([bounded, Buffer.from(' ')]));
  const output = join(directory, 'report.json');
  const rejected = cli(['--input', input, '--json', output], directory);
  assert.equal(rejected.error, undefined, rejected.error?.message);
  assert.notEqual(rejected.status, 0);
  assert.equal(rejected.stdout, '');
  assert.equal(existsSync(output), false);
}));

test('CLI rejects a huge unknown control-character key with a bounded single-line diagnostic', () => withTemporaryDirectory(directory => {
  const input = bundle();
  input[`untrusted-key-${'x'.repeat(20000)}\u001b[31m\n\u0000`] = 'not part of the schema';
  const filename = join(directory, 'bad-key.json');
  const output = join(directory, 'report.json');
  writeFileSync(filename, JSON.stringify(input));
  const result = cli(['--input', filename, '--json', output], directory);
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(output), false);
  assert.match(result.stderr, /^[^\u0000-\u001f\u007f]{1,600}\n$/);
  assert.doesNotMatch(result.stderr, /untrusted-key-/);
}));

test('CLI rejects ambiguous flags and preserves an existing output byte for byte', async t => {
  await withTemporaryDirectory(async directory => {
    const input = join(directory, 'input.json');
    const output = join(directory, 'existing.json');
    writeFileSync(input, JSON.stringify(bundle()));
    const original = 'existing output must survive\n';
    writeFileSync(output, original);
    const overwrite = cli(['--input', input, '--json', output], directory);
    assert.notEqual(overwrite.status, 0);
    assert.equal(overwrite.stdout, '');
    assert.equal(readFileSync(output, 'utf8'), original);
    const flags = [
      [], ['--input'], ['--input', input, '--unknown'],
      ['--input', input, '--input', input], ['--input', input, '--split', 'validation'],
      ['--input', input, '--split', 'test', '--split', 'train'],
      ['--input', input, '--json'], ['--input', input, 'extra-positional'],
    ];
    for (const args of flags) {
      await t.test(JSON.stringify(args), () => {
        const result = cli(args, directory);
        assert.equal(result.error, undefined, result.error?.message);
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, '');
      });
    }
  });
});
