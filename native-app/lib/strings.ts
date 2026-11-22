// Choose one reviewed catalog and layout direction together at app startup.
import { deviceLanguageTag, nativeLocaleReviews, selectNativeLocale } from './strings/language.ts';
import { loadDraft } from './strings/load-draft.cjs';
export { catalogKeyPaths, compareCatalogKeys } from './strings/catalog-shape.ts';
import { monitorStrings } from './strings/monitor.ts';
import { historyStrings } from './strings/history.ts';
import { settingsStrings, preDriveStrings } from './strings/settings.ts';
export { formatString, templatePlaceholders } from './strings/format.ts';

export const en = {
  navigation: { app: 'Occulert', home: 'Home', monitoring: 'Monitoring', safetyCheck: 'Safety Check' },
  simulator: { title: 'SIMULATOR TRACE', detail: 'Synthetic input · Cloud disabled · Not for driving' },
  monitor: monitorStrings,
  history: historyStrings,
  settings: settingsStrings,
  preDrive: preDriveStrings,
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

function selectDeviceCatalog() {
  const locale = selectNativeLocale(deviceLanguageTag());
  if (locale !== 'en') {
    try { return { locale, catalog: loadDraft(locale, en) }; }
    catch { /* A stale or incomplete reviewed catalog falls back as one unit. */ }
  }
  return { locale: 'en' as const, catalog: en };
}

const selected = selectDeviceCatalog();
export const nativeDirection = nativeLocaleReviews[selected.locale].direction;
export const strings: StringCatalog = selected.catalog;
