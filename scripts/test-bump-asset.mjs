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
const fixtureGit = (cwd, args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

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

test('a prepared branch and its deleted URLs reserve immutable asset versions',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'occulert-reserved-'));
 try{
  const source='const sample = 1;\n';
  writeFileSync(join(cwd,'leaf.v1.js'),source);
  writeFileSync(join(cwd,'asset-versions.json'),JSON.stringify({'leaf.js':'leaf.v1.js'}));
  writeFileSync(join(cwd,'asset-integrity.json'),JSON.stringify({'leaf.v1.js':sha(source)}));
  writeFileSync(join(cwd,'index.html'),'<script src="/leaf.v1.js"></script>');
  writeFileSync(join(cwd,'sw.js'),"const CACHE = 'occulert-v1'; const files=['/leaf.v1.js'];\n");
  writeFileSync(join(cwd,'vercel.json'),JSON.stringify({headers:[{source:'/(.*)\\.(js|css)',headers:[]}]}));
  fixtureGit(cwd,['init','-q']);fixtureGit(cwd,['add','.']);
  fixtureGit(cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Initial release']);
  const initial=fixtureGit(cwd,['rev-parse','--abbrev-ref','HEAD']).toString().trim();
  fixtureGit(cwd,['checkout','-qb','prepared-release']);
  writeFileSync(join(cwd,'leaf.v2.js'),'const otherPreparedBytes=2;\n');writeFileSync(join(cwd,'sw.js'),"const CACHE = 'occulert-v2'; const files=['/leaf.v2.js'];\n");fixtureGit(cwd,['add','.']);
  fixtureGit(cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Prepared URL']);
  fixtureGit(cwd,['rm','leaf.v2.js']);writeFileSync(join(cwd,'leaf.v3.js'),'const otherPreparedBytes=3;\n');writeFileSync(join(cwd,'sw.js'),"const CACHE = 'occulert-v3'; const files=['/leaf.v3.js'];\n");fixtureGit(cwd,['add','.']);
  fixtureGit(cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Replacement URL']);
  fixtureGit(cwd,['checkout','-q',initial]);
  const dry=JSON.parse(run(cwd,'leaf.js','--dry-run'));assert.equal(dry.copies['leaf.v1.js'],'leaf.v4.js');assert.equal(dry.cache,'occulert-v4');
  run(cwd,'leaf.js');assert.equal(JSON.parse(read(cwd,'asset-versions.json'))['leaf.js'],'leaf.v4.js');
  assert.equal(read(cwd,'leaf.v1.js'),source);assert.equal(read(cwd,'leaf.v4.js'),source);assert.match(read(cwd,'sw.js'),/occulert-v4/);
 }finally{rmSync(cwd,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('merge-resolution-only filenames and caches stay reserved after removal', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-merge-reserved-'));
  const commit = message => {
    fixtureGit(cwd, ['add', '.']);
    fixtureGit(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message]);
  };
  try {
    const source = 'const sample = 1;\n';
    const initialWorker = "const CACHE = 'occulert-v1'; const files=['/leaf.v1.js'];\n";
    writeFileSync(join(cwd, 'leaf.v1.js'), source);
    writeFileSync(join(cwd, 'asset-versions.json'), JSON.stringify({ 'leaf.js': 'leaf.v1.js' }));
    writeFileSync(join(cwd, 'asset-integrity.json'), JSON.stringify({ 'leaf.v1.js': sha(source) }));
    writeFileSync(join(cwd, 'index.html'), '<script src="/leaf.v1.js"></script>');
    writeFileSync(join(cwd, 'sw.js'), initialWorker);
    writeFileSync(join(cwd, 'vercel.json'), JSON.stringify({ headers: [{ source: '/(.*)\\.(js|css)', headers: [] }] }));
    fixtureGit(cwd, ['init', '-q']); commit('Initial release');
    const initial = fixtureGit(cwd, ['rev-parse', 'HEAD']).toString().trim();
    fixtureGit(cwd, ['checkout', '-qb', 'side-release']);
    writeFileSync(join(cwd, 'sw.js'), initialWorker.replace('occulert-v1', 'occulert-v2')); commit('Side cache');
    fixtureGit(cwd, ['checkout', '-qb', 'merge-release', initial]);
    writeFileSync(join(cwd, 'sw.js'), initialWorker.replace('occulert-v1', 'occulert-v3')); commit('Main cache');
    assert.throws(() => fixtureGit(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '--no-commit', '--no-ff', 'side-release']));
    assert.match(read(cwd, 'sw.js'), /<<<<<<< HEAD/);
    writeFileSync(join(cwd, 'sw.js'), initialWorker.replace('occulert-v1', 'occulert-v93'));
    writeFileSync(join(cwd, 'leaf.v2.js'), 'const mergedBytes = 2;\n'); commit('Resolve with fresh file and cache');
    const merge = fixtureGit(cwd, ['rev-parse', 'HEAD']).toString().trim();
    assert.equal(fixtureGit(cwd, ['show', '-s', '--format=%P', merge]).toString().trim().split(' ').length, 2);
    for (const parent of [`${merge}^1`, `${merge}^2`]) {
      assert.throws(() => fixtureGit(cwd, ['cat-file', '-e', `${parent}:leaf.v2.js`]));
      assert.doesNotMatch(fixtureGit(cwd, ['show', `${parent}:sw.js`]).toString(), /occulert-v93/);
    }
    fixtureGit(cwd, ['checkout', '-qb', 'next-release', initial]);
    const before = read(cwd, 'asset-versions.json');
    const assertReservations = () => {
      const plan = JSON.parse(run(cwd, 'leaf.js', '--dry-run'));
      assert.equal(plan.copies['leaf.v1.js'], 'leaf.v3.js');
      assert.equal(plan.cache, 'occulert-v94');
      assert.equal(read(cwd, 'asset-versions.json'), before);
      assert.equal(read(cwd, 'sw.js'), initialWorker);
    };
    assertReservations();
    fixtureGit(cwd, ['checkout', '-q', 'merge-release']);
    fixtureGit(cwd, ['rm', 'leaf.v2.js']);
    writeFileSync(join(cwd, 'sw.js'), initialWorker); commit('Retire merged release');
    fixtureGit(cwd, ['branch', '-D', 'side-release']);
    fixtureGit(cwd, ['checkout', '-q', 'next-release']);
    assertReservations();
    run(cwd, 'leaf.js');
    assert.equal(JSON.parse(read(cwd, 'asset-versions.json'))['leaf.js'], 'leaf.v3.js');
    assert.equal(read(cwd, 'leaf.v1.js'), source);
    assert.equal(read(cwd, 'leaf.v3.js'), source);
    assert.match(read(cwd, 'sw.js'), /occulert-v94/);
  } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});


test('a driver release copies its startup guard and synchronizes both integrity consumers', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-guard-release-'));
  const sri = source => 'sha256-' + createHash('sha256').update(source).digest('base64');
  try {
    const original = { 'driver.v1.js': 'window.completeDriver=true;\n', 'driver-startup-guard.v1.js': 'const corePath="/driver.v1.js";\n' };
    for (const [name, source] of Object.entries(original)) writeFileSync(join(cwd, name), source);
    writeFileSync(join(cwd, 'asset-versions.json'), JSON.stringify({'driver.js':'driver.v1.js','driver-startup-guard.js':'driver-startup-guard.v1.js'}));
    writeFileSync(join(cwd, 'asset-integrity.json'), JSON.stringify(Object.fromEntries(Object.entries(original).map(([name,source])=>[name,sha(source)]))));
    writeFileSync(join(cwd, 'app.html'), `<script id="driver-startup-guard" src="/driver-startup-guard.v1.js" integrity="${sri(original['driver-startup-guard.v1.js'])}" defer></script><script src="/driver.v1.js" defer></script>`);
    writeFileSync(join(cwd, 'sw.js'), `const CACHE = 'occulert-v1'; const STARTUP_GUARD_ASSETS = ${JSON.stringify([{url:'/driver-startup-guard.v1.js',integrity:sri(original['driver-startup-guard.v1.js'])}])}; const files=['/driver.v1.js'];`);
    writeFileSync(join(cwd, 'vercel.json'), JSON.stringify({headers:[{source:'/(.*)\\.(js|css)',headers:[]}]}));
    fixtureGit(cwd,['init','-q']);fixtureGit(cwd,['add','.']);fixtureGit(cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Published guard']);
    run(cwd,'driver.js');
    const guard='driver-startup-guard.v2.js';
    assert.match(read(cwd,guard),/driver\.v2\.js/);
    const assertPins=()=>{
      const pin=sri(read(cwd,guard));
      assert.ok(read(cwd,'app.html').includes(`src="/${guard}" integrity="${pin}"`));
      assert.ok(read(cwd,'sw.js').includes(JSON.stringify({url:'/'+guard,integrity:pin})));
      assert.equal(JSON.parse(read(cwd,'asset-integrity.json'))[guard],sha(read(cwd,guard)));
    };
    assertPins();writeFileSync(join(cwd,guard),read(cwd,guard)+'// Unpublished revision.\n');
    run(cwd,'driver-startup-guard.js','--refresh');assertPins();
    for(const [name,source] of Object.entries(original))assert.equal(read(cwd,name),source);
  } finally { rmSync(cwd,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});
