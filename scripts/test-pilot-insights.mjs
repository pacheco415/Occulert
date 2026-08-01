import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPilotCounts,
  summarizePilotIssues,
} from '../native-app/lib/pilotInsights.ts';

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
