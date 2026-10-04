import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditSourceAssets, commitAssetPlan } from './lib/source-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = join(root, 'scripts/bump-asset.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sri = bytes => 'sha256-' + createHash('sha256').update(bytes).digest('base64');
const run = (cwd, ...args) => execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
const read = (cwd, name) => readFileSync(join(cwd, name), 'utf8');
const json = (cwd, name) => JSON.parse(read(cwd, name));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (cwd, name, bytes) => { mkdirSync(dirname(join(cwd, name)), { recursive: true }); writeFileSync(join(cwd, name), bytes); };
const commit = cwd => { git(cwd, 'add', '.'); git(cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture release'); };

function snapshot(cwd) {
  const files = {};
  const walk = dir => {
    for (const entry of readdirSync(join(cwd, dir), { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const name = join(dir, entry.name);
      if (entry.isDirectory()) walk(name);
      else files[name] = sha(readFileSync(join(cwd, name)));
    }
  };
  walk('.');
  return files;
}

function fixture(body) {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-source-release-'));
  const original = {
    'driver-app.v1.js': "const dependency='/utility.v1.js'; const sample=1;\n",
    'utility.v1.js': 'const utility=1;\n',
    'driver-startup-guard.v1.js': "const corePath='/driver-app.v1.js';\n"
  };
  try {
    for (const [name, bytes] of Object.entries(original)) write(cwd, name, bytes);
    write(cwd, 'asset-versions.json', JSON.stringify({ 'driver-app.js': 'driver-app.v1.js', 'utility.js': 'utility.v1.js', 'driver-startup-guard.js': 'driver-startup-guard.v1.js' }));
    write(cwd, 'asset-integrity.json', JSON.stringify(Object.fromEntries(Object.entries(original).map(([name, bytes]) => [name, sha(bytes)]))));
    write(cwd, 'src/driver-app.js', original['driver-app.v1.js']);
    write(cwd, 'src/utility.js', original['utility.v1.js']);
    write(cwd, 'source-assets.json', JSON.stringify({ schemaVersion: 1, assets: { 'driver-app.js': { source: 'src/driver-app.js', mode: 'copy' }, 'utility.js': { source: 'src/utility.js', mode: 'copy' } } }));
    write(cwd, '.vercelignore', 'src/\nbuild/\nsource-assets.json\n');
    write(cwd, 'app.html', `<script id="driver-startup-guard" src="/driver-startup-guard.v1.js" integrity="${sri(original['driver-startup-guard.v1.js'])}" defer></script><script src="/driver-app.v1.js" defer></script>`);
    write(cwd, 'sw.js', `const CACHE = 'occulert-v1';\nconst STARTUP_GUARD_ASSETS = ${JSON.stringify([{ url: '/driver-startup-guard.v1.js', integrity: sri(original['driver-startup-guard.v1.js']) }])};\nconst files=['/driver-app.v1.js','/utility.v1.js'];\n`);
    write(cwd, 'vercel.json', JSON.stringify({ headers: [{ source: '/(.*)\\.(js|css)', headers: [] }] }));
    git(cwd, 'init', '-q'); commit(cwd); git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    body(cwd, original);
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('unchanged source and dry-run are exact filesystem no-ops', () => fixture(cwd => {
  const before = snapshot(cwd);
  for (const args of [['--release'], ['--release', '--dry-run']]) {
    const plan = JSON.parse(run(cwd, ...args));
    assert.equal(plan.noOp, true);
    assert.deepEqual(plan.copies, {});
    assert.equal(plan.cache, undefined);
    assert.deepEqual(snapshot(cwd), before);
  }
  assert.equal(auditSourceAssets(cwd).length, 2);
}));

test('one release composes every changed source, copied importer, guard and pins', () => fixture((cwd, original) => {
  write(cwd, 'src/driver-app.js', original['driver-app.v1.js'].replace('sample=1', 'sample=2'));
  write(cwd, 'src/utility.js', 'const utility=2;\n');
  assert.throws(() => auditSourceAssets(cwd), /Source mismatch.*driver-app\.js/);
  const before = snapshot(cwd);
  const plan = JSON.parse(run(cwd, '--release', '--dry-run'));
  assert.deepEqual(plan.copies, { 'driver-app.v1.js': 'driver-app.v2.js', 'utility.v1.js': 'utility.v2.js', 'driver-startup-guard.v1.js': 'driver-startup-guard.v2.js' });
  assert.deepEqual(snapshot(cwd), before);
  run(cwd, '--release');
  const manifest = json(cwd, 'asset-versions.json');
  for (const logical of ['driver-app.js', 'utility.js']) assert.equal(read(cwd, manifest[logical]), read(cwd, 'src/' + logical));
  assert.match(read(cwd, 'driver-app.v2.js'), /sample=2/);
  assert.match(read(cwd, 'driver-app.v2.js'), /utility\.v2\.js/);
  assert.match(read(cwd, 'driver-startup-guard.v2.js'), /driver-app\.v2\.js/);
  const pin = sri(read(cwd, 'driver-startup-guard.v2.js'));
  assert.ok(read(cwd, 'app.html').includes(`src="/driver-startup-guard.v2.js" integrity="${pin}"`));
  assert.ok(read(cwd, 'sw.js').includes(JSON.stringify({ url: '/driver-startup-guard.v2.js', integrity: pin })));
  assert.match(read(cwd, 'sw.js'), /occulert-v2/);
  assert.equal(json(cwd, 'vercel.json').headers.at(-1).headers.at(-1).value, 'public, max-age=31536000, immutable');
  for (const [name, hash] of Object.entries(json(cwd, 'asset-integrity.json'))) assert.equal(sha(readFileSync(join(cwd, name))), hash);
  for (const [name, bytes] of Object.entries(original)) assert.equal(read(cwd, name), bytes);
  assert.equal(auditSourceAssets(cwd).length, 2);
  assert.throws(() => run(cwd, '--release'), /existing unpublished asset release/);
  commit(cwd);
  assert.equal(JSON.parse(run(cwd, '--release')).noOp, true);
}));

test('an unregistered dependency bump keeps its registered importer source current', () => fixture(cwd => {
  const registry = json(cwd, 'source-assets.json'); delete registry.assets['utility.js'];
  write(cwd, 'source-assets.json', JSON.stringify(registry)); commit(cwd);
  run(cwd, 'utility.js');
  const name = json(cwd, 'asset-versions.json')['driver-app.js'];
  assert.equal(read(cwd, name), read(cwd, 'src/driver-app.js'));
  assert.match(read(cwd, name), /utility\.v2\.js/);
  write(cwd, name, read(cwd, name).replace('sample=1', 'sample=3'));
  run(cwd, 'driver-app.js', '--refresh');
  assert.equal(read(cwd, name), read(cwd, 'src/driver-app.js'));
  assert.equal(auditSourceAssets(cwd).length, 1);
}));

test('pending source edits cannot be discarded by bump or refresh', () => fixture(cwd => {
  write(cwd, 'src/driver-app.js', 'const changed=2;\n');
  const before = snapshot(cwd);
  assert.throws(() => run(cwd, 'utility.js'), /Pending source edits/);
  assert.throws(() => run(cwd, 'driver-app.js', '--refresh'), /Pending source edits/);
  assert.deepEqual(snapshot(cwd), before);
}));

test('edited published bytes are rejected even if their digest was replaced', () => fixture(cwd => {
  write(cwd, 'utility.v1.js', 'const utility=9;\n');
  const hashes = json(cwd, 'asset-integrity.json'); hashes['utility.v1.js'] = sha(read(cwd, 'utility.v1.js'));
  write(cwd, 'asset-integrity.json', JSON.stringify(hashes));
  const before = snapshot(cwd);
  assert.throws(() => run(cwd, '--release'), /edited published bytes/);
  assert.deepEqual(snapshot(cwd), before);
}));

test('deleted prepared URLs and caches stay reserved for a source release', () => fixture(cwd => {
  const initial = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-qb', 'prepared');
  write(cwd, 'driver-app.v2.js', 'const prepared=2;\n');
  write(cwd, 'sw.js', "const CACHE = 'occulert-v9';\n"); commit(cwd);
  git(cwd, 'rm', 'driver-app.v2.js'); commit(cwd);
  git(cwd, 'checkout', '-q', '--detach', initial);
  write(cwd, 'src/driver-app.js', 'const fresh=3;\n');
  const plan = JSON.parse(run(cwd, '--release', '--dry-run'));
  assert.equal(plan.copies['driver-app.v1.js'], 'driver-app.v3.js');
  assert.equal(plan.cache, 'occulert-v10');
}));

test('known newer main must be integrated before source is released', () => fixture(cwd => {
  const initial = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-qb', 'new-main'); write(cwd, 'new.html', '<p>Main</p>'); commit(cwd);
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '--detach', initial);
  write(cwd, 'src/driver-app.js', 'const fresh=3;\n');
  const before = snapshot(cwd);
  assert.throws(() => run(cwd, '--release'), /integrate origin\/main/);
  assert.deepEqual(snapshot(cwd), before);
}));

test('invalid source, registry and guard fail before any output is written', () => {
  for (const mutation of [
    cwd => write(cwd, 'src/driver-app.js', 'const = ;'),
    cwd => { const registry = json(cwd, 'source-assets.json'); registry.assets['driver-app.js'].source = '../outside.js'; write(cwd, 'source-assets.json', JSON.stringify(registry)); },
    cwd => { const registry = json(cwd, 'source-assets.json'); registry.assets['driver-app.js'].mode = 'unknown'; write(cwd, 'source-assets.json', JSON.stringify(registry)); },
    cwd => { write(cwd, 'src/driver-app.js', 'const fresh=3;'); write(cwd, 'app.html', '<p>Missing guard</p>'); },
    cwd => { rmSync(join(cwd, 'src/driver-app.js')); symlinkSync(join(cwd, 'driver-app.v1.js'), join(cwd, 'src/driver-app.js')); }
  ]) fixture(cwd => { mutation(cwd); const before = snapshot(cwd); assert.throws(() => run(cwd, '--release')); assert.deepEqual(snapshot(cwd), before); });
});

test('source audit rejects erased pilot coverage and public or offline source exposure', () => {
  for (const mutation of [
    cwd => { const registry = json(cwd, 'source-assets.json'); delete registry.assets['driver-app.js']; write(cwd, 'source-assets.json', JSON.stringify(registry)); },
    cwd => write(cwd, '.vercelignore', 'build/\nsource-assets.json\n'),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js') + "const sourceCache=['/src/driver-app.js'];\n")
  ]) fixture(cwd => { mutation(cwd); assert.throws(() => auditSourceAssets(cwd)); });
});

test('a mid-commit filesystem failure restores replaced files and removes new files', () => fixture(cwd => {
  chmodSync(join(cwd, 'app.html'), 0o444);
  const before = snapshot(cwd);
  const changes = new Map([['new.v2.js', 'const newFile=1;'], ['app.html', '<p>New</p>'], ['sw.js', 'const worker=2;']]);
  let calls = 0;
  assert.throws(() => commitAssetPlan(cwd, changes, { rename(from, to) {
    if (++calls === 3) throw new Error('Fixture filesystem failure');
    // Use the real operation until the injected final failure.
    renameSync(from, to);
  } }), /Fixture filesystem failure/);
  assert.deepEqual(snapshot(cwd), before);
  assert.equal(statSync(join(cwd, 'app.html')).mode & 0o777, 0o444);
}));

test('a changed real driver source produces an audited guard release without changing prior bytes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-source-site-'));
  try {
    const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const name of paths) { mkdirSync(dirname(join(cwd, name)), { recursive: true }); cpSync(join(root, name), join(cwd, name)); }
    symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
    git(cwd, 'init', '-q'); commit(cwd); git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const prior = json(cwd, 'asset-integrity.json');
    write(cwd, 'src/driver-app.js', read(cwd, 'src/driver-app.js') + '\n// Fixture source release.\n');
    run(cwd, '--release');
    assert.equal(auditSourceAssets(cwd).length, 1);
    for (const [name, hash] of Object.entries(prior)) assert.equal(sha(readFileSync(join(cwd, name))), hash);
    const output = execFileSync(process.execPath, ['scripts/audit-site.mjs'], { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(output, /passed/i);
    assert.equal(existsSync(join(cwd, 'build')), false);
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
