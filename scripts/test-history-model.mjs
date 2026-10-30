import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HISTORY_VIEW } from '../native-app/lib/historyPreferences.ts';
import { historyReviewInput, historyReviewQueue } from '../native-app/lib/historyReviewModel.ts';
import { deriveHistoryView } from '../native-app/lib/historyViewModel.ts';
import { buildHistoryShareMessage, buildHistoryPilotProgressMessage } from '../native-app/lib/historyShareMessage.ts';

const now = new Date(2026, 9, 4, 12).getTime();
const complete = {
  sensitivity: 'medium', alertAssessment: 'accurate',
  testConditions: { lighting: 'daylight', eyewear: 'none', phonePosition: 'center' },
  deviceImpact: { batteryImpact: 'low', phoneHeat: 'cool' },
};
const sessions = [
  { ...complete, sessionId: 'today', savedAt: new Date(2026, 9, 4, 8).toISOString(), durationSec: 90, alertCount: 0 },
  { ...complete, sessionId: 'long', savedAt: new Date(2026, 9, 3, 8).toISOString(), durationSec: 300, alertCount: 2, alertAssessment: 'false_alert' },
  { sessionId: 'unfinished', savedAt: new Date(2026, 9, 2).toISOString(), sensitivity: 'medium', alertAssessment: 'late_alert', durationSec: 40 },
  { ...complete, sessionId: 'recovered', savedAt: new Date(2026, 9, 1).toISOString(), recoveredFromInterruption: true },
  { sessionId: 'invalid', savedAt: 'invalid', alertAssessment: 'legacy-unknown', sensitivity: 'legacy-unknown', testConditions: { lighting: 'legacy-unknown' } },
  { ...complete, sessionId: 'future', savedAt: new Date(2026, 9, 5).toISOString() },
];
function select(overrides = {}) {
  return deriveHistoryView({ sessions, historyFilter: 'all', historyPeriod: 'all', historyAssessment: 'all', historyView: { ...DEFAULT_HISTORY_VIEW }, sessionOperations: {}, now, ...overrides });
}

test('review presentation removes unrecognized observations without changing stored legacy fields', () => {
  const item = Object.freeze({ ...sessions[4], testConditions: Object.freeze({ lighting: 'legacy-unknown', eyewear: 'glasses' }), privateExtra: 'retain-in-storage' });
  const normalized = historyReviewInput(item);
  assert.equal(item.alertAssessment, 'legacy-unknown');
  assert.equal(item.testConditions.lighting, 'legacy-unknown');
  assert.equal(normalized.alertAssessment, undefined);
  assert.equal(normalized.sensitivity, undefined);
  assert.equal(normalized.testConditions.lighting, undefined);
  assert.equal(normalized.testConditions.eyewear, 'glasses');
  assert.equal(normalized.privateExtra, 'retain-in-storage');
});

test('review queues exclude recovered/complete records and keep the original record and storage index', () => {
  const indexed = sessions.map((item, index) => ({ item, index })).reverse();
  const queue = historyReviewQueue(indexed);
  assert.deepEqual(queue.map(({ item }) => item.sessionId), ['invalid', 'unfinished']);
  queue.forEach(({ item, index }) => assert.equal(item, sessions[index]));
  assert.deepEqual(historyReviewQueue(indexed, 4).map(({ item }) => item.sessionId), ['unfinished']);
});

test('filter counts use the other selected dimensions and metric sorting remains one ordered shown group', () => {
  const model = select({ historyPeriod: '7-days', historyFilter: 'reviewed', historyAssessment: 'false_alert', historyView: { ...DEFAULT_HISTORY_VIEW, sort: 'duration' } });
  assert.deepEqual(model.filteredSessions.map(({ item, index }) => [item.sessionId, index]), [['long', 1]]);
  assert.deepEqual(model.filterCounts, { all: 1, 'needs-review': 0, reviewed: 1, recovered: 0 });
  assert.equal(model.assessmentCounts.all, 2);
  assert.equal(model.assessmentCounts.accurate, 1);
  assert.equal(model.assessmentCounts.false_alert, 1);
  assert.equal(model.groupedFilteredSessions.length, 1);
  assert.equal(model.groupedFilteredSessions[0].key, 'shown');
  assert.equal(model.groupedFilteredSessions[0].label, 'Longest first');
  assert.equal(model.groupedFilteredSessions[0].sessions, model.filteredSessions);
  assert.equal(model.filteredSessions[0].item, sessions[1]);
});

test('custom local dates are inclusive and exclude invalid/future dates while all-time preserves them', () => {
  const custom = select({ historyPeriod: 'custom', historyView: { ...DEFAULT_HISTORY_VIEW, range: { start: '2026-10-03', end: '2026-10-04' } } });
  assert.deepEqual(custom.filteredSessions.map(({ item }) => item.sessionId), ['today', 'long']);
  assert.equal(select().filteredSessions.length, sessions.length);
  assert.equal(select({ historyPeriod: '7-days' }).filteredSessions.length, 4);
});

test('recovered summaries stay visible but do not count as complete Medium review evidence', () => {
  const model = select();
  assert.equal(model.recoveredCount, 1);
  assert.equal(model.checkpointProgress, 3);
  assert.ok(!model.reviewedMedium.some(item => item.sessionId === 'recovered'));
  assert.equal(select({ sessionOperations: { long: 'saving' } }).sessionOperationsBusy, true);
});

test('shown and pilot exports keep explicit scope, unknown versus zero and private-field exclusions', () => {
  const records = [{ ...sessions[0], driverId: 'private-driver', location: { lat: 9 }, sensorFusion: { secret: true }, avgFatigue: 0 }, { ...sessions[4], alertCount: null, avgFatigue: null }];
  const message = buildHistoryShareMessage(records, 'custom', 'all', 'all', { ...DEFAULT_HISTORY_VIEW, range: { start: '2026-10-03', end: '2026-10-04' } });
  assert.match(message, /^Shown view: 2026-10-03 through 2026-10-04/);
  assert.match(message, /inclusive local calendar dates/);
  assert.match(message, /Alerts: 0/);
  assert.match(message, /Alerts: Not recorded/);
  assert.match(message, /Average fatigue: 0/);
  assert.doesNotMatch(message, /private-driver|driverId|sensorFusion|"lat"|legacy-unknown/);
  const pilot = buildHistoryPilotProgressMessage(records);
  assert.doesNotMatch(pilot, /private-driver|driverId|sensorFusion|today|invalid/);
  assert.match(pilot, /aggregate/i);
});
