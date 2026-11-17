// Model inputs from local parked exports and independent observer labels.
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { parseTable } from './csv.mjs';
import { parseFile, validateInput } from './run-event-benchmark.mjs';
import { validateComparisonRows } from './detection-comparison.mjs';
import { toCsv } from './prepare-dataset.mjs';
import { contentSha256, sourceSnapshot } from './provenance.mjs';

const source = readFileSync(new URL('../src/detection-experiments.js', import.meta.url));
const sandbox = { module: { exports: {} }, URLSearchParams };
vm.runInNewContext(source.toString(), sandbox);
const { createFatigueFeatureWindow, fatigueFeatureConfig: config } = sandbox.module.exports;
const features = config.windowsMs.flatMap(ms => config.fields.map(name => name + '_' + ms / 1000 + 's'));
const longestWindowMs = Math.max(...config.windowsMs);
const firstTick = longestWindowMs / config.stepMs;
const sessionFields = ['session_id', 'participant', 'split', 'end_ms', 'label'];
const measurementFields = ['frame_id', 'at_ms', 'smoothed_ear', 'legacy_usable', 'calibrating',
  'tasks_usable', 'eye_blink_left', 'eye_blink_right', 'pitch_down'];

async function loadDirectory(directory) {
  const inputHashes = {};
  async function read(name) {
    const bytes = await readFile(join(directory, name));
    inputHashes[name] = contentSha256(bytes);
    return bytes.toString('utf8');
  }
  const sessions = parseFile(await read('sessions.csv'), 'sessions');
  if (sessions.length !== 1 || sessions[0].platform !== 'web' || !['train','test'].includes(sessions[0].split)) {
    throw Error('Expected a single parked web session with an explicit participant split');
  }
  const session = sessions[0];
  const episodes = parseFile(await read('episodes.csv'), 'episodes');
  validateInput({ sessions, episodes, tracking: [], alerts: [] });
  const provenance = JSON.parse(await read('trace-provenance.json'));
  if (!Array.isArray(provenance.experimentFlags) || !['normalized','pixels-reference-3x4'].includes(provenance.geometryUnits)) {
    throw Error('Missing parked source geometry or experiment flags');
  }
  const table = parseTable(await read('comparison.csv'));
  for (const name of ['session_id', ...measurementFields]) {
    if (!table.headers.includes(name)) throw Error('Missing comparison field ' + name);
  }
  validateComparisonRows(table.rows, sessions);
  let yawnRows;
  try { yawnRows = parseTable(await read('accepted-yawns.csv')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (yawnRows && (yawnRows.headers.join(',') !== 'session_id,frame_id,accepted_yawn' || yawnRows.rows.length !== table.rows.length)) {
    throw Error('Accepted-yawn evidence must align with the retained frames');
  }
  const frames = table.rows.map((row, i) => {
    const point = {};
    for (const name of measurementFields) point[name] = row[name] === '' ? null : Number(row[name]);
    const yawn = yawnRows?.rows[i];
    if (yawn && (yawn.session_id !== row.session_id || yawn.frame_id !== row.frame_id || !['', '0', '1'].includes(yawn.accepted_yawn))) {
      throw Error('Invalid accepted-yawn evidence');
    }
    point.accepted_yawn = yawn?.accepted_yawn ? Number(yawn.accepted_yawn) : null;
    if (!provenance.experimentFlags.includes('tasks') && point.tasks_usable ||
        !provenance.experimentFlags.includes('pitch') && point.pitch_down) throw Error('Feature frame contradicts experiment flags');
    return point;
  });
  return { session, episodes, frames, provenance, inputHashes };
}

export async function writeFeatureWindows(inputs, output) {
  if (!inputs.length) throw Error('Provide at least one parked input directory');
  const sessions = [];
  for (const directory of inputs) sessions.push(await loadDirectory(directory));
  validateInput({ sessions: sessions.map(input => input.session), episodes: [],
    tracking: [], alerts: [] });
  const rows = [], details = [];
  const totals = { warmup: 0, lowUsableFraction: 0, included: 0 };
  for (const { session, episodes, frames, provenance, inputHashes } of sessions) {
    const { session_id, participant, split } = session;
    const extractor = createFatigueFeatureWindow({ pixels: provenance.geometryUnits === 'pixels-reference-3x4',
      pitch: provenance.experimentFlags.includes('pitch') });
    const ticks = Math.floor(session.duration_ms / config.stepMs);
    if (!Number.isSafeInteger(ticks)) throw Error('Invalid session tick count');
    const warmup = Math.min(firstTick - 1, ticks);
    const counts = { warmup, lowUsableFraction: 0, included: 0 };
    let index = 0;
    for (let tick = firstTick; tick <= ticks; tick++) {
      const end = tick * config.stepMs;
      while (index < frames.length && frames[index].at_ms < end) extractor.add(frames[index++]);
      // Skip long empty spans, counting exactly the same low-coverage windows.
      if (!index || end - frames[index - 1].at_ms > longestWindowMs) {
        const lastEmpty = index === frames.length ? ticks : Math.min(ticks, Math.floor(frames[index].at_ms / config.stepMs));
        counts.lowUsableFraction += lastEmpty - tick + 1;
        tick = lastEmpty;
        continue;
      }
      const featureRow = extractor.at(end);
      if (config.windowsMs.some(ms => featureRow['usable_fraction_' + ms / 1000 + 's'] < config.minUsableFraction)) {
        counts.lowUsableFraction++;
        continue;
      }
      const label = Number(episodes.some(episode => end >= episode.start_ms && end < episode.end_ms));
      rows.push({ session_id, participant, split, end_ms: end, label, ...featureRow });
      counts.included++;
    }
    details.push({ session_id, participant, split, detector_version: session.detector_version, inputHashes, counts });
    for (const key of Object.keys(totals)) totals[key] += counts[key];
  }
  const manifest = { featureVersion: config.version, features, stepMs: config.stepMs, minUsableFraction: config.minUsableFraction,
    inputs: details, counts: totals, featureSourceSha256: contentSha256(source),
    ...sourceSnapshot(['feature-windows.mjs','parked-detection-trace.mjs','run-event-benchmark.mjs','detection-comparison.mjs']) };
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  try {
    await writeFile(join(output, 'windows.csv'), toCsv([...sessionFields, ...features], rows) + '\n');
    await writeFile(join(output, 'windows-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length < 3 || args.at(-2) !== '--out' || args.slice(0, -2).some(arg => arg.startsWith('--'))) {
    throw Error('Usage: node benchmark/feature-windows.mjs parked-directory [...] --out fresh-directory');
  }
  const manifest = await writeFeatureWindows(args.slice(0, -2), args.at(-1));
  console.log(JSON.stringify(manifest.counts));
}
