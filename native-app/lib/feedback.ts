import { Linking, Platform } from 'react-native';
import type { SensitivityLevel } from '../constants/thresholds';
import { currentAppBuildInfo } from './appBuildInfo';

export type AlertAssessment = 'accurate' | 'false_alert' | 'missed_alert';
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
  durationSec?: number;
  alertCount?: number;
  avgFatigue?: number;
  alertAssessment?: AlertAssessment;
  sensitivity?: SensitivityLevel;
  testConditions?: SessionTestConditions;
  deviceImpact?: SessionDeviceImpact;
  appVersion?: string;
  appBuildNumber?: string;
}

const FEEDBACK_EMAIL = 'hello@occulert.com';

function valueOrDash(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : '-';
}

function assessmentLabel(value?: AlertAssessment): string {
  if (value === 'accurate') return 'Alerts felt right';
  if (value === 'false_alert') return 'False alert reported';
  if (value === 'missed_alert') return 'Missed alert reported';
  return '-';
}

function conditionLabel(value?: string): string {
  if (!value) return '-';
  return value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function feedbackUrl(session?: FeedbackSession): string {
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
      'Saved: ' + (session.savedAt || session.updatedAt || '-'),
      'Duration seconds: ' + valueOrDash(session.durationSec),
      'Alerts: ' + valueOrDash(session.alertCount),
      'Average fatigue: ' + valueOrDash(session.avgFatigue),
      'Sensitivity: ' + (session.sensitivity || '-'),
      'Alert assessment: ' + assessmentLabel(session.alertAssessment),
      'Lighting: ' + conditionLabel(session.testConditions?.lighting),
      'Eyewear: ' + conditionLabel(session.testConditions?.eyewear),
      'Phone position: ' + conditionLabel(session.testConditions?.phonePosition),
      'Battery impact (tester-reported): ' + conditionLabel(session.deviceImpact?.batteryImpact),
      'Phone heat (tester-reported): ' + conditionLabel(session.deviceImpact?.phoneHeat),
    );
  }

  lines.push('', 'No camera images, video, audio, or location are attached.');
  return 'mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
}

export async function openFeedback(session?: FeedbackSession): Promise<boolean> {
  try {
    await Linking.openURL(feedbackUrl(session));
    return true;
  } catch {
    return false;
  }
}
