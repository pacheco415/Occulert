import type { StringCatalog } from '../strings.ts';
import type { DraftLocale } from './language.ts';
import { catalogKeyPaths, compareCatalogKeys } from './catalog-shape.ts';
import { templatePlaceholders } from './format.ts';
import { homeTranslationDrafts } from './home-translations.ts';
import { monitorTranslations } from './monitor-translations.ts';
import { historyTranslationDrafts } from './history-translations.ts';
import { settingsTranslations } from './settings-translations.ts';
import { settingsArabicTranslations } from './settings-translations-arabic.ts';
import { settingsEastAsianTranslations } from './settings-translations-east-asian.ts';

export function leaf(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => node && typeof node === 'object'
    && Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined, catalog);
}

export function validateCatalog(en: StringCatalog, candidate: unknown): { missing: string[]; extra: string[]; placeholders: string[]; invalid: string[] } {
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

export function draftEntries(locale: DraftLocale): Record<string, string> {
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

export function createDraft(locale: DraftLocale, en: StringCatalog): StringCatalog {
  // Static catalog paths only. User values and stored records never enter lookup.
  // Build from explicit entries, without English fallback hiding an unfinished key.
  const catalog: Record<string, unknown> = {};
  const expected = new Set(catalogKeyPaths(en));
  for (const [path, translated] of Object.entries(draftEntries(locale))) {
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
  const validation = validateCatalog(en, catalog);
  if (Object.values(validation).some(paths => paths.length)) {
    throw new Error(`Invalid native translation draft: ${locale}: ${JSON.stringify(validation)}`);
  }
  return catalog as StringCatalog;
}
