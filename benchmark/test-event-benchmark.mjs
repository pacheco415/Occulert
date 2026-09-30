import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFile, scoreByDetector, scoreBySlice, scoreEvents, selectSessions, validateInput } from './run-event-benchmark.mjs';

const fixture = () => ({
  sessions: parseFile('session_id,participant,platform,detector_version,duration_ms,split,lighting\ns1,p1,web,web-1,10000,test,day\ns2,p2,ios,ios-1,10000,test,night\n', 'sessions'),
  tracking: parseFile('session_id,start_ms,end_ms\ns1,0,10000\ns2,0,5000\n', 'tracking'),
  episodes: parseFile('session_id,start_ms,end_ms,label\ns1,2000,4000,drowsy\ns2,6000,8000,high_fatigue\n', 'episodes'),
  alerts: parseFile('session_id,at_ms\ns1,3000\ns1,9000\ns2,2000\n', 'alerts'),
});

test('scores event recall only when the episode had complete tracking', () => {
  const result = scoreEvents(fixture());
  assert.equal(result.sessions, 2);
  assert.equal(result.trackingCoverage, 0.75);
  assert.equal(result.fullyTrackedEpisodes, 1);
  assert.equal(result.insufficientTrackingEpisodes, 1);
  assert.equal(result.detectedEpisodes, 1);
  assert.equal(result.eventRecall, 1);
  assert.equal(result.falseAlerts, 2);
  assert.equal(result.medianAlertDelayMs, 1000);
  assert.equal(result.alertsOutsideTracking, 0);
});

test('reports an estimable miss, rather than dropping a fully tracked episode', () => {
  const input = fixture();
  input.alerts = input.alerts.filter(alert => alert.at_ms !== 3000);
  const result = scoreEvents(input);
  assert.equal(result.eventRecall, 0);
  assert.equal(result.missedFullyTrackedEpisodes, 1);
  assert.equal(result.medianAlertDelayMs, null);
});

test('uses earliest alert time even when export rows are out of order', () => {
  const input = fixture();
  input.alerts.unshift({ session_id: 's1', at_ms: 3500 });
  assert.equal(scoreEvents(input).medianAlertDelayMs, 1000);
});

test('keeps web and iPhone session slices separate', () => {
  const sliced = scoreByDetector(fixture());
  assert.equal(sliced['web / web-1'].sessions, 1);
  assert.equal(sliced['ios / ios-1'].sessions, 1);
  assert.equal(sliced['web / web-1'].eventRecall, 1);
  assert.equal(sliced['ios / ios-1'].eventRecall, null);
  assert.equal(scoreBySlice(fixture(), 'lighting').day['web / web-1'].sessions, 1);
  const bothDay = fixture();
  bothDay.sessions[1].lighting = 'day';
  assert.deepEqual(Object.keys(scoreBySlice(bothDay, 'lighting').day), ['ios / ios-1', 'web / web-1']);
});

test('separates detector versions on one platform', () => {
  const input = fixture();
  input.sessions[1].platform = 'web';
  assert.deepEqual(Object.keys(scoreByDetector(input)), ['web / ios-1', 'web / web-1']);
});

test('never estimates recall or false alerts per hour from missing coverage', () => {
  const input = fixture();
  input.tracking = [];
  const result = scoreEvents(input);
  assert.equal(result.eventRecall, null);
  assert.equal(result.falseAlertsPerTrackedHour, null);
  assert.equal(result.insufficientTrackingEpisodes, 2);
});

test('excludes untracked alerts from the false-alert rate and reports them separately', () => {
  const input = fixture();
  input.alerts.push({ session_id: 's2', at_ms: 7500 });
  const result = scoreEvents(input);
  assert.equal(result.falseAlerts, 2);
  assert.equal(result.alertsOutsideTracking, 1);
});

test('checks participant split leakage before selecting held-out data', () => {
  const input = fixture();
  input.sessions.push({ ...input.sessions[0], session_id: 's3', split: 'train' });
  assert.throws(() => selectSessions(input, 'test'), /Participant leakage/);
});

test('rejects unknown sessions, out-of-bounds times and overlapping episodes', () => {
  const unknown = fixture();
  unknown.alerts.push({ session_id: 'other', at_ms: 100 });
  assert.throws(() => validateInput(unknown), /unknown session/);

  const outside = fixture();
  outside.alerts.push({ session_id: 's1', at_ms: 10001 });
  assert.throws(() => validateInput(outside), /outside session/);

  const overlap = fixture();
  overlap.episodes.push({ session_id: 's1', start_ms: 3000, end_ms: 5000, label: 'drowsy' });
  assert.throws(() => validateInput(overlap), /Overlapping episodes/);
});

test('CSV input rejects missing fields, malformed values and invalid labels', () => {
  assert.throws(() => parseFile('session_id,at_ms\ns1,\n', 'alerts'), /at_ms missing/);
  assert.throws(() => parseFile('session_id,start_ms,end_ms,label\ns1,0,10,awake\n', 'episodes'), /Invalid episode label/);
  assert.throws(() => parseFile('session_id,start_ms,end_ms\ns1,10,5\n', 'tracking'), /end_ms must be after/);
  assert.throws(() => parseFile('session_id,participant,platform,detector_version,duration_ms\ns1,p1,unknown,v1,10\n', 'sessions'), /Invalid platform/);
});
