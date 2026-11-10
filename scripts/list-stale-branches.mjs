import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const defaultRepository = 'pacheco415/Occulert';
const abandonedAfterMs = 45 * 24 * 60 * 60 * 1000;
const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const markdown = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('\r', ' ');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function olderThan45Days(lastCommitAt, observedAt) {
  const committed = Date.parse(lastCommitAt);
  const observed = Date.parse(observedAt);
  return Number.isFinite(committed) && Number.isFinite(observed)
    && observed - committed > abandonedAfterMs;
}

export function branchWorkDiff(cwd, head, main) {
  try {
    const bases = git(cwd, 'merge-base', '--all', main, head).trim().split('\n').filter(Boolean);
    if (bases.length !== 1) return { available: false, reason: 'no unique merge base' };
    // Disable rename detection so each NUL-delimited record has one literal
    // path. Renames are counted as a deletion plus an addition, not lost.
    const entries = git(cwd, 'diff', '--no-renames', '--numstat', '-z', bases[0], head, '--')
      .split('\0').filter(Boolean);
    const result = { available: true, base: bases[0], changedPaths: entries.length,
      insertions: 0, deletions: 0, binaryPaths: 0, zeroLinePaths: 0 };
    for (const entry of entries) {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry);
      if (!match || (match[1] === '-') !== (match[2] === '-')) throw new Error('Malformed numstat');
      if (match[1] === '-') result.binaryPaths++;
      else {
        const added = Number(match[1]);
        const removed = Number(match[2]);
        if (!Number.isSafeInteger(added) || !Number.isSafeInteger(removed)) throw new Error('Invalid line count');
        result.insertions += added;
        result.deletions += removed;
        if (!added && !removed) result.zeroLinePaths++;
      }
    }
    return result;
  } catch {
    return { available: false, reason: 'Git analysis failed' };
  }
}

function renderBranchDiff(diff) {
  if (!diff?.available) return `unavailable: ${diff?.reason || 'not analyzed'}`;
  const paths = (count, kind) => `${count} ${kind} path${count === 1 ? '' : 's'}`;
  return `${paths(diff.changedPaths, 'changed')}; +${diff.insertions}/-${diff.deletions} text lines`
    + (diff.binaryPaths ? `; ${paths(diff.binaryPaths, 'binary')}` : '')
    + (diff.zeroLinePaths ? `; ${paths(diff.zeroLinePaths, 'zero-line')}` : '');
}

export function validatePullRequestSnapshot(snapshot, repository) {
  if (snapshot?.schemaVersion !== 1 || snapshot.complete !== true
    || snapshot.repository?.toLowerCase() !== repository.toLowerCase()
    || !Number.isFinite(Date.parse(snapshot.capturedAt)) || !Array.isArray(snapshot.pullRequests)) {
    throw new Error('A complete, dated open-pull-request snapshot for this repository is required.');
  }
  const numbers = new Set();
  for (const pr of snapshot.pullRequests) {
    if (!Number.isSafeInteger(pr.number) || pr.number <= 0 || numbers.has(pr.number)
      || pr.state !== 'open' || typeof pr.headRefName !== 'string' || !pr.headRefName
      || !(pr.headRepository === null || typeof pr.headRepository === 'string')
      || !/^[a-f0-9]{40}$/.test(pr.headSha) || typeof pr.url !== 'string'
      || pr.url !== `https://github.com/${repository}/pull/${pr.number}`) {
      throw new Error('Malformed or duplicate open-pull-request record.');
    }
    numbers.add(pr.number);
  }
  return snapshot;
}

export function loadGithubSnapshot(repository, snapshotPath) {
  if (snapshotPath) return validatePullRequestSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')), repository);
  // API pagination has no fixed PR-count ceiling. --slurp preserves pages.
  const pages = JSON.parse(execFileSync(process.env.GH_BIN || 'gh', [
    'api', '--paginate', '--slurp', `repos/${repository}/pulls?state=open&per_page=100`,
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }));
  if (!Array.isArray(pages) || !pages.length || pages.some(page => !Array.isArray(page))) {
    throw new Error('GitHub did not return paginated open-pull-request data.');
  }
  return validatePullRequestSnapshot({
    schemaVersion: 1, repository, capturedAt: new Date().toISOString(),
    source: 'GitHub CLI paginated REST open pull requests', complete: true,
    pullRequests: pages.flat().map(pr => ({
      number: pr.number, title: pr.title, state: pr.state, url: pr.html_url,
      headRefName: pr.head?.ref, headRepository: pr.head?.repo?.full_name ?? null,
      headSha: pr.head?.sha,
    })),
  }, repository);
}

function containment(cwd, head, main) {
  try {
    try {
      git(cwd, 'merge-base', '--is-ancestor', head, main);
      return 'merged ancestry';
    } catch (error) { if (error.status !== 1) throw error; }
    const bases = git(cwd, 'merge-base', '--all', main, head).trim().split('\n').filter(Boolean);
    if (bases.length !== 1) return 'not proven';
    const paths = git(cwd, 'diff', '--no-renames', '--name-only', '-z', bases[0], head, '--').split('\0').filter(Boolean);
    if (!paths.length) return 'matching change snapshot';
    // Literal NUL-delimited tree entries compare modes, binary/symlink blobs,
    // additions and absence, including both sides of a rename.
    const pathspecs = paths.map(path => `:(literal)${path}`);
    return git(cwd, 'ls-tree', '-rz', '--full-tree', head, '--', ...pathspecs)
      === git(cwd, 'ls-tree', '-rz', '--full-tree', main, '--', ...pathspecs)
      ? 'matching change snapshot' : 'not proven';
  } catch {
    return 'not proven';
  }
}

export function collectInventory({ cwd = process.cwd(), repository = defaultRepository,
  prSnapshot = null, observedAt = new Date().toISOString() } = {}) {
  if (prSnapshot) validatePullRequestSnapshot(prSnapshot, repository);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('A valid inventory observation time is required.');
  // Analyze captured immutable SHAs even if a concurrent fetch moves a ref.
  const main = git(cwd, 'rev-parse', '--verify', 'refs/remotes/origin/main^{commit}').trim();
  const refs = git(cwd, 'for-each-ref', '--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)',
    'refs/remotes/origin').trim().split('\n').filter(Boolean);
  const records = refs.map(line => line.split('\0')).filter(([ref]) =>
    ref !== 'refs/remotes/origin/main' && ref !== 'refs/remotes/origin/HEAD')
    .map(([ref, head, date]) => {
      const branch = ref.slice('refs/remotes/origin/'.length);
      const openPrs = (prSnapshot?.pullRequests || []).filter(pr =>
        (pr.headRepository === null || pr.headRepository.toLowerCase() === repository.toLowerCase())
          && pr.headRefName === branch);
      const evidence = containment(cwd, head, main);
      const abandoned = Boolean(prSnapshot) && !openPrs.length && olderThan45Days(date, observedAt);
      return { branch, head, date, evidence, openPrs, abandoned,
        netDiff: abandoned ? branchWorkDiff(cwd, head, main) : null,
        // Snapshot equivalence may still hide unique commits. Only proven
        // ancestry with complete open-PR metadata gets a review proposal.
        proposed: Boolean(prSnapshot) && !openPrs.length && evidence === 'merged ancestry' };
    }).sort((a, b) => a.branch.localeCompare(b.branch, 'en'));
  return { repository, main, observedAt, prSnapshot, records };
}

export function renderInventory({ repository, main, observedAt, prSnapshot, records }) {
  const proposed = records.filter(row => row.proposed);
  const abandoned = records.filter(row => row.abandoned);
  const table = [
    '# Remote branch inventory', '',
    `Observed: ${observedAt}. Base: \`${main}\` (fetched origin/main).`, '',
    `Remote branches other than main: **${records.length}**. Commented merged-branch review proposals: **${proposed.length}**. Abandoned review flags: **${abandoned.length}**.`, '',
    prSnapshot ? `Open PR snapshot: ${prSnapshot.capturedAt}; ${prSnapshot.pullRequests.length} open PRs, complete pagination. See [snapshot](open-pull-requests.json).`
      : 'Open PR membership is unavailable. No deletion proposals or abandoned review flags are generated.', '',
    '`merged ancestry` means every branch commit is reachable from captured main, even if main later edited its files. '
      + '`matching change snapshot` means the branch\'s net changed paths equal main (including modes and deletions); unique history may remain, so it gets no deletion proposal. '
      + '`not proven` includes divergent files, ambiguous ancestry and Git errors.', '',
    'Every same-repository open-PR branch is protected regardless of containment. '
      + 'These observations are not live deletion approval. Refetch, refresh the complete open-PR snapshot and review again before any manual deletion. '
      + 'A head lease detects branch movement but cannot detect a newly opened PR.', '',
    'The generator reads fetched refs and never fetches or deletes branches. '
      + 'The companion [proposal](proposed-branch-deletions.sh) contains only comments and performs no actions if run.', '',
    'Regenerate after `git fetch --prune origin` using Node 24:', '',
    '```sh',
    'node scripts/list-stale-branches.mjs --github --output=docs/branch-inventory',
    '# Without GitHub CLI: supply a fresh complete connector snapshot explicitly.',
    'node scripts/list-stale-branches.mjs --github --github-snapshot=docs/branch-inventory/open-pull-requests.json --output=docs/branch-inventory',
    '```', '',
    '## Abandoned review', '',
    'A branch is flagged when it has no open PR in the complete snapshot and its last commit is strictly more than 45 days old at the observation time. '
      + 'Exactly 45 days, future or invalid dates, and missing PR metadata do not qualify. '
      + 'This review category may overlap merged ancestry; age does not prove that work is merged or disposable. '
      + 'Only proven merged ancestry can appear in the commented deletion proposal.', '',
    'Net branch changes compare the unique merge base of captured main and head with that head, not the full difference from today\'s main. '
      + 'An ancestor head therefore has zero net branch changes even when main later edited its files. '
      + 'Changed-path counts include additions, deletions, binary files and mode-only changes; renames count as a deletion and addition. '
      + 'Text-line totals exclude binary contents. Zero-line paths include mode-only changes and empty-file changes. '
      + 'An unavailable comparison is not containment evidence.', '',
    ...(abandoned.length ? [
      '| Branch | Last commit | Containment evidence | Net branch changes |',
      '| --- | --- | --- | --- |',
      ...abandoned.map(row => `| ${markdown(row.branch)} | ${row.date} | ${row.evidence} | ${renderBranchDiff(row.netDiff)} |`),
    ] : [prSnapshot ? 'No fetched branch meets the abandoned-review criteria.' : 'Abandoned review is unavailable without complete open-PR metadata.']), '',
    '## All remote branches', '',
    '| Branch | Captured head | Last commit | Containment evidence | Open PRs | Review proposal |',
    '| --- | --- | --- | --- | --- | --- |',
    ...records.map(row => `| ${markdown(row.branch)} | [${row.head.slice(0, 12)}](https://github.com/${repository}/commit/${row.head}) | ${row.date} | ${row.evidence} | ${row.openPrs.map(pr => `[#${pr.number}](${pr.url})`).join(', ') || (prSnapshot ? 'none' : 'unknown')} | ${row.openPrs.length ? 'keep: open PR' : row.proposed ? 'review merged branch' : row.abandoned ? 'inspect: abandoned' : 'keep / inspect'} |`), '',
  ].join('\n');
  const proposal = [
    '#!/bin/sh', '# REVIEW ONLY: every command is commented; running this file does nothing.',
    `# Repository: ${repository}`, `# Observed: ${observedAt}`, `# Captured main: ${main}`,
    '# No branches have been deleted by this generator or this proposal.',
    '# Before any manual deletion: fetch, refresh all open PRs, rerun inventory,',
    '# and inspect the branch. A lease alone does not protect a newly opened PR.',
    '# Snapshot-equivalent branches with unique history are not proposed.', '',
    ...proposed.map(row => `# git push ${quote(`--force-with-lease=refs/heads/${row.branch}:${row.head}`)} origin ${quote(`:refs/heads/${row.branch}`)}`), '',
  ].join('\n');
  return { table, proposal };
}

export function main(args = process.argv.slice(2)) {
  const allowed = /^(?:--github|--output=.+|--github-snapshot=.+)$/;
  if (args.some(arg => !allowed.test(arg))
    || ['--output=', '--github-snapshot='].some(prefix => args.filter(arg => arg.startsWith(prefix)).length > 1)
    || (args.some(arg => arg.startsWith('--github-snapshot=')) && !args.includes('--github'))) {
    throw new Error('Usage: list-stale-branches.mjs [--github [--github-snapshot=path]] [--output=directory]');
  }
  const repository = process.env.GITHUB_REPOSITORY || defaultRepository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid GitHub repository.');
  const output = resolve(args.find(arg => arg.startsWith('--output='))?.slice(9) || resolve(tmpdir(), 'occulert-branch-review'));
  const prSnapshot = args.includes('--github')
    ? loadGithubSnapshot(repository, args.find(arg => arg.startsWith('--github-snapshot='))?.slice(18)) : null;
  const inventory = collectInventory({ repository, prSnapshot });
  const { table, proposal } = renderInventory(inventory);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'stale-branches.md'), table);
  writeFileSync(resolve(output, 'proposed-branch-deletions.sh'), proposal);
  if (prSnapshot) writeFileSync(resolve(output, 'open-pull-requests.json'), JSON.stringify(prSnapshot, null, 2) + '\n');
  console.log(`Reviewed ${inventory.records.length} remote branches; ${inventory.records.filter(row => row.proposed).length} merged branches proposed as comments only; ${inventory.records.filter(row => row.abandoned).length} abandoned review flags. Wrote ${output}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
