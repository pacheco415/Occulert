import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const outputDir = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || resolve(tmpdir(), 'occulert-branch-review'));
const base = 'origin/main';
git('rev-parse', '--verify', base);
const prs = new Map();
if (process.argv.includes('--github')) {
  const repo = process.env.GITHUB_REPOSITORY || 'pacheco415/Occulert';
  const rows = JSON.parse(execFileSync(process.env.GH_BIN || 'gh', ['pr', 'list', '--repo', repo, '--state', 'closed', '--limit', '1000', '--json', 'number,headRefName'], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }));
  for (const row of rows) if (!prs.has(row.headRefName)) prs.set(row.headRefName, row.number);
}
const refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin').split('\n').filter(ref => ref !== base && ref !== 'origin/HEAD' && ref);
const records = refs.map(ref => {
  const branch = ref.slice('origin/'.length);
  const ancestor = git('merge-base', base, ref);
  const paths = execFileSync('git', ['diff', '--name-only', '-z', ancestor, ref], { encoding: 'utf8' }).split('\0').filter(Boolean);
  // Compare every changed path, including deletion and binary blobs. Main's
  // later edits may produce conservative false negatives; never infer deletion
  // eligibility from PR closure or commit messages alone.
  const contained = paths.every(path => git('ls-tree', ref, '--', path) === git('ls-tree', base, '--', path));
  return { branch, contained, date: git('show', '-s', '--format=%cI', ref), pr: prs.get(branch) };
});
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = ['# Remote branch inventory', '', `Base commit: ${git('rev-parse', base)}`, '', 'Containment compares changed paths with main. Review before using the proposal. Remote refs are read as fetched; this script does not fetch or delete.', '', '| Branch | Changes contained | Last commit | Closed PR |', '| --- | --- | --- | --- |', ...records.map(row => `| ${escape(row.branch)} | ${row.contained ? 'yes' : 'not proven'} | ${row.date} | ${row.pr ? '#' + row.pr : 'unknown'} |`)].join('\n') + '\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const proposal = ['#!/bin/sh', '# Review-only proposal. This script was generated but has not been executed.', '# Refetch and recheck containment before deleting remote branches.', 'set -eu', ...records.filter(row => row.contained).map(row => `git push origin --delete ${quote(row.branch)}`)].join('\n') + '\n';
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'stale-branches.md'), table);
writeFileSync(resolve(outputDir, 'proposed-branch-deletions.sh'), proposal);
console.log(`Reviewed ${records.length} remote branches; ${records.filter(row => row.contained).length} conservatively contained. Wrote inventory and an unexecuted proposal to ${outputDir}.`);
