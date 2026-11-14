import { strings } from './strings.ts';
import type { SensitivityLevel } from '../constants/thresholds';
import type { SessionRecord } from './historyRecord';
import { sessionSavedAt } from './sessionSummaryValues.ts';

/** Preserve the text rendered by saved JSON children before named interpolation. */
export function historyTextValue(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(historyTextValue).join('');
  if (typeof value === 'object') throw new TypeError('Objects are not valid History text children.');
  // Numeric totals can overflow even when each stored measurement is finite.
  // JSX displayed Infinity/NaN as text; the strict template accepts that string.
  return String(value);
}

export function fmtDuration(sec?: number): string {
  if (!sec || sec < 0) return strings.history.presentation.zeroDuration;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

export function fmtDate(iso?: string): string {
  if (!iso) return strings.history.presentation.unknownDate;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return strings.history.presentation.unknownDate;
  return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function sessionHistoryDate(item: SessionRecord): string | undefined {
  return sessionSavedAt(item.savedAt, item.updatedAt) || undefined;
}

export function sensitivityLabel(value?: SensitivityLevel): string {
  if (value === 'low') return strings.history.common.low;
  if (value === 'medium') return strings.history.common.medium;
  if (value === 'high') return strings.history.common.high;
  return strings.history.common.notRecorded;
}

export function headphoneMotionLabel(value?: string): string {
  if (value === 'active') return strings.history.presentation.headphoneActive;
  if (value === 'starting') return strings.history.presentation.headphoneStarting;
  if (value === 'unavailable') return strings.history.presentation.headphoneUnavailable;
  if (value === 'denied') return strings.history.presentation.headphoneDenied;
  if (value === 'error') return strings.history.presentation.headphoneError;
  if (value === 'not-built') return strings.history.presentation.headphoneNotBuilt;
  if (value === 'stopped') return strings.history.presentation.headphoneStopped;
  return strings.history.presentation.headphoneUnknown;
}
