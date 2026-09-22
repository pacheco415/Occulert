import type { FeedbackSession } from './feedback.ts';
import { formatPilotCounts, summarizePilotCoverage, summarizePilotIssues } from './pilotInsights.ts';
import { hasCompleteSessionReview } from './sessionReviewProgress.ts';

export interface PilotProgressSession extends FeedbackSession {
  recoveredFromInterruption?: boolean;
}

const ASSESSMENT_LABELS = [
  { value: 'accurate', label: 'Felt right' },
  { value: 'false_alert', label: 'False alerts' },
  { value: 'missed_alert', label: 'Missed alerts' },
  { value: 'late_alert', label: 'Late alerts' },
] as const;

const BATTERY_LABELS = [
  { value: 'low', label: 'Low' },
  { value: 'noticeable', label: 'Noticeable' },
  { value: 'high', label: 'High' },
] as const;

const HEAT_LABELS = [
  { value: 'cool', label: 'Cool' },
  { value: 'warm', label: 'Warm' },
  { value: 'hot', label: 'Hot' },
] as const;

function countLine<T extends string>(
  sessions: PilotProgressSession[],
  options: ReadonlyArray<{ value: T; label: string }>,
  read: (session: PilotProgressSession) => T | undefined,
): string {
  return options.map(option => (
    `${option.label} ${sessions.filter(session => read(session) === option.value).length}`
  )).join(' · ');
}

export function buildPilotProgressExport(
  sessions: PilotProgressSession[],
  checkpointTarget = 10,
  generatedAt = new Date(),
): string {
  const completeReviews = sessions.filter(session => (
    !session.recoveredFromInterruption && hasCompleteSessionReview(session)
  ));
  const mediumReviews = completeReviews.filter(session => session.sensitivity === 'medium');
  const coverage = summarizePilotCoverage(mediumReviews);
  const issues = summarizePilotIssues(completeReviews);
  const recoveredCount = sessions.filter(session => session.recoveredFromInterruption).length;

  const issueLines = issues.map(issue => {
    if (issue.total === 0) return `${issue.label}: 0`;
    const sensitivity = formatPilotCounts(issue.sensitivities) || 'not recorded';
    const conditions = formatPilotCounts(issue.conditions) || 'not recorded';
    return `${issue.label}: ${issue.total} · Sensitivity: ${sensitivity} · Conditions: ${conditions}`;
  });

  return [
    'Occulert pilot progress',
    `Generated: ${generatedAt.toISOString()}`,
    '',
    `Medium review target: ${Math.min(mediumReviews.length, checkpointTarget)} of ${checkpointTarget}`,
    `Complete local reviews: ${completeReviews.length}`,
    `Recovered partial sessions excluded: ${recoveredCount}`,
    '',
    'Alert ratings · completed Medium reviews',
    countLine(mediumReviews, ASSESSMENT_LABELS, session => session.alertAssessment),
    '',
    `Condition coverage: ${coverage.coveredCount} of ${coverage.totalCount} planned variants represented`,
    coverage.items.map(item => `${item.label} ${item.count}`).join(' · '),
    coverage.missingLabels.length > 0
      ? `Still needed: ${coverage.missingLabels.join(', ')}`
      : 'No planned condition gaps remain.',
    '',
    'Device impact · tester-reported completed Medium reviews',
    `Battery use: ${countLine(mediumReviews, BATTERY_LABELS, session => session.deviceImpact?.batteryImpact)}`,
    `Phone heat: ${countLine(mediumReviews, HEAT_LABELS, session => session.deviceImpact?.phoneHeat)}`,
    '',
    'Observed alert patterns · all completed reviews',
    ...issueLines,
    '',
    'Evidence note: These are local tester observations and counts, not accuracy or safety-effectiveness rates. One session in a condition is not enough to establish accuracy.',
    'Privacy: This aggregate report excludes session and driver identifiers, dates of individual sessions, location, camera media, audio, raw motion, and performance diagnostics.',
    'Safety: Occulert is a supplemental prototype and does not determine fitness to drive.',
  ].join('\n');
}
