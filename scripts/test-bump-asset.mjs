import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = fileURLToPath(new URL('../', import.meta.url));
const script = join(root, 'scripts/bump-asset.mjs');
const sha = source => createHash('sha256').update(source).digest('hex');
const run = (cwd, ...args) => execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
const read = (cwd, name) => readFileSync(join(cwd, name), 'utf8');
// Fixture repositories must not launch background maintenance or inherit hooks.
const fixtureGit = (cwd, args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });

test('asset release copies importers, preserves published bytes and supports guarded refresh', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-asset-'));
  try {
    const sources = { 'leaf.v1.js': 'const sample = 1;\n', 'main.v1.js': 'import "/leaf.v1.js";\n' };
    for (const [name, source] of Object.entries(sources)) writeFileSync(join(cwd, name), source);
    writeFileSync(join(cwd, 'asset-versions.json'), JSON.stringify({ 'leaf.js': 'leaf.v1.js', 'alias.js': 'leaf.v1.js', 'main.js': 'main.v1.js' }));
    writeFileSync(join(cwd, 'asset-integrity.json'), JSON.stringify(Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, sha(source)]))));
    writeFileSync(join(cwd, 'index.html'), '<script src="/main.v1.js"></script>');
    writeFileSync(join(cwd, 'sw.js'), "const CACHE = 'occulert-v1'; const files = ['/main.v1.js', '/leaf.v1.js'];");
    writeFileSync(join(cwd, 'vercel.json'), JSON.stringify({ headers: [{ source: '/(.*)\\.v2\\.(js|css)', headers: [] }, { source: '/(.*)\\.(js|css)', headers: [] }] }));
    fixtureGit(cwd, ['init', '-q']);
    fixtureGit(cwd, ['add', '.']);
    fixtureGit(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture']);
    assert.throws(() => run(cwd, 'leaf.js', '--refresh'));
    const before = read(cwd, 'asset-versions.json');
    run(cwd, 'leaf.js', '--dry-run');
    assert.equal(read(cwd, 'asset-versions.json'), before);
    run(cwd, 'leaf.js');
    const manifest = JSON.parse(read(cwd, 'asset-versions.json'));
    assert.equal(manifest['leaf.js'], 'leaf.v2.js');
    assert.equal(manifest['alias.js'], 'leaf.v2.js');
    assert.equal(manifest['main.js'], 'main.v2.js');
    assert.match(read(cwd, 'main.v2.js'), /leaf\.v2\.js/);
    assert.match(read(cwd, 'index.html'), /main\.v2\.js/);
    assert.match(read(cwd, 'sw.js'), /occulert-v2/);
    for (const [name, source] of Object.entries(sources)) assert.equal(read(cwd, name), source);
    const headers = JSON.parse(read(cwd, 'vercel.json')).headers;
    assert.equal(headers.at(-1).source, '/(.*)\\.v2\\.(js|css)');
    writeFileSync(join(cwd, 'leaf.v2.js'), 'const sample = 2;\n');
    run(cwd, 'leaf.js', '--refresh');
    assert.equal(JSON.parse(read(cwd, 'asset-integrity.json'))['leaf.v2.js'], sha(read(cwd, 'leaf.v2.js')));
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('the complete site audits pass after a sample asset release', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-site-release-'));
  try {
    const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const name of paths) {
      const destination = join(cwd, name);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(root, name), destination);
    }
    symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
    fixtureGit(cwd, ['init', '-q']);
    fixtureGit(cwd, ['add', '.']);
    fixtureGit(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture source']);
    run(cwd, 'driver-app.js');
    const output = execFileSync(process.execPath, ['scripts/audit-site.mjs'], { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(output, /passed/i);
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
