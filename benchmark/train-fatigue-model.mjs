// Offline participant-separated training on the scalar feature-window export.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { parseTable } from './csv.mjs';
import { contentSha256 } from './provenance.mjs';
import { createFatigueAlertPolicy } from './fatigue-alert-policy.mjs';

const sandbox = { module: { exports: {} }, URLSearchParams };
vm.runInNewContext(readFileSync(new URL('../src/detection-experiments.js', import.meta.url), 'utf8'), sandbox);
const { fatigueFeatureConfig: config, fatigueModelScore } = sandbox.module.exports;
const features = Array.from(config.windowsMs).flatMap(ms => Array.from(config.fields, key => key + '_' + ms / 1000 + 's'));
const columns = ['session_id', 'participant', 'split', 'end_ms', 'label', ...features];
const penalties = [0.001, 0.01, 0.1, 1];
const thresholds = [0.25, 0.35, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1];
const streaks = [1, 2, 3, 5];
const iterations = 200;
const stepSize = 0.1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

async function loadWindows(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'windows-manifest.json'), 'utf8'));
  const { headers, rows } = parseTable(await readFile(join(directory, 'windows.csv'), 'utf8'));
  if (manifest.featureVersion !== config.version || manifest.stepMs !== config.stepMs ||
      JSON.stringify(manifest.features) !== JSON.stringify(features) || JSON.stringify(headers) !== JSON.stringify(columns))
    throw Error('Incompatible feature-window schema');
  const sessions = new Map(), participants = new Map();
  for (const input of manifest.inputs) {
    const { session_id: id, participant, split, counts, inputHashes } = input;
    if (!id || !participant || sessions.has(id) || !['train', 'test'].includes(split) ||
        !Number.isSafeInteger(counts?.included) || counts.included < 0 ||
        !inputHashes || !['sessions.csv','episodes.csv','comparison.csv','trace-provenance.json'].every(k => Object.hasOwn(inputHashes,k)) ||
        !Object.values(inputHashes).every(hash => /^[0-9a-f]{64}$/.test(hash))) throw Error('Invalid windows input manifest');
    if (participants.has(participant) && participants.get(participant) !== split) throw Error('Participant crosses train and test splits');
    participants.set(participant, split);
    sessions.set(id, { input, rows: [] });
  }
  for (const row of rows) {
    const source = sessions.get(row.session_id);
    if (!source || source.input.participant !== row.participant || source.input.split !== row.split ||
        !['0','1'].includes(row.label)) throw Error('Window contradicts manifest or label contract');
    const end = Number(row.end_ms);
    if (!Number.isSafeInteger(end) || end < Math.max(...config.windowsMs) || end % config.stepMs) throw Error('Invalid window end');
    const values = {};
    for (const key of features) {
      const raw = row[key];
      values[key] = raw === '' ? null : Number(raw);
      if (raw !== '' && (!raw.trim() || !Number.isFinite(values[key]))) throw Error('Invalid numeric window feature');
    }
    source.rows.push({ session: row.session_id, participant: row.participant, end, label: Number(row.label), values });
  }
  const train = [], test = [], hashes = [];
  for (const [id, source] of [...sessions].sort(([a],[b]) => compare(a,b))) {
    const { input, rows: samples } = source;
    samples.sort((a,b) => a.end - b.end);
    if (samples.length !== input.counts.included || samples.some((row,i) => i && row.end === samples[i-1].end))
      throw Error('Window count mismatch or duplicate window');
    const split = input.split === 'train' ? train : test;
    for (const row of samples) split.push(row);
    if (input.split === 'train') {
      // Hash just this training session: test-only edits must never change the model.
      const files = Object.fromEntries(Object.entries(input.inputHashes).sort(([a],[b]) => compare(a,b)));
      hashes.push(contentSha256(JSON.stringify([id, input.participant, files, samples])));
    }
  }
  return { train, test, hashes };
}

function fit(rows, penalty) {
  const n = features.length;
  if (!rows.some(r => r.label === 1) || !rows.some(r => r.label === 0))
    throw Error('Each training fold needs both label classes');
  const means = Array(n).fill(0), sums = Array(n).fill(0), counts = Array(n).fill(0);
  for (const { values } of rows) for (const [i,key] of features.entries()) {
    const x = values[key];
    if (x === null) continue;
    const delta = x - means[i];
    means[i] += delta / ++counts[i];
    sums[i] += delta * (x - means[i]);
  }
  const stds = sums.map((v,i) => counts[i] && v > 0 ? Math.sqrt(v / counts[i]) : 1);
  const samples = rows.map(({label,values}) => ({ label,
    x:features.map((k,i) => values[k] === null ? 0 : (values[k] - means[i]) / stds[i]) }));
  const weights = Array(n).fill(0);
  let bias = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const grad = Array(n).fill(0);
    let biasGrad = 0;
    for (const {label,x} of samples) {
      let z = bias;
      for (let i = 0; i < n; i++) z += weights[i] * x[i];
      const error = 1 / (1 + Math.exp(-z)) - label;
      biasGrad += error;
      for (let i = 0; i < n; i++) grad[i] += error * x[i];
    }
    bias -= stepSize * biasGrad / rows.length;
    for (let i = 0; i < n; i++) weights[i] -= stepSize * (grad[i] / rows.length + penalty * weights[i]);
  }
  return {schemaVersion:1, kind:'fatigue-logreg', featureVersion:config.version, features, means, stds, weights, bias};
}

function scored(rows, model) {
  return rows.map(row => ({ ...row, score:fatigueModelScore(model,row.values) }));
}

function choosePenalty(train) {
  const participants = [...new Set(train.map(r => r.participant))].sort(compare);
  if (participants.length < 2) throw Error('At least two training participants are required');
  let best;
  for (const l2 of penalties) {
    const predictions = [];
    let totalLoss = 0;
    for (const participant of participants) {
      const model = fit(train.filter(r => r.participant !== participant),l2);
      const held = scored(train.filter(r => r.participant === participant),model);
      for (const row of held) {
        predictions.push(row);
        totalLoss -= Math.log(Math.max(Number.EPSILON,row.label ? row.score : 1 - row.score));
      }
    }
    const loss = totalLoss / train.length;
    if (!best || loss < best.loss) best = { l2, loss, predictions };
  }
  return best;
}

// Each retained row contributes one scored second. Gaps break label runs and
// qualifying streaks. Cooldown still follows elapsed time within a session.
export function evaluatePolicy(rows, threshold, consecutiveWindows) {
  let previous, isAlert, hit = false, positives = 0, hits = 0, falseAlerts = 0;
  for (const row of rows) {
    if (row.session !== previous?.session) isAlert = createFatigueAlertPolicy(threshold, consecutiveWindows, config.stepMs);
    const adjacent = previous?.session === row.session && row.end === previous.end + config.stepMs;
    if (row.label && (!adjacent || !previous.label)) { positives++; hit = false; }
    if (isAlert(row.end, row.score)) {
      if (!row.label) falseAlerts++;
      else if (!hit) { hits++; hit = true; }
    }
    previous = row;
  }
  const scoredHours = rows.length * config.stepMs / 3600000;
  return { positiveRuns:positives, detectedRuns:hits, falseAlerts, scoredHours, falseAlertsPerHour:falseAlerts / scoredHours };
}

function choosePolicy(rows, target) {
  let best;
  for (const consecutiveWindows of streaks) for (const threshold of thresholds) {
    const metrics = evaluatePolicy(rows,threshold,consecutiveWindows);
    if (metrics.falseAlertsPerHour > target) continue;
    if (!best || metrics.detectedRuns > best.metrics.detectedRuns ||
        (metrics.detectedRuns === best.metrics.detectedRuns && metrics.falseAlerts < best.metrics.falseAlerts)) {
      best = {threshold, consecutiveWindows, metrics};
    }
  }
  if (!best) throw Error('No candidate policy meets the requested training false-alert rate');
  return best;
}

function windowMetrics(rows, threshold) {
  const sorted = [...rows].sort((a,b) => a.score - b.score);
  let rankSum = 0, positives = 0, predicted = 0, truePositives = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const averageRank = (i + 1 + j) / 2;
    for (const row of sorted.slice(i,j)) {
      positives += row.label;
      rankSum += averageRank * row.label;
      if (row.score >= threshold) { predicted++; truePositives += row.label; }
    }
    i = j;
  }
  const negatives = rows.length - positives;
  return {windows:rows.length, participants:new Set(rows.map(r => r.participant)).size,
    sessions:new Set(rows.map(r => r.session)).size, positiveWindows:positives, negativeWindows:negatives,
    predictedPositive:predicted, truePositives, threshold,
    auc:positives && negatives ? (rankSum - positives * (positives + 1) / 2) / (positives * negatives) : null,
    precision:predicted ? truePositives / predicted : null, recall:positives ? truePositives / positives : null};
}

export async function trainFatigueModel(directory, output, target) {
  if (!Number.isFinite(target) || target < 0) throw Error('Supply a nonnegative target false alerts per hour');
  const {train,test,hashes} = await loadWindows(directory);
  const {l2,loss,predictions} = choosePenalty(train);
  const policy = choosePolicy(predictions,target);
  const model = { ...fit(train,l2), threshold:policy.threshold, consecutiveWindows:policy.consecutiveWindows,
    training:{inputSha256:hashes, windows:train.length, participants:new Set(train.map(r=>r.participant)).size,
      sessions:new Set(train.map(r=>r.session)).size, positives:train.reduce((count,r)=>count+r.label,0),
      l2,iterations,stepSize,targetFalseAlertsPerHour:target,meanValidationLogLoss:loss,crossValidation:policy.metrics},
    validated:false };
  const metrics = windowMetrics(scored(test,model),model.threshold);
  await mkdir(dirname(output),{recursive:true});
  await mkdir(output);
  try {
    await writeFile(join(output,'model.json'),JSON.stringify(model,null,2)+'\n');
    await writeFile(join(output,'test-metrics.json'),JSON.stringify(metrics,null,2)+'\n');
  } catch (error) {
    await rm(output,{recursive:true,force:true});
    throw error;
  }
  return {model,metrics};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory,targetOption,raw,outOption,output,...extra] = process.argv.slice(2);
  if (!directory || targetOption !== '--target-false-alerts-per-hour' || !raw?.trim() || outOption !== '--out' || !output || extra.length)
    throw Error('Usage: node benchmark/train-fatigue-model.mjs WINDOWS --target-false-alerts-per-hour N --out NEW_DIRECTORY');
  const {metrics} = await trainFatigueModel(directory,output,Number(raw));
  console.log(JSON.stringify(metrics));
}
