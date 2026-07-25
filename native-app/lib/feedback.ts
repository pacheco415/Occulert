import { Linking, Platform } from 'react-native';
import type { SensitivityLevel } from '../constants/thresholds';

export type AlertAssessment = 'accurate' | 'false_alert' | 'missed_alert';

export interface FeedbackSession {
  sessionId?: string;
  savedAt?: string;
  updatedAt?: string;
  durationSec?: number;
  alertCount?: number;
  avgFatigue?: number;
  alertAssessment?: AlertAssessment;
  sensitivity?: SensitivityLevel;
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

export function feedbackUrl(session?: FeedbackSession): string {
  const subject = session ? 'Occulert pilot session feedback' : 'Occulert pilot feedback';
  const lines = [
    'Please tell us what worked, what did not, and whether any alert felt late, missed, or incorrect.',
    '',
    'Feedback:',
    '',
    '--- App details (you can remove these before sending) ---',
    'App version: 1.0.0',
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
