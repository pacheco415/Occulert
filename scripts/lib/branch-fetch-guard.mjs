import { execFileSync } from 'node:child_process';

// The release and retirement tools reserve asset URLs and cache names from
// `git log --all`, which only knows refs this checkout has fetched. A clone made
// with --depth 1 or --single-branch keeps a one-branch fetch rule even after
// `git fetch --unshallow`, so a later plain fetch still skips every other
// prepared branch. PR #419 chose fleet-dashboard.v8.js that way while another
// open branch already used the name for different bytes.
export const fetchEveryBranchCommands = Object.freeze([
  "git remote set-branches origin '*'",
  "git fetch origin '+refs/heads/*:refs/remotes/origin/*' '+refs/pull/*/head:refs/remotes/pr/*'",
]);

// True when the rules fetch every branch of the remote: at least one positive
// rule whose source is all heads (or all refs, as in a mirror) and no negative
// rule that drops branches again.
export function fetchRulesCoverEveryBranch(rules) {
  const trimmed = rules.map(rule => String(rule).trim()).filter(Boolean);
  const fetchesAll = trimmed.some(rule => /^\+?refs\/(?:heads\/)?\*:/.test(rule));
  const branchPrefix = 'refs/heads/';
  const dropsBranches = trimmed.some(rule => {
    if (!rule.startsWith('^')) return false;
    const source = rule.slice(1);
    const wildcard = source.indexOf('*');
    if (wildcard === -1) return source.startsWith(branchPrefix);
    // The wildcard can begin inside "refs/heads/", as in ^refs/hea*main.
    // Either compatible fixed prefix can still hide a prepared branch.
    const prefix = source.slice(0, wildcard);
    return branchPrefix.startsWith(prefix) || prefix.startsWith(branchPrefix);
  });
  return fetchesAll && !dropsBranches;
}

function configValues(root, key) {
  try {
    return execFileSync('git', ['config', '--get-all', key], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).filter(Boolean);
  } catch (error) {
    // Exit status 1 means the key is not set; anything else is a real failure.
    if (error.status === 1) return [];
    throw error;
  }
}

// Refuse to choose a new immutable name from a checkout that cannot see every
// origin branch. A repository without an origin has no other branches to miss.
export function assertEveryBranchFetched(root, action = 'choosing new immutable asset names') {
  if (!configValues(root, 'remote.origin.url').length) return;
  const rules = configValues(root, 'remote.origin.fetch');
  if (fetchRulesCoverEveryBranch(rules)) return;
  throw new Error([
    `Fetch every origin branch before ${action}.`,
    `This checkout fetches only part of origin (remote.origin.fetch = ${rules.length ? rules.join(' ') : 'unset'}),`,
    'so names prepared on other branches are invisible to the reservation check. Run:',
    ...fetchEveryBranchCommands.map(command => `  ${command}`),
    'then retry.',
  ].join('\n'));
}
