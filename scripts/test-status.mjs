import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectGitFacts, renderStatus, summarizePullRequests, validateObservations } from './status.mjs';

const cli = fileURLToPath(new URL('./status.mjs', import.meta.url));
const at = '2026-10-03T23:49:49.617533+00:00';
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-status-'));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Status fixture']);
  git(['config', 'user.email', 'status-fixture@example.invalid']);
  mkdirSync(join(cwd, 'native-app'));
  mkdirSync(join(cwd, 'docs'));
  writeFileSync(join(cwd, 'native-app/monitor.ts'), 'export const monitor = 1;\n');
  const commit = message => { git(['add', '.']); git(['commit', '-qm', message]); return git(['rev-parse', 'HEAD']); };
  const built = commit('built native source');
  git(['update-ref', 'refs/remotes/origin/main', built]);
  return { cwd, git, commit, built, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
function receipts(sourceCommit) {
  return { schemaVersion: 1,
    production: { sourceCommit, deploymentId: 'dpl_fixture', state: 'READY', createdAt: '2026-10-03T23:20:35.697Z', observedAt: at },
    testFlight: { sourceCommit, version: '1.0.0', buildNumber: '56', completedAt: '2026-10-03T23:44:38.728Z', observedAt: at, processingState: 'VALID', internalState: 'IN_BETA_TESTING', physicalAcceptance: 'not_recorded' },
    migrations: { state: 'unknown', observedAt: at, summary: 'Authentication failed; production schema is unknown.' },
  };
}

test('default source stays on origin/main while an unbuilt feature branch changes', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, 'native-app/monitor.ts'), 'export const monitor = 2;\n');
    const feature = f.commit('feature not merged');
    const main = collectGitFacts({ cwd: f.cwd, buildSource: f.built });
    assert.equal(main.sourceCommit, f.built);
    assert.equal(main.native.state, 'unchanged');
    const candidate = collectGitFacts({ cwd: f.cwd, ref: 'HEAD', buildSource: f.built });
    assert.equal(candidate.sourceCommit, feature);
    assert.deepEqual(candidate.native.paths, ['native-app/monitor.ts']);
    const output = renderStatus({ git: candidate, observations: receipts(f.built) });
    assert.ok(output.includes(`Production website: \`${f.built}\``));
    assert.ok(output.includes(`Inspected source (HEAD): \`${feature}\``));
    assert.match(output, /1 files differ from the TestFlight source/);
    assert.match(output, /Physical acceptance for build 56: Not recorded/);
  } finally { f.cleanup(); }
});

test('native documentation changes do not imply a new binary, but code changes do', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, 'native-app/UPGRADE_README.md'), '# Compatible update plan\n');
    const docs = f.commit('native upgrade instructions');
    f.git(['update-ref', 'refs/remotes/origin/main', docs]);
    assert.equal(collectGitFacts({ cwd: f.cwd, buildSource: f.built }).native.state, 'unchanged');
    writeFileSync(join(f.cwd, 'native-app/app.json'), '{"ios":{"buildNumber":"57"}}\n');
    const code = f.commit('next binary configuration');
    f.git(['update-ref', 'refs/remotes/origin/main', code]);
    assert.deepEqual(collectGitFacts({ cwd: f.cwd, buildSource: f.built }).native.paths, ['native-app/app.json']);
  } finally { f.cleanup(); }
});

test('missing build history is reported unknown instead of inferring a native pass', () => {
  const f = fixture();
  try {
    const git = collectGitFacts({ cwd: f.cwd, buildSource: 'f'.repeat(40) });
    assert.equal(git.native.state, 'unknown');
    const output = renderStatus({ git });
    assert.match(output, /Native changes waiting for a build: Unknown/);
    assert.match(output, /Production website: Unknown/);
    assert.match(output, /TestFlight: Unknown/);
    assert.match(output, /Open PRs: Unknown/);
    assert.match(output, /Production migrations: Unknown/);
    assert.throws(() => collectGitFacts({ cwd: f.cwd, ref: '--help' }));
  } finally { f.cleanup(); }
});

test('counts require a complete dated snapshot and unique open pull request rows', () => {
  const snapshot = { observedAt: at, complete: true, pullRequests: [
    { number: 177, headRefName: 'codex/json', isDraft: false },
    { number: 194, headRefName: 'dependabot/npm/playwright', isDraft: false },
    { number: 206, headRefName: 'codex/offboarding', isDraft: true },
    { number: 300, headRefName: 'maintainer/change', isDraft: false },
  ] };
  assert.deepEqual(summarizePullRequests(snapshot), { total: 4, codex: 2, dependabot: 1, other: 1, draft: 1, observedAt: at });
  assert.equal(summarizePullRequests({ ...snapshot, pullRequests: [] }).total, 0);
  assert.equal(summarizePullRequests(null), null);
  assert.throws(() => summarizePullRequests({ ...snapshot, complete: false }));
  assert.throws(() => summarizePullRequests({ ...snapshot, observedAt: undefined }));
  assert.throws(() => summarizePullRequests({ ...snapshot, pullRequests: [...snapshot.pullRequests, snapshot.pullRequests[0]] }));
});

test('malformed dates, partial receipts and undocumented acceptance fail visibly', () => {
  const original = receipts('a'.repeat(40));
  for (const badDate of ['2026-02-31', '2026-02-29', '2026-10-03T24:00:00Z', '2026-10-03T12:00:00', 'today']) {
    const facts = structuredClone(original);
    facts.production.observedAt = badDate;
    assert.throws(() => validateObservations(facts));
  }
  const valid = structuredClone(original);
  valid.production.observedAt = '2028-02-29';
  assert.equal(validateObservations(valid), valid);
  for (const update of [
    facts => { facts.production.sourceCommit = 'abc'; },
    facts => { facts.production.state = 'BUILDING'; },
    facts => { facts.testFlight.physicalAcceptance = 'passed'; },
    facts => { facts.migrations.summary = 'first line\nsecond line'; },
    facts => { facts.migrations.state = 'pending'; },
  ]) {
    const facts = structuredClone(original);
    update(facts);
    assert.throws(() => validateObservations(facts));
  }
});

test('CLI writes only after valid inputs; refresh retains dated external observations', () => {
  const f = fixture();
  try {
    const facts = receipts(f.built);
    writeFileSync(join(f.cwd, 'docs/status-observations.json'), JSON.stringify(facts));
    writeFileSync(join(f.cwd, 'docs/status-pull-requests.json'), JSON.stringify({ observedAt: at, complete: true, pullRequests: [] }));
    writeFileSync(join(f.cwd, 'docs/STATUS.md'), 'Existing status\n');
    // Run from another current directory using explicit fixtures; it must never treat that branch HEAD as main.
    const runner = `import { runStatus } from ${JSON.stringify(new URL('./status.mjs', import.meta.url).href)}; runStatus(['--write'], {cwd:${JSON.stringify(f.cwd)}});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', runner], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(join(f.cwd, 'docs/STATUS.md'), 'utf8');
    assert.match(output, /Open PRs .*: 0 total/);
    assert.ok(output.includes(at));
    assert.ok(output.trimEnd().split('\n').length <= 60);
    assert.equal(readFileSync(join(f.cwd, 'docs/status-observations.json'), 'utf8'), JSON.stringify(facts));
    facts.production.createdAt = '2026-02-31';
    writeFileSync(join(f.cwd, 'docs/status-observations.json'), JSON.stringify(facts));
    const failed = spawnSync(process.execPath, ['--input-type=module', '-e', runner], { encoding: 'utf8' });
    assert.notEqual(failed.status, 0);
    assert.equal(readFileSync(join(f.cwd, 'docs/STATUS.md'), 'utf8'), output);
    const badCli = spawnSync(process.execPath, [cli, '--unknown'], { encoding: 'utf8' });
    assert.equal(badCli.status, 1);
    assert.match(badCli.stderr, /Unknown option/);
  } finally { f.cleanup(); }
});

test('large native diffs keep status concise while preserving the complete file count', () => {
  const output = renderStatus({ git: { ref: 'origin/main', sourceCommit: 'a'.repeat(40), committedAt: at,
    native: { state: 'changed', paths: Array.from({ length: 200 }, (_, i) => `native-app/file${i}.ts`) } },
    observations: receipts('b'.repeat(40)) });
  assert.match(output, /200 files differ/);
  assert.match(output, /195 more/);
  assert.ok(output.trimEnd().split('\n').length <= 60);
});
