import { formatSessionAlertCount } from './sessionAlertCount.ts';
import { formatSessionDuration, formatSessionFatigue } from './sessionSummaryValues.ts';

export interface ExportableSessionSummary {
  savedAt?: string;
  updatedAt?: string;
  durationSec?: number;
  alertCount?: number;
  avgFatigue?: number;
  sensitivity?: string;
  alertAssessment?: string;
  recoveredFromInterruption?: boolean;
}

const ASSESSMENT_LABELS: Record<string, string> = {
  accurate: 'Felt right',
  false_alert: 'Unnecessary alert',
  missed_alert: 'Missed alert',
  late_alert: 'Too late',
};

function safeDate(item: ExportableSessionSummary): string {
  const source = item.savedAt || item.updatedAt;
  if (!source) return 'Unknown date';
  const date = new Date(source);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'Unknown date';
}

export function buildSessionHistoryExport(sessions: ExportableSessionSummary[]): string {
  const summaries = sessions.map((item, index) => [
    `Session ${index + 1} · ${safeDate(item)}`,
    `Duration: ${formatSessionDuration(item.durationSec, 'summary')} · Alerts: ${formatSessionAlertCount(item.alertCount)}`,
    `Average fatigue: ${formatSessionFatigue(item.avgFatigue)} · Sensitivity: ${item.sensitivity || 'Not recorded'}`,
    `Review: ${item.alertAssessment ? ASSESSMENT_LABELS[item.alertAssessment] || 'Reviewed' : 'Not reviewed'}${item.recoveredFromInterruption ? ' · Recovered partial session' : ''}`,
  ].join('\n'));

  return [
    'Occulert session summaries',
    '',
    ...summaries.flatMap((summary, index) => index === summaries.length - 1 ? [summary] : [summary, '']),
    '',
    'Privacy: This export excludes driver IDs, cloud IDs, location, camera media, audio, raw motion, and local performance diagnostics.',
    'Safety: Occulert is a supplemental prototype and does not determine fitness to drive.',
  ].join('\n');
}
