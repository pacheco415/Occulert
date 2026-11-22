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

export function deviceLanguageTag(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; }
  catch { return undefined; }
}
