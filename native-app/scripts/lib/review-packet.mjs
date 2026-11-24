import { en, catalogKeyPaths } from '../../lib/strings.ts';
import { createDraft, leaf } from '../../lib/strings/draft-catalog.ts';
import { nativeLocaleReviews } from '../../lib/strings/language.ts';

export const columns = ['locale', 'key', 'screen', 'english', 'draft', 'priority', 'correction'];
const screens = { navigation: 'Navigation', simulator: 'Simulator', home: 'Home', monitor: 'Monitor',
  history: 'History', settings: 'Settings', preDrive: 'Pre-drive' };

export function packetRows(locale) {
  if (!Object.hasOwn(nativeLocaleReviews, locale) || locale === 'en' || nativeLocaleReviews[locale].reviewed) {
    throw new Error('Choose an unreviewed draft locale.');
  }
  const draft = createDraft(locale, en);
  return catalogKeyPaths(en).map(key => {
    const english = leaf(en, key);
    const priority = /alert|consent|recover|preDrive|safeStop|\.faults\.|\.spoken\./i.test(key)
      || /\b(alerts?|consent|recover\w*|pre-drive)\b/i.test(english);
    return [locale, key, screens[key.split('.')[0]], english, leaf(draft, key), priority ? 'Priority' : '', ''];
  });
}

// Preserve leading spaces and line breaks. A doubled quote represents one quote.
// A spreadsheet must display catalog copy literally even if it starts with a
// formula marker. Escape leading apostrophes too so the encoding is reversible.
export function spreadsheetText(value) {
  return /^(?:'|\s*[=+@-]|[\t\r\n])/.test(value) ? "'" + value : value;
}

export function encodeCsv(rows) {
  return rows.map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(input) {
  const csv = input.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const cells = /(?:"((?:[^"]|"")*)"|([^",\n\r]*))(,|\n|$)/y;
  const rows = [];
  let row = [];
  while (cells.lastIndex < csv.length) {
    const match = cells.exec(csv);
    if (!match) throw new Error('Malformed CSV. Save the complete packet as UTF-8 comma-separated values.');
    row.push(match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'));
    if (match[3] !== ',') {
      rows.push(row);
      row = [];
    } else if (cells.lastIndex === csv.length) {
      rows.push([...row, '']);
    }
  }
  return rows;
}
