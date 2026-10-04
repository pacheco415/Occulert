import type React from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { AlertAssessment } from './feedback';
import type { SessionRecord, TestConditionGroup, DeviceImpactGroup, HistoryRecordedFilterKey } from './historyRecord';
import { hasHistoryAlertAssessment, type HistoryFilter, type HistoryPeriod, type HistorySort, type HistoryAssessmentFilter, type HistoryViewPreferences } from './historyPreferences.ts';
import { hasCompleteSessionReview, incompleteSessionReviewQueue } from './sessionReviewProgress.ts';

export const CHECKPOINT_TARGET = 10;

export const ASSESSMENT_OPTIONS: Array<{
  value: AlertAssessment;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}> = [
  { value: 'accurate', label: 'Felt right', icon: 'checkmark-circle-outline' },
  { value: 'false_alert', label: 'Unnecessary', icon: 'alert-circle-outline' },
  { value: 'missed_alert', label: 'Missed alert', icon: 'eye-off-outline' },
  { value: 'late_alert', label: 'Too late', icon: 'time-outline' },
];

export const TEST_CONDITION_GROUPS: TestConditionGroup[] = [
  {
    key: 'lighting',
    label: 'Lighting',
    options: [
      { value: 'daylight', label: 'Daylight' },
      { value: 'low_light', label: 'Low light' },
    ],
  },
  {
    key: 'eyewear',
    label: 'Eyewear',
    options: [
      { value: 'none', label: 'None' },
      { value: 'glasses', label: 'Glasses' },
      { value: 'sunglasses', label: 'Sunglasses' },
    ],
  },
  {
    key: 'phonePosition',
    label: 'Phone position',
    options: [
      { value: 'high', label: 'High' },
      { value: 'center', label: 'Center' },
      { value: 'low', label: 'Low' },
    ],
  },
];

export const DEVICE_IMPACT_GROUPS: DeviceImpactGroup[] = [
  {
    key: 'batteryImpact',
    label: 'Battery use',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'noticeable', label: 'Noticeable' },
      { value: 'high', label: 'High' },
    ],
  },
  {
    key: 'phoneHeat',
    label: 'Phone heat',
    options: [
      { value: 'cool', label: 'Cool' },
      { value: 'warm', label: 'Warm' },
      { value: 'hot', label: 'Hot' },
    ],
  },
];

export const HISTORY_FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'recovered', label: 'Recovered' },
];

export const HISTORY_PERIODS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '7-days', label: 'Last 7 days' },
  { value: '30-days', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom dates' },
];

export const HISTORY_RECORDED_FILTERS: Array<{
  key: HistoryRecordedFilterKey;
  label: string;
  options: Array<{ value: string; label: string }>;
}> = [
  { key: 'sensitivity', label: 'Saved sensitivity', options: [
    { value: 'all', label: 'All' }, { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
    { value: 'unknown', label: 'Not recorded' },
  ] },
  { key: 'lighting', label: 'Saved lighting', options: [
    { value: 'all', label: 'All' }, { value: 'daylight', label: 'Daylight' },
    { value: 'low_light', label: 'Low light' }, { value: 'unknown', label: 'Not recorded' },
  ] },
  { key: 'eyewear', label: 'Saved eyewear', options: [
    { value: 'all', label: 'All' }, { value: 'none', label: 'None' },
    { value: 'glasses', label: 'Glasses' }, { value: 'sunglasses', label: 'Sunglasses' },
    { value: 'unknown', label: 'Not recorded' },
  ] },
];

export const HISTORY_SORTS: Array<{ value: HistorySort; label: string }> = [
  { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
  { value: 'duration', label: 'Longest first' }, { value: 'alerts', label: 'Most alerts first' },
];

export const HISTORY_ASSESSMENTS: Array<{ value: HistoryAssessmentFilter; label: string }> = [
  { value: 'all', label: 'All feedback' },
  { value: 'accurate', label: 'Felt right' },
  { value: 'false_alert', label: 'Unnecessary alert' },
  { value: 'missed_alert', label: 'Missed alert' },
  { value: 'late_alert', label: 'Too late' },
  { value: 'not-assessed', label: 'Not assessed' },
];

export function historyReviewInput(item: SessionRecord): SessionRecord {
  const testConditions = { ...item.testConditions };
  const deviceImpact = { ...item.deviceImpact };
  TEST_CONDITION_GROUPS.forEach(group => {
    if (!group.options.some(option => option.value === testConditions[group.key])) delete testConditions[group.key];
  });
  DEVICE_IMPACT_GROUPS.forEach(group => {
    if (!group.options.some(option => option.value === deviceImpact[group.key])) delete deviceImpact[group.key];
  });
  return {
    ...item,
    alertAssessment: hasHistoryAlertAssessment(item.alertAssessment) ? item.alertAssessment : undefined,
    sensitivity: item.sensitivity === 'low' || item.sensitivity === 'medium' || item.sensitivity === 'high'
      ? item.sensitivity : undefined,
    testConditions,
    deviceImpact,
  };
}

export function hasCompleteHistoryReview(item: SessionRecord): boolean {
  return hasCompleteSessionReview(historyReviewInput(item));
}

export function matchesHistoryReviewFilter(item: SessionRecord, filter: HistoryFilter): boolean {
  if (filter === 'recovered') return Boolean(item.recoveredFromInterruption);
  if (filter === 'reviewed') return !item.recoveredFromInterruption && hasCompleteHistoryReview(item);
  if (filter === 'needs-review') return !item.recoveredFromInterruption && !hasCompleteHistoryReview(item);
  return true;
}

export function historyReviewQueue(
  sessions: Array<{ item: SessionRecord; index: number }>,
  excludedIndex?: number,
): Array<{ item: SessionRecord; index: number }> {
  const unfinished = incompleteSessionReviewQueue(
    sessions.map(({ item, index }) => ({ item: historyReviewInput(item), index })),
    excludedIndex,
  );
  const indices = new Set(unfinished.map(({ index }) => index));
  // Return the original records and storage indices, rather than normalized copies.
  return sessions.filter(({ index }) => indices.has(index));
}

export function historyScopeLabel(
  period: HistoryPeriod,
  filter: HistoryFilter,
  assessment: HistoryAssessmentFilter,
  view: HistoryViewPreferences,
): string {
  const periodLabel = period === 'custom' && view.range
    ? `${view.range.start} through ${view.range.end}`
    : HISTORY_PERIODS.find(option => option.value === period)?.label || 'All time';
  const filterLabel = HISTORY_FILTERS.find(option => option.value === filter)?.label || 'All';
  const assessmentLabel = HISTORY_ASSESSMENTS.find(option => option.value === assessment)?.label || 'All feedback';
  const recordedLabels = HISTORY_RECORDED_FILTERS.map(group => (
    `${group.label}: ${group.options.find(option => option.value === view[group.key])?.label || 'All'}`
  ));
  const sortLabel = HISTORY_SORTS.find(option => option.value === view.sort)?.label || 'Newest first';
  return [periodLabel, filterLabel, assessmentLabel, ...recordedLabels, sortLabel].join(' · ');
}

export function sessionRecordKey(item: SessionRecord, index: number): string {
  return item.sessionId || `${item.savedAt || item.updatedAt || 'session'}-${index}`;
}

