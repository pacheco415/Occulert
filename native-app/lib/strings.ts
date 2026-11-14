// English source copy for native screens (Vision roadmap Task 6.1, first step).
// Screens read user-facing text from this catalog instead of hard-coding it, so
// another language can later be added and checked key for key. Only English
// exists today. Translated safety, alert and consent copy needs fluent human
// review before release; values here must keep their released wording.

export const en = {
  home: {
    privacyPill: 'ON-DEVICE · PRIVATE',
    eyebrow: 'DRIVER AWARENESS',
    title: 'Stay alert.\nArrive safe.',
    subtitle: 'Supplemental fatigue alerts, designed to stay clear and calm when the road needs your attention.',
    parkedSetup: 'Set up only while parked. Mount the phone facing you, then keep Occulert in the foreground.',
    recoveryChecking: {
      accessibilityLabel: 'Checking for an interrupted previous drive',
      title: 'Checking the previous drive',
      detail: 'A new session will be available when this local recovery check finishes.',
    },
    recoveryRecovered: {
      accessibilityLabel: 'Previous interrupted drive recovered. Open session history',
      title: 'Previous drive recovered',
      detail: 'A local checkpoint was saved after monitoring ended unexpectedly. Review it in Session History.',
    },
    recoveryError: {
      title: 'Couldn’t check the previous drive',
      unreadableDetail: 'The checkpoint was kept, but Occulert cannot read it. You can retry or review the explicit discard option in Settings. Consider contacting pilot support before discarding it.',
      retryableDetail: 'Your local history stays on this iPhone. Try the recovery check again before starting another session.',
      retryAccessibilityLabel: 'Retry previous drive recovery',
      retry: 'Try again',
      reviewAccessibilityLabel: 'Open Settings to review unreadable recovery data',
      review: 'Review in Settings',
    },
    start: {
      blockedAccessibilityLabel: 'Pre-drive safety check unavailable while previous drive recovery is unresolved',
      readyAccessibilityLabel: 'Begin pre-drive safety check',
      checkingHint: 'Wait for the local recovery check to finish',
      errorHint: 'Retry previous drive recovery before starting another session',
      readyHint: 'Opens the parked pre-drive safety confirmation',
      checkingLabel: 'Checking previous drive…',
      errorLabel: 'Recovery check required',
      readyLabel: 'Begin safely',
      blockedDetail: 'Resolve local recovery first',
      readyDetail: 'Pre-drive check',
    },
    sectionLabel: 'YOUR OCCULERT',
    historyLink: { label: 'Session history', detail: 'Review test sessions' },
    settingsLink: { label: 'Settings', detail: 'Tune alerts and sync' },
    footer: 'Supplemental prototype only. Pull over whenever you feel drowsy or unsafe.',
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every additional language must match, key for key. */
export type StringCatalog = Widen<typeof en>;

export const strings = en;

/** Dotted paths of every string leaf, for key-parity checks between catalogs. */
export function catalogKeyPaths(catalog: object, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : catalogKeyPaths(value as object, path);
  });
}

/** Keys present in `reference` but missing (or not a string) in `candidate`, and extra keys. */
export function compareCatalogKeys(reference: object, candidate: object): { missing: string[]; extra: string[] } {
  const expected = new Set(catalogKeyPaths(reference)), actual = new Set(catalogKeyPaths(candidate));
  return {
    missing: [...expected].filter(path => !actual.has(path)),
    extra: [...actual].filter(path => !expected.has(path)),
  };
}
