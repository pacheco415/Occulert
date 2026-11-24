import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const catalogDir = fileURLToPath(new URL('../lib/strings/', import.meta.url));

function variableObject(source, name) {
  const declarations = source.statements.filter(ts.isVariableStatement).flatMap(stmt => stmt.declarationList.declarations);
  let node = declarations.find(decl => decl.name.text === name)?.initializer;
  if (node && ts.isAsExpression(node)) node = node.expression;
  if (!node || !ts.isObjectLiteralExpression(node)) throw new Error(`Unknown draft source format at ${name}.`);
  return node;
}

function properties(node) {
  return new Map(node.properties.map(prop => [prop.name.text, prop.initializer]));
}

// The generated sources use dotted keys, relative History keys, and paired
// Chinese/Japanese Settings values. Replace only the affected TS literals.
function planEdits(locale, corrections, rows) {
  const groups = [
    ['home-translations.ts', 'homeTranslationDrafts'],
    ['monitor-translations.ts', 'monitorTranslations'],
    ['history-translations.ts', 'historyTranslationDrafts'],
  ];
  const paired = locale === 'zh' || locale === 'ja';
  if (paired) groups.push(['settings-translations-east-asian.ts', 'rows']);
  else if (locale === 'ar') groups.push(['settings-translations-arabic.ts', 'settingsArabicTranslations']);
  else groups.push(['settings-translations.ts', 'settingsTranslations']);

  const files = new Map();
  let applied = 0;
  for (const [file, name] of groups) {
    const before = readFileSync(join(catalogDir, file), 'utf8');
    const source = ts.createSourceFile(file, before, ts.ScriptTarget.Latest, true);
    const root = variableObject(source, name);
    const isPair = name === 'rows';
    const catalog = isPair ? root : properties(root).get(locale);
    const edits = [];
    const isHistory = name === 'historyTranslationDrafts';
    for (const [path, value] of properties(catalog)) {
      const key = isHistory ? 'history.' + path : path;
      if (!corrections.has(key)) continue;
      const literal = isPair ? value.elements[locale === 'zh' ? 0 : 1] : value;
      if (!ts.isStringLiteral(literal) || literal.text !== rows.get(key)[4]) {
        throw new Error(`Draft source changed at ${key}. Export a fresh packet.`);
      }
      edits.push([literal, JSON.stringify(corrections.get(key))]);
      applied++;
    }
    if (!edits.length) continue;
    if (isHistory) {
      const list = properties(variableObject(source, 'historyTranslationUnchangedPaths')).get(locale);
      const keys = [...properties(catalog).keys()].filter(path => {
        const key = 'history.' + path;
        const row = rows.get(key);
        return (corrections.get(key) ?? row[4]) === row[3];
      });
      if (JSON.stringify(keys) !== JSON.stringify(list.elements.map(element => element.text))) {
        edits.push([list, keys.length ? '[\n' + keys.map(key => '    ' + JSON.stringify(key)).join(',\n') + '\n  ]' : '[]']);
      }
    }
    let after = before;
    for (const [literal, replacement] of edits.sort(([a], [b]) => b.pos - a.pos)) {
      after = after.slice(0, literal.getStart(source)) + replacement + after.slice(literal.end);
    }
    files.set(file, { before, after });
  }
  if (applied !== corrections.size) throw new Error('A corrected key has no unique draft source.');
  return files;
}

async function importPacket(locale, csv, stage) {
  const { columns, packetRows, parseCsv, spreadsheetText } = await import('./lib/review-packet.mjs');
  const { en } = await import('../lib/strings.ts');
  const { createDraft, validateCatalog } = await import('../lib/strings/draft-catalog.ts');
  const rows = new Map(packetRows(locale).map(row => [row[1], row]));
  const [header, ...records] = parseCsv(readFileSync(csv, 'utf8'));
  if (JSON.stringify(header) !== JSON.stringify(columns)) throw new Error('Invalid review packet columns.');
  const candidate = createDraft(locale, en);
  const seen = new Set();
  const corrections = new Map();
  for (const record of records) {
    const [, key, , , oldDraft, , correction] = record;
    const row = rows.get(key);
    if (!row || seen.has(key) || record.length !== columns.length) throw new Error(`Unknown, duplicate or malformed row: ${key}`);
    seen.add(key);
    // A second import of the same correction is harmless.
    if ([0, 1, 2, 3, 5].some(index => spreadsheetText(row[index]) !== record[index])
      || (oldDraft !== spreadsheetText(row[4]) && correction !== row[4])) {
      throw new Error(`Stale or modified reference fields at ${key}. Export a fresh packet.`);
    }
    if (correction === '' || correction === row[4]) continue;
    const parts = key.split('.');
    const leaf = parts.pop();
    parts.reduce((node, part) => node[part], candidate)[leaf] = correction;
    corrections.set(key, correction);
  }
  if (seen.size !== rows.size) throw new Error('Incomplete review packet.');
  const invalid = validateCatalog(en, candidate);
  if (Object.values(invalid).some(keys => keys.length)) throw new Error('Invalid corrections: ' + JSON.stringify(invalid));
  if (!corrections.size) return 0;

  const files = planEdits(locale, corrections, rows);
  for (const [file, { after }] of files) writeFileSync(join(stage, file), after);
  const written = [];
  try {
    for (const [file, { before }] of files) {
      const target = join(catalogDir, file);
      if (readFileSync(target, 'utf8') !== before) throw new Error(`Source changed during import: ${file}`);
      renameSync(join(stage, file), target);
      written.push(file);
    }
  } catch (error) {
    for (const file of written) writeFileSync(join(catalogDir, file), files.get(file).before);
    throw error;
  }
  return corrections.size;
}

try {
  const [locale, csv, ...extra] = process.argv.slice(2);
  if (!locale || !csv || extra.length) throw new Error('Usage: node scripts/import-review-corrections.mjs <locale> <review.csv>');
  const stage = join(catalogDir, '.review-import');
  mkdirSync(stage); // Serialize overlapping imports before loading the draft modules.
  try {
    const count = await importPacket(locale, csv, stage);
    console.log(`Applied ${count} corrections to the ${locale} draft.`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
