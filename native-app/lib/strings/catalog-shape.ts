/** Dotted paths of every string leaf, for key-parity checks between catalogs. */
export function catalogKeyPaths(catalog: unknown, prefix = ''): string[] {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return [];
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : catalogKeyPaths(value as object, path);
  });
}

/** Keys present in `reference` but missing (or not a string) in `candidate`, and extra keys. */
export function compareCatalogKeys(reference: object, candidate: unknown): { missing: string[]; extra: string[] } {
  const expected = new Set(catalogKeyPaths(reference)), actual = new Set(catalogKeyPaths(candidate));
  const candidateLeaves = (value: unknown, prefix = ''): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
    if (Object.keys(value).length === 0) return prefix ? [prefix] : [];
    return Object.entries(value).flatMap(([key, child]) => candidateLeaves(child, prefix ? `${prefix}.${key}` : key));
  };
  return {
    missing: [...expected].filter(path => !actual.has(path)),
    extra: candidateLeaves(candidate).filter(path => !expected.has(path)),
  };
}
