import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPilotCounts,
  summarizePilotIssues,
} from '../native-app/lib/pilotInsights.ts';
import {
  getSessionReviewProgress,
  hasCompleteSessionReview,
} from '../native-app/lib/sessionReviewProgress.ts';

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
