import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = new URL('./update-sitemap.mjs', import.meta.url);
const record = (url, date = '2020-01-01') => `<url><loc>${url}</loc><lastmod>${date}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
const document = records => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${records.join('\n')}</urlset>\n`;
const git = (cwd, args, env = {}) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const run = (cwd, ...args) => execFileSync(process.execPath, ['scripts/update-sitemap.mjs', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-sitemap-'));
  mkdirSync(join(cwd, 'scripts'));
  cpSync(source, join(cwd, 'scripts/update-sitemap.mjs'));
  writeFileSync(join(cwd, 'index.html'), '<script src="/shared.v1.js"></script>');
  writeFileSync(join(cwd, 'guide.html'), '<script src="/shared.v1.js"></script>');
  writeFileSync(join(cwd, 'shared.v1.js'), 'const source = 1;\n');
  writeFileSync(join(cwd, 'sitemap.xml'), document([record('https://www.occulert.com/')]));
  return cwd;
}
function commit(cwd, date) {
  git(cwd, ['add', '.']);
  git(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture source'], { GIT_AUTHOR_DATE: date + 'T12:00:00Z', GIT_COMMITTER_DATE: date + 'T12:00:00Z' });
}
const cleanup = cwd => rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

test('generation deduplicates fragments and derives distinct dates from tracked pages and direct assets', () => {
  const cwd = fixture();
  try {
    writeFileSync(join(cwd, 'sitemap.xml'), document([
      record('https://www.occulert.com/'), record('https://www.occulert.com/#features'), record('https://www.occulert.com/guide.html?preview=1'),
    ]));
    git(cwd, ['init', '-q']);commit(cwd, '2020-02-03');
    writeFileSync(join(cwd, 'shared.v1.js'), 'const source = 2;\n');commit(cwd, '2020-04-05');
    writeFileSync(join(cwd, 'guide.html'), '<script src="/shared.v1.js"></script><p>Updated guide</p>');commit(cwd, '2020-06-07');
    run(cwd);
    const output = readFileSync(join(cwd, 'sitemap.xml'), 'utf8');
    assert.equal((output.match(/<url>/g) || []).length, 2);
    assert.match(output, /<loc>https:\/\/www\.occulert\.com\/<\/loc><lastmod>2020-04-05<\/lastmod>/);
    assert.match(output, /<loc>https:\/\/www\.occulert\.com\/guide\.html<\/loc><lastmod>2020-06-07<\/lastmod>/);
    assert.doesNotMatch(output, /#features|preview=1/);
    assert.match(run(cwd, '--check'), /2 canonical pages/);
    run(cwd);assert.equal(readFileSync(join(cwd, 'sitemap.xml'), 'utf8'), output);
  } finally { cleanup(cwd); }
});

test('checking rejects empty, duplicate, noncanonical, missing and invalid-date records', () => {
  const cwd = fixture();
  try {
    for (const records of [
      [], [record('https://www.occulert.com/'), record('https://www.occulert.com/')],
      [record('https://www.occulert.com/#features')], [record('https://www.occulert.com/?preview=1')],
      [record('https://other.example/')], [record('https://private:secret@www.occulert.com/')],
      [record('https://www.occulert.com/missing.html')], [record('https://www.occulert.com/', '2025-02-29')],
      [record('https://www.occulert.com/', '2999-01-01')],
    ]) {
      writeFileSync(join(cwd, 'sitemap.xml'), document(records));
      assert.throws(() => run(cwd, '--check'));
    }
  } finally { cleanup(cwd); }
});

test('generation refuses shallow history while checking remains available', () => {
  const cwd = fixture();
  try {
    git(cwd, ['init', '-q']);commit(cwd, '2020-02-03');
    writeFileSync(join(cwd, '.git/shallow'), git(cwd, ['rev-parse', 'HEAD']));
    const before = readFileSync(join(cwd, 'sitemap.xml'), 'utf8');
    assert.throws(() => run(cwd), error => String(error.stderr).includes('complete checkout'));
    assert.equal(readFileSync(join(cwd, 'sitemap.xml'), 'utf8'), before);
    assert.match(run(cwd, '--check'), /1 canonical pages/);
  } finally { cleanup(cwd); }
});
