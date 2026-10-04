import type { SensitivityLevel } from '../constants/thresholds';
import type { SessionRecord } from './historyRecord';
import { sessionSavedAt } from './sessionSummaryValues.ts';

export function fmtDuration(sec?: number): string {
  if (!sec || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

export function fmtDate(iso?: string): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function sessionHistoryDate(item: SessionRecord): string | undefined {
  return sessionSavedAt(item.savedAt, item.updatedAt) || undefined;
}

export function sensitivityLabel(value?: SensitivityLevel): string {
  if (value === 'low') return 'Low';
  if (value === 'medium') return 'Medium';
  if (value === 'high') return 'High';
  return 'Not recorded';
}

export function headphoneMotionLabel(value?: string): string {
  if (value === 'active') return 'Compatible headphones provided motion';
  if (value === 'starting') return 'No motion sample arrived before the session ended';
  if (value === 'unavailable') return 'No compatible headphone motion was available';
  if (value === 'denied') return 'Motion access was not allowed';
  if (value === 'error') return 'Headphone motion stopped with an error';
  if (value === 'not-built') return 'This build does not include headphone motion';
  if (value === 'stopped') return 'Headphone motion was stopped';
  return 'Headphone motion status was not recorded';
}

