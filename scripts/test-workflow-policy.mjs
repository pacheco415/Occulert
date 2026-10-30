import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditWorkflowPolicy } from './lib/workflow-policy.mjs';

const sha = '1234567890abcdef1234567890abcdef12345678';
const fixture = (checkout = '6.1.0', setup = '6.5.0', input = '.nvmrc') => `
jobs:
  checks:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@${sha} # v${checkout}
      - name: Set Node version
        uses: actions/setup-node@${sha} # v${setup}
        with:
          node-version-file: ${input}
      - run: npm ci
`;
const check = source => auditWorkflowPolicy(source, { requireNodeSetup: true });

test('current and newer semantic action versions accept .nvmrc including v7 documented quoting', () => {
  assert.deepEqual(check(fixture()), []);
  assert.deepEqual(check(fixture('7.0.1', '7.0.0', "'.nvmrc'")), []);
  assert.deepEqual(check(fixture('7.0.1', '7.0.0', '".nvmrc" # project runtime')), []);
});

test('mutable action refs, shortened SHAs, incomplete versions and older majors are rejected', () => {
  for (const source of [
    fixture().replace(`checkout@${sha}`, 'checkout@v7'),
    fixture().replace(`setup-node@${sha}`, 'setup-node@1234567'),
    fixture('6', '6.5.0'), fixture('6.1.0', '7.0'), fixture('5.1.0'),
    fixture('6.1.0', '5.0.0'), fixture('6.1.0', '6.5.0 prerelease'),
    fixture().replace('# v6.1.0', '# v6.1.0 extra text'),
  ]) assert.notDeepEqual(check(source), [], source);
});

test('one valid setup cannot hide another setup with a missing or incorrect Node input', () => {
  const second = `      - uses: actions/setup-node@${sha} # v7.0.0\n        with:\n          cache: npm\n`;
  assert.match(check(fixture() + second).join('\n'), /every setup-node step/);
  assert.match(check(fixture('6.1.0', '6.5.0', '.node-version')).join('\n'), /every setup-node step/);
  const misplaced = fixture().replace('          node-version-file: .nvmrc\n', '') + '      - name: Other step\n        with:\n          node-version-file: .nvmrc\n';
  assert.match(check(misplaced).join('\n'), /every setup-node step/);
  assert.match(check(fixture().replace('        with:', '        env:')).join('\n'), /every setup-node step/);
  assert.match(check(fixture().replace('          node-version-file:', '            node-version-file:')).join('\n'), /every setup-node step/);
  const duplicateInput = fixture().replace('          node-version-file: .nvmrc', '          node-version-file: .nvmrc\n          node-version-file: .node-version');
  assert.match(check(duplicateInput).join('\n'), /every setup-node step/);
  const duplicateWith = fixture().replace('      - run: npm ci', '        with:\n          node-version-file: .node-version\n      - run: npm ci');
  assert.match(check(duplicateWith).join('\n'), /every setup-node step/);
  const override = fixture().replace('          node-version-file: .nvmrc', '          node-version-file: .nvmrc\n          node-version: 26');
  assert.match(check(override).join('\n'), /without a node-version override/);
});

test('all remote actions remain immutable and required actions and OS pins cannot disappear', () => {
  assert.match(check(fixture() + '      - uses: actions/upload-artifact@v8\n').join('\n'), /40-character/);
  assert.match(check(fixture().replace(/.*uses: actions\/checkout.*\n/, '')).join('\n'), /required checkout/);
  assert.match(check(fixture().replace('ubuntu-24.04', 'ubuntu-latest')).join('\n'), /explicit OS/);
  assert.match(check(fixture().replace('ubuntu-24.04', 'macos-latest')).join('\n'), /explicit OS/);
  assert.match(check(fixture().replace('ubuntu-24.04', "'macos-latest'")).join('\n'), /explicit OS/);
});

test('checked-in workflow actions retain full SHAs and version-compatible Node inputs', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
    assert.deepEqual(auditWorkflowPolicy(readFileSync(new URL(file, directory), 'utf8')), [], file);
  }
});

test('browser container is immutable and matches the locked Playwright version', () => {
  const workflow = readFileSync(new URL('../.github/workflows/browser-smoke.yml', import.meta.url), 'utf8');
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const image = workflow.match(/^\s+image: mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:([a-f0-9]{64})$/m);
  assert.ok(image, 'use the official digest-pinned Noble image');
  assert.equal(image[1], lock.packages['node_modules/@playwright/test'].version);
  assert.ok(workflow.includes(`assert.equal(require('@playwright/test/package.json').version, '${image[1]}')`));
  assert.ok(workflow.includes('for (const browser of [chromium, webkit]) accessSync(browser.executablePath(), constants.X_OK)'));
  assert.ok(workflow.includes('run: npm run test:browser -- tests/onboarding-form-validation.spec.mjs --project=webkit'));
  assert.match(workflow, /run: npm run test:browser -- --project=\$\{\{ matrix\.browser \}\} --reporter=line,json --output=test-results\/browser\s*\n/);
  assert.doesNotMatch(workflow, /continue-on-error|--privileged|--cap-add|--ipc=host|playwright install --with-deps/);
});

test('both browser projects feed a stable check that rejects unsuccessful matrix results', () => {
  const workflow = readFileSync(new URL('../.github/workflows/browser-smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /browser: \[chromium, webkit\]/);
  assert.match(workflow, /fail-fast: false/);
  const aggregate = workflow.split('\n  smoke:\n')[1];
  assert.match(aggregate, /name: smoke\n/);
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(aggregate, /needs: browser\n/);
  assert.match(aggregate, /BROWSER_RESULT: \$\{\{ needs\.browser\.result \}\}/);
  const command = aggregate.match(/^        run: (.+)$/m)?.[1];
  assert.ok(command);
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '', 'unknown']) {
    const ran = spawnSync('/bin/sh', ['-e', '-c', command], { encoding: 'utf8', env: { ...process.env, BROWSER_RESULT: result } });
    assert.equal(ran.status === 0, result === 'success', result);
  }
});

test('retry report inputs match each browser and artifacts cannot collide across matrix jobs or attempts', () => {
  const workflow = readFileSync(new URL('../.github/workflows/browser-smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: \$\{\{ matrix\.browser == 'webkit' \}\}/);
  assert.match(workflow, /name: browser-test-diagnostics-\$\{\{ matrix\.browser \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /write-verification-receipt\.mjs browser-\$\{\{ matrix\.browser \}\}/);
  assert.match(workflow, /name: verification-browser-\$\{\{ matrix\.browser \}\}-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/);
  const step = workflow.split('      - name: List browser tests that passed after retry\n')[1].split('      - name: Preserve browser failure')[0];
  const command = step.split('        run: |\n')[1].split('\n').filter(Boolean).map(line => line.slice(10)).join('\n');
  for (const browser of ['chromium', 'webkit']) {
    const probe = 'node() { printf "%s\\n" "$@"; }\n' + command;
    const ran = spawnSync('/bin/sh', ['-e', '-c', probe], { encoding: 'utf8', env: { ...process.env, BROWSER: browser } });
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(ran.stdout.trim().split('\n'), ['scripts/report-browser-retries.mjs',
      ...(browser === 'webkit' ? ['playwright-report/onboarding.json'] : []), 'playwright-report/browser.json']);
  }
});

test('container ownership alignment is limited to its fresh checkout directory', () => {
  const workflow = readFileSync(new URL('../.github/workflows/browser-smoke.yml', import.meta.url), 'utf8');
  const alignment = workflow.indexOf('- name: Align fresh workspace ownership');
  assert.ok(alignment >= 0 && alignment < workflow.indexOf('- uses: actions/checkout'));
  assert.ok(workflow.includes('test "$GITHUB_WORKSPACE" = "$PWD"'));
  assert.ok(workflow.includes('test -d "$GITHUB_WORKSPACE" && test ! -L "$GITHUB_WORKSPACE"'));
  assert.ok(workflow.includes('entries="$(ls -A "$GITHUB_WORKSPACE")"'));
  assert.ok(workflow.includes('test -z "$entries"'));
  for (const guard of [
    'test "$(realpath "$GITHUB_WORKSPACE")" = "$(pwd -P)"',
    'mode="$(stat -c %a "$GITHUB_WORKSPACE")"',
    'owner="$(id -u):$(id -g)"',
    'chown "$owner" "$GITHUB_WORKSPACE"',
    'test "$(stat -c %a "$GITHUB_WORKSPACE")" = "$mode"',
    'test "$(stat -c %u:%g "$GITHUB_WORKSPACE")" = "$owner"'
  ]) assert.ok(workflow.includes(guard));
  assert.doesNotMatch(workflow, /safe\.directory|GIT_CONFIG_|chown\s+-|chmod/);
});

test('real event concurrency job is isolated, bounded and never uses production credentials', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const workflow = read('../.github/workflows/event-concurrency.yml');
  const build = read('./build-concurrency-postgres.sh');
  const harness = read('./test-event-idempotency-concurrency.mjs');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /npm ci --ignore-scripts --prefix scripts\/event-concurrency-runtime/);
  assert.match(workflow, /node scripts\/test-event-idempotency-concurrency.mjs/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.doesNotMatch(workflow + build, /pull_request_target|secrets\.|sudo\s|continue-on-error|supabase db|DATABASE_URL/);
  assert.match(build, /version=17\.11/);
  assert.match(build, /checksum=dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979/);
  assert.ok(build.indexOf('sha256sum --check --strict') < build.indexOf('tar -xjf'));
  assert.match(build, /https:\/\/ftp\.postgresql\.org\/pub\/source/);
  assert.match(build, /test "\$\(id -u\)" -ne 0/);
  assert.match(harness, /listen_addresses=''/);
  assert.match(harness, /host:root/);
  assert.match(harness, /pg_blocking_pids/);
  assert.doesNotMatch(harness, /await sleep\(100\)|pg_sleep/);
  assert.match(harness, /assert.equal\(scenarios.length,6\)/);
  assert.match(harness, /status:'passed'/);
  const manifest = JSON.parse(read('./event-concurrency-runtime/package.json'));
  const lock = JSON.parse(read('./event-concurrency-runtime/package-lock.json'));
  assert.deepEqual(manifest.dependencies, {pg:'8.16.3'});
  assert.equal(lock.packages['node_modules/pg'].version, '8.16.3');
});


test('concurrency harness rejects remote configuration before loading or starting PostgreSQL', () => {
  const harness = fileURLToPath(new URL('./test-event-idempotency-concurrency.mjs', import.meta.url));
  const base = {...process.env, OCCULERT_PG_TEST_RUNTIME: tmpdir()};
  for (const key of ['DATABASE_URL','SUPABASE_URL','PGHOST','PGHOSTADDR','PGSERVICE','PGSERVICEFILE']) delete base[key];
  for (const key of ['DATABASE_URL','SUPABASE_URL','PGHOST','PGHOSTADDR','PGSERVICE','PGSERVICEFILE']) {
    const result = spawnSync(process.execPath, [harness], {env:{...base,[key]:'not-a-real-target'}, encoding:'utf8'});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`External database configuration is not accepted: ${key}`));
  }
  const args = spawnSync(process.execPath, [harness, '--url=not-a-real-target'], {env:base, encoding:'utf8'});
  assert.notEqual(args.status, 0);
  assert.match(args.stderr, /No arguments or database URLs accepted/);
  const relative = spawnSync(process.execPath, [harness], {env:{...base,OCCULERT_PG_BIN:'relative'}, encoding:'utf8'});
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /must be an absolute local binary directory/);
});
