import { en, catalogKeyPaths, compareCatalogKeys, type StringCatalog } from '../strings.ts';
import { templatePlaceholders } from './format.ts';
import { homeTranslationDrafts } from './home-translations.ts';
import { monitorTranslations } from './monitor-translations.ts';
import { historyTranslationDrafts } from './history-translations.ts';
import { settingsTranslations } from './settings-translations.ts';
import { settingsArabicTranslations } from './settings-translations-arabic.ts';
import { settingsEastAsianTranslations } from './settings-translations-east-asian.ts';

export const nativeLocaleCodes = ['en', 'es', 'fr', 'pt', 'de', 'ar', 'zh', 'ja'] as const;
export type NativeLocale = typeof nativeLocaleCodes[number];
type DraftLocale = Exclude<NativeLocale, 'en'>;
type LocaleReview = {
  label: string;
  direction: 'ltr' | 'rtl';
  status: 'source' | 'unreviewed' | 'reviewed';
  reviewedBy: string | null;
  reviewedAt: string | null;
};

// No reviewer or approval is inferred from the web catalog or generated copy.
export const nativeLocaleReviews: Record<NativeLocale, LocaleReview> = {
  en: { label: 'English', direction: 'ltr', status: 'source', reviewedBy: null, reviewedAt: null },
  es: { label: 'Español', direction: 'ltr', status: 'unreviewed', reviewedBy: null, reviewedAt: null },
  fr: { label: 'Français', direction: 'ltr', status: 'unreviewed', reviewedBy: null, reviewedAt: null },
  pt: { label: 'Português', direction: 'ltr', status: 'unreviewed', reviewedBy: null, reviewedAt: null },
  de: { label: 'Deutsch', direction: 'ltr', status: 'unreviewed', reviewedBy: null, reviewedAt: null },
  ar: { label: 'العربية', direction: 'rtl', status: 'unreviewed', reviewedBy: null, reviewedAt: null },
  zh: { label: '中文', direction: 'ltr', status: 'unreviewed', reviewedBy: null, reviewedAt: null },
  ja: { label: '日本語', direction: 'ltr', status: 'unreviewed', reviewedBy: null, reviewedAt: null },
};

function leaf(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => node && typeof node === 'object'
    && Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined, catalog);
}

export function validateNativeCatalog(candidate: unknown): { missing: string[]; extra: string[]; placeholders: string[]; invalid: string[] } {
  const keys = compareCatalogKeys(en, candidate);
  const placeholders = catalogKeyPaths(en).filter(path => {
    const source = leaf(en, path), translated = leaf(candidate, path);
    return typeof translated === 'string' && typeof source === 'string'
      && JSON.stringify(templatePlaceholders(source)) !== JSON.stringify(templatePlaceholders(translated));
  });
  const invalid = catalogKeyPaths(en).filter(path => {
    const value = leaf(candidate, path);
    return typeof value === 'string' && (!value.trim()
      || /[{}]/.test(value.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '')));
  });
  return { ...keys, placeholders, invalid };
}

const settingsDrafts = { ...settingsTranslations, ...settingsArabicTranslations, ...settingsEastAsianTranslations };

function draftEntries(locale: DraftLocale): Record<string, string> {
  const result: Record<string, string> = {};
  const groups: Record<string, string>[] = [homeTranslationDrafts[locale], monitorTranslations[locale],
    Object.fromEntries(Object.entries(historyTranslationDrafts[locale]).map(([path, value]) => [`history.${path}`, value])),
    settingsDrafts[locale]];
  for (const group of groups) for (const [path, value] of Object.entries(group)) {
    if (Object.hasOwn(result, path)) throw new Error(`Duplicate native draft key: ${locale}/${path}`);
    result[path] = value;
  }
  return result;
}

export const nativeTranslationDrafts: Record<DraftLocale, Record<string, string>> = {
  es: draftEntries('es'), fr: draftEntries('fr'), pt: draftEntries('pt'), de: draftEntries('de'),
  ar: draftEntries('ar'), zh: draftEntries('zh'), ja: draftEntries('ja'),
};

function createDraft(locale: DraftLocale): StringCatalog {
  // Static catalog paths only. User values and stored records never enter lookup.
  // Build from explicit entries, without English fallback hiding an unfinished key.
  const catalog: Record<string, unknown> = {};
  const expected = new Set(catalogKeyPaths(en));
  for (const [path, translated] of Object.entries(nativeTranslationDrafts[locale])) {
    if (!expected.has(path)) throw new Error(`Unexpected native draft key: ${locale}/${path}`);
    const segments = path.split('.');
    const last = segments.pop()!;
    let parent = catalog;
    for (const segment of segments) {
      parent[segment] ??= {};
      parent = parent[segment] as Record<string, unknown>;
    }
    parent[last] = translated;
  }
  const validation = validateNativeCatalog(catalog);
  if (Object.values(validation).some(paths => paths.length)) {
    throw new Error(`Invalid native translation draft: ${locale}: ${JSON.stringify(validation)}`);
  }
  return catalog as StringCatalog;
}

/** Complete translation drafts. Completeness does not establish fluent review. */
export const nativeCatalogs: Record<NativeLocale, StringCatalog> = {
  en, es: createDraft('es'), fr: createDraft('fr'), pt: createDraft('pt'),
  de: createDraft('de'), ar: createDraft('ar'), zh: createDraft('zh'), ja: createDraft('ja'),
};

export function nativeCatalogCoverage(locale: NativeLocale): { explicitKeys: string[]; missingKeys: string[]; englishIdenticalKeys: string[] } {
  const paths = catalogKeyPaths(en);
  const explicitKeys = locale === 'en' ? paths : Object.keys(nativeTranslationDrafts[locale]);
  const explicit = new Set(explicitKeys);
  return { explicitKeys: [...explicitKeys].sort(), missingKeys: paths.filter(path => !explicit.has(path)).sort(),
    englishIdenticalKeys: paths.filter(path => leaf(nativeCatalogs[locale], path) === leaf(en, path)).sort() };
}

function isAvailable(locale: NativeLocale): boolean {
  if (locale === 'en') return true;
  const review = nativeLocaleReviews[locale];
  return review.status === 'reviewed' && Boolean(review.reviewedBy?.trim()) && Boolean(review.reviewedAt?.trim())
    && nativeCatalogCoverage(locale).missingKeys.length === 0
    && Object.values(validateNativeCatalog(nativeCatalogs[locale])).every(paths => paths.length === 0);
}

/** Only reviewed, complete languages may ever be offered by a future selector. */
export const availableNativeLocales = nativeLocaleCodes.filter(isAvailable);

/** Hidden, malformed and unknown requests keep the exact released English catalog. */
export function resolveNativeCatalog(requested: unknown): StringCatalog {
  return typeof requested === 'string' && Object.hasOwn(nativeLocaleReviews, requested)
    && isAvailable(requested as NativeLocale) ? nativeCatalogs[requested as NativeLocale] : en;
}
