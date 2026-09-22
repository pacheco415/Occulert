import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPilotCounts,
  summarizePilotCoverage,
  summarizePilotIssues,
} from '../native-app/lib/pilotInsights.ts';
import {
  getSessionReviewProgress,
  hasCompleteSessionReview,
  incompleteSessionReviewQueue,
} from '../native-app/lib/sessionReviewProgress.ts';
import { sortIndexedSessionsNewest } from '../native-app/lib/historyPreferences.ts';
import { buildPilotProgressExport } from '../native-app/lib/pilotProgressExport.ts';

test('session review progress identifies every missing pilot detail', () => {
  const progress = getSessionReviewProgress({
    alertAssessment: 'accurate',
    testConditions: { lighting: 'daylight', phonePosition: 'center' },
    deviceImpact: { batteryImpact: 'low' },
  });

  assert.equal(progress.completedSteps, 1);
  assert.equal(progress.totalSteps, 3);
  assert.equal(progress.complete, false);
  assert.equal(progress.missingSummary, 'Still needed: eyewear, phone heat');
  assert.deepEqual(progress.steps.map(step => ({
    id: step.id,
    complete: step.complete,
    missing: step.missing,
  })), [
    { id: 'assessment', complete: true, missing: [] },
    { id: 'conditions', complete: false, missing: ['eyewear'] },
    { id: 'device-impact', complete: false, missing: ['phone heat'] },
  ]);
});

test('session review progress recognizes a complete review', () => {
  const session = {
    alertAssessment: 'false_alert',
    testConditions: { lighting: 'low_light', eyewear: 'glasses', phonePosition: 'low' },
    deviceImpact: { batteryImpact: 'noticeable', phoneHeat: 'warm' },
  };

  const progress = getSessionReviewProgress(session);
  assert.equal(progress.completedSteps, 3);
  assert.equal(progress.complete, true);
  assert.equal(progress.missingSummary, 'Nothing missing');
  assert.equal(hasCompleteSessionReview(session), true);
  assert.equal(hasCompleteSessionReview({}), false);
});

test('review queue selects newest unfinished complete-session records only', () => {
  const sorted = sortIndexedSessionsNewest([
    { sessionId: 'older', savedAt: '2026-09-18T12:00:00.000Z' },
    { sessionId: 'just-completed', savedAt: '2026-09-21T12:00:00.000Z' },
    { sessionId: 'newer', savedAt: '2026-09-20T12:00:00.000Z', alertAssessment: 'accurate' },
    { sessionId: 'recovered', savedAt: '2026-09-19T12:00:00.000Z', recoveredFromInterruption: true },
    {
      sessionId: 'finished',
      savedAt: '2026-09-17T12:00:00.000Z',
      alertAssessment: 'accurate',
      testConditions: { lighting: 'daylight', eyewear: 'none', phonePosition: 'center' },
      deviceImpact: { batteryImpact: 'low', phoneHeat: 'cool' },
    },
  ]);

  const queue = incompleteSessionReviewQueue(sorted, 1);
  assert.deepEqual(queue.map(entry => entry.item.sessionId), ['newer', 'older']);
  assert.deepEqual(queue.map(entry => entry.index), [2, 0]);
});

test('pilot issue summaries group reviewed problems without turning counts into rates', () => {
  const summaries = summarizePilotIssues([
    {
      alertAssessment: 'false_alert',
      sensitivity: 'medium',
      testConditions: { lighting: 'low_light', eyewear: 'sunglasses', phonePosition: 'low' },
    },
    {
      alertAssessment: 'false_alert',
      sensitivity: 'high',
      testConditions: { lighting: 'daylight', eyewear: 'none', phonePosition: 'low' },
    },
    {
      alertAssessment: 'missed_alert',
      sensitivity: 'medium',
      testConditions: { lighting: 'low_light', eyewear: 'glasses' },
    },
    {
      alertAssessment: 'accurate',
      sensitivity: 'medium',
      testConditions: { lighting: 'low_light', eyewear: 'glasses', phonePosition: 'high' },
    },
    { sensitivity: 'low', testConditions: { lighting: 'daylight' } },
    { alertAssessment: 'late_alert', sensitivity: 'medium', testConditions: { lighting: 'daylight' } },
  ]);

  assert.deepEqual(summaries, [
    {
      assessment: 'false_alert',
      label: 'False alerts',
      total: 2,
      completeConditionCount: 2,
      sensitivities: [
        { label: 'Medium sensitivity', count: 1 },
        { label: 'High sensitivity', count: 1 },
      ],
      conditions: [
        { label: 'Daylight', count: 1 },
        { label: 'Low light', count: 1 },
        { label: 'No eyewear', count: 1 },
        { label: 'Sunglasses', count: 1 },
        { label: 'Low phone', count: 2 },
      ],
    },
    {
      assessment: 'missed_alert',
      label: 'Missed alerts',
      total: 1,
      completeConditionCount: 0,
      sensitivities: [{ label: 'Medium sensitivity', count: 1 }],
      conditions: [
        { label: 'Low light', count: 1 },
        { label: 'Glasses', count: 1 },
      ],
    },
    {
      assessment: 'late_alert',
      label: 'Late alerts',
      total: 1,
      completeConditionCount: 0,
      sensitivities: [{ label: 'Medium sensitivity', count: 1 }],
      conditions: [{ label: 'Daylight', count: 1 }],
    },
  ]);
});

test('pilot count formatting stays compact and handles no recorded context', () => {
  assert.equal(
    formatPilotCounts([
      { label: 'Medium sensitivity', count: 2 },
      { label: 'High sensitivity', count: 1 },
    ]),
    '2 medium sensitivity · 1 high sensitivity',
  );
  assert.equal(formatPilotCounts([]), '');

  const summaries = summarizePilotIssues([{ alertAssessment: 'false_alert' }]);
  assert.equal(summaries[0]?.total, 1);
  assert.equal(summaries[0]?.completeConditionCount, 0);
  assert.deepEqual(summaries[0]?.sensitivities, []);
  assert.deepEqual(summaries[0]?.conditions, []);
  assert.equal(summaries[1]?.total, 0);
});

test('pilot coverage names represented and missing condition variants', () => {
  const coverage = summarizePilotCoverage([
    { testConditions: { lighting: 'daylight', eyewear: 'none', phonePosition: 'center' } },
    { testConditions: { lighting: 'low_light', eyewear: 'glasses', phonePosition: 'low' } },
    { testConditions: { lighting: 'low_light', eyewear: 'glasses', phonePosition: 'low' } },
  ]);

  assert.equal(coverage.coveredCount, 6);
  assert.equal(coverage.totalCount, 8);
  assert.deepEqual(coverage.missingLabels, ['Sunglasses', 'High phone']);
  assert.deepEqual(
    coverage.items.filter(item => item.count > 0).map(item => [item.label, item.count]),
    [
      ['Daylight', 1],
      ['Low light', 2],
      ['No eyewear', 1],
      ['Glasses', 2],
      ['Center phone', 1],
      ['Low phone', 2],
    ],
  );
});

test('pilot coverage recognizes every planned condition variant', () => {
  const coverage = summarizePilotCoverage([
    { testConditions: { lighting: 'daylight', eyewear: 'none', phonePosition: 'high' } },
    { testConditions: { lighting: 'low_light', eyewear: 'glasses', phonePosition: 'center' } },
    { testConditions: { lighting: 'daylight', eyewear: 'sunglasses', phonePosition: 'low' } },
  ]);

  assert.equal(coverage.coveredCount, coverage.totalCount);
  assert.deepEqual(coverage.missingLabels, []);
});

test('pilot progress export stays aggregate, privacy-limited, and evidence-bounded', () => {
  const complete = {
    alertAssessment: 'false_alert',
    sensitivity: 'medium',
    testConditions: { lighting: 'low_light', eyewear: 'glasses', phonePosition: 'low' },
    deviceImpact: { batteryImpact: 'noticeable', phoneHeat: 'warm' },
  };
  const report = buildPilotProgressExport([
    {
      ...complete,
      sessionId: 'private-session-id',
      savedAt: '2026-09-22T12:34:56.000Z',
      driverId: 'private-driver-id',
      monitorPerformance: { private: true },
    },
    {
      ...complete,
      alertAssessment: 'accurate',
      testConditions: { lighting: 'daylight', eyewear: 'none', phonePosition: 'center' },
      deviceImpact: { batteryImpact: 'low', phoneHeat: 'cool' },
    },
    { ...complete, recoveredFromInterruption: true },
    { sensitivity: 'medium', alertAssessment: 'missed_alert' },
  ], 10, new Date('2026-09-22T20:00:00.000Z'));

  assert.match(report, /Medium review target: 2 of 10/);
  assert.match(report, /Complete local reviews: 2/);
  assert.match(report, /Recovered partial sessions excluded: 1/);
  assert.match(report, /Condition coverage: 6 of 8 planned variants represented/);
  assert.match(report, /Still needed: Sunglasses, High phone/);
  assert.match(report, /Felt right 1 · False alerts 1 · Missed alerts 0 · Late alerts 0/);
  assert.match(report, /Battery use: Low 1 · Noticeable 1 · High 0/);
  assert.match(report, /counts, not accuracy or safety-effectiveness rates/);
  assert.match(report, /excludes session and driver identifiers/);
  assert.doesNotMatch(report, /private-session-id|private-driver-id|2026-09-22T12:34:56/);
});
