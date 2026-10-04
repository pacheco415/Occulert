import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditSourceAssets } from './lib/source-assets.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (cwd, name) => readFileSync(join(cwd, name), 'utf8');
const json = (cwd, name) => JSON.parse(read(cwd, name));
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cwd, ...args) => execFileSync(process.execPath, [join(root, 'scripts/bump-asset.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
const commit = cwd => { git(cwd, 'add', '.'); git(cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture source release'); };
function snapshot(cwd) {
  const files = {};
  function walk(path) { for (const entry of readdirSync(join(cwd, path), { withFileTypes: true })) { if (['.git', 'node_modules'].includes(entry.name)) continue; const name = join(path, entry.name); if (entry.isDirectory()) walk(name); else files[name] = hash(readFileSync(join(cwd, name))); } }
  walk('.'); return files;
}
function fixture(body) {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-bundle-release-'));
  try {
    const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const name of paths) { mkdirSync(dirname(join(cwd, name)), { recursive: true }); cpSync(join(root, name), join(cwd, name)); }
    symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
    git(cwd, 'init', '-q'); commit(cwd); git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    body(cwd);
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('real bundled output and both release no-op modes preserve every file', () => fixture(cwd => {
  const before = snapshot(cwd);
  for (const args of [['--release'], ['--release', '--dry-run']]) { assert.equal(JSON.parse(run(cwd, ...args)).noOp, true); assert.deepEqual(snapshot(cwd), before); }
  assert.equal(auditSourceAssets(cwd)[0].mode, 'bundle');
}));

test('a real module edit releases compiled output and guard while pending work blocks dependency bumps', () => fixture(cwd => {
  const prior = json(cwd, 'asset-integrity.json'), entry = read(cwd, 'src/driver-app.js'), metrics = read(cwd, 'src/metrics.js');
  assert.ok(metrics.includes("'SAFE'")); writeFileSync(join(cwd, 'src/metrics.js'), metrics.replace("'SAFE'", "'READY'"));
  const pending = snapshot(cwd); assert.throws(() => run(cwd, 'detection-experiments.js'), /Pending source edits/); assert.deepEqual(snapshot(cwd), pending);
  const plan = JSON.parse(run(cwd, '--release', '--dry-run')); assert.equal(plan.sources[0].changed, true); assert.deepEqual(snapshot(cwd), pending);
  run(cwd, '--release'); const active = json(cwd, 'asset-versions.json')['driver-app.js'];
  assert.ok(read(cwd, active).includes("'READY'")); assert.equal(read(cwd, 'src/driver-app.js'), entry); assert.equal(auditSourceAssets(cwd).length, 1);
  for (const [name, digest] of Object.entries(prior)) assert.equal(hash(readFileSync(join(cwd, name))), digest);
}));

test('real helper bump and unpublished refresh synchronize modules and exact compiled SRI consumers', () => fixture(cwd => {
  const prior = json(cwd, 'asset-integrity.json'), entry = read(cwd, 'src/driver-app.js');
  run(cwd, 'detection-experiments.js');
  const manifest = json(cwd, 'asset-versions.json');
  const assertPins = () => {
    const helper = readFileSync(join(cwd, manifest['detection-experiments.js'])), pin = 'sha256-' + createHash('sha256').update(helper).digest('base64');
    assert.ok(read(cwd, 'src/ui.js').includes(manifest['detection-experiments.js'])); assert.ok(read(cwd, 'src/ui.js').includes(pin));
    assert.equal(read(cwd, 'src/driver-app.js'), entry); assert.ok(read(cwd, manifest['driver-app.js']).includes(pin));
    assert.equal(auditSourceAssets(cwd).length, 1);
    const hashes = json(cwd, 'asset-integrity.json'); for (const [name, digest] of Object.entries(hashes)) assert.equal(hash(readFileSync(join(cwd, name))), digest);
  };
  assertPins(); writeFileSync(join(cwd, manifest['detection-experiments.js']), read(cwd, manifest['detection-experiments.js']) + '\n// New unpublished helper fixture.\n');
  run(cwd, 'detection-experiments.js', '--refresh'); assertPins();
  for (const [name, digest] of Object.entries(prior)) assert.equal(hash(readFileSync(join(cwd, name))), digest);
  commit(cwd); assert.equal(JSON.parse(run(cwd, '--release')).noOp, true);
}));

test('broken module compilation and public source configuration fail before release writes', () => fixture(cwd => {
  const path = join(cwd, 'src/metrics.js'), original = readFileSync(path); writeFileSync(path, Buffer.concat([original, Buffer.from('\nexport const = ;')]));
  const broken = snapshot(cwd); assert.throws(() => run(cwd, '--release')); assert.deepEqual(snapshot(cwd), broken);
  writeFileSync(path, original); writeFileSync(join(cwd, '.vercelignore'), read(cwd, '.vercelignore').replace('source-driver-contract.json\n', ''));
  assert.throws(() => auditSourceAssets(cwd), /exclude source-driver-contract/);
}));
