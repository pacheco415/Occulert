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

export type HistoryPeriod = 'all' | '7-days' | '30-days';

export function normalizeHistoryPeriod(value: string | null | undefined): HistoryPeriod {
  return value === '7-days' || value === '30-days' ? value : 'all';
}

function validTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Keep original storage indices so a dated view edits the same saved records. */
export function filterIndexedSessionsByPeriod<T extends { savedAt?: string; updatedAt?: string }>(
  sessions: Array<{ item: T; index: number }>,
  period: HistoryPeriod,
  now = Date.now(),
): Array<{ item: T; index: number }> {
  if (period === 'all') return sessions;

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
