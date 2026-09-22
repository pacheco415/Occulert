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

export function getSessionReviewProgress(session: FeedbackSession): SessionReviewProgress {
  const steps: SessionReviewStep[] = [
    {
      id: 'assessment',
      label: 'Alert rating',
      complete: Boolean(session.alertAssessment),
      missing: session.alertAssessment ? [] : ['alert rating'],
    },
    {
      id: 'conditions',
      label: 'Test conditions',
      complete: Boolean(
        session.testConditions?.lighting
        && session.testConditions?.eyewear
        && session.testConditions?.phonePosition,
      ),
      missing: [
        !session.testConditions?.lighting && 'lighting',
        !session.testConditions?.eyewear && 'eyewear',
        !session.testConditions?.phonePosition && 'phone position',
      ].filter((value): value is string => Boolean(value)),
    },
    {
      id: 'device-impact',
      label: 'Device impact',
      complete: Boolean(session.deviceImpact?.batteryImpact && session.deviceImpact?.phoneHeat),
      missing: [
        !session.deviceImpact?.batteryImpact && 'battery use',
        !session.deviceImpact?.phoneHeat && 'phone heat',
      ].filter((value): value is string => Boolean(value)),
    },
  ];
  const completedSteps = steps.filter(step => step.complete).length;
  const missing = steps.flatMap(step => step.missing);

  return {
    steps,
    completedSteps,
    totalSteps: steps.length,
    complete: completedSteps === steps.length,
    missingSummary: missing.length === 0 ? 'Nothing missing' : `Still needed: ${missing.join(', ')}`,
  };
}

export function hasCompleteSessionReview(session: FeedbackSession): boolean {
  return getSessionReviewProgress(session).complete;
}
