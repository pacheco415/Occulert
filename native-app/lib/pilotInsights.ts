import type {
  AlertAssessment,
  SessionTestConditions,
} from './feedback';
import type { SensitivityLevel } from '../constants/thresholds';

export type PilotIssueAssessment = Extract<AlertAssessment, 'false_alert' | 'missed_alert'>;

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

const ISSUE_LABELS: Record<PilotIssueAssessment, string> = {
  false_alert: 'False alerts',
  missed_alert: 'Missed alerts',
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

  return (['false_alert', 'missed_alert'] as const).map((assessment) => {
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
