import { strings } from './strings.ts';
/** Display saved counts without inventing a measurement for legacy records. */
export function formatSessionAlertCount(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : strings.history.common.notRecorded;
}
