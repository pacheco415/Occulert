import { strings, formatString } from './strings.ts';
import type { Ionicons } from '@expo/vector-icons';
import type React from 'react';
import type { AlertAssessment } from './feedback';
import { hasHistoryAlertAssessment, type HistoryAssessmentFilter, type HistoryFilter, type HistoryPeriod, type HistorySort, type HistoryViewPreferences } from './historyPreferences.ts';
import type { DeviceImpactGroup, HistoryRecordedFilterKey, SessionRecord, TestConditionGroup } from './historyRecord';
import { hasCompleteSessionReview, incompleteSessionReviewQueue } from './sessionReviewProgress.ts';

export const CHECKPOINT_TARGET = 10;

export const ASSESSMENT_OPTIONS: Array<{
  value: AlertAssessment;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}> = [
  { value: 'accurate', label: strings.history.common.feltRight, icon: 'checkmark-circle-outline' },
  { value: 'false_alert', label: strings.history.options.unnecessary, icon: 'alert-circle-outline' },
  { value: 'missed_alert', label: strings.history.common.missedAlert, icon: 'eye-off-outline' },
  { value: 'late_alert', label: strings.history.common.tooLate, icon: 'time-outline' },
];

export const TEST_CONDITION_GROUPS: TestConditionGroup[] = [
  {
    key: 'lighting',
    label: strings.history.common.lighting,
    options: [
      { value: 'daylight', label: strings.history.common.daylight },
      { value: 'low_light', label: strings.history.common.lowLight },
    ],
  },
  {
    key: 'eyewear',
    label: strings.history.common.eyewear,
    options: [
      { value: 'none', label: strings.history.common.none },
      { value: 'glasses', label: strings.history.common.glasses },
      { value: 'sunglasses', label: strings.history.common.sunglasses },
    ],
  },
  {
    key: 'phonePosition',
    label: strings.history.common.phonePosition,
    options: [
      { value: 'high', label: strings.history.common.high },
      { value: 'center', label: strings.history.common.center },
      { value: 'low', label: strings.history.common.low },
    ],
  },
];

export const DEVICE_IMPACT_GROUPS: DeviceImpactGroup[] = [
  {
    key: 'batteryImpact',
    label: strings.history.common.batteryUse,
    options: [
      { value: 'low', label: strings.history.common.low },
      { value: 'noticeable', label: strings.history.common.noticeable },
      { value: 'high', label: strings.history.common.high },
    ],
  },
  {
    key: 'phoneHeat',
    label: strings.history.common.phoneHeat,
    options: [
      { value: 'cool', label: strings.history.common.cool },
      { value: 'warm', label: strings.history.common.warm },
      { value: 'hot', label: strings.history.common.hot },
    ],
  },
];

export const HISTORY_FILTERS: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: strings.history.common.all },
  { value: 'needs-review', label: strings.history.common.needsReview },
  { value: 'reviewed', label: strings.history.common.reviewed },
  { value: 'recovered', label: strings.history.common.recovered },
];

export const HISTORY_PERIODS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: 'all', label: strings.history.common.allTime },
  { value: '7-days', label: strings.history.options.last7Days },
  { value: '30-days', label: strings.history.options.last30Days },
  { value: 'custom', label: strings.history.options.customDates },
];

export const HISTORY_RECORDED_FILTERS: Array<{
  key: HistoryRecordedFilterKey;
  label: string;
  options: Array<{ value: string; label: string }>;
}> = [
  { key: 'sensitivity', label: strings.history.options.savedSensitivity, options: [
    { value: 'all', label: strings.history.common.all }, { value: 'low', label: strings.history.common.low },
    { value: 'medium', label: strings.history.common.medium }, { value: 'high', label: strings.history.common.high },
    { value: 'unknown', label: strings.history.common.notRecorded },
  ] },
  { key: 'lighting', label: strings.history.options.savedLighting, options: [
    { value: 'all', label: strings.history.common.all }, { value: 'daylight', label: strings.history.common.daylight },
    { value: 'low_light', label: strings.history.common.lowLight }, { value: 'unknown', label: strings.history.common.notRecorded },
  ] },
  { key: 'eyewear', label: strings.history.options.savedEyewear, options: [
    { value: 'all', label: strings.history.common.all }, { value: 'none', label: strings.history.common.none },
    { value: 'glasses', label: strings.history.common.glasses }, { value: 'sunglasses', label: strings.history.common.sunglasses },
    { value: 'unknown', label: strings.history.common.notRecorded },
  ] },
];

export const HISTORY_SORTS: Array<{ value: HistorySort; label: string }> = [
  { value: 'newest', label: strings.history.common.newestFirst }, { value: 'oldest', label: strings.history.options.oldestFirst },
  { value: 'duration', label: strings.history.options.longestFirst }, { value: 'alerts', label: strings.history.options.mostAlertsFirst },
];

export const HISTORY_ASSESSMENTS: Array<{ value: HistoryAssessmentFilter; label: string }> = [
  { value: 'all', label: strings.history.common.allFeedback },
  { value: 'accurate', label: strings.history.common.feltRight },
  { value: 'false_alert', label: strings.history.options.unnecessaryAlert },
  { value: 'missed_alert', label: strings.history.common.missedAlert },
  { value: 'late_alert', label: strings.history.common.tooLate },
  { value: 'not-assessed', label: strings.history.common.notAssessed },
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
    ? formatString(strings.history.options.customRange, { start: view.range.start, end: view.range.end })
    : HISTORY_PERIODS.find(option => option.value === period)?.label || strings.history.common.allTime;
  const filterLabel = HISTORY_FILTERS.find(option => option.value === filter)?.label || strings.history.common.all;
  const assessmentLabel = HISTORY_ASSESSMENTS.find(option => option.value === assessment)?.label || strings.history.common.allFeedback;
  const recordedLabels = HISTORY_RECORDED_FILTERS.map(group => (
    formatString(strings.history.common.labelValue, { label: group.label, value: group.options.find(option => option.value === view[group.key])?.label || strings.history.common.all })
  ));
  const sortLabel = HISTORY_SORTS.find(option => option.value === view.sort)?.label || strings.history.common.newestFirst;
  return [periodLabel, filterLabel, assessmentLabel, ...recordedLabels, sortLabel].join(' · ');
}

export function sessionRecordKey(item: SessionRecord, index: number): string {
  return item.sessionId || `${item.savedAt || item.updatedAt || 'session'}-${index}`;
}
