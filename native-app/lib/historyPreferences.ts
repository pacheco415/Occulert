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
