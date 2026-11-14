import { strings, formatString } from './strings.ts';
import type {
  AlertAssessment,
  SessionTestConditions,
} from './feedback';
import type { SensitivityLevel } from '../constants/thresholds';

export type PilotIssueAssessment = Extract<AlertAssessment, 'false_alert' | 'missed_alert' | 'late_alert'>;

export interface PilotInsightSession {
  alertAssessment?: AlertAssessment;
  sensitivity?: SensitivityLevel;
  testConditions?: SessionTestConditions;
}

export interface PilotCount {
  label: string;
  count: number;
}

export interface PilotIssueSummary {
  assessment: PilotIssueAssessment;
  label: string;
  total: number;
  completeConditionCount: number;
  sensitivities: PilotCount[];
  conditions: PilotCount[];
}

export interface PilotCoverageItem {
  id: string;
  label: string;
  count: number;
}

export interface PilotCoverageSummary {
  coveredCount: number;
  totalCount: number;
  items: PilotCoverageItem[];
  missingLabels: string[];
}

const ISSUE_LABELS: Record<PilotIssueAssessment, string> = {
  false_alert: strings.history.insights.falseAlerts,
  missed_alert: strings.history.insights.missedAlerts,
  late_alert: strings.history.insights.lateAlerts,
};

const SENSITIVITY_LABELS: Array<{ value: SensitivityLevel; label: string }> = [
  { value: 'low', label: strings.history.insights.lowSensitivity },
  { value: 'medium', label: strings.history.insights.mediumSensitivity },
  { value: 'high', label: strings.history.insights.highSensitivity },
];

const CONDITION_LABELS: Array<{
  key: keyof SessionTestConditions;
  value: NonNullable<SessionTestConditions[keyof SessionTestConditions]>;
  label: string;
}> = [
  { key: 'lighting', value: 'daylight', label: strings.history.common.daylight },
  { key: 'lighting', value: 'low_light', label: strings.history.common.lowLight },
  { key: 'eyewear', value: 'none', label: strings.history.insights.noEyewear },
  { key: 'eyewear', value: 'glasses', label: strings.history.common.glasses },
  { key: 'eyewear', value: 'sunglasses', label: strings.history.common.sunglasses },
  { key: 'phonePosition', value: 'high', label: strings.history.insights.highPhone },
  { key: 'phonePosition', value: 'center', label: strings.history.insights.centerPhone },
  { key: 'phonePosition', value: 'low', label: strings.history.insights.lowPhone },
];

const PILOT_COVERAGE_CONDITIONS: Array<{
  id: string;
  label: string;
  matches: (session: PilotInsightSession) => boolean;
}> = [
  { id: 'daylight', label: strings.history.common.daylight, matches: session => session.testConditions?.lighting === 'daylight' },
  { id: 'low-light', label: strings.history.common.lowLight, matches: session => session.testConditions?.lighting === 'low_light' },
  { id: 'no-eyewear', label: strings.history.insights.noEyewear, matches: session => session.testConditions?.eyewear === 'none' },
  { id: 'glasses', label: strings.history.common.glasses, matches: session => session.testConditions?.eyewear === 'glasses' },
  { id: 'sunglasses', label: strings.history.common.sunglasses, matches: session => session.testConditions?.eyewear === 'sunglasses' },
  { id: 'high-phone', label: strings.history.insights.highPhone, matches: session => session.testConditions?.phonePosition === 'high' },
  { id: 'center-phone', label: strings.history.insights.centerPhone, matches: session => session.testConditions?.phonePosition === 'center' },
  { id: 'low-phone', label: strings.history.insights.lowPhone, matches: session => session.testConditions?.phonePosition === 'low' },
];

function countMatching(
  sessions: PilotInsightSession[],
  labels: Array<{ label: string; matches: (session: PilotInsightSession) => boolean }>,
): PilotCount[] {
  return labels
    .map(item => ({
      label: item.label,
      count: sessions.filter(item.matches).length,
    }))
    .filter(item => item.count > 0);
}

export function summarizePilotIssues(sessions: PilotInsightSession[]): PilotIssueSummary[] {
  const reviewed = sessions.filter(session => Boolean(session.alertAssessment));

  return (['false_alert', 'missed_alert', 'late_alert'] as const).map((assessment) => {
    const matching = reviewed.filter(session => session.alertAssessment === assessment);
    return {
      assessment,
      label: ISSUE_LABELS[assessment],
      total: matching.length,
      completeConditionCount: matching.filter(session => (
        Boolean(session.testConditions?.lighting)
        && Boolean(session.testConditions?.eyewear)
        && Boolean(session.testConditions?.phonePosition)
      )).length,
      sensitivities: countMatching(
        matching,
        SENSITIVITY_LABELS.map(item => ({
          label: item.label,
          matches: session => session.sensitivity === item.value,
        })),
      ),
      conditions: countMatching(
        matching,
        CONDITION_LABELS.map(item => ({
          label: item.label,
          matches: session => session.testConditions?.[item.key] === item.value,
        })),
      ),
    };
  });
}

export function formatPilotCounts(counts: PilotCount[]): string {
  return counts.map(item => formatString(strings.history.pilot.issueCount, { count: item.count, label: item.label.toLowerCase() })).join(' · ');
}

export function summarizePilotCoverage(sessions: PilotInsightSession[]): PilotCoverageSummary {
  const items = PILOT_COVERAGE_CONDITIONS.map(condition => ({
    id: condition.id,
    label: condition.label,
    count: sessions.filter(condition.matches).length,
  }));

  return {
    coveredCount: items.filter(item => item.count > 0).length,
    totalCount: items.length,
    items,
    missingLabels: items.filter(item => item.count === 0).map(item => item.label),
  };
}
