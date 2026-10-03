import { Alert, AppState, Linking, Platform, Share } from 'react-native';
import type { SensitivityLevel } from '../constants/thresholds';
import { currentAppBuildInfo } from './appBuildInfo';
import { formatSessionAlertCount } from './sessionAlertCount';
import { formatSessionDuration, formatSessionFatigue, sessionSavedAt } from './sessionSummaryValues';

export type AlertAssessment = 'accurate' | 'false_alert' | 'missed_alert' | 'late_alert';
export type LightingCondition = 'daylight' | 'low_light';
export type EyewearCondition = 'none' | 'glasses' | 'sunglasses';
export type PhonePosition = 'high' | 'center' | 'low';
export type BatteryImpactObservation = 'low' | 'noticeable' | 'high';
export type PhoneHeatObservation = 'cool' | 'warm' | 'hot';

export interface SessionTestConditions {
  lighting?: LightingCondition;
  eyewear?: EyewearCondition;
  phonePosition?: PhonePosition;
}

export interface SessionDeviceImpact {
  batteryImpact?: BatteryImpactObservation;
  phoneHeat?: PhoneHeatObservation;
}

export interface FeedbackSession {
  sessionId?: string;
  savedAt?: string;
  updatedAt?: string;
  recoveredFromInterruption?: boolean;
  durationSec?: number;
  alertCount?: number;
  avgFatigue?: number;
  headNodObservations?: number;
  cameraHeadNodObservations?: number;
  headphoneHeadNodObservations?: number;
  headphoneMotionSamples?: number;
  headphoneMotionStatus?: string;
  alertAssessment?: AlertAssessment;
  sensitivity?: SensitivityLevel;
  testConditions?: SessionTestConditions;
  deviceImpact?: SessionDeviceImpact;
  appVersion?: string;
  appBuildNumber?: string;
}

const FEEDBACK_EMAIL = 'hello@occulert.com';

function assessmentLabel(value?: AlertAssessment): string {
  if (value === 'accurate') return 'Alerts felt right';
  if (value === 'false_alert') return 'False alert reported';
  if (value === 'missed_alert') return 'Missed alert reported';
  if (value === 'late_alert') return 'Late alert reported';
  return '-';
}

function conditionLabel(value?: string): string {
  if (typeof value !== 'string' || !value) return '-';
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function feedbackDraft(session?: FeedbackSession): { subject: string; body: string } {
  const subject = session ? 'Occulert pilot session feedback' : 'Occulert pilot feedback';
  const currentBuild = currentAppBuildInfo();
  const lines = [
    'Please tell us what worked, what did not, and whether any alert felt late, missed, or incorrect.',
    '',
    'Feedback:',
    '',
    '--- App details (you can remove these before sending) ---',
    'App version: ' + (session?.appVersion || currentBuild.appVersion || '-'),
    'Build number: ' + (session?.appBuildNumber || currentBuild.appBuildNumber || '-'),
    'Platform: ' + Platform.OS,
  ];

  if (session) {
    lines.push(
      'Session: ' + (session.sessionId || '-'),
      'Summary: ' + (session.recoveredFromInterruption === true ? 'Recovered partial session' : 'Session summary; completion not independently verified'),
      'Saved: ' + (sessionSavedAt(session.savedAt, session.updatedAt) || 'Unknown date'),
      'Duration seconds: ' + formatSessionDuration(session.durationSec, 'seconds'),
      'Alerts: ' + formatSessionAlertCount(session.alertCount),
      'Average fatigue: ' + formatSessionFatigue(session.avgFatigue),
      'Experimental camera head-nod observations: ' + formatSessionAlertCount(
        session.cameraHeadNodObservations ?? session.headNodObservations,
      ),
      'Experimental headphone head-nod observations: ' + formatSessionAlertCount(session.headphoneHeadNodObservations),
      'Headphone motion samples processed: ' + formatSessionAlertCount(session.headphoneMotionSamples),
      'Headphone motion status: ' + (session.headphoneMotionStatus || '-'),
      'Sensitivity: ' + (session.sensitivity || '-'),
      'Alert assessment: ' + assessmentLabel(session.alertAssessment),
      'Lighting: ' + conditionLabel(session.testConditions?.lighting),
      'Eyewear: ' + conditionLabel(session.testConditions?.eyewear),
      'Phone position: ' + conditionLabel(session.testConditions?.phonePosition),
      'Battery impact (tester-reported): ' + conditionLabel(session.deviceImpact?.batteryImpact),
      'Phone heat (tester-reported): ' + conditionLabel(session.deviceImpact?.phoneHeat),
    );
  }

  lines.push('', 'No camera images, video, audio, raw motion readings, or location are attached.');
  return { subject, body: lines.join('\n') };
}

function draftUrl(draft: { subject: string; body: string }): string {
  return 'mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(draft.subject) + '&body=' + encodeURIComponent(draft.body);
}

export function feedbackUrl(session?: FeedbackSession): string {
  return draftUrl(feedbackDraft(session));
}

export async function openFeedback(session?: FeedbackSession): Promise<boolean> {
  try {
    await Linking.openURL(feedbackUrl(session));
    return true;
  } catch {
    return false;
  }
}

/** Keep the same draft when Mail fails; sharing requires a second user choice. */
export async function openFeedbackWithFallback(
  session?: FeedbackSession,
  isActive: () => boolean = () => true,
): Promise<void> {
  const current = () => AppState.currentState === 'active' && isActive();
  if (!current()) return;
  const draft = feedbackDraft(session);
  try {
    if (!current()) return;
    await Linking.openURL(draftUrl(draft));
    return;
  } catch {
    if (!current()) return;
  }

  await new Promise<void>(resolve => {
    let choiceMade = false;
    Alert.alert(
      'Mail is unavailable',
      'Your feedback draft is ready. Share it with an app you choose, then review it before sending to hello@occulert.com. Nothing is sent automatically.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => { choiceMade = true; resolve(); } },
        {
          text: 'Share draft',
          onPress: () => {
            choiceMade = true;
            if (!current()) { resolve(); return; }
            void (async () => {
              try {
                await Share.share({
                  title: draft.subject,
                  message: 'To: ' + FEEDBACK_EMAIL + '\nSubject: ' + draft.subject + '\n\n' + draft.body,
                });
              } catch {
                if (current()) {
                  Alert.alert('Feedback draft unavailable', 'The share sheet could not open. Try again, or email hello@occulert.com from your preferred email app.');
                }
              } finally {
                resolve();
              }
            })();
          },
        },
      ],
      { cancelable: true, onDismiss: () => { if (!choiceMade) resolve(); } },
    );
  });
}
