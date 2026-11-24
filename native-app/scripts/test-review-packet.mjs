import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { columns, encodeCsv, packetRows, parseCsv } from './lib/review-packet.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'occulert-review-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(new URL('../lib/strings/', import.meta.url), join(dir, 'lib/strings'), { recursive: true });
  cpSync(new URL('../lib/strings.ts', import.meta.url), join(dir, 'lib/strings.ts'));
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
  for (const file of ['export-review-packet.mjs', 'import-review-corrections.mjs', 'lib/review-packet.mjs']) {
    cpSync(new URL(file, import.meta.url), join(dir, 'scripts', file));
  }
  // npm may hoist TypeScript when native-app is nested in another checkout.
  mkdirSync(join(dir, 'node_modules'));
  symlinkSync(new URL('../', import.meta.resolve('typescript')), join(dir, 'node_modules/typescript'), 'dir');
  return {
    dir,
    cli(name, ...args) {
      return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', `scripts/${name}.mjs`, ...args], { cwd: dir, encoding: 'utf8' });
    },
    sources() {
      return readdirSync(join(dir, 'lib/strings')).map(name => [name, readFileSync(join(dir, 'lib/strings', name), 'utf8')]);
    },
  };
}

test('Spanish print and CSV exports cover all screens, flag priority copy and leave source byte-identical on return', t => {
  const { dir, cli, sources } = fixture(t);
  const before = sources();
  const result = cli('export-review-packet', 'es', 'packet');
  assert.equal(result.status, 0, result.stderr);
  const csv = readFileSync(join(dir, 'packet/review.csv'), 'utf8');
  const [header, ...rows] = parseCsv(csv);
  assert.deepEqual(header, columns);
  assert.deepEqual(rows, packetRows('es'));
  assert.ok(rows.length >= 963);
  assert.ok(rows.every(row => row[6] === ''));
  for (const key of ['monitor.alerts.critical.title', 'settings.cloud.consent.detail', 'home.recoveryError.retry', 'preDrive.confirmations.limits.detail']) {
    assert.equal(rows.find(row => row[1] === key)[5], 'Priority');
  }
  const html = readFileSync(join(dir, 'packet/review.html'), 'utf8');
  assert.match(html, /@page/);
  assert.equal((html.match(/<tr>/g) ?? []).length, rows.length + 1);
  assert.notEqual(cli('export-review-packet', 'es', 'packet').status, 0);
  assert.equal(readFileSync(join(dir, 'packet/review.csv'), 'utf8'), csv);
  assert.equal(cli('import-review-corrections', 'es', 'packet/review.csv').status, 0);
  assert.deepEqual(sources(), before);
  assert.notEqual(cli('export-review-packet', 'en', 'en-packet').status, 0);
});

test('a late invalid placeholder or stale reference rejects the whole file', t => {
  const { dir, cli, sources } = fixture(t);
  const before = sources();
  const rows = packetRows('es');
  rows[0][6] = 'Primero';
  const templated = rows.find(row => row[3].includes('{'));
  templated[6] = 'Sin el marcador';
  const run = () => {
    writeFileSync(join(dir, 'review.csv'), encodeCsv([columns, ...rows]));
    return cli('import-review-corrections', 'es', 'review.csv');
  };
  assert.match(run().stderr, /Invalid corrections.*placeholders/);
  assert.deepEqual(sources(), before);
  templated[6] = '';
  templated[4] += ' draft';
  assert.match(run().stderr, /Stale or modified/);
  assert.deepEqual(sources(), before);
});

test('corrections reach the original draft, survive CSV punctuation and keep the gate and sibling language intact', t => {
  const { dir, cli } = fixture(t);
  const language = join(dir, 'lib/strings/language.ts');
  const gate = readFileSync(language, 'utf8');
  for (const locale of ['es', 'ar', 'zh', 'ja']) {
    const rows = packetRows(locale);
    const keys = ['home.title', 'monitor.alerts.critical.title', 'history.common.notRecorded', 'settings.saveError.title', 'preDrive.confirmations.limits.detail'];
    const value = `=<img> "${locale}",\nliteral 'text' & punctuation`;
    for (const row of rows) if (keys.includes(row[1])) row[6] = value;
    const csv = join(dir, 'review.csv');
    writeFileSync(csv, '\uFEFF' + encodeCsv([columns, ...rows]));
    const result = cli('import-review-corrections', locale, csv);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Applied 5 corrections/);
    assert.match(cli('import-review-corrections', locale, csv).stdout, /Applied 0 corrections/);
    assert.equal(cli('export-review-packet', locale, locale).status, 0);
    const exported = parseCsv(readFileSync(join(dir, locale, 'review.csv'), 'utf8')).slice(1);
    assert.deepEqual(exported.filter(row => keys.includes(row[1])).map(row => row[4]), Array(5).fill("'" + value));
    assert.match(cli('import-review-corrections', locale, join(locale, 'review.csv')).stdout, /Applied 0 corrections/);
    const html = readFileSync(join(dir, locale, 'review.html'), 'utf8');
    assert.match(html, /&lt;img&gt;/);
    assert.doesNotMatch(html, /<img>/);
  }
  assert.equal(readFileSync(language, 'utf8'), gate);
});
