import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectInventory, loadGithubSnapshot, renderInventory, validatePullRequestSnapshot } from './list-stale-branches.mjs';

const repository = 'fixture/repository';
const snapshot = pullRequests => ({ schemaVersion: 1, repository,
  capturedAt: '2026-10-28T23:00:00Z', complete: true, pullRequests });
const pr = (number, branch, sha, headRepository = repository) => ({ number, state: 'open',
  headRefName: branch, headRepository, headSha: sha,
  url: `https://github.com/${repository}/pull/${number}` });
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-branch-inventory-'));
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
    '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    ...args], { cwd, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (name, bytes) => writeFileSync(join(cwd, name), bytes);
  const commit = message => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  write('merged.txt', 'base'); write('snapshot.txt', 'base'); write('deleted.txt', 'keep');
  write('[literal]*.txt', 'rename me'); write('binary.bin', Buffer.from([0, 1, 2])); write('mode.txt', 'same bytes');
  commit('base');
  write('merged.txt', 'merged work');
  const merged = commit('merged feature');
  write('merged.txt', 'later main edit');
  const shared = commit('main moves beyond merged work');
  git('checkout', '--detach', shared);
  const applySnapshot = () => { write('snapshot.txt', 'squashed work'); rmSync(join(cwd, 'deleted.txt'));
    renameSync(join(cwd, '[literal]*.txt'), join(cwd, 'renamed.txt')); write('binary.bin', Buffer.from([0, 1, 255])); };
  applySnapshot();
  const unique = commit('unique feature history');
  git('checkout', 'main'); applySnapshot(); commit('independent squash');
  write('unrelated.txt', 'later unrelated work');
  const main = commit('unrelated main edit');
  git('checkout', '--detach', unique); write('binary.bin', Buffer.from([0, 1, 254]));
  const binary = commit('divergent binary');
  git('checkout', '--detach', unique); chmodSync(join(cwd, 'mode.txt'), 0o755);
  const mode = commit('different executable mode');
  git('checkout', '--detach', unique); rmSync(join(cwd, 'snapshot.txt')); symlinkSync('other-target', join(cwd, 'snapshot.txt'));
  const link = commit('different symlink');
  for (const [name, sha] of Object.entries({ main, merged, 'open-merged': merged,
    'fork-only': merged, 'unknown-owner': merged, snapshot: unique, binary, mode, link })) git('update-ref', `refs/remotes/origin/${name}`, sha);
  return { cwd, git, merged, main, unique, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test('merged ancestry survives main edits; snapshots preserve unique history; open PRs always stay', () => {
  const f = fixture();
  try {
    const data = collectInventory({ cwd: f.cwd, repository, prSnapshot: snapshot([
      pr(1, 'open-merged', f.merged), pr(2, 'fork-only', f.merged, 'someone/fork'),
      pr(3, 'unknown-owner', f.merged, null),
    ]) });
    const byName = Object.fromEntries(data.records.map(row => [row.branch, row]));
    assert.equal(data.main, f.main);
    assert.equal(byName.merged.evidence, 'merged ancestry');
    assert.equal(byName.merged.proposed, true, 'later main edits do not erase merged ancestry');
    assert.equal(byName['open-merged'].evidence, 'merged ancestry');
    assert.equal(byName['open-merged'].proposed, false, 'even fully merged open PR branches must stay');
    assert.equal(byName['fork-only'].proposed, true, 'a different repository with the same branch name is not membership');
    assert.equal(byName['unknown-owner'].proposed, false, 'unknown head repository must conservatively protect a matching branch');
    assert.equal(byName.snapshot.evidence, 'matching change snapshot', 'literal rename, deletion and binary changes match');
    assert.equal(byName.snapshot.proposed, false, 'matching net files do not prove every unique commit is merged');
    for (const name of ['binary', 'mode', 'link']) {
      assert.equal(byName[name].evidence, 'not proven', name);
      assert.equal(byName[name].proposed, false, name);
    }
    const { table, proposal } = renderInventory(data);
    assert.match(table, /keep: open PR/);
    assert.match(proposal, new RegExp(`--force-with-lease=refs/heads/merged:${f.merged}`));
    assert.doesNotMatch(proposal, /:refs\/heads\/(?:open-merged|snapshot|binary|mode|link)'/);
    const path = join(f.cwd, 'proposal.sh'); writeFileSync(path, proposal);
    const refs = f.git('for-each-ref');
    execFileSync('/bin/sh', [path], { cwd: f.cwd });
    assert.equal(f.git('for-each-ref'), refs, 'executing the generated comments performs no mutation');
    assert.equal(readFileSync(path, 'utf8').split('\n').filter(line => line && !line.startsWith('#')).length, 0);
  } finally { f.cleanup(); }
});

test('GitHub collection requests all pages and validates connector snapshots', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-branch-metadata-'));
  const old = process.env.GH_BIN;
  try {
    const bin = join(cwd, 'fake-gh');
    writeFileSync(bin, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(join(cwd, 'args.json'))}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(fs.readFileSync(${JSON.stringify(join(cwd, 'response.json'))}));\n`);
    chmodSync(bin, 0o755);
    const raw = number => ({ number, title: 'Open PR', state: 'open', html_url: `https://github.com/${repository}/pull/${number}`,
      head: { ref: `branch-${number}`, sha: 'a'.repeat(40), repo: { full_name: repository } } });
    writeFileSync(join(cwd, 'response.json'), JSON.stringify([[raw(1)], [raw(2)]]));
    process.env.GH_BIN = bin;
    const collected = loadGithubSnapshot(repository);
    assert.deepEqual(collected.pullRequests.map(row => row.number), [1, 2]);
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'args.json'))), ['api', '--paginate', '--slurp', `repos/${repository}/pulls?state=open&per_page=100`]);
    const path = join(cwd, 'snapshot.json'); writeFileSync(path, JSON.stringify(collected));
    assert.deepEqual(loadGithubSnapshot(repository, path), collected);
    writeFileSync(path, JSON.stringify({ ...collected, complete: false }));
    assert.throws(() => loadGithubSnapshot(repository, path), /complete/);
  } finally {
    if (old === undefined) delete process.env.GH_BIN; else process.env.GH_BIN = old;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing open PR metadata produces zero candidates; incomplete or malformed snapshots fail closed', () => {
  const f = fixture();
  try {
    const unknown = collectInventory({ cwd: f.cwd, repository });
    assert.ok(unknown.records.some(row => row.evidence === 'merged ancestry'));
    assert.equal(unknown.records.filter(row => row.proposed).length, 0);
    assert.doesNotMatch(renderInventory(unknown).proposal, /# git push/);
    for (const invalid of [null, { ...snapshot([]), complete: false }, { ...snapshot([]), repository: 'other/repo' },
      snapshot([{ ...pr(1, 'open-merged', f.merged), state: 'closed' }]), snapshot([pr(1, 'x', f.merged), pr(1, 'y', f.merged)])]) {
      assert.throws(() => validatePullRequestSnapshot(invalid, repository), /snapshot|record/);
    }
  } finally { f.cleanup(); }
});

test('the proposal safely quotes shell-sensitive branch names and remains inert', () => {
  const branch = "codex/someone's-$thing";
  const sha = 'a'.repeat(40);
  const data = { repository, main: sha, observedAt: '2026-10-28T23:00:00Z', prSnapshot: snapshot([]),
    records: [{ branch, head: sha, date: '', evidence: 'merged ancestry', openPrs: [], proposed: true }] };
  const { proposal } = renderInventory(data);
  assert.match(proposal, /someone'\\''s-\$thing/);
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-review-only-'));
  try { const path = join(cwd, 'proposal.sh'); writeFileSync(path, proposal); execFileSync('/bin/sh', [path], { cwd }); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
});
