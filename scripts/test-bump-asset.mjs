import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { assertEveryBranchFetched, fetchEveryBranchCommands, fetchRulesCoverEveryBranch } from './lib/branch-fetch-guard.mjs';
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
    const paths = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
    // Current registered source and emitted assets can be reviewed before staging.
    const registry = JSON.parse(read(root, 'source-assets.json'));
    for (const entry of Object.values(registry.assets)) paths.add(entry.source);
    for (const name of Object.values(JSON.parse(read(root, 'asset-versions.json')))) paths.add(name);
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


test('fetch rules must cover every origin branch', () => {
  const all = '+refs/heads/*:refs/remotes/origin/*';
  for (const rules of [[all], ['refs/heads/*:refs/remotes/origin/*'], ['+refs/*:refs/*'], ['+refs/heads/main:refs/remotes/origin/main', all], [all, '+refs/pull/*/head:refs/remotes/pr/*'], [all, '^refs/tags/nightly'], [all, '^refs/tags/*'], [all, '^refs/pull/*']]) {
    assert.equal(fetchRulesCoverEveryBranch(rules), true, rules.join(' '));
  }
  for (const rules of [[], ['+refs/heads/main:refs/remotes/origin/main'], ['+refs/heads/main:refs/remotes/origin/main', '+refs/heads/codex/topic:refs/remotes/origin/codex/topic'], ['+refs/pull/*/head:refs/remotes/pr/*'], [all, '^refs/heads/main'], [all, '^refs/heads/codex/*'], [all, '^refs/*'], [all, '^refs/hea*'], [all, '^refs/h*'], [all, '^refs/hea*main']]) {
    assert.equal(fetchRulesCoverEveryBranch(rules), false, rules.join(' ') || 'no rules');
  }
});

test('negative fetch patterns that exclude real branch refs are refused', () => {
  const base = mkdtempSync(join(tmpdir(), 'occulert-negative-fetch-'));
  const origin = join(base, 'origin');
  const branches = ['main', 'prepared-main', 'retained'];
  const cases = [
    { negative: '^refs/hea*', retained: [] },
    { negative: '^refs/h*', retained: [] },
    { negative: '^refs/hea*main', retained: ['retained'] },
    { negative: '^refs/heads/*main', retained: ['retained'] },
    { negative: '^refs/heads/main', retained: ['prepared-main', 'retained'] },
    { negative: '^refs/tags/nightly', retained: branches },
    { negative: '^refs/tags/*', retained: branches },
    { negative: '^refs/pull/*', retained: branches },
    { negative: '^main', retained: branches },
    { negative: '^h*', retained: branches },
  ];
  try {
    mkdirSync(origin);
    fixtureGit(origin, ['init', '-q', '--initial-branch=main']);
    fixtureGit(origin, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Fixture branches']);
    for (const branch of branches.slice(1)) fixtureGit(origin, ['branch', branch]);
    for (const [index, { negative, retained }] of cases.entries()) {
      fixtureGit(origin, ['check-ref-format', '--allow-onelevel', '--refspec-pattern', negative.slice(1)]);
      const clone = join(base, `clone-${index}`);
      mkdirSync(clone);
      fixtureGit(clone, ['init', '-q']);
      fixtureGit(clone, ['remote', 'add', 'origin', pathToFileURL(origin).href]);
      fixtureGit(clone, ['config', '--add', 'remote.origin.fetch', negative]);
      fixtureGit(clone, ['fetch', '-q', '--no-tags', 'origin']);
      // Git may also create origin/HEAD, a symbolic default-branch pointer.
      const fetched = fixtureGit(clone, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/']).toString().trim().split('\n').filter(ref => ref && ref !== 'refs/remotes/origin/HEAD');
      assert.deepEqual(fetched, retained.map(branch => `refs/remotes/origin/${branch}`), negative);
      if (retained.length === branches.length) assertEveryBranchFetched(clone);
      else assert.throws(() => assertEveryBranchFetched(clone), /Fetch every origin branch/, negative);
    }
  } finally { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('a single-branch clone is refused until every origin branch is fetched', () => {
  const base = mkdtempSync(join(tmpdir(), 'occulert-single-branch-'));
  const origin = join(base, 'origin'), clone = join(base, 'clone');
  const commit = (cwd, message) => {
    fixtureGit(cwd, ['add', '.']);
    fixtureGit(cwd, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message]);
  };
  try {
    mkdirSync(origin);
    const source = 'const sample = 1;\n';
    writeFileSync(join(origin, 'leaf.v1.js'), source);
    writeFileSync(join(origin, 'asset-versions.json'), JSON.stringify({ 'leaf.js': 'leaf.v1.js' }));
    writeFileSync(join(origin, 'asset-integrity.json'), JSON.stringify({ 'leaf.v1.js': sha(source) }));
    writeFileSync(join(origin, 'index.html'), '<script src="/leaf.v1.js"></script>');
    writeFileSync(join(origin, 'sw.js'), "const CACHE = 'occulert-v1'; const files=['/leaf.v1.js'];\n");
    writeFileSync(join(origin, 'vercel.json'), JSON.stringify({ headers: [{ source: '/(.*)\\.(js|css)', headers: [] }] }));
    fixtureGit(origin, ['init', '-q']); commit(origin, 'Initial release');
    const initial = fixtureGit(origin, ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    // A second commit makes the depth-1 clone below genuinely shallow.
    writeFileSync(join(origin, 'notes.txt'), 'Later main commit.\n'); commit(origin, 'Later main commit');
    fixtureGit(origin, ['checkout', '-qb', 'prepared-release']);
    writeFileSync(join(origin, 'leaf.v2.js'), 'const otherPreparedBytes = 2;\n');
    writeFileSync(join(origin, 'sw.js'), "const CACHE = 'occulert-v2'; const files=['/leaf.v2.js'];\n");
    commit(origin, 'Prepared URL on another branch');
    fixtureGit(origin, ['checkout', '-q', initial]);

    // The checkout behind PR #419: cloned with --depth 1, then given full history.
    fixtureGit(base, ['clone', '-q', '--depth', '1', pathToFileURL(origin).href, clone]);
    assert.throws(() => run(clone, 'leaf.js', '--dry-run'), /Fetch full Git history/);
    fixtureGit(clone, ['fetch', '-q', '--unshallow']);
    assert.equal(fixtureGit(clone, ['rev-parse', '--is-shallow-repository']).toString().trim(), 'false');
    // Full history of one branch still cannot see the other prepared release.
    assert.throws(() => fixtureGit(clone, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/prepared-release']));
    const before = read(clone, 'asset-versions.json');
    for (const args of [['leaf.js', '--dry-run'], ['leaf.js']]) {
      assert.throws(() => run(clone, ...args), error => {
        assert.match(error.stderr, /Fetch every origin branch before choosing new immutable asset names/);
        assert.match(error.stderr, /remote\.origin\.fetch = \+refs\/heads\/[^*\s]+:refs\/remotes\/origin\/[^*\s]+\)/);
        for (const command of fetchEveryBranchCommands) assert.ok(error.stderr.includes(command), command);
        return true;
      });
    }
    assert.equal(read(clone, 'asset-versions.json'), before);
    assert.ok(!existsSync(join(clone, 'leaf.v2.js')), 'a refused run must not create the colliding URL');
    assert.match(read(clone, 'sw.js'), /occulert-v1/);

    // The printed commands are the complete fix.
    for (const command of fetchEveryBranchCommands) {
      fixtureGit(clone, command.split(' ').slice(1).map(word => word.replace(/^'|'$/g, '')));
    }
    assertEveryBranchFetched(clone);
    const plan = JSON.parse(run(clone, 'leaf.js', '--dry-run'));
    assert.equal(plan.copies['leaf.v1.js'], 'leaf.v3.js');
    assert.equal(plan.cache, 'occulert-v3');
    run(clone, 'leaf.js');
    assert.equal(JSON.parse(read(clone, 'asset-versions.json'))['leaf.js'], 'leaf.v3.js');
    assert.equal(read(clone, 'leaf.v1.js'), source);
    assert.match(read(clone, 'sw.js'), /occulert-v3/);
  } finally { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
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


test('helper releases copy the driver and guard and refresh both integrity consumers without editing published importers', () => {
 const cwd=mkdtempSync(join(tmpdir(),'occulert-helper-release-'));
 const sri=source=>'sha256-'+createHash('sha256').update(source).digest('base64');
 try{
  const helper='window.helper=true;\n',driver=`const EXPERIMENT_HELPER_INTEGRITY='${sri(helper)}';const helperUrl='/detection-experiments.v1.js';\n`;
  const original={'detection-experiments.v1.js':helper,'driver-app.v1.js':driver,'driver-startup-guard.v1.js':'const corePath="/driver-app.v1.js";\n'};
  for(const [name,source]of Object.entries(original))writeFileSync(join(cwd,name),source);
  writeFileSync(join(cwd,'asset-versions.json'),JSON.stringify({'detection-experiments.js':'detection-experiments.v1.js','driver-app.js':'driver-app.v1.js','driver-startup-guard.js':'driver-startup-guard.v1.js'}));
  writeFileSync(join(cwd,'asset-integrity.json'),JSON.stringify(Object.fromEntries(Object.entries(original).map(([name,source])=>[name,sha(source)]))));
  writeFileSync(join(cwd,'app.html'),`<script id="driver-startup-guard" src="/driver-startup-guard.v1.js" integrity="${sri(original['driver-startup-guard.v1.js'])}" defer></script><script src="/driver-app.v1.js" defer></script>`);
  writeFileSync(join(cwd,'sw.js'),`const CACHE = 'occulert-v1'; const STARTUP_GUARD_ASSETS = ${JSON.stringify([{url:'/driver-startup-guard.v1.js',integrity:sri(original['driver-startup-guard.v1.js'])}])}; const EXPERIMENT_HELPER_ASSETS = ${JSON.stringify([{url:'/detection-experiments.v1.js',integrity:sri(helper)}])};`);
  writeFileSync(join(cwd,'vercel.json'),JSON.stringify({headers:[{source:'/(.*)\\.(js|css)',headers:[]}]}));
  fixtureGit(cwd,['init','-q']);fixtureGit(cwd,['add','.']);fixtureGit(cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Published helper']);
  run(cwd,'detection-experiments.js');
  const assertPins=()=>{const pin=sri(read(cwd,'detection-experiments.v2.js'));assert.ok(read(cwd,'driver-app.v2.js').includes(`EXPERIMENT_HELPER_INTEGRITY='${pin}'`));assert.ok(read(cwd,'sw.js').includes(JSON.stringify({url:'/detection-experiments.v2.js',integrity:pin})));const hashes=JSON.parse(read(cwd,'asset-integrity.json'));for(const name of ['detection-experiments.v2.js','driver-app.v2.js','driver-startup-guard.v2.js'])assert.equal(hashes[name],sha(read(cwd,name)));assert.match(read(cwd,'driver-startup-guard.v2.js'),/driver-app\.v2\.js/)};
  assertPins();writeFileSync(join(cwd,'detection-experiments.v2.js'),helper+'// New unpublished helper bytes.\n');run(cwd,'detection-experiments.js','--refresh');assertPins();
  for(const [name,source]of Object.entries(original))assert.equal(read(cwd,name),source);
  const manifest=JSON.parse(read(cwd,'asset-versions.json'));manifest['driver-app.js']='driver-app.v1.js';writeFileSync(join(cwd,'asset-versions.json'),JSON.stringify(manifest));
  assert.throws(()=>run(cwd,'detection-experiments.js','--refresh'),/selected experimental helper URL and pin/);
 }finally{rmSync(cwd,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});
