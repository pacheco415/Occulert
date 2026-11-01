import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditSourceAssets, commitAssetPlan, loadSourceAssets } from './lib/source-assets.mjs';
import { INITIAL_COPY_PIN } from './lib/initial-copy-assets.mjs';

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
      else files[name] = entry.isSymbolicLink() ? 'symlink:' + readlinkSync(join(cwd, name)) : sha(readFileSync(join(cwd, name)));
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

function initialCopy(cwd, logical = 'driver-i18n.js', bytes = "const identity={logical:'driver-i18n.js',source:'src/driver-i18n.js'};\n") {
  const registry = json(cwd, 'source-assets.json');
  registry.assets[logical] = { source: 'src/' + logical, mode: 'copy' };
  write(cwd, 'source-assets.json', JSON.stringify(registry));
  write(cwd, 'src/' + logical, bytes);
  const html = logical.endsWith('.js')
    ? `<script src="/${logical}" data-source="src/${logical}" integrity="${INITIAL_COPY_PIN}" crossorigin="anonymous" async></script>`
    : `<link rel="stylesheet" href="/${logical}" integrity="${INITIAL_COPY_PIN}" crossorigin="anonymous">`;
  write(cwd, 'app.html', read(cwd, 'app.html') + html);
  write(cwd, 'sw.js', read(cwd, 'sw.js') + `const INITIAL_ASSETS=[{url:'/${logical}',integrity:'${INITIAL_COPY_PIN}'}];\n`);
  return logical;
}

test('explicit initial copy release is dry-run safe, pinned, immutable and preserves source identity', () => fixture((cwd, original) => {
  const logical = initialCopy(cwd), registry = read(cwd, 'source-assets.json'), source = read(cwd, 'src/' + logical);
  const before = snapshot(cwd);
  assert.throws(() => run(cwd, '--release'), /Unknown source-managed logical asset/);
  const plan = JSON.parse(run(cwd, '--release', '--init-copy=' + logical, '--dry-run'));
  assert.deepEqual(plan.initializations, { [logical]: 'driver-i18n.v1.js' });
  assert.deepEqual(plan.copies, {});
  assert.equal(plan.sources.find(entry => entry.logical === logical).initial, true);
  assert.equal(plan.sources.find(entry => entry.logical === logical).active, null);
  assert.equal(plan.cache, 'occulert-v2');
  assert.deepEqual(snapshot(cwd), before);
  run(cwd, '--release', '--init-copy=' + logical);
  const manifest = json(cwd, 'asset-versions.json'), filename = manifest[logical], expected = sri(source);
  assert.equal(filename, 'driver-i18n.v1.js');
  assert.equal(read(cwd, filename), source);
  assert.equal(read(cwd, 'src/' + logical), source);
  assert.equal(read(cwd, 'source-assets.json'), registry);
  assert.equal(existsSync(join(cwd, logical)), false, 'no unversioned served alias is created');
  assert.ok(read(cwd, 'app.html').includes(`src="/${filename}" data-source="src/${logical}" integrity="${expected}"`));
  assert.ok(read(cwd, 'sw.js').includes(`url:'/${filename}',integrity:${JSON.stringify(expected)}`));
  assert.match(read(cwd, 'sw.js'), /occulert-v2/);
  assert.equal(json(cwd, 'vercel.json').headers.at(-1).source, '/(.*)\\.v1\\.(js|css)');
  assert.equal(json(cwd, 'vercel.json').headers.at(-1).headers.at(-1).value, 'public, max-age=31536000, immutable');
  for (const [name, hash] of Object.entries(json(cwd, 'asset-integrity.json'))) assert.equal(sha(readFileSync(join(cwd, name))), hash);
  for (const [name, bytes] of Object.entries(original)) assert.equal(read(cwd, name), bytes);
  assert.equal(auditSourceAssets(cwd).length, 3);
  const released = snapshot(cwd);
  assert.throws(() => run(cwd, '--release', '--init-copy=' + logical), /absent from the manifest/);
  assert.throws(() => run(cwd, '--release'), /existing unpublished asset release/);
  assert.deepEqual(snapshot(cwd), released);
  commit(cwd);
  assert.equal(JSON.parse(run(cwd, '--release')).noOp, true);
}));

test('initialization composes changed sources and transitive importers without rewriting source paths or logical keys', () => fixture(cwd => {
  const utility = "const utility=1;const metadata={source:'src/driver-i18n.js',logical:'driver-i18n.js'};\n";
  write(cwd, 'utility.v1.js', utility); write(cwd, 'src/utility.js', utility);
  const hashes = json(cwd, 'asset-integrity.json'); hashes['utility.v1.js'] = sha(utility);
  write(cwd, 'asset-integrity.json', JSON.stringify(hashes)); commit(cwd);
  const originals = Object.fromEntries(Object.values(json(cwd, 'asset-versions.json')).map(name => [name, read(cwd, name)]));
  const logical = initialCopy(cwd, 'driver-i18n.js', "const dependency='/utility.v1.js';const identity={source:'src/driver-i18n.js',logical:'driver-i18n.js'};\n");
  const registry = read(cwd, 'source-assets.json');
  write(cwd, 'src/driver-app.js', read(cwd, 'src/driver-app.js').replace('sample=1', 'sample=2'));
  write(cwd, 'src/utility.js', utility.replace('utility=1', 'utility=2'));
  const plan = JSON.parse(run(cwd, '--release', '--init-copy=' + logical));
  assert.deepEqual(plan.copies, { 'driver-app.v1.js': 'driver-app.v2.js', 'utility.v1.js': 'utility.v2.js', 'driver-startup-guard.v1.js': 'driver-startup-guard.v2.js' });
  assert.equal(plan.cache, 'occulert-v2');
  const manifest = json(cwd, 'asset-versions.json');
  for (const name of ['driver-app.js', 'utility.js', logical]) assert.equal(read(cwd, manifest[name]), read(cwd, 'src/' + name));
  assert.match(read(cwd, manifest['driver-app.js']), /sample=2/);
  assert.match(read(cwd, manifest['utility.js']), /utility=2/);
  assert.ok(read(cwd, manifest[logical]).includes("dependency='/utility.v2.js'"));
  for (const name of ['utility.js', logical]) assert.ok(read(cwd, manifest[name]).includes("source:'src/driver-i18n.js',logical:'driver-i18n.js'"));
  assert.equal(read(cwd, 'source-assets.json'), registry);
  assert.ok(read(cwd, 'app.html').includes(`integrity="${sri(read(cwd, manifest[logical]))}"`));
  assert.equal(auditSourceAssets(cwd).length, 3);
  for (const [name, bytes] of Object.entries(originals)) assert.equal(read(cwd, name), bytes);
}));

test('initial copy initialization supports CSS without an unversioned alias', () => fixture(cwd => {
  const logical = initialCopy(cwd, 'driver-labels.css', '.driver-label{color:inherit}\n');
  run(cwd, '--release', '--init-copy=' + logical);
  assert.equal(json(cwd, 'asset-versions.json')[logical], 'driver-labels.v1.css');
  assert.equal(read(cwd, 'driver-labels.v1.css'), read(cwd, 'src/' + logical));
  assert.ok(read(cwd, 'app.html').includes(`href="/driver-labels.v1.css" integrity="${sri(read(cwd, 'driver-labels.v1.css'))}"`));
  assert.equal(existsSync(join(cwd, logical)), false);
}));

test('initial copy accepts its exact pin and leaves unrelated integrity references unchanged', () => fixture(cwd => {
  const logical = initialCopy(cwd), expected = sri(read(cwd, 'src/' + logical));
  const unrelated = '<script src="/unrelated.v9.js" integrity="sha256-unrelated" crossorigin="anonymous"></script>';
  write(cwd, 'app.html', read(cwd, 'app.html').replace(INITIAL_COPY_PIN, expected) + unrelated);
  write(cwd, 'sw.js', read(cwd, 'sw.js').replace(INITIAL_COPY_PIN, expected) + "const OTHER_ASSETS=[{url:'/unrelated.v9.js',integrity:'sha256-unrelated'}];\n");
  run(cwd, '--release', '--init-copy=' + logical);
  assert.ok(read(cwd, 'app.html').includes(unrelated));
  assert.ok(read(cwd, 'sw.js').includes("{url:'/unrelated.v9.js',integrity:'sha256-unrelated'}"));
}));

test('initial copy uses its registered nested source without renaming it or its registry key', () => fixture(cwd => {
  const logical = initialCopy(cwd), source = 'src/locales/driver-words.js';
  const bytes = "const identity={logical:'driver-i18n.js',source:'src/locales/driver-words.js'};\n";
  const registry = json(cwd, 'source-assets.json'); registry.assets[logical].source = source;
  write(cwd, 'source-assets.json', JSON.stringify(registry)); write(cwd, source, bytes);
  rmSync(join(cwd, 'src/' + logical));
  const registered = read(cwd, 'source-assets.json');
  run(cwd, '--release', '--init-copy=' + logical);
  assert.equal(read(cwd, json(cwd, 'asset-versions.json')[logical]), bytes);
  assert.equal(read(cwd, source), bytes);
  assert.equal(read(cwd, 'source-assets.json'), registered);
  assert.equal(existsSync(join(cwd, 'src/' + logical)), false);
  assert.equal(auditSourceAssets(cwd).length, 3);
}));

test('initial copy rejects a logical stem already owned by an active manifest alias', () => fixture(cwd => {
  const manifest = json(cwd, 'asset-versions.json'), hashes = json(cwd, 'asset-integrity.json');
  manifest['utility.js'] = 'driver-i18n.v4.js';
  write(cwd, manifest['utility.js'], read(cwd, 'utility.v1.js'));
  hashes[manifest['utility.js']] = sha(read(cwd, manifest['utility.js']));
  write(cwd, 'asset-versions.json', JSON.stringify(manifest)); write(cwd, 'asset-integrity.json', JSON.stringify(hashes)); commit(cwd);
  initialCopy(cwd); const before = snapshot(cwd);
  assert.throws(() => run(cwd, '--release', '--init-copy=driver-i18n.js'), /collides with an active asset alias/);
  assert.deepEqual(snapshot(cwd), before);
}));

test('initial copy reserves deleted historical filenames, existing files and cache identities', () => fixture(cwd => {
  const initial = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-qb', 'prepared');
  write(cwd, 'driver-i18n.v7.js', 'const historical=7;\n');
  write(cwd, 'sw.js', "const CACHE = 'occulert-v11';\n"); commit(cwd);
  git(cwd, 'rm', 'driver-i18n.v7.js'); commit(cwd);
  git(cwd, 'checkout', '-q', '--detach', initial);
  const logical = initialCopy(cwd);
  write(cwd, 'driver-i18n.v9.js', 'const localReserved=9;\n');
  const before = snapshot(cwd);
  const plan = JSON.parse(run(cwd, '--release', '--init-copy=' + logical, '--dry-run'));
  assert.equal(plan.initializations[logical], 'driver-i18n.v10.js');
  assert.equal(plan.cache, 'occulert-v12');
  assert.deepEqual(snapshot(cwd), before);
  run(cwd, '--release', '--init-copy=' + logical);
  assert.equal(read(cwd, 'driver-i18n.v9.js'), 'const localReserved=9;\n');
  assert.equal(json(cwd, 'asset-versions.json')[logical], 'driver-i18n.v10.js');
}));

test('initial copy flags cannot bypass existing or pending release baselines', () => {
  for (const mutate of [
    cwd => { const manifest = json(cwd, 'asset-versions.json'); delete manifest['utility.js']; write(cwd, 'asset-versions.json', JSON.stringify(manifest)); return 'utility.js'; },
    cwd => { const logical = initialCopy(cwd); const manifest = json(cwd, 'asset-versions.json'); manifest['utility.js'] = 'utility.v2.js'; write(cwd, 'utility.v2.js', read(cwd, 'utility.v1.js')); write(cwd, 'asset-versions.json', JSON.stringify(manifest)); return logical; },
    cwd => { const logical = initialCopy(cwd); write(cwd, 'utility.v1.js', 'const utility=9;'); const hashes = json(cwd, 'asset-integrity.json'); hashes['utility.v1.js'] = sha(read(cwd, 'utility.v1.js')); write(cwd, 'asset-integrity.json', JSON.stringify(hashes)); return logical; },
  ]) fixture(cwd => {
    const logical = mutate(cwd), before = snapshot(cwd);
    assert.throws(() => run(cwd, '--release', '--init-copy=' + logical), /existing HEAD logical|existing unpublished asset release|edited published bytes/);
    assert.deepEqual(snapshot(cwd), before);
  });
});

test('initial copy rejects ambiguous CLI, unsafe sources and unrequested missing entries without writes', () => {
  const cases = [
    { args: ['utility.js', '--init-copy=driver-i18n.js'] },
    { args: ['--release', '--init-copy=driver-i18n.js', '--init-copy=driver-i18n.js'] },
    { args: ['--release', '--init-copy=../outside.js'] },
    { args: ['--release', '--init-copy='] },
    { args: ['--release', '--init-copy=missing.js'] },
    { args: ['--release', '--init-copy=utility.js'] },
    { mutate: cwd => { const registry = json(cwd, 'source-assets.json'); registry.assets['other.js'] = { source: 'src/other.js', mode: 'copy' }; write(cwd, 'source-assets.json', JSON.stringify(registry)); write(cwd, 'src/other.js', 'const other=1;'); } },
    { mutate: cwd => { const registry = json(cwd, 'source-assets.json'); registry.assets['driver-i18n.js'].mode = 'bundle'; write(cwd, 'source-assets.json', JSON.stringify(registry)); } },
    { mutate: cwd => { const registry = json(cwd, 'source-assets.json'); registry.assets['driver-i18n.js'].source = '../outside.js'; write(cwd, 'source-assets.json', JSON.stringify(registry)); } },
    { mutate: cwd => { const registry = json(cwd, 'source-assets.json'); registry.assets['driver-i18n.js'].source = 'src/utility.js'; write(cwd, 'source-assets.json', JSON.stringify(registry)); } },
    { mutate: cwd => { rmSync(join(cwd, 'src/driver-i18n.js')); symlinkSync(join(cwd, 'utility.v1.js'), join(cwd, 'src/driver-i18n.js')); } },
    { mutate: cwd => { rmSync(join(cwd, 'src/driver-i18n.js')); symlinkSync(join(cwd, 'missing.js'), join(cwd, 'src/driver-i18n.js')); } },
    { mutate: cwd => { const registry = json(cwd, 'source-assets.json'); registry.assets['driver-i18n.js'].source = 'src/linked/words.js'; write(cwd, 'source-assets.json', JSON.stringify(registry)); write(cwd, 'actual/words.js', 'const words=1;'); symlinkSync(join(cwd, 'actual'), join(cwd, 'src/linked'), 'dir'); } },
    { mutate: cwd => write(cwd, 'src/driver-i18n.js', Buffer.from([0xff])) },
    { mutate: cwd => write(cwd, 'src/driver-i18n.js', 'const =;') },
    { mutate: cwd => write(cwd, 'driver-i18n.js', 'const unversioned=1;') },
    { mutate: cwd => write(cwd, 'driver-i18n.v9007199254740992.js', 'const unsafeVersion=1;') },
    { mutate: cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace('occulert-v1', 'occulert-v9007199254740992')) },
  ];
  for (const { mutate, args } of cases) fixture(cwd => {
    initialCopy(cwd); mutate?.(cwd); const before = snapshot(cwd);
    assert.throws(() => run(cwd, ...(args || ['--release', '--init-copy=driver-i18n.js'])));
    assert.deepEqual(snapshot(cwd), before);
  });
});

test('initial copy rejects unrelated or mismatched pins and ambiguous reference ownership', () => {
  const mutations = [
    cwd => write(cwd, 'app.html', read(cwd, 'app.html').replace(INITIAL_COPY_PIN, 'sha256-wrong')),
    cwd => write(cwd, 'app.html', read(cwd, 'app.html').replace(` integrity="${INITIAL_COPY_PIN}"`, '')),
    cwd => write(cwd, 'app.html', read(cwd, 'app.html').replace('src="/driver-i18n.js"', 'src="driver-i18n.js"')),
    cwd => write(cwd, 'app.html', read(cwd, 'app.html').replace('src="/driver-i18n.js"', 'src=/driver-i18n.js').replace(INITIAL_COPY_PIN, sri(read(cwd, 'src/driver-i18n.js')))),
    cwd => write(cwd, 'app.html', read(cwd, 'app.html').replace('src="/driver-i18n.js"', 'src="/other.js"')),
    cwd => write(cwd, 'app.html', read(cwd, 'app.html').replace('src="/driver-i18n.js"', 'src="/driver-i18n.js" src="/other.js"')),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace(INITIAL_COPY_PIN, 'sha256-wrong')),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "url:'driver-i18n.js'")),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "url:'/driver-i18n.js?ambiguous=1'")),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "...other,url:'/driver-i18n.js'")),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "['url']:'/driver-i18n.js'")),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "url:`/driver-i18n.js`").replace(INITIAL_COPY_PIN, sri(read(cwd, 'src/driver-i18n.js')))),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "url:`/driver-i18n.js${suffix}`").replace(INITIAL_COPY_PIN, sri(read(cwd, 'src/driver-i18n.js')))),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "url:`/driver-i18n.js-${suffix}`").replace(INITIAL_COPY_PIN, sri(read(cwd, 'src/driver-i18n.js')))),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js') + "const unpaired='/driver-i18n.js';\n"),
    cwd => write(cwd, 'sw.js', read(cwd, 'sw.js').replace("url:'/driver-i18n.js'", "url:'/other.js'")),
  ];
  for (const mutate of mutations) fixture(cwd => {
    initialCopy(cwd); mutate(cwd); const before = snapshot(cwd);
    assert.throws(() => run(cwd, '--release', '--init-copy=driver-i18n.js'));
    assert.deepEqual(snapshot(cwd), before);
  });
});

test('initial copy rejects runtime JS-loader placeholders instead of guessing URL or pin ownership', () => {
  const loaders = [
    "const script={};script.src='/driver-i18n.js';script.integrity='sha256-INIT-COPY';\n",
    "const script={};script.src='/driver-i18n.js';script.integrity='sha256-already-exact';\n",
    "const script={};script.src=`/driver-i18n.js${suffix}`;\n",
    "const marker='sha256-INIT-COPY';\n",
  ];
  for (const loader of loaders) fixture(cwd => {
    initialCopy(cwd); write(cwd, 'src/utility.js', loader); const before = snapshot(cwd);
    assert.throws(() => run(cwd, '--release', '--init-copy=driver-i18n.js'), /unsupported in runtime JS\/CSS|supported only in HTML and worker pins/);
    assert.deepEqual(snapshot(cwd), before);
  });
});

test('a partial write of a real initialization plan restores prior files and removes the new output', () => fixture(cwd => {
  const logical = initialCopy(cwd), before = snapshot(cwd);
  const plan = JSON.parse(run(cwd, '--release', '--init-copy=' + logical, '--dry-run'));
  const paths = [...new Set([...plan.rewrites, 'asset-versions.json', 'asset-integrity.json', 'vercel.json'])];
  const originals = new Map(paths.map(name => [name, existsSync(join(cwd, name)) ? readFileSync(join(cwd, name)) : null]));
  run(cwd, '--release', '--init-copy=' + logical);
  const changes = new Map(paths.map(name => [name, readFileSync(join(cwd, name))]));
  for (const [name, bytes] of originals) { if (bytes === null) rmSync(join(cwd, name)); else write(cwd, name, bytes); }
  assert.deepEqual(snapshot(cwd), before);
  let calls = 0;
  assert.throws(() => commitAssetPlan(cwd, changes, { rename(from, to) {
    if (++calls === 4) throw new Error('Fixture initialization write failure');
    renameSync(from, to);
  } }), /Fixture initialization write failure/);
  assert.deepEqual(snapshot(cwd), before);
  assert.equal(existsSync(join(cwd, plan.initializations[logical])), false);
}));

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

test('source audits accept nested copy output and check full-path integrity and bytes', () => fixture((cwd, original) => {
  const active = 'assets/runtime/utility.v1.js';
  write(cwd, active, original['utility.v1.js']);
  const manifest = json(cwd, 'asset-versions.json'); manifest['utility.js'] = active;
  write(cwd, 'asset-versions.json', JSON.stringify(manifest));
  const hashes = json(cwd, 'asset-integrity.json'); hashes[active] = sha(original['utility.v1.js']);
  write(cwd, 'asset-integrity.json', JSON.stringify(hashes));
  const before = snapshot(cwd);
  assert.equal(auditSourceAssets(cwd).find(entry => entry.logical === 'utility.js').active, active);
  assert.deepEqual(snapshot(cwd), before, 'validation must not move or release files');
  hashes[active] = '0'.repeat(64);
  write(cwd, 'asset-integrity.json', JSON.stringify(hashes));
  assert.throws(() => auditSourceAssets(cwd), /Source output integrity mismatch: assets\/runtime\/utility\.v1\.js/);
  hashes[active] = sha(original['utility.v1.js']);
  write(cwd, 'asset-integrity.json', JSON.stringify(hashes));
  write(cwd, active, 'const altered=2;\n');
  assert.throws(() => auditSourceAssets(cwd), /Source mismatch: utility\.js/);
}));

test('source output validation rejects unsafe locations and symlinked parents or files', () => fixture((cwd, original) => {
  const manifest = json(cwd, 'asset-versions.json');
  for (const active of ['src/utility.v1.js', '../utility.v1.js', '/utility.v1.js', 'assets/runtime/../utility.v1.js', 'assets/runtime/utility.v1.js?cache=1', 'assets/runtime/utility.js']) {
    assert.throws(() => loadSourceAssets(cwd, { ...manifest, 'utility.js': active }), /Invalid active source asset: utility\.js/);
  }
  mkdirSync(join(cwd, 'assets'));
  symlinkSync(cwd, join(cwd, 'assets/runtime'), 'dir');
  const nested = { ...manifest, 'utility.js': 'assets/runtime/utility.v1.js' };
  assert.throws(() => loadSourceAssets(cwd, nested), /symlink/i);
  rmSync(join(cwd, 'assets/runtime'));
  mkdirSync(join(cwd, 'assets/runtime'));
  const output = join(cwd, nested['utility.js']);
  symlinkSync(join(cwd, 'utility.v1.js'), output);
  assert.throws(() => loadSourceAssets(cwd, nested), /symlink/i);
  rmSync(output);
  symlinkSync(join(cwd, 'missing.v1.js'), output);
  assert.throws(() => loadSourceAssets(cwd, nested), /symlink/i);
  assert.equal(read(cwd, 'utility.v1.js'), original['utility.v1.js']);
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
    const paths = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
    // Include reviewable registered source and active assets before Git staging.
    for (const entry of Object.values(json(root, 'source-assets.json').assets)) paths.add(entry.source);
    const contract = json(root, 'source-driver-contract.json');
    for (const module of contract.modules) paths.add('src/' + module);
    for (const input of contract.sharedInputs) paths.add(input);
    for (const name of Object.values(json(root, 'asset-versions.json'))) paths.add(name);
    for (const name of paths) { mkdirSync(dirname(join(cwd, name)), { recursive: true }); cpSync(join(root, name), join(cwd, name)); }
    symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
    git(cwd, 'init', '-q'); commit(cwd); git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const prior = json(cwd, 'asset-integrity.json'), before = json(cwd, 'asset-versions.json');
    const metrics = read(cwd, 'src/metrics.js');
    assert.ok(metrics.includes("'SAFE'")); write(cwd, 'src/metrics.js', metrics.replace("'SAFE'", "'READY'"));
    const plan = JSON.parse(run(cwd, '--release'));
    assert.equal(plan.sources.find(entry => entry.logical === 'driver-app.js').changed, true);
    assert.equal(plan.sources.find(entry => entry.logical === 'detection-experiments.js').changed, false);
    const manifest = json(cwd, 'asset-versions.json');
    assert.notEqual(manifest['driver-app.js'], before['driver-app.js']);
    assert.notEqual(manifest['driver-startup-guard.js'], before['driver-startup-guard.js']);
    assert.equal(manifest['detection-experiments.js'], before['detection-experiments.js']);
    assert.ok(read(cwd, manifest['driver-app.js']).includes("'READY'"));
    assert.deepEqual(auditSourceAssets(cwd).map(({ logical, mode }) => ({ logical, mode })), [
      { logical: 'driver-app.js', mode: 'bundle' },
      { logical: 'detection-experiments.js', mode: 'copy' },
    ]);
    for (const [name, hash] of Object.entries(prior)) assert.equal(sha(readFileSync(join(cwd, name))), hash);
    const output = execFileSync(process.execPath, ['scripts/audit-site.mjs'], { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(output, /passed/i);
    assert.equal(existsSync(join(cwd, 'build')), false);
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('initial copy composes actual bundled source edits without touching source identity', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-source-initial-bundle-'));
  try {
    const paths = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
    paths.add('scripts/lib/initial-copy-assets.mjs');
    for (const entry of Object.values(json(root, 'source-assets.json').assets)) paths.add(entry.source);
    const contract = json(root, 'source-driver-contract.json');
    for (const module of contract.modules) paths.add('src/' + module);
    for (const input of contract.sharedInputs) paths.add(input);
    for (const name of Object.values(json(root, 'asset-versions.json'))) paths.add(name);
    for (const name of paths) { mkdirSync(dirname(join(cwd, name)), { recursive: true }); cpSync(join(root, name), join(cwd, name)); }
    symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
    git(cwd, 'init', '-q'); commit(cwd); git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const prior = json(cwd, 'asset-integrity.json'), logical = initialCopy(cwd), registry = read(cwd, 'source-assets.json');
    write(cwd, 'src/ui.js', read(cwd, 'src/ui.js') + "\nexport const INITIAL_COPY_REFERENCE={source:'src/driver-i18n.js',logical:'driver-i18n.js'};\n");
    write(cwd, 'src/metrics.js', read(cwd, 'src/metrics.js').replace("'SAFE'", "'READY'"));
    const plan = JSON.parse(run(cwd, '--release', '--init-copy=' + logical));
    assert.equal(plan.sources.find(entry => entry.logical === 'driver-app.js').changed, true);
    const manifest = json(cwd, 'asset-versions.json');
    assert.equal(plan.initializations[logical], manifest[logical]);
    assert.ok(read(cwd, manifest['driver-app.js']).includes("'READY'"));
    assert.ok(read(cwd, 'src/ui.js').includes("source:'src/driver-i18n.js',logical:'driver-i18n.js'"));
    assert.equal(read(cwd, 'source-assets.json'), registry);
    assert.equal(auditSourceAssets(cwd).length, 3);
    for (const [name, hash] of Object.entries(prior)) assert.equal(sha(readFileSync(join(cwd, name))), hash);
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
