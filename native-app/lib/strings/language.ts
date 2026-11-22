export const nativeLocaleCodes = ['en', 'es', 'fr', 'pt', 'de', 'ar', 'zh', 'ja'] as const;
export type NativeLocale = typeof nativeLocaleCodes[number];
export type DraftLocale = Exclude<NativeLocale, 'en'>;
type LocaleReview = {
  label: string;
  direction: 'ltr' | 'rtl';
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

// No reviewer or approval is inferred from the web catalog or generated copy.
export const nativeLocaleReviews: Record<NativeLocale, LocaleReview> = {
  en: { label: 'English', direction: 'ltr', reviewed: true, reviewedBy: null, reviewedAt: null },
  es: { label: 'Español', direction: 'ltr', reviewed: false, reviewedBy: null, reviewedAt: null },
  fr: { label: 'Français', direction: 'ltr', reviewed: false, reviewedBy: null, reviewedAt: null },
  pt: { label: 'Português', direction: 'ltr', reviewed: false, reviewedBy: null, reviewedAt: null },
  de: { label: 'Deutsch', direction: 'ltr', reviewed: false, reviewedBy: null, reviewedAt: null },
  ar: { label: 'العربية', direction: 'rtl', reviewed: false, reviewedBy: null, reviewedAt: null },
  zh: { label: '中文', direction: 'ltr', reviewed: false, reviewedBy: null, reviewedAt: null },
  ja: { label: '日本語', direction: 'ltr', reviewed: false, reviewedBy: null, reviewedAt: null },
};

export function selectNativeLocale(tag: unknown, reviews = nativeLocaleReviews): NativeLocale {
  if (typeof tag !== 'string') return 'en';
  try {
    const code = Intl.getCanonicalLocales(tag)[0]?.split('-')[0];
    if (!code || !Object.hasOwn(reviews, code)) return 'en';
    const locale = code as NativeLocale;
    const record = reviews[locale];
    return record.reviewed && record.reviewedBy?.trim() && record.reviewedAt?.trim() ? locale : 'en';
  } catch {
    return 'en';
  }
}

type LanguageSettings = Pick<typeof import('react-native'), 'Platform' | 'Settings' | 'I18nManager'>;

export function nativeLanguagePreference(native: LanguageSettings): string | undefined {
  if (native.Platform.OS === 'ios') {
    const languages = native.Settings.get('AppleLanguages');
    return Array.isArray(languages) && typeof languages[0] === 'string' ? languages[0] : undefined;
  }
  if (native.Platform.OS === 'android') {
    // Android Locale.toString() can include "_#Script". All current catalogs
    // are keyed by primary language, so neither region nor script is needed.
    return native.I18nManager.getConstants().localeIdentifier?.split(/[-_]/)[0];
  }
  return undefined;
}

export function deviceLanguageTag(): string | undefined {
  try {
    if (globalThis.navigator?.product === 'ReactNative') {
      const preference = nativeLanguagePreference(require('react-native'));
      if (preference) return preference;
    }
  } catch { /* Use the system formatting locale if native settings are unavailable. */ }
  try { return Intl.DateTimeFormat().resolvedOptions().locale; }
  catch { return undefined; }
}
