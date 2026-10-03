import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTable } from './csv.mjs';
import { contentSha256, sourceSnapshot } from './provenance.mjs';

const EPISODE_LABELS = new Set(['drowsy', 'high_fatigue']);
const PLATFORMS = new Set(['web', 'ios', 'android']);
const REQUIRED = {
  sessions: ['session_id', 'participant', 'platform', 'detector_version', 'duration_ms'],
  tracking: ['session_id', 'start_ms', 'end_ms'],
  episodes: ['session_id', 'start_ms', 'end_ms', 'label'],
  alerts: ['session_id', 'at_ms'],
};

function positiveNumber(value, field, line, { allowZero = false } = {}) {
  if (value === undefined || String(value).trim() === '') throw new Error(`${field} missing on record ${line}`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    throw new Error(`${field} must be ${allowZero ? 'non-negative' : 'positive'} on record ${line}`);
  }
  return number;
}

export function parseFile(text, kind) {
  const required = REQUIRED[kind];
  if (!required) throw new Error(`Unknown input kind: ${kind}`);
  const table = parseTable(text);
  const headers = table.headers.map(header => header.toLowerCase());
  for (const field of required) if (!headers.includes(field)) throw new Error(`${kind} CSV must contain ${field}`);
  const rows = table.rows.map((source, index) => {
    const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
    if (!String(row.session_id).trim()) throw new Error(`session_id missing on record ${index + 2}`);
    if (kind === 'sessions') {
      for (const field of ['participant', 'platform', 'detector_version']) {
        if (!String(row[field]).trim()) throw new Error(`${field} missing on record ${index + 2}`);
      }
      if (!PLATFORMS.has(row.platform)) throw new Error(`Invalid platform on record ${index + 2}`);
      row.duration_ms = positiveNumber(row.duration_ms, 'duration_ms', index + 2);
      if (row.split && row.split !== 'train' && row.split !== 'test') throw new Error(`Invalid split on record ${index + 2}`);
    } else if (kind === 'alerts') {
      row.at_ms = positiveNumber(row.at_ms, 'at_ms', index + 2, { allowZero: true });
    } else {
      row.start_ms = positiveNumber(row.start_ms, 'start_ms', index + 2, { allowZero: true });
      row.end_ms = positiveNumber(row.end_ms, 'end_ms', index + 2);
      if (row.end_ms <= row.start_ms) throw new Error(`end_ms must be after start_ms on record ${index + 2}`);
      if (kind === 'episodes' && !EPISODE_LABELS.has(row.label)) throw new Error(`Invalid episode label on record ${index + 2}`);
    }
    return row;
  });
  return rows;
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of [...intervals].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms)) {
    const previous = merged.at(-1);
    if (previous && interval.start_ms <= previous.end_ms) previous.end_ms = Math.max(previous.end_ms, interval.end_ms);
    else merged.push({ start_ms: interval.start_ms, end_ms: interval.end_ms });
  }
  return merged;
}

function contained(interval, coverage) {
  return coverage.some(item => item.start_ms <= interval.start_ms && item.end_ms >= interval.end_ms);
}

function trackedAt(time, coverage) {
  return coverage.some(item => item.start_ms <= time && time < item.end_ms);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export function validateInput({ sessions, tracking, episodes, alerts }) {
  const byId = new Map();
  const splitByParticipant = new Map();
  const anySplit = sessions.some(session => Object.hasOwn(session, 'split'));
  for (const session of sessions) {
    if (byId.has(session.session_id)) throw new Error(`Duplicate session_id: ${session.session_id}`);
    byId.set(session.session_id, session);
    if (anySplit) {
      if (session.split !== 'train' && session.split !== 'test') throw new Error(`Missing train/test split for ${session.session_id}`);
      const previous = splitByParticipant.get(session.participant);
      if (previous && previous !== session.split) throw new Error(`Participant leakage across train/test: ${session.participant}`);
      splitByParticipant.set(session.participant, session.split);
    }
  }
  for (const [kind, rows] of Object.entries({ tracking, episodes, alerts })) {
    for (const row of rows) {
      const session = byId.get(row.session_id);
      if (!session) throw new Error(`${kind} refers to unknown session ${row.session_id}`);
      const end = kind === 'alerts' ? row.at_ms : row.end_ms;
      if (end > session.duration_ms) throw new Error(`${kind} is outside session ${row.session_id}`);
    }
  }
  const eventsBySession = new Map();
  for (const episode of episodes) {
    const previous = eventsBySession.get(episode.session_id) ?? [];
    previous.push(episode);
    eventsBySession.set(episode.session_id, previous);
  }
  for (const [sessionId, rows] of eventsBySession) {
    const sorted = [...rows].sort((a, b) => a.start_ms - b.start_ms);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].start_ms < sorted[index - 1].end_ms) throw new Error(`Overlapping episodes in session ${sessionId}`);
    }
  }
}

export function selectSessions(input, split) {
  validateInput(input);
  if (!split) return input;
  if (split !== 'train' && split !== 'test') throw new Error('Requested split must be train or test');
  if (!input.sessions.some(session => Object.hasOwn(session, 'split'))) throw new Error(`--split ${split} requires a split column`);
  const sessions = input.sessions.filter(session => session.split === split);
  const selected = new Set(sessions.map(session => session.session_id));
  return {
    sessions,
    tracking: input.tracking.filter(row => selected.has(row.session_id)),
    episodes: input.episodes.filter(row => selected.has(row.session_id)),
    alerts: input.alerts.filter(row => selected.has(row.session_id)),
  };
}

export function scoreEvents(input) {
  validateInput(input);
  let durationMs = 0;
  let trackedMs = 0;
  let fullyTrackedEpisodes = 0;
  let detectedEpisodes = 0;
  let insufficientTrackingEpisodes = 0;
  let falseAlerts = 0;
  let alertsOutsideTracking = 0;
  const delays = [];
  for (const session of input.sessions) {
    durationMs += session.duration_ms;
    const coverage = mergeIntervals(input.tracking.filter(row => row.session_id === session.session_id));
    trackedMs += coverage.reduce((sum, row) => sum + row.end_ms - row.start_ms, 0);
    const episodes = input.episodes.filter(row => row.session_id === session.session_id);
    const alerts = input.alerts.filter(row => row.session_id === session.session_id);
    for (const episode of episodes) {
      if (!contained(episode, coverage)) {
        insufficientTrackingEpisodes += 1;
        continue;
      }
      fullyTrackedEpisodes += 1;
      const episodeAlerts = alerts.filter(alert => alert.at_ms >= episode.start_ms && alert.at_ms < episode.end_ms);
      if (episodeAlerts.length) {
        detectedEpisodes += 1;
        delays.push(episodeAlerts.reduce((first, alert) => Math.min(first, alert.at_ms), Infinity) - episode.start_ms);
      }
    }
    for (const alert of alerts) {
      if (!trackedAt(alert.at_ms, coverage)) {
        alertsOutsideTracking += 1;
        continue;
      }
      if (!episodes.some(episode => alert.at_ms >= episode.start_ms && alert.at_ms < episode.end_ms)) falseAlerts += 1;
    }
  }
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
  return {
    sessions: input.sessions.length,
    participants: new Set(input.sessions.map(session => session.participant)).size,
    episodes: input.episodes.length,
    alerts: input.alerts.length,
    durationHours: durationMs / 3_600_000,
    trackedHours: trackedMs / 3_600_000,
    trackingCoverage: ratio(trackedMs, durationMs),
    fullyTrackedEpisodes,
    insufficientTrackingEpisodes,
    detectedEpisodes,
    missedFullyTrackedEpisodes: fullyTrackedEpisodes - detectedEpisodes,
    eventRecall: ratio(detectedEpisodes, fullyTrackedEpisodes),
    falseAlerts,
    falseAlertsPerTrackedHour: trackedMs ? falseAlerts / (trackedMs / 3_600_000) : null,
    alertsOutsideTracking,
    medianAlertDelayMs: percentile(delays, 0.5),
    p95AlertDelayMs: percentile(delays, 0.95),
  };
}

export function scoreBySlice(input, field) {
  if (!input.sessions.length || !Object.hasOwn(input.sessions[0], field)) throw new Error(`Slice column ${field} is absent from sessions CSV`);
  const values = new Set(input.sessions.map(session => session[field] || '(unspecified)'));
  return Object.fromEntries([...values].sort().map(value => {
    const ids = new Set(input.sessions.filter(session => (session[field] || '(unspecified)') === value).map(session => session.session_id));
    return [value, scoreByDetector({
      sessions: input.sessions.filter(row => ids.has(row.session_id)),
      tracking: input.tracking.filter(row => ids.has(row.session_id)),
      episodes: input.episodes.filter(row => ids.has(row.session_id)),
      alerts: input.alerts.filter(row => ids.has(row.session_id)),
    })];
  }));
}

export function scoreByDetector(input) {
  const keys = new Set(input.sessions.map(session => `${session.platform} / ${session.detector_version}`));
  return Object.fromEntries([...keys].sort().map(key => {
    const ids = new Set(input.sessions.filter(session => `${session.platform} / ${session.detector_version}` === key).map(session => session.session_id));
    return [key, scoreEvents({
      sessions: input.sessions.filter(row => ids.has(row.session_id)),
      tracking: input.tracking.filter(row => ids.has(row.session_id)),
      episodes: input.episodes.filter(row => ids.has(row.session_id)),
      alerts: input.alerts.filter(row => ids.has(row.session_id)),
    })];
  }));
}

export function comparePipelines(primary, comparison) {
  validateInput(primary);validateInput(comparison);
  const identity=input=>input.sessions.map(row=>[row.session_id,row.participant,row.platform,row.duration_ms,row.split||'']).sort((a,b)=>a[0].localeCompare(b[0]));
  const labels=input=>input.episodes.map(row=>[row.session_id,row.start_ms,row.end_ms,row.label]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(JSON.stringify(identity(primary))!==JSON.stringify(identity(comparison))||JSON.stringify(labels(primary))!==JSON.stringify(labels(comparison)))throw new Error('Comparison must use identical sessions, participants, durations, splits and ground-truth episodes');
  const versions=new Map(primary.sessions.map(row=>[row.session_id,row.detector_version]));
  if(comparison.sessions.some(row=>row.detector_version===versions.get(row.session_id)))throw new Error('Comparison must identify a distinct detector version');
  return {primary:scoreByDetector(primary),comparison:scoreByDetector(comparison),combinedAccuracy:null};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const paths = Object.fromEntries(Object.keys(REQUIRED).map(kind => [kind, arg(`--${kind}`)]));
  if (Object.values(paths).some(value => !value)) {
    console.error('Usage: node benchmark/run-event-benchmark.mjs --sessions sessions.csv --tracking tracking.csv --episodes episodes.csv --alerts alerts.csv [--split test] [--slice-by lighting] [--dataset name@version] [--comparison-dir tasks-export] [--json results.json]');
    process.exit(2);
  }
  const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([kind, path]) => [kind, await readFile(path)])));
  const parsed = Object.fromEntries(Object.entries(bytes).map(([kind, value]) => [kind, parseFile(value.toString('utf8'), kind)]));
  const split = arg('--split');
  const selected = selectSessions(parsed, split);
  if (!selected.sessions.length) throw new Error('No sessions selected');
  const detectors = scoreByDetector(selected);
  let comparison=null,comparisonInputs=null;
  if(arg('--comparison-dir')) {
    const comparisonPaths=Object.fromEntries(Object.keys(REQUIRED).map(kind=>[kind,join(arg('--comparison-dir'),kind+'.csv')]));
    const comparisonBytes=Object.fromEntries(await Promise.all(Object.entries(comparisonPaths).map(async([kind,path])=>[kind,await readFile(path)])));
    const comparisonParsed=Object.fromEntries(Object.entries(comparisonBytes).map(([kind,value])=>[kind,parseFile(value.toString('utf8'),kind)]));
    comparePipelines(parsed,comparisonParsed);
    comparison=comparePipelines(selected,selectSessions(comparisonParsed,split));
    comparisonInputs=Object.fromEntries(Object.entries(comparisonBytes).map(([kind,value])=>[kind,{path:comparisonPaths[kind],sha256:contentSha256(value)}]));
  }
  const result = {
    provenance: {
      ...sourceSnapshot(['run-event-benchmark.mjs']),
      dataset: arg('--dataset') ?? null,
      split: split ?? 'all',
      inputs: Object.fromEntries(Object.entries(bytes).map(([kind, value]) => [kind, { path: paths[kind], sha256: contentSha256(value) }])),
      comparisonInputs,
      ranAt: new Date().toISOString(),
    },
    // Distinct platforms or detector versions must not share one accuracy number.
    overall: Object.keys(detectors).length === 1 ? scoreEvents(selected) : null,
    detectors,
    comparison,
    slices: arg('--slice-by') ? scoreBySlice(selected, arg('--slice-by')) : null,
  };
  console.log(JSON.stringify(result, null, 2));
  console.error('Event benchmark scores exported alert observations only. It does not establish on-road safety or causality.');
  if (arg('--json')) await writeFile(arg('--json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
