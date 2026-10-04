import type { SessionRecord, SessionOperation } from './historyRecord';
import { filterIndexedSessionsByPeriod, filterIndexedSessionsByRecordedConditions, filterIndexedSessionsByAssessment, sortIndexedSessions, type HistoryFilter, type HistoryPeriod, type HistoryAssessmentFilter, type HistoryViewPreferences } from './historyPreferences.ts';
import { summarizePilotCoverage, summarizePilotIssues } from './pilotInsights.ts';
import { summarizeFusionValidation, planNextFusionValidationSession } from './fusionValidationSummary.ts';
import { CHECKPOINT_TARGET, HISTORY_ASSESSMENTS, HISTORY_SORTS, historyReviewInput, hasCompleteHistoryReview, matchesHistoryReviewFilter, historyScopeLabel, historyReviewQueue } from './historyReviewModel.ts';

export interface HistoryViewInput {
  sessions: SessionRecord[];
  historyFilter: HistoryFilter;
  historyPeriod: HistoryPeriod;
  historyAssessment: HistoryAssessmentFilter;
  historyView: HistoryViewPreferences;
  sessionOperations: Record<string, SessionOperation>;
  now?: number;
}

/** Derive display copies while retaining each original record and storage index. */
export function deriveHistoryView({ sessions, historyFilter, historyPeriod, historyAssessment, historyView, sessionOperations, now = Date.now() }: HistoryViewInput) {
  const evidenceSessions = sessions.filter(item => !item.recoveredFromInterruption);
  const reviewedMedium = evidenceSessions.filter(
    item => item.sensitivity === 'medium' && hasCompleteHistoryReview(item),
  );
  const checkpointProgress = Math.min(reviewedMedium.length, CHECKPOINT_TARGET);
  const accurateCount = reviewedMedium.filter(item => item.alertAssessment === 'accurate').length;
  const falseAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'false_alert').length;
  const missedAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'missed_alert').length;
  const lateAlertCount = reviewedMedium.filter(item => item.alertAssessment === 'late_alert').length;
  const completeConditionCount = reviewedMedium.filter(item => (
    Boolean(item.testConditions?.lighting)
    && Boolean(item.testConditions?.eyewear)
    && Boolean(item.testConditions?.phonePosition)
  )).length;
  const completeDeviceImpactCount = reviewedMedium.filter(item => (
    Boolean(item.deviceImpact?.batteryImpact) && Boolean(item.deviceImpact?.phoneHeat)
  )).length;
  const pilotCoverage = summarizePilotCoverage(reviewedMedium);
  const issueInsights = summarizePilotIssues(evidenceSessions.map(historyReviewInput));
  const issueSessionCount = issueInsights.reduce((total, insight) => total + insight.total, 0);
  const fusionValidation = summarizeFusionValidation(sessions);
  const fusionSessionPlan = planNextFusionValidationSession(sessions);
  const reviewedCount = sessions.filter(item => !item.recoveredFromInterruption && hasCompleteHistoryReview(item)).length;
  const needsReviewCount = sessions.filter(item => !item.recoveredFromInterruption && !hasCompleteHistoryReview(item)).length;
  const recoveredCount = sessions.filter(item => item.recoveredFromInterruption).length;
  const sortedSessions = sortIndexedSessions(sessions, historyView.sort);
  const periodSessions = filterIndexedSessionsByPeriod(sortedSessions, historyPeriod, now, historyView.range);
  const recordedSessions = filterIndexedSessionsByRecordedConditions(periodSessions, historyView);
  const assessmentSessions = filterIndexedSessionsByAssessment(recordedSessions, historyAssessment);
  const filterCounts: Record<HistoryFilter, number> = {
    all: assessmentSessions.length,
    'needs-review': assessmentSessions.filter(({ item }) => matchesHistoryReviewFilter(item, 'needs-review')).length,
    reviewed: assessmentSessions.filter(({ item }) => matchesHistoryReviewFilter(item, 'reviewed')).length,
    recovered: assessmentSessions.filter(({ item }) => matchesHistoryReviewFilter(item, 'recovered')).length,
  };
  const reviewStatusSessions = recordedSessions.filter(({ item }) => matchesHistoryReviewFilter(item, historyFilter));
  const assessmentCounts = Object.fromEntries(HISTORY_ASSESSMENTS.map(assessment => [
    assessment.value,
    filterIndexedSessionsByAssessment(reviewStatusSessions, assessment.value).length,
  ])) as Record<HistoryAssessmentFilter, number>;
  const filteredSessions = filterIndexedSessionsByAssessment(reviewStatusSessions, historyAssessment);
  const selectedScope = historyScopeLabel(historyPeriod, historyFilter, historyAssessment, historyView);
  const visibleReviewQueue = historyReviewQueue(filteredSessions);
  const nextReviewSession = visibleReviewQueue[0];
  const shownRecoveredCount = filteredSessions.filter(({ item }) => item.recoveredFromInterruption).length;
  // A single shown group keeps metric and oldest sorting intact instead of regrouping by date.
  const groupedFilteredSessions = filteredSessions.length > 0 ? [{
    key: 'shown',
    label: HISTORY_SORTS.find(option => option.value === historyView.sort)?.label || 'Newest first',
    sessions: filteredSessions,
  }] : [];
  const sessionOperationsBusy = Object.keys(sessionOperations).length > 0;

  return { evidenceSessions, reviewedMedium, checkpointProgress, accurateCount, falseAlertCount, missedAlertCount, lateAlertCount, completeConditionCount, completeDeviceImpactCount, pilotCoverage, issueInsights, issueSessionCount, fusionValidation, fusionSessionPlan, reviewedCount, needsReviewCount, recoveredCount, sortedSessions, periodSessions, recordedSessions, assessmentSessions, filterCounts, reviewStatusSessions, assessmentCounts, filteredSessions, selectedScope, visibleReviewQueue, nextReviewSession, shownRecoveredCount, groupedFilteredSessions, sessionOperationsBusy };
}

export type HistoryViewModel = ReturnType<typeof deriveHistoryView>;
