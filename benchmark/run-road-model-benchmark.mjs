import { constants, openSync, fstatSync, readSync, closeSync, writeFileSync, mkdtempSync, linkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentSha256, sourceSnapshot } from './provenance.mjs';

export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const LIGHTING = ['day', 'night', 'dawn-dusk', 'unknown'];
const WEATHER = ['dry', 'rain', 'fog', 'snow', 'unknown'];
const ROUNDING = 8 * Number.EPSILON;
const NOTICE = 'Synthetic fixture contract checks only. No real model, road clip or device inference is executed. Declared licenses, sizes and simulated timings establish no rights, real-road accuracy, device latency or safety result.';
const fail = message => { throw new Error(message); };

function object(value, keys, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(location + ' must be an object');
  const actual = Object.keys(value);
  for (const key of actual) if (!keys.includes(key)) fail(location + ' has unknown field');
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(location + ' is missing ' + key);
}

function text(value, location, maximum = 256) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(location + ' must be nonempty bounded text');
}

function id(value, location) {
  text(value, location, 64);
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value)) fail(location + ' has invalid identifier characters');
}

function number(value, location, minimum, maximum, { integer = false, exclusiveMinimum = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))
    || (exclusiveMinimum ? value <= minimum : value < minimum) || value > maximum) fail(location + ' is outside its numeric bounds');
}

function choice(value, choices, location) {
  if (!choices.includes(value)) fail(location + ' must be one of ' + choices.join(', '));
}

function list(value, location, maximum, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(location + ' has invalid array length');
}

function geometry(value, task, truth, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(location + ' must be an object');
  choice(value.state, truth ? ['present', 'absent', 'unlabeled'] : ['present', 'absent', 'unavailable'], location + '.state');
  if (value.state !== 'present') { object(value, ['state'], location); return; }
  if (task === 'lane') {
    object(value, ['state', 'leftX', 'rightX'], location);
    number(value.leftX, location + '.leftX', 0, 1);
    number(value.rightX, location + '.rightX', 0, 1);
    if (value.leftX >= value.rightX) fail(location + ' lane edges are inverted or empty');
  } else {
    object(value, ['state', 'box'], location);
    list(value.box, location + '.box', 4, 4);
    for (const [index, entry] of value.box.entries()) number(entry, location + '.box[' + index + ']', 0, 1, { exclusiveMinimum: index >= 2 });
    if (value.box[0] + value.box[2] > 1 || value.box[1] + value.box[3] > 1) fail(location + ' box extends outside the normalized image');
    const resolvedWidth = value.box[0] + value.box[2] - value.box[0];
    const resolvedHeight = value.box[1] + value.box[3] - value.box[1];
    if (resolvedWidth <= 0 || resolvedHeight <= 0 || value.box[2] * value.box[3] === 0
      || resolvedWidth * resolvedHeight === 0) fail(location + ' box has nonrepresentable positive extent or area');
  }
}

const frameKey = (clipId, frameId) => clipId + '\0' + frameId;

export function validateRoadBundle(input) {
  object(input, ['schemaVersion', 'kind', 'dataset', 'evaluation', 'models', 'clips', 'predictions'], 'bundle');
  if (input.schemaVersion !== 1 || input.kind !== 'synthetic-road-fixture') fail('Only schemaVersion 1 synthetic-road-fixture bundles are supported');
  object(input.dataset, ['id', 'version', 'origin', 'license'], 'dataset');
  id(input.dataset.id, 'dataset.id');
  text(input.dataset.version, 'dataset.version');
  text(input.dataset.license, 'dataset.license');
  if (input.dataset.origin !== 'hand-authored-synthetic-scalars') fail('dataset.origin must declare hand-authored-synthetic-scalars');
  object(input.evaluation, ['laneReferenceY', 'laneTolerance', 'leadIoUThreshold'], 'evaluation');
  number(input.evaluation.laneReferenceY, 'evaluation.laneReferenceY', 0, 1);
  number(input.evaluation.laneTolerance, 'evaluation.laneTolerance', 0, 1);
  number(input.evaluation.leadIoUThreshold, 'evaluation.leadIoUThreshold', 0, 1, { exclusiveMinimum: true });
  list(input.models, 'models', 8);
  list(input.clips, 'clips', 32);
  list(input.predictions, 'predictions', 8_000, 0);
  const models = new Map(), clips = new Map(), frames = new Map(), groups = new Map();
  for (const model of input.models) {
    object(model, ['id', 'task', 'version', 'origin', 'license', 'declaredSizeBytes'], 'model');
    id(model.id, 'model.id');
    if (models.has(model.id)) fail('Duplicate model ID: ' + model.id);
    choice(model.task, ['lane', 'lead-vehicle'], 'model.task');
    text(model.version, 'model.version');
    text(model.license, 'model.license');
    if (model.origin !== 'synthetic-predictions') fail('model.origin must declare synthetic-predictions');
    number(model.declaredSizeBytes, 'model.declaredSizeBytes', 0, 1_073_741_824, { integer: true });
    models.set(model.id, model);
  }
  let frameCount = 0;
  for (const clip of input.clips) {
    object(clip, ['id', 'sourceGroup', 'split', 'lighting', 'weather', 'durationMs', 'license', 'frames'], 'clip');
    id(clip.id, 'clip.id');
    id(clip.sourceGroup, 'clip.sourceGroup');
    if (clips.has(clip.id)) fail('Duplicate clip ID: ' + clip.id);
    clips.set(clip.id, clip);
    choice(clip.split, ['train', 'test'], 'clip.split');
    choice(clip.lighting, LIGHTING, 'clip.lighting');
    choice(clip.weather, WEATHER, 'clip.weather');
    text(clip.license, 'clip.license');
    number(clip.durationMs, 'clip.durationMs', 0, 3_600_000, { exclusiveMinimum: true });
    if (groups.has(clip.sourceGroup) && groups.get(clip.sourceGroup) !== clip.split) fail('Source group leakage across train/test: ' + clip.sourceGroup);
    groups.set(clip.sourceGroup, clip.split);
    list(clip.frames, 'clip.frames', 1_000);
    frameCount += clip.frames.length;
    if (frameCount > 1_000) fail('Bundle exceeds 1000 frames');
    let previousTime = -1;
    for (const frame of clip.frames) {
      object(frame, ['id', 'atMs', 'lane', 'leadVehicle'], 'frame');
      id(frame.id, 'frame.id');
      const key = frameKey(clip.id, frame.id);
      if (frames.has(key)) fail('Duplicate frame ID in clip: ' + clip.id + '/' + frame.id);
      number(frame.atMs, 'frame.atMs', 0, clip.durationMs);
      if (frame.atMs >= clip.durationMs || frame.atMs <= previousTime) fail('Frame timestamps must be strictly ordered and inside clip duration');
      previousTime = frame.atMs;
      geometry(frame.lane, 'lane', true, 'frame.lane');
      geometry(frame.leadVehicle, 'lead-vehicle', true, 'frame.leadVehicle');
      frames.set(key, frame);
    }
  }
  const seenPredictions = new Set();
  for (const prediction of input.predictions) {
    object(prediction, ['modelId', 'clipId', 'frameId', 'result', 'simulatedLatencyMs'], 'prediction');
    id(prediction.modelId, 'prediction.modelId');
    id(prediction.clipId, 'prediction.clipId');
    id(prediction.frameId, 'prediction.frameId');
    const model = models.get(prediction.modelId);
    if (!model) fail('Prediction references unknown model: ' + prediction.modelId);
    const key = frameKey(prediction.clipId, prediction.frameId);
    if (!frames.has(key)) fail('Prediction references unknown clip/frame: ' + prediction.clipId + '/' + prediction.frameId);
    const combined = prediction.modelId + '\0' + key;
    if (seenPredictions.has(combined)) fail('Duplicate model/frame prediction');
    seenPredictions.add(combined);
    geometry(prediction.result, model.task, false, 'prediction.result');
    if (prediction.simulatedLatencyMs !== null) number(prediction.simulatedLatencyMs, 'prediction.simulatedLatencyMs', 0, 60_000);
  }
  return input;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function iou(a, b) {
  const rightA = a[0] + a[2], bottomA = a[1] + a[3];
  const rightB = b[0] + b[2], bottomB = b[1] + b[3];
  const intersection = Math.max(0, Math.min(rightA, rightB) - Math.max(a[0], b[0]))
    * Math.max(0, Math.min(bottomA, bottomB) - Math.max(a[1], b[1]));
  // Areas and intersection must use identical represented corners. Mixing
  // nominal widths with rounded corners can make tiny identical boxes miss.
  const areaA = (rightA - a[0]) * (bottomA - a[1]);
  const areaB = (rightB - b[0]) * (bottomB - b[1]);
  return intersection / (areaA + areaB - intersection);
}

function matches(truth, result, task, evaluation) {
  if (task === 'lane') {
    const error = Math.max(Math.abs(truth.leftX - result.leftX), Math.abs(truth.rightX - result.rightX));
    return error <= evaluation.laneTolerance || error - evaluation.laneTolerance <= ROUNDING * Math.max(error, evaluation.laneTolerance);
  }
  const overlap = iou(truth.box, result.box), threshold = evaluation.leadIoUThreshold;
  return overlap > 0 && (overlap >= threshold || threshold - overlap <= ROUNDING * Math.max(overlap, threshold));
}

const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

function scoreFrames(clips, model, predictions, evaluation) {
  const counts = { frames: 0, labeledFrames: 0, unlabeledFrames: 0, positiveFrames: 0, negativeFrames: 0,
    coveredLabeledFrames: 0, coveredPositiveFrames: 0, coveredNegativeFrames: 0,
    missingPredictions: 0, unavailablePredictions: 0, unlabeledOutputs: 0,
    truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0,
    falsePositivesOnNegativeFrames: 0, localizationErrors: 0 };
  const latencies = [];
  let missingLatency = 0;
  for (const clip of clips) for (const frame of clip.frames) {
    counts.frames += 1;
    const truth = model.task === 'lane' ? frame.lane : frame.leadVehicle;
    const prediction = predictions.get(frameKey(clip.id, frame.id));
    if (prediction) {
      if (prediction.simulatedLatencyMs === null) missingLatency += 1;
      else latencies.push(prediction.simulatedLatencyMs);
    }
    const result = prediction?.result;
    const covered = result?.state === 'present' || result?.state === 'absent';
    if (!prediction) counts.missingPredictions += 1;
    else if (result.state === 'unavailable') counts.unavailablePredictions += 1;
    if (truth.state === 'unlabeled') {
      counts.unlabeledFrames += 1;
      if (covered) counts.unlabeledOutputs += 1;
      continue;
    }
    counts.labeledFrames += 1;
    if (covered) counts.coveredLabeledFrames += 1;
    if (truth.state === 'present') {
      counts.positiveFrames += 1;
      if (covered) counts.coveredPositiveFrames += 1;
      if (result?.state === 'present' && matches(truth, result, model.task, evaluation)) counts.truePositives += 1;
      else {
        counts.falseNegatives += 1;
        if (result?.state === 'present') { counts.falsePositives += 1; counts.localizationErrors += 1; }
      }
    } else {
      counts.negativeFrames += 1;
      if (covered) counts.coveredNegativeFrames += 1;
      if (result?.state === 'present') { counts.falsePositives += 1; counts.falsePositivesOnNegativeFrames += 1; }
      else if (result?.state === 'absent') counts.trueNegatives += 1;
    }
  }
  return { ...counts,
    coverage: ratio(counts.coveredLabeledFrames, counts.labeledFrames),
    recall: ratio(counts.truePositives, counts.positiveFrames),
    coveredRecall: ratio(counts.truePositives, counts.coveredPositiveFrames),
    precision: ratio(counts.truePositives, counts.truePositives + counts.falsePositives),
    f1: ratio(2 * counts.truePositives, 2 * counts.truePositives + counts.falsePositives + counts.falseNegatives),
    falsePositiveRateOnCoveredNegatives: ratio(counts.falsePositivesOnNegativeFrames, counts.coveredNegativeFrames),
    simulatedLatencyMs: { samples: latencies.length, missing: missingLatency,
      mean: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
      median: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) } };
}

function modelMetadata(model) {
  return { version: model.version, origin: model.origin, licenseDeclaration: model.license,
    declaredSizeBytes: model.declaredSizeBytes, sizeEvidence: 'fictional-fixture-declaration',
    measuredModelSizeBytes: null, verifiedArtifactSha256: null,
    metadataSha256: contentSha256(JSON.stringify({ id: model.id, task: model.task, version: model.version,
      origin: model.origin, license: model.license, declaredSizeBytes: model.declaredSizeBytes })) };
}

function scoreValidated(input, split) {
  choice(split, ['all', 'train', 'test'], 'split');
  const clips = input.clips.filter(clip => split === 'all' || clip.split === split);
  if (!clips.length) fail('No clips selected for split ' + split);
  return input.models.map(model => {
    const predictions = new Map(input.predictions.filter(row => row.modelId === model.id).map(row => [frameKey(row.clipId, row.frameId), row]));
    return { id: model.id, task: model.task, metadata: modelMetadata(model),
      overall: scoreFrames(clips, model, predictions, input.evaluation),
      slices: {
        lighting: LIGHTING.map(value => ({ value, ...scoreFrames(clips.filter(clip => clip.lighting === value), model, predictions, input.evaluation) })),
        weather: WEATHER.map(value => ({ value, ...scoreFrames(clips.filter(clip => clip.weather === value), model, predictions, input.evaluation) })),
      } };
  });
}

export function scoreRoadModels(input, { split = 'all' } = {}) {
  validateRoadBundle(input);
  return scoreValidated(input, split);
}

export function createRoadReport(input, { inputBytes, split = 'all', ranAt = new Date().toISOString() } = {}) {
  validateRoadBundle(input);
  const bytes = inputBytes ?? Buffer.from(JSON.stringify(input));
  if (!(typeof bytes === 'string' || bytes instanceof Uint8Array) || Buffer.byteLength(bytes) > MAX_INPUT_BYTES) fail('inputBytes must be bounded UTF-8 JSON bytes');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(typeof bytes === 'string' ? Buffer.from(bytes) : bytes)); }
  catch { fail('inputBytes must contain valid UTF-8 JSON'); }
  // A report must hash the exact bytes it actually scores, not caller-supplied
  // bytes belonging to another fixture.
  if (JSON.stringify(parsed) !== JSON.stringify(input)) fail('inputBytes do not match the scored bundle');
  validateRoadBundle(parsed);
  // Score the decoded, validated bytes themselves. Non-JSON JavaScript
  // properties can never affect a result whose provenance omits those values.
  const modelResults = scoreValidated(parsed, split);
  if (typeof ranAt !== 'string' || !Number.isFinite(Date.parse(ranAt))) fail('ranAt must be a valid timestamp');
  const config = { laneReferenceY: parsed.evaluation.laneReferenceY, laneTolerance: parsed.evaluation.laneTolerance,
    leadIoUThreshold: parsed.evaluation.leadIoUThreshold, normalizedBox: 'xywh',
    geometryRelativeRoundoffAllowance: ROUNDING, matchingContract: 'road-frame-geometry-v1' };
  return { schemaVersion: 1, kind: 'synthetic-road-contract-report', notice: NOTICE,
    evidence: { syntheticFixtureOnly: true, realModelsExecuted: false, realRoadAccuracyEstablished: false,
      onDeviceLatencyMeasured: false, appIntegrationAuthorized: false },
    dataset: { ...parsed.dataset }, evaluation: config,
    provenance: { ...sourceSnapshot(['run-road-model-benchmark.mjs']), fixtureId: parsed.dataset.id,
      fixtureVersion: parsed.dataset.version, inputSha256: contentSha256(bytes), inputBytes: Buffer.byteLength(bytes),
      configSha256: contentSha256(JSON.stringify(config)), split, nodeVersion: process.version, ranAt },
    modelResults };
}

function readInput(filename) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) fail('Input must be a local regular JSON file');
  const descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MAX_INPUT_BYTES) fail('Input must be a regular file of at most 2 MiB');
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let used = 0, count;
    do {
      count = readSync(descriptor, bytes, used, bytes.length - used, null);
      used += count;
      if (used > MAX_INPUT_BYTES) fail('Input exceeds 2 MiB');
    } while (count > 0);
    if (!used) fail('Input is empty');
    return bytes.subarray(0, used);
  } finally { closeSync(descriptor); }
}

// Publish only a complete report, without replacing any existing file or link.
function writeNewReport(filename, contents) {
  const destination = path.resolve(filename);
  const temporary = mkdtempSync(path.join(path.dirname(destination), '.road-report-'));
  try {
    const staged = path.join(temporary, 'report.json');
    writeFileSync(staged, contents, { flag: 'wx', mode: 0o600 });
    linkSync(staged, destination);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function main(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--input', '--split', '--json'].includes(key) || args.has(key) || !value || value.startsWith('--')) fail('Usage: --input LOCAL_FILE [--split all|train|test] [--json NEW_FILE]; unknown, duplicate or missing argument');
    args.set(key, value);
  }
  if (!args.has('--input')) fail('Usage: --input LOCAL_FILE [--split all|train|test] [--json NEW_FILE]');
  const bytes = readInput(args.get('--input'));
  let input;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('Input must contain valid UTF-8 JSON'); }
  const report = createRoadReport(input, { inputBytes: bytes, split: args.get('--split') ?? 'all' });
  const output = JSON.stringify(report, null, 2) + '\n';
  if (args.has('--json')) writeNewReport(args.get('--json'), output);
  console.log(output.trimEnd());
  console.error(NOTICE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    const message = String(error.message).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 512);
    console.error('Road fixture evaluation failed: ' + message);
    process.exitCode = 1;
  }
}
