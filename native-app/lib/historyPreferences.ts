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

function validTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
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
