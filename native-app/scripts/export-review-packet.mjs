import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { columns, encodeCsv, packetRows, spreadsheetText } from './lib/review-packet.mjs';

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function printable(locale, rows) {
  const body = rows.map(([, key, screen, english, draft, priority]) => `<tr>
<td><strong>${escapeHtml(screen)}</strong><br><code>${escapeHtml(key)}</code><br>${priority}</td>
<td lang="en">${escapeHtml(english)}</td><td lang="${locale}" dir="auto">${escapeHtml(draft)}</td><td></td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Occulert translation review · ${locale}</title>
<style>
@page { size: landscape; margin: 12mm; }
body { font: 11pt system-ui, sans-serif; color: #111; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
th, td { border: 1px solid #888; padding: .5em; vertical-align: top; text-align: start; overflow-wrap: anywhere; }
td { white-space: pre-wrap; } tr { break-inside: avoid; } thead { display: table-header-group; }
</style>
<h1>Occulert translation review · ${locale}</h1>
<p>Review every entry. Give flagged wording particular care and keep named placeholders such as {count}. Write the full replacement in the correction column.</p>
<table><thead><tr><th>Screen, key and priority</th><th>English</th><th>Draft</th><th>Correction</th></tr></thead>
<tbody>${body}</tbody></table></html>\n`;
}

try {
  const [locale, out, ...extra] = process.argv.slice(2);
  if (!locale || !out || extra.length) throw new Error('Usage: node scripts/export-review-packet.mjs <locale> <new-directory>');
  const rows = packetRows(locale);
  const html = printable(locale, rows);
  const csv = encodeCsv([columns, ...rows.map(row => row.map(spreadsheetText))]);
  mkdirSync(out); // Exclusive creation also rejects an existing empty directory or symlink.
  try {
    writeFileSync(join(out, 'review.csv'), csv, { flag: 'wx' });
    writeFileSync(join(out, 'review.html'), html, { flag: 'wx' });
  } catch (error) {
    rmSync(out, { recursive: true, force: true });
    throw error;
  }
  console.log(`Exported ${rows.length} ${locale} entries to ${out}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
