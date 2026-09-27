import type { AlertAssessment } from './feedback';

export type HistoryFilter = 'all' | 'needs-review' | 'reviewed' | 'recovered';

const HISTORY_FILTERS = new Set<HistoryFilter>([
  'all',
  'needs-review',
  'reviewed',
  'recovered',
]);

export function normalizeHistoryFilter(value: string | null | undefined): HistoryFilter {
  return value && HISTORY_FILTERS.has(value as HistoryFilter) ? value as HistoryFilter : 'all';
}

export type HistoryAssessmentFilter = 'all' | AlertAssessment | 'not-assessed';

const ALERT_ASSESSMENTS = new Set<string>(['accurate', 'false_alert', 'missed_alert', 'late_alert']);

export function hasHistoryAlertAssessment(value: unknown): value is AlertAssessment {
  return typeof value === 'string' && ALERT_ASSESSMENTS.has(value);
}

export function normalizeHistoryAssessmentFilter(value: string | null | undefined): HistoryAssessmentFilter {
  return value === 'not-assessed' || hasHistoryAlertAssessment(value) ? value : 'all';
}

/** Unrecognized legacy ratings remain unassessed without rewriting saved records. */
export function filterIndexedSessionsByAssessment<T extends { alertAssessment?: unknown }>(
  sessions: Array<{ item: T; index: number }>,
  filter: HistoryAssessmentFilter,
): Array<{ item: T; index: number }> {
  if (filter === 'all') return sessions;
  return sessions.filter(({ item }) => filter === 'not-assessed'
    ? !hasHistoryAlertAssessment(item.alertAssessment)
    : item.alertAssessment === filter);
}

export type HistoryPeriod = 'all' | '7-days' | '30-days' | 'custom';

export function normalizeHistoryPeriod(value: string | null | undefined): HistoryPeriod {
  return value === '7-days' || value === '30-days' || value === 'custom' ? value : 'all';
}

function validTimestamp(value: string | undefined): number | null {
  if (typeof value !== 'string' || !value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Keep original storage indices so a dated view edits the same saved records. */
export function filterIndexedSessionsByPeriod<T extends { savedAt?: string; updatedAt?: string }>(
  sessions: Array<{ item: T; index: number }>,
  period: HistoryPeriod,
  now = Date.now(),
  range: HistoryDateRange | null = null,
): Array<{ item: T; index: number }> {
  if (period === 'all') return sessions;

  if (period === 'custom') {
    const validRange = range && validateHistoryDateRange(range.start, range.end, now).range;
    if (!validRange) return [];
    const start = localDateTimestamp(validRange.start)!;
    const end = new Date(localDateTimestamp(validRange.end)!);
    // Advancing a local calendar day keeps the end inclusive across daylight-saving changes.
    end.setDate(end.getDate() + 1);
    return sessions.filter(({ item }) => {
      const timestamp = validTimestamp(item.savedAt) ?? validTimestamp(item.updatedAt);
      return timestamp !== null && timestamp >= start && timestamp < end.getTime() && timestamp <= now;
    });
  }

  const firstDay = new Date(now);
  firstDay.setHours(0, 0, 0, 0);
  firstDay.setDate(firstDay.getDate() - (period === '7-days' ? 6 : 29));
  const firstTimestamp = firstDay.getTime();

  return sessions.filter(({ item }) => {
    const timestamp = validTimestamp(item.savedAt) ?? validTimestamp(item.updatedAt);
    return timestamp !== null && timestamp >= firstTimestamp && timestamp <= now;
  });
}

export function sortIndexedSessionsNewest<T extends { savedAt?: string; updatedAt?: string }>(
  sessions: T[],
): Array<{ item: T; index: number }> {
  return sessions
    .map((item, index) => ({
      item,
      index,
      timestamp: validTimestamp(item.savedAt) ?? validTimestamp(item.updatedAt) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => b.timestamp - a.timestamp || a.index - b.index)
    .map(({ item, index }) => ({ item, index }));
}

export interface HistoryDateRange {
  start: string;
  end: string;
}

function localDateTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime() : null;
}

export function validateHistoryDateRange(
  start: string,
  end: string,
  now = Date.now(),
): { range: HistoryDateRange | null; error: string | null } {
  const startTimestamp = localDateTimestamp(start);
  const endTimestamp = localDateTimestamp(end);
  if (startTimestamp === null || endTimestamp === null) {
    return { range: null, error: 'Enter two real dates as YYYY-MM-DD, with a year of 1900 or later.' };
  }
  if (startTimestamp > endTimestamp) return { range: null, error: 'From must be on or before To.' };
  if (endTimestamp > localDayStart(now)) return { range: null, error: 'Choose dates on or before today on this iPhone.' };
  return { range: { start, end }, error: null };
}

export type HistorySensitivityFilter = 'all' | 'unknown' | 'low' | 'medium' | 'high';
export type HistoryLightingFilter = 'all' | 'unknown' | 'daylight' | 'low_light';
export type HistoryEyewearFilter = 'all' | 'unknown' | 'none' | 'glasses' | 'sunglasses';
export type HistorySort = 'newest' | 'oldest' | 'duration' | 'alerts';

export interface HistoryViewPreferences {
  range: HistoryDateRange | null;
  sensitivity: HistorySensitivityFilter;
  lighting: HistoryLightingFilter;
  eyewear: HistoryEyewearFilter;
  sort: HistorySort;
}

export const DEFAULT_HISTORY_VIEW: HistoryViewPreferences = {
  range: null, sensitivity: 'all', lighting: 'all', eyewear: 'all', sort: 'newest',
};

const SENSITIVITIES = new Set<string>(['low', 'medium', 'high']);
const LIGHTING = new Set<string>(['daylight', 'low_light']);
const EYEWEAR = new Set<string>(['none', 'glasses', 'sunglasses']);

export function normalizeHistoryViewPreferences(raw: string | null | undefined): HistoryViewPreferences {
  if (!raw || raw.length > 2048) return { ...DEFAULT_HISTORY_VIEW };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_HISTORY_VIEW };
    const saved = value as Record<string, unknown>;
    const rawRange = saved.range;
    const rangeRecord = rawRange && typeof rawRange === 'object' && !Array.isArray(rawRange)
      ? rawRange as Record<string, unknown> : null;
    const range = rangeRecord && typeof rangeRecord.start === 'string' && typeof rangeRecord.end === 'string'
      ? validateHistoryDateRange(rangeRecord.start, rangeRecord.end).range : null;
    return {
      range,
      sensitivity: saved.sensitivity === 'unknown' || (typeof saved.sensitivity === 'string' && SENSITIVITIES.has(saved.sensitivity))
        ? saved.sensitivity as HistorySensitivityFilter : 'all',
      lighting: saved.lighting === 'unknown' || (typeof saved.lighting === 'string' && LIGHTING.has(saved.lighting))
        ? saved.lighting as HistoryLightingFilter : 'all',
      eyewear: saved.eyewear === 'unknown' || (typeof saved.eyewear === 'string' && EYEWEAR.has(saved.eyewear))
        ? saved.eyewear as HistoryEyewearFilter : 'all',
      sort: saved.sort === 'oldest' || saved.sort === 'duration' || saved.sort === 'alerts' ? saved.sort : 'newest',
    };
  } catch {
    return { ...DEFAULT_HISTORY_VIEW };
  }
}

function matchesRecordedFilter(value: unknown, filter: string, recorded: Set<string>): boolean {
  if (filter === 'all') return true;
  const known = typeof value === 'string' && recorded.has(value);
  return filter === 'unknown' ? !known : known && value === filter;
}

export function filterIndexedSessionsByRecordedConditions<T extends {
  sensitivity?: unknown;
  testConditions?: { lighting?: unknown; eyewear?: unknown };
}>(
  sessions: Array<{ item: T; index: number }>,
  preferences: HistoryViewPreferences,
): Array<{ item: T; index: number }> {
  return sessions.filter(({ item }) => (
    matchesRecordedFilter(item.sensitivity, preferences.sensitivity, SENSITIVITIES)
    && matchesRecordedFilter(item.testConditions?.lighting, preferences.lighting, LIGHTING)
    && matchesRecordedFilter(item.testConditions?.eyewear, preferences.eyewear, EYEWEAR)
  ));
}

function compareRecordedNumbers(a: number | null, b: number | null, ascending = false): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}

export function sortIndexedSessions<T extends {
  savedAt?: string; updatedAt?: string; durationSec?: unknown; alertCount?: unknown;
}>(sessions: T[], order: HistorySort): Array<{ item: T; index: number }> {
  return sessions.map((item, index) => ({ item, index })).sort((a, b) => {
    const aDate = validTimestamp(a.item.savedAt) ?? validTimestamp(a.item.updatedAt);
    const bDate = validTimestamp(b.item.savedAt) ?? validTimestamp(b.item.updatedAt);
    if (order === 'newest' || order === 'oldest') {
      return compareRecordedNumbers(aDate, bDate, order === 'oldest') || a.index - b.index;
    }
    const recordedValue = (item: T): number | null => {
      const value = order === 'duration' ? item.durationSec : item.alertCount;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
      return order === 'alerts' && !Number.isSafeInteger(value) ? null : value;
    };
    return compareRecordedNumbers(recordedValue(a.item), recordedValue(b.item))
      || compareRecordedNumbers(aDate, bDate) || a.index - b.index;
  });
}

export type HistoryDateGroupKey = 'today' | 'yesterday' | 'earlier';

export interface HistoryDateGroup<T> {
  key: HistoryDateGroupKey;
  label: 'Today' | 'Yesterday' | 'Earlier';
  sessions: Array<{ item: T; index: number }>;
}

function localDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function groupIndexedSessionsByDate<T extends { savedAt?: string; updatedAt?: string }>(
  sessions: Array<{ item: T; index: number }>,
  now = Date.now(),
): Array<HistoryDateGroup<T>> {
  const todayStart = localDayStart(now);
  const yesterday = new Date(todayStart);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = yesterday.getTime();
  const groupedSessions: Record<HistoryDateGroupKey, Array<{ item: T; index: number }>> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  sessions.forEach(session => {
    const timestamp = validTimestamp(session.item.savedAt) ?? validTimestamp(session.item.updatedAt);
    const sessionDayStart = timestamp === null ? null : localDayStart(timestamp);
    const key: HistoryDateGroupKey = sessionDayStart === todayStart
      ? 'today'
      : sessionDayStart === yesterdayStart ? 'yesterday' : 'earlier';
    groupedSessions[key].push(session);
  });

  return ([
    { key: 'today', label: 'Today', sessions: groupedSessions.today },
    { key: 'yesterday', label: 'Yesterday', sessions: groupedSessions.yesterday },
    { key: 'earlier', label: 'Earlier', sessions: groupedSessions.earlier },
  ] satisfies Array<HistoryDateGroup<T>>).filter(group => group.sessions.length > 0);
}
