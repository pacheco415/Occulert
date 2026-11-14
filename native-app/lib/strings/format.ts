/** Named display placeholders; protocol values and stored records are not localized. */
type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest> : never;
export type TemplateValues<T extends string> = string extends T
  ? Record<string, string | number> : { [K in Placeholders<T>]: string | number };

export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]))].sort();
}

/** Preserve the caller's existing number/date formatting and substitute text once. */
export function formatString<T extends string>(template: T, values: TemplateValues<T>): string {
  const names = templatePlaceholders(template);
  const provided = values as Record<string, unknown>;
  if (!provided || typeof provided !== 'object' || Array.isArray(provided)
      || Object.keys(provided).length !== names.length
      || names.some(name => !Object.hasOwn(provided, name)
        || !(typeof provided[name] === 'string' || typeof provided[name] === 'number' && Number.isFinite(provided[name])))) {
    throw new Error('Invalid native string template values');
  }
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => String(provided[name]));
}
