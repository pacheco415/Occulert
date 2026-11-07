// Task 4.1: replay exported observation timelines under camera-only and
// camera-plus-corroboration cue policies, then score both with the existing
// event scorer. Corroboration may only ADD cues; every camera alert is kept.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scoreByDetector, scoreEvents, validateInput } from './run-event-benchmark.mjs';
import { contentSha256, sourceSnapshot } from './provenance.mjs';

export const SCHEMA = 'occulert.corroboration-timeline';
export const SCHEMA_VERSION = 1;
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
// Mirrors native-app/lib/sensorFusionObservation.ts and native-app/constants/thresholds.ts.
// scripts/test-corroboration-replay.mjs fails if either native value changes alone.
export const DEFAULT_POLICY = Object.freeze({ windowMs: 5_000, refractoryMs: 8_000, minSources: 1 });
export const ACCESSORY_SOURCES = Object.freeze(['headphone', 'road', 'watch']);
// Candidate kinds that exist or are proposed in the roadmap. Watch has none yet
// (Task 4.2 records freshness only), so Watch coverage is reported but can never corroborate.
export const OBSERVATION_KINDS = Object.freeze({
  camera: Object.freeze(['elevated', 'head_nod']),
  headphone: Object.freeze(['head_nod']),
  road: Object.freeze(['lane_departure', 'closing_distance']),
  watch: Object.freeze([]),
});
const NOTICE = 'Corroboration replay scores exported cue timestamps against independent labels. It establishes no on-road safety, causality or alert-delivery result, and a synthetic fixture establishes no accuracy result at all.';
const MAX_SESSIONS = 10_000, MAX_SESSION_MS = 12 * 3_600_000, MAX_ROWS = 20_000;
const fail = message => { throw new Error(message); };

function object(value, keys, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${location} must be an object`);
  // Unknown fields are refused so a timeline cannot carry raw motion, health
  // readings, coordinates, media references or names alongside the timestamps.
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${location} has unknown field ${JSON.stringify(key)}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${location} is missing ${key}`);
}
function id(value, location) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(value)) fail(`${location} must be a pseudonymous identifier`);
}
function choice(value, choices, location) {
  if (!choices.includes(value)) fail(`${location} must be one of ${choices.join(', ')}`);
}
function ms(value, location, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`${location} must be an integer millisecond offset within the session`);
}
function list(value, location, maximum = MAX_ROWS) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${location} must be an array of at most ${maximum} entries`);
}
function intervals(value, location, durationMs) {
  list(value, location);
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) fail(`${location}[${index}] must be [startMs, endMs]`);
    const [startMs, endMs] = entry;
    ms(startMs, `${location}[${index}][0]`, durationMs);
    ms(endMs, `${location}[${index}][1]`, durationMs);
    if (endMs <= startMs) fail(`${location}[${index}] must end after it starts`);
    return { start_ms: startMs, end_ms: endMs };
  });
}

export function validateTimeline(input) {
  object(input, ['schema', 'version', 'kind', 'dataset', 'sessions'], 'timeline');
  if (input.schema !== SCHEMA || input.version !== SCHEMA_VERSION) fail(`Only ${SCHEMA} version ${SCHEMA_VERSION} is supported`);
  choice(input.kind, ['synthetic-fixture', 'labeled-export'], 'kind');
  object(input.dataset, ['id', 'version', 'labelSource'], 'dataset');
  id(input.dataset.id, 'dataset.id');
  id(input.dataset.version, 'dataset.version');
  choice(input.dataset.labelSource, input.kind === 'synthetic-fixture' ? ['synthetic'] : ['independent-annotation'], 'dataset.labelSource');
  list(input.sessions, 'sessions', MAX_SESSIONS);
  if (!input.sessions.length) fail('sessions must not be empty');
  const seen = new Set();
  for (const [index, session] of input.sessions.entries()) {
    const at = `sessions[${index}]`;
    object(session, ['sessionId', 'participant', 'split', 'platform', 'detectorVersion', 'collection', 'consentVersion',
      'durationMs', 'tracking', 'accessories', 'observations', 'alerts', 'episodes'], at);
    id(session.sessionId, `${at}.sessionId`);
    if (seen.has(session.sessionId)) fail(`Duplicate sessionId: ${session.sessionId}`);
    seen.add(session.sessionId);
    id(session.participant, `${at}.participant`);
    choice(session.split, ['train', 'test'], `${at}.split`);
    choice(session.platform, ['web', 'ios', 'android'], `${at}.platform`);
    if (typeof session.detectorVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(session.detectorVersion)) {
      fail(`${at}.detectorVersion must be a bounded detector version`);
    }
    // The roadmap allows parked or passenger collection only; never a drowsy driver on the road.
    choice(session.collection, ['parked', 'passenger'], `${at}.collection`);
    id(session.consentVersion, `${at}.consentVersion`);
    if (input.kind === 'synthetic-fixture' ? session.consentVersion !== 'synthetic' : session.consentVersion === 'synthetic') {
      fail(`${at}.consentVersion must be "synthetic" only in synthetic fixtures`);
    }
    if (!Number.isSafeInteger(session.durationMs) || session.durationMs <= 0 || session.durationMs > MAX_SESSION_MS) fail(`${at}.durationMs is outside its bounds`);
    intervals(session.tracking, `${at}.tracking`, session.durationMs);
    if (!session.accessories || typeof session.accessories !== 'object' || Array.isArray(session.accessories)) fail(`${at}.accessories must be an object`);
    for (const source of Object.keys(session.accessories)) {
      choice(source, ACCESSORY_SOURCES, `${at}.accessories key`);
      intervals(session.accessories[source], `${at}.accessories.${source}`, session.durationMs);
    }
    list(session.observations, `${at}.observations`);
    for (const [row, observation] of session.observations.entries()) {
      object(observation, ['atMs', 'source', 'kind'], `${at}.observations[${row}]`);
      ms(observation.atMs, `${at}.observations[${row}].atMs`, session.durationMs);
      choice(observation.source, Object.keys(OBSERVATION_KINDS), `${at}.observations[${row}].source`);
      if (!OBSERVATION_KINDS[observation.source].length) fail(`${at}.observations[${row}]: no ${observation.source} candidate kind is defined`);
      choice(observation.kind, OBSERVATION_KINDS[observation.source], `${at}.observations[${row}].kind`);
    }
    list(session.alerts, `${at}.alerts`);
    for (const [row, alert] of session.alerts.entries()) {
      object(alert, ['atMs', 'level'], `${at}.alerts[${row}]`);
      ms(alert.atMs, `${at}.alerts[${row}].atMs`, session.durationMs);
      choice(alert.level, ['watch', 'alert', 'critical'], `${at}.alerts[${row}].level`);
    }
    list(session.episodes, `${at}.episodes`);
    for (const [row, episode] of session.episodes.entries()) {
      object(episode, ['startMs', 'endMs', 'label'], `${at}.episodes[${row}]`);
      ms(episode.startMs, `${at}.episodes[${row}].startMs`, session.durationMs);
      ms(episode.endMs, `${at}.episodes[${row}].endMs`, session.durationMs);
      if (episode.endMs <= episode.startMs) fail(`${at}.episodes[${row}] must end after it starts`);
      choice(episode.label, ['drowsy', 'high_fatigue'], `${at}.episodes[${row}].label`);
    }
  }
  // Participant leakage across train/test and overlapping episodes use the event scorer's own rules.
  validateInput(toEventInput(input.sessions, session => session.alerts.map(alert => alert.atMs)));
  return input;
}

function toEventInput(sessions, alertsFor) {
  const event = { sessions: [], tracking: [], episodes: [], alerts: [] };
  for (const session of sessions) {
    event.sessions.push({ session_id: session.sessionId, participant: session.participant, platform: session.platform,
      detector_version: session.detectorVersion, duration_ms: session.durationMs, split: session.split });
    for (const [start_ms, end_ms] of session.tracking) event.tracking.push({ session_id: session.sessionId, start_ms, end_ms });
    for (const { startMs, endMs, label } of session.episodes) event.episodes.push({ session_id: session.sessionId, start_ms: startMs, end_ms: endMs, label });
    for (const at_ms of alertsFor(session)) event.alerts.push({ session_id: session.sessionId, at_ms });
  }
  return event;
}

function merge(rows) {
  const merged = [];
  for (const [start, end] of [...rows].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
const covers = (coverage, at) => coverage.some(([start, end]) => start <= at && at < end);
const containsInterval = (coverage, start, end) => coverage.some(([from, to]) => from <= start && to >= end);
const intersectionMs = (left, right) => left.reduce((sum, [a, b]) => sum
  + right.reduce((inner, [c, d]) => inner + Math.max(0, Math.min(b, d) - Math.max(a, c)), 0), 0);
export const accessoryKey = session => ['camera', ...ACCESSORY_SOURCES.filter(source => session.accessories[source]?.length)].join('+');

export function resolvePolicy(overrides = {}) {
  const policy = { ...DEFAULT_POLICY, ...overrides };
  if (!Number.isSafeInteger(policy.windowMs) || policy.windowMs < 0 || policy.windowMs > 60_000) fail('windowMs must be 0-60000');
  if (!Number.isSafeInteger(policy.refractoryMs) || policy.refractoryMs < 0 || policy.refractoryMs > 300_000) fail('refractoryMs must be 0-300000');
  if (!Number.isSafeInteger(policy.minSources) || policy.minSources < 1 || policy.minSources > ACCESSORY_SOURCES.length) fail(`minSources must be 1-${ACCESSORY_SOURCES.length}`);
  return Object.freeze({ ...policy, defaults: Object.keys(DEFAULT_POLICY).every(key => policy[key] === DEFAULT_POLICY[key]) });
}

/**
 * Proposed add-only cue for one session. A camera candidate observed while the
 * camera was usable is corroborated when at least `minSources` independent
 * accessory sources each report a candidate within `windowMs` of it, while that
 * accessory was usable. The cue fires when the last required signal arrives.
 * Each accessory candidate is used at most once. A cue within `refractoryMs`
 * after any earlier camera alert or added cue is dropped, mirroring the released
 * cooldown. Camera alerts themselves are never removed or moved.
 */
export function corroborateSession(session, policy = resolvePolicy()) {
  const tracking = merge(session.tracking);
  const coverage = Object.fromEntries(ACCESSORY_SOURCES.map(source => [source, merge(session.accessories[source] ?? [])]));
  const byTime = (a, b) => a.atMs - b.atMs;
  const camera = session.observations.filter(row => row.source === 'camera' && covers(tracking, row.atMs)).sort(byTime);
  const accessory = session.observations
    .filter(row => row.source !== 'camera' && covers(coverage[row.source], row.atMs))
    .map((row, index) => ({ ...row, index })).sort(byTime);
  const used = new Set(), candidates = [];
  let low = 0;
  for (const cameraRow of camera) {
    // Camera rows ascend, so the window's lower bound only moves forward.
    while (low < accessory.length && accessory[low].atMs < cameraRow.atMs - policy.windowMs) low += 1;
    const earliest = new Map();
    for (let next = low; next < accessory.length && accessory[next].atMs <= cameraRow.atMs + policy.windowMs; next += 1) {
      const row = accessory[next];
      if (!used.has(row.index) && !earliest.has(row.source)) earliest.set(row.source, row);
    }
    if (earliest.size < policy.minSources) continue;
    const chosen = [...earliest.values()].sort(byTime).slice(0, policy.minSources);
    for (const row of chosen) used.add(row.index);
    candidates.push({ atMs: Math.max(cameraRow.atMs, chosen.at(-1).atMs), sources: chosen.map(row => row.source).sort() });
  }
  const cameraAlerts = session.alerts.map(alert => alert.atMs).sort((a, b) => a - b);
  const added = [];
  let dropped = 0, cameraIndex = 0, lastPrior = Number.NEGATIVE_INFINITY;
  for (const cue of candidates.sort(byTime)) {
    while (cameraIndex < cameraAlerts.length && cameraAlerts[cameraIndex] <= cue.atMs) lastPrior = Math.max(lastPrior, cameraAlerts[cameraIndex++]);
    // A cue at the same instant as an existing alert adds nothing, even with no cooldown.
    if (cue.atMs - lastPrior < policy.refractoryMs || cue.atMs === lastPrior) { dropped += 1; continue; }
    added.push(cue);
    lastPrior = cue.atMs;
  }
  return { added, pairs: candidates.length, dropped, cameraAlerts };
}

function firstAlertDelay(episode, alerts) {
  const inside = alerts.filter(at => at >= episode.startMs && at < episode.endMs);
  return inside.length ? Math.min(...inside) - episode.startMs : null;
}
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
};

function compareGroup(rows) {
  const cameraOnly = toEventInput(rows.map(row => row.session), session => session.alerts.map(alert => alert.atMs));
  const corroborated = toEventInput(rows.map(row => row.session), session => {
    const replay = rows.find(row => row.session === session).replay;
    return [...replay.cameraAlerts, ...replay.added.map(cue => cue.atMs)];
  });
  let newlyDetected = 0, earlier = 0, addedCues = 0, addedOutsideEpisodes = 0, pairs = 0, dropped = 0;
  const gains = [];
  for (const { session, replay } of rows) {
    pairs += replay.pairs; dropped += replay.dropped; addedCues += replay.added.length;
    const tracking = merge(session.tracking);
    const corroboratedAlerts = [...replay.cameraAlerts, ...replay.added.map(cue => cue.atMs)];
    for (const episode of session.episodes) {
      if (!containsInterval(tracking, episode.startMs, episode.endMs)) continue;
      const before = firstAlertDelay(episode, replay.cameraAlerts), after = firstAlertDelay(episode, corroboratedAlerts);
      if (before === null && after !== null) newlyDetected += 1;
      else if (before !== null && after < before) { earlier += 1; gains.push(before - after); }
    }
    for (const cue of replay.added) {
      if (covers(tracking, cue.atMs) && !session.episodes.some(episode => cue.atMs >= episode.startMs && cue.atMs < episode.endMs)) addedOutsideEpisodes += 1;
    }
  }
  const single = new Set(rows.map(({ session }) => `${session.platform} / ${session.detectorVersion}`)).size === 1;
  return {
    sessions: rows.length,
    participants: new Set(rows.map(({ session }) => session.participant)).size,
    cameraOnly: { overall: single ? scoreEvents(cameraOnly) : null, detectors: scoreByDetector(cameraOnly) },
    corroborated: { overall: single ? scoreEvents(corroborated) : null, detectors: scoreByDetector(corroborated) },
    delta: { corroborationPairs: pairs, addedCues, droppedByRefractory: dropped, addedCuesOutsideEpisodes: addedOutsideEpisodes,
      newlyDetectedEpisodes: newlyDetected, earlierEpisodes: earlier, medianEarlierByMs: median(gains) },
  };
}

function coverageReport(sessions) {
  const trackedMs = sessions.reduce((sum, session) => sum + intersectionMs(merge(session.tracking), [[0, session.durationMs]]), 0);
  return Object.fromEntries(ACCESSORY_SOURCES.map(source => {
    let coveredTrackedMs = 0, sessionsWithCoverage = 0, fullyCoveredEpisodes = 0, candidates = 0;
    for (const session of sessions) {
      const tracking = merge(session.tracking), coverage = merge(session.accessories[source] ?? []);
      if (coverage.length) sessionsWithCoverage += 1;
      coveredTrackedMs += intersectionMs(tracking, coverage);
      candidates += session.observations.filter(row => row.source === source && covers(coverage, row.atMs)).length;
      fullyCoveredEpisodes += session.episodes.filter(episode => containsInterval(tracking, episode.startMs, episode.endMs)
        && containsInterval(coverage, episode.startMs, episode.endMs)).length;
    }
    return [source, { sessionsWithCoverage, coveredTrackedHours: coveredTrackedMs / 3_600_000,
      fractionOfTrackedTime: trackedMs ? coveredTrackedMs / trackedMs : null, fullyCoveredEpisodes, candidatesDuringCoverage: candidates }];
  }));
}

// Task 4.3 may start only if held-out labeled data shows fewer missed or later
// events without more false alerts. This reports that necessary condition; it is
// not sufficient on its own (sample size and owner review still apply).
function task43StartCondition(input, split, overall) {
  if (input.kind !== 'labeled-export') return { evaluable: false, reason: 'Synthetic fixture: no accuracy evidence.', perDetector: null };
  if (split !== 'test') return { evaluable: false, reason: 'Only the held-out test split can support Task 4.3.', perDetector: null };
  const perDetector = Object.fromEntries(Object.keys(overall.cameraOnly.detectors).map(key => {
    const before = overall.cameraOnly.detectors[key], after = overall.corroborated.detectors[key];
    const fewerMissed = after.missedFullyTrackedEpisodes < before.missedFullyTrackedEpisodes;
    const earlierMedian = before.medianAlertDelayMs !== null && after.medianAlertDelayMs !== null && after.medianAlertDelayMs < before.medianAlertDelayMs;
    const noMoreFalseAlerts = after.falseAlerts <= before.falseAlerts;
    return [key, { fullyTrackedEpisodes: before.fullyTrackedEpisodes, fewerMissed, earlierMedian, noMoreFalseAlerts,
      meetsNecessaryCondition: (fewerMissed || earlierMedian) && noMoreFalseAlerts }];
  }));
  return { evaluable: true, reason: null, perDetector };
}

export function replayCorroboration(input, { split = 'all', policy: overrides = {} } = {}) {
  validateTimeline(input);
  choice(split, ['all', 'train', 'test'], 'split');
  const policy = resolvePolicy(overrides);
  const sessions = input.sessions.filter(session => split === 'all' || session.split === split);
  if (!sessions.length) fail(`No sessions in split ${split}`);
  const rows = sessions.map(session => ({ session, replay: corroborateSession(session, policy) }));
  for (const { session, replay } of rows) {
    // Add-only invariant: the corroborated stream must contain every camera alert unchanged.
    const stream = [...replay.cameraAlerts, ...replay.added.map(cue => cue.atMs)];
    if (!session.alerts.every(alert => stream.includes(alert.atMs))) fail('Internal error: a camera alert was suppressed');
  }
  const groups = new Map();
  for (const row of rows) groups.set(accessoryKey(row.session), [...(groups.get(accessoryKey(row.session)) ?? []), row]);
  const overall = compareGroup(rows);
  return {
    kind: input.kind,
    dataset: { id: input.dataset.id, version: input.dataset.version, labelSource: input.dataset.labelSource },
    split,
    policy,
    cameraAlertsPreserved: true,
    overall,
    byAccessories: Object.fromEntries([...groups.keys()].sort().map(key => [key, compareGroup(groups.get(key))])),
    coverage: coverageReport(sessions),
    task43StartCondition: task43StartCondition(input, split, overall),
    notice: NOTICE,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const integer = name => arg(name) === undefined ? undefined : Number(arg(name));
  const inputPath = arg('--input');
  if (!inputPath) {
    console.error('Usage: node benchmark/run-corroboration-replay.mjs --input timeline.json [--split all|train|test] [--window-ms 5000] [--refractory-ms 8000] [--min-sources 1] [--json results.json]');
    process.exit(2);
  }
  if (statSync(inputPath).size > MAX_INPUT_BYTES) fail(`Input exceeds ${MAX_INPUT_BYTES} bytes`);
  const bytes = readFileSync(inputPath);
  const overrides = Object.fromEntries([['windowMs', integer('--window-ms')], ['refractoryMs', integer('--refractory-ms')], ['minSources', integer('--min-sources')]]
    .filter(([, value]) => value !== undefined));
  const report = replayCorroboration(JSON.parse(bytes.toString('utf8')), { split: arg('--split') ?? 'all', policy: overrides });
  const result = { provenance: { ...sourceSnapshot(['run-event-benchmark.mjs', 'run-corroboration-replay.mjs']),
    input: { path: inputPath, sha256: contentSha256(bytes) }, ranAt: new Date().toISOString() }, ...report };
  const text = `${JSON.stringify(result, null, 2)}\n`;
  console.log(text.trimEnd());
  console.error(NOTICE);
  // 'wx' refuses to overwrite an earlier report.
  if (arg('--json')) writeFileSync(arg('--json'), text, { encoding: 'utf8', flag: 'wx' });
}
