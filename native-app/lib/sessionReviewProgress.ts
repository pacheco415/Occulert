import { strings, formatString } from './strings.ts';
import type { FeedbackSession } from './feedback';

export type SessionReviewStepId = 'assessment' | 'conditions' | 'device-impact';

export interface SessionReviewStep {
  id: SessionReviewStepId;
  label: string;
  complete: boolean;
  missing: string[];
}

export interface SessionReviewProgress {
  steps: SessionReviewStep[];
  completedSteps: number;
  totalSteps: number;
  complete: boolean;
  missingSummary: string;
}

export interface IndexedReviewSession<T extends FeedbackSession = FeedbackSession> {
  item: T & { recoveredFromInterruption?: boolean };
  index: number;
}

export function getSessionReviewProgress(session: FeedbackSession): SessionReviewProgress {
  const steps: SessionReviewStep[] = [
    {
      id: 'assessment',
      label: strings.history.progress.alertRating,
      complete: Boolean(session.alertAssessment),
      missing: session.alertAssessment ? [] : [strings.history.progress.missingAlertRating],
    },
    {
      id: 'conditions',
      label: strings.history.common.testConditions,
      complete: Boolean(
        session.testConditions?.lighting
        && session.testConditions?.eyewear
        && session.testConditions?.phonePosition,
      ),
      missing: [
        !session.testConditions?.lighting && strings.history.progress.missingLighting,
        !session.testConditions?.eyewear && strings.history.progress.missingEyewear,
        !session.testConditions?.phonePosition && strings.history.progress.missingPhonePosition,
      ].filter((value): value is Exclude<typeof value, false> => Boolean(value)),
    },
    {
      id: 'device-impact',
      label: strings.history.common.deviceImpact,
      complete: Boolean(session.deviceImpact?.batteryImpact && session.deviceImpact?.phoneHeat),
      missing: [
        !session.deviceImpact?.batteryImpact && strings.history.progress.missingBatteryUse,
        !session.deviceImpact?.phoneHeat && strings.history.progress.missingPhoneHeat,
      ].filter((value): value is Exclude<typeof value, false> => Boolean(value)),
    },
  ];
  const completedSteps = steps.filter(step => step.complete).length;
  const missing = steps.flatMap(step => step.missing);

  return {
    steps,
    completedSteps,
    totalSteps: steps.length,
    complete: completedSteps === steps.length,
    missingSummary: missing.length === 0 ? strings.history.progress.nothingMissing : formatString(strings.history.progress.stillNeeded, { items: missing.join(', ') }),
  };
}

export function hasCompleteSessionReview(session: FeedbackSession): boolean {
  return getSessionReviewProgress(session).complete;
}

export function incompleteSessionReviewQueue<T extends FeedbackSession>(
  newestFirstSessions: Array<IndexedReviewSession<T>>,
  excludedIndex?: number,
): Array<IndexedReviewSession<T>> {
  return newestFirstSessions.filter(({ item, index }) => (
    index !== excludedIndex
    && !item.recoveredFromInterruption
    && !hasCompleteSessionReview(item)
  ));
}
