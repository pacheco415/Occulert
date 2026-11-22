// Full draft catalog inventory for review and test tooling.
import { en, type StringCatalog } from '../strings.ts';
import { catalogKeyPaths } from './catalog-shape.ts';
import { createDraft, draftEntries, leaf, validateCatalog } from './draft-catalog.ts';
import { nativeLocaleCodes, selectNativeLocale, type NativeLocale, type DraftLocale } from './language.ts';
export { nativeLocaleCodes, nativeLocaleReviews, type NativeLocale } from './language.ts';

export function validateNativeCatalog(candidate: unknown) {
  return validateCatalog(en, candidate);
}

export const nativeTranslationDrafts: Record<DraftLocale, Record<string, string>> = {
  es: draftEntries('es'), fr: draftEntries('fr'), pt: draftEntries('pt'), de: draftEntries('de'),
  ar: draftEntries('ar'), zh: draftEntries('zh'), ja: draftEntries('ja'),
};

/** Complete translation drafts. Completeness does not establish fluent review. */
export const nativeCatalogs: Record<NativeLocale, StringCatalog> = {
  en, es: createDraft('es', en), fr: createDraft('fr', en), pt: createDraft('pt', en),
  de: createDraft('de', en), ar: createDraft('ar', en), zh: createDraft('zh', en), ja: createDraft('ja', en),
};

export function nativeCatalogCoverage(locale: NativeLocale): { explicitKeys: string[]; missingKeys: string[]; englishIdenticalKeys: string[] } {
  const paths = catalogKeyPaths(en);
  const explicitKeys = locale === 'en' ? paths : Object.keys(nativeTranslationDrafts[locale]);
  const explicit = new Set(explicitKeys);
  return { explicitKeys: [...explicitKeys].sort(), missingKeys: paths.filter(path => !explicit.has(path)).sort(),
    englishIdenticalKeys: paths.filter(path => leaf(nativeCatalogs[locale], path) === leaf(en, path)).sort() };
}

export const availableNativeLocales = nativeLocaleCodes.filter(code => selectNativeLocale(code) === code);

export function resolveNativeCatalog(requested: unknown): StringCatalog {
  return nativeCatalogs[selectNativeLocale(requested)];
}
