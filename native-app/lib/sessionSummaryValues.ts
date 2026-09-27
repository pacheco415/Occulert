/** Format saved measurements without changing records or inventing missing values. */
export function formatSessionDuration(
  value: unknown,
  format: 'clock' | 'summary' = 'clock',
): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return 'Not recorded';
  }

  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return format === 'summary'
    ? `${minutes}m ${remainder}s`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatSessionFatigue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? String(Math.round(value))
    : 'Not recorded';
}
