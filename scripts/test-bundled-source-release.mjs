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
    const paths = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
    // Include new reviewable source and release outputs before Git staging.
    for (const entry of Object.values(json(root, 'source-assets.json').assets)) paths.add(entry.source);
    for (const name of Object.values(json(root, 'asset-versions.json'))) paths.add(name);
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
  writeFileSync(join(cwd, 'src/driver-app.js'), read(cwd, 'src/driver-app.js') + '\n// Comment-only source edit.\n');
  const commentOnly = snapshot(cwd);
  assert.equal(JSON.parse(run(cwd, '--release')).noOp, true);
  assert.deepEqual(snapshot(cwd), commentOnly);
  assert.equal(auditSourceAssets(cwd).length, 2);
}));

test('a real module edit releases compiled output and guard while pending work blocks dependency bumps', () => fixture(cwd => {
  const prior = json(cwd, 'asset-integrity.json'), entry = read(cwd, 'src/driver-app.js'), metrics = read(cwd, 'src/metrics.js');
  assert.ok(metrics.includes("'SAFE'")); writeFileSync(join(cwd, 'src/metrics.js'), metrics.replace("'SAFE'", "'READY'"));
  const pending = snapshot(cwd); assert.throws(() => run(cwd, 'detection-experiments.js'), /Pending source edits/); assert.deepEqual(snapshot(cwd), pending);
  const plan = JSON.parse(run(cwd, '--release', '--dry-run')); assert.equal(plan.sources[0].changed, true); assert.deepEqual(snapshot(cwd), pending);
  run(cwd, '--release'); const active = json(cwd, 'asset-versions.json')['driver-app.js'];
  assert.ok(read(cwd, active).includes("'READY'")); assert.equal(read(cwd, 'src/driver-app.js'), entry); assert.equal(auditSourceAssets(cwd).length, 2);
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
    assert.equal(auditSourceAssets(cwd).length, 2);
    const hashes = json(cwd, 'asset-integrity.json'); for (const [name, digest] of Object.entries(hashes)) assert.equal(hash(readFileSync(join(cwd, name))), digest);
  };
  assertPins(); writeFileSync(join(cwd, manifest['detection-experiments.js']), read(cwd, manifest['detection-experiments.js']) + '\n// New unpublished helper fixture.\n');
  run(cwd, 'detection-experiments.js', '--refresh'); assertPins();
  for (const [name, digest] of Object.entries(prior)) assert.equal(hash(readFileSync(join(cwd, name))), digest);
  commit(cwd); assert.equal(JSON.parse(run(cwd, '--release')).noOp, true);
}));

test('changed helper source and driver module release together with one guard and cache update',()=>fixture(cwd=>{
  const before=json(cwd,'asset-versions.json'),prior=json(cwd,'asset-integrity.json');
  const previousCache=Number(read(cwd,'sw.js').match(/const CACHE = 'occulert-v(\d+)'/)[1]);
  writeFileSync(join(cwd,'src/metrics.js'),read(cwd,'src/metrics.js').replace("'SAFE'","'READY'"));
  const helper=read(cwd,'src/detection-experiments.js')+'\n// Paired helper source release fixture.\n';
  writeFileSync(join(cwd,'src/detection-experiments.js'),helper);
  const pending=snapshot(cwd),plan=JSON.parse(run(cwd,'--release','--dry-run'));
  assert.equal(plan.sources.filter(entry=>entry.changed).length,2);
  assert.equal(Object.keys(plan.copies).length,3);assert.deepEqual(snapshot(cwd),pending);
  run(cwd,'--release');const manifest=json(cwd,'asset-versions.json');
  for(const logical of ['driver-app.js','detection-experiments.js','driver-startup-guard.js'])assert.notEqual(manifest[logical],before[logical]);
  assert.equal(read(cwd,manifest['detection-experiments.js']),helper);
  const pin='sha256-'+createHash('sha256').update(helper).digest('base64');
  assert.ok(read(cwd,'src/ui.js').includes(pin));assert.ok(read(cwd,manifest['driver-app.js']).includes(pin));
  assert.ok(read(cwd,manifest['driver-app.js']).includes("'READY'"));
  assert.ok(read(cwd,manifest['driver-startup-guard.js']).includes(manifest['driver-app.js']));
  assert.ok(read(cwd,'sw.js').includes("const CACHE = 'occulert-v"+(previousCache+1)+"'"));
  assert.equal(auditSourceAssets(cwd).length,2);
  for(const [name,digest]of Object.entries(prior))assert.equal(hash(readFileSync(join(cwd,name))),digest);
}));

test('broken module compilation and public source configuration fail before release writes', () => fixture(cwd => {
  const path = join(cwd, 'src/metrics.js'), original = readFileSync(path); writeFileSync(path, Buffer.concat([original, Buffer.from('\nexport const = ;')]));
  const broken = snapshot(cwd); assert.throws(() => run(cwd, '--release')); assert.deepEqual(snapshot(cwd), broken);
  writeFileSync(path, original); writeFileSync(join(cwd, '.vercelignore'), read(cwd, '.vercelignore').replace('source-driver-contract.json\n', ''));
  assert.throws(() => auditSourceAssets(cwd), /exclude source-driver-contract/);
}));

test('actual builder rejects a linked contract in normal and override-staging modes before output', () => fixture(cwd => {
  const path = join(cwd, 'source-driver-contract.json'), original = readFileSync(path), external = join(cwd, 'external-contract.json');
  writeFileSync(external, original); rmSync(path); symlinkSync(external, path);
  const before = snapshot(cwd);
  for (const args of [['--stdout'], ['--stdout', '--overrides']]) {
    let failure;
    try { execFileSync(process.execPath, [join(cwd, 'scripts/build-driver.mjs'), ...args], { cwd, input: '{}', encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (error) { failure = error; }
    assert.ok(failure, 'actual builder must reject the contract link');
    assert.match(String(failure.stderr), /regular owned file: source-driver-contract.json/);
    assert.equal(String(failure.stdout), '');
    assert.deepEqual(snapshot(cwd), before);
  }
}));

test('prebuilt Vercel deployments skip the excluded compiler while CI verifies committed output', () => {
  const config = json(root, 'vercel.json');
  assert.equal(config.buildCommand, '', 'An explicit empty deployment command must override the root package build script');
  assert.equal(json(root, 'package.json').scripts.build, 'node scripts/build-driver.mjs');
  assert.ok(json(root, 'scripts/verify-steps.json').steps.includes('build'), 'Root verification must still compile the actual source');
  const exclusions = new Set(read(root, '.vercelignore').split(/\r?\n/).map(line => line.trim()));
  for (const path of ['src/', 'build/', 'scripts/', 'source-assets.json', 'source-driver-contract.json', 'jsconfig.json', 'eslint.config.mjs'])
    assert.ok(exclusions.has(path), 'Development input must stay excluded from deployment: ' + path);
  const manifest = json(root, 'asset-versions.json'), pins = json(root, 'asset-integrity.json');
  for (const logical of ['driver-app.js', 'driver-startup-guard.js', 'detection-experiments.js']) {
    const active = manifest[logical];
    assert.ok(!exclusions.has(active), 'The committed runtime must remain a deployment asset');
    assert.equal(hash(readFileSync(join(root, active))), pins[active], 'The prebuilt runtime must retain its committed integrity pin');
  }
});
