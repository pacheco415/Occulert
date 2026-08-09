export type SafeStopKind = 'rest-area' | 'gas-station' | 'food-coffee';

export interface SafeStopOption {
  kind: SafeStopKind;
  label: string;
  detail: string;
}

export const SAFE_STOP_OPTIONS: readonly SafeStopOption[] = [
  { kind: 'rest-area', label: 'Rest area', detail: 'Search for a nearby place to park and rest' },
  { kind: 'gas-station', label: 'Gas station', detail: 'Search for a nearby staffed stop' },
  { kind: 'food-coffee', label: 'Food or coffee', detail: 'Search for a nearby open business' },
];

const SEARCH_QUERIES: Record<SafeStopKind, string> = {
  'rest-area': 'rest area',
  'gas-station': 'gas station',
  'food-coffee': 'food or coffee',
};

export function safeStopSearchQuery(kind: SafeStopKind): string {
  const query = SEARCH_QUERIES[kind];
  if (!query) throw new Error(`Unsupported safe-stop kind: ${String(kind)}`);
  return query;
}

/**
 * Return a primary native Maps URL followed by a web fallback.
 *
 * Occulert does not request, read, store, or upload coordinates here. The
 * selected maps app decides how to center the search using its own settings.
 */
export function buildSafeStopSearchUrls(platform: string, kind: SafeStopKind): readonly string[] {
  const encoded = encodeURIComponent(safeStopSearchQuery(kind));
  const googleMapsWeb = `https://www.google.com/maps/search/?api=1&query=${encoded}`;

  if (platform === 'ios') {
    return [`http://maps.apple.com/?q=${encoded}`, googleMapsWeb];
  }
  if (platform === 'android') {
    return [`geo:0,0?q=${encoded}`, googleMapsWeb];
  }
  return [googleMapsWeb];
}
