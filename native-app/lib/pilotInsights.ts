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
  false_alert: 'False alerts',
  missed_alert: 'Missed alerts',
  late_alert: 'Late alerts',
};

const SENSITIVITY_LABELS: Array<{ value: SensitivityLevel; label: string }> = [
  { value: 'low', label: 'Low sensitivity' },
  { value: 'medium', label: 'Medium sensitivity' },
  { value: 'high', label: 'High sensitivity' },
];

const CONDITION_LABELS: Array<{
  key: keyof SessionTestConditions;
  value: NonNullable<SessionTestConditions[keyof SessionTestConditions]>;
  label: string;
}> = [
  { key: 'lighting', value: 'daylight', label: 'Daylight' },
  { key: 'lighting', value: 'low_light', label: 'Low light' },
  { key: 'eyewear', value: 'none', label: 'No eyewear' },
  { key: 'eyewear', value: 'glasses', label: 'Glasses' },
  { key: 'eyewear', value: 'sunglasses', label: 'Sunglasses' },
  { key: 'phonePosition', value: 'high', label: 'High phone' },
  { key: 'phonePosition', value: 'center', label: 'Center phone' },
  { key: 'phonePosition', value: 'low', label: 'Low phone' },
];

const PILOT_COVERAGE_CONDITIONS: Array<{
  id: string;
  label: string;
  matches: (session: PilotInsightSession) => boolean;
}> = [
  { id: 'daylight', label: 'Daylight', matches: session => session.testConditions?.lighting === 'daylight' },
  { id: 'low-light', label: 'Low light', matches: session => session.testConditions?.lighting === 'low_light' },
  { id: 'no-eyewear', label: 'No eyewear', matches: session => session.testConditions?.eyewear === 'none' },
  { id: 'glasses', label: 'Glasses', matches: session => session.testConditions?.eyewear === 'glasses' },
  { id: 'sunglasses', label: 'Sunglasses', matches: session => session.testConditions?.eyewear === 'sunglasses' },
  { id: 'high-phone', label: 'High phone', matches: session => session.testConditions?.phonePosition === 'high' },
  { id: 'center-phone', label: 'Center phone', matches: session => session.testConditions?.phonePosition === 'center' },
  { id: 'low-phone', label: 'Low phone', matches: session => session.testConditions?.phonePosition === 'low' },
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
  return counts.map(item => `${item.count} ${item.label.toLowerCase()}`).join(' · ');
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
