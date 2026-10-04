import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function excluded(path, patterns) {
  return patterns.some(pattern => pattern.endsWith('/') ? path.startsWith(pattern) : pattern === '*.md' ? path.endsWith('.md') : path === pattern);
}

export function deploymentDecision({ cwd = process.cwd(), base, head = 'HEAD' } = {}) {
  try {
    // The preceding successful deployment is the baseline. HEAD^ could miss an
    // earlier site change when several ignored-only commits follow that change.
    if (!base || !/^[a-f0-9]{40}$/i.test(base)) return { skip: false, reason: 'No verified previous deployment revision.' };
    const revision = git(cwd, 'rev-parse', '--verify', `${head}^{commit}`).trim();
    git(cwd, 'rev-parse', '--verify', `${base}^{commit}`);
    git(cwd, 'merge-base', '--is-ancestor', base, revision);
    const patterns = git(cwd, 'show', `${revision}:.vercelignore`).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (patterns.some(pattern => pattern !== '*.md' && !/^[\w./-]+\/?$/.test(pattern))) return { skip: false, reason: 'Unrecognized deployment exclusion; build conservatively.' };
    const paths = git(cwd, 'diff', '--no-renames', '--name-only', '-z', base, revision).split('\0').filter(Boolean);
    const required = paths.filter(path => path === '.vercelignore' || path === 'scripts/ignore-vercel-deployment.mjs' || !excluded(path, patterns));
    return { skip: required.length === 0, reason: required.length ? 'Public source or deployment policy changed.' : 'Only excluded development files changed.', changedPaths: paths.length };
  } catch {
    return { skip: false, reason: 'Deployment history could not be verified; build conservatively.' };
  }
}

if (!process.argv[1] || import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const decision = deploymentDecision({ base: process.env.VERCEL_GIT_PREVIOUS_SHA, head: process.env.VERCEL_GIT_COMMIT_SHA || 'HEAD' });
  console.log(decision.reason);
  // Vercel uses 0 to skip, and 1 to continue the build.
  process.exitCode = decision.skip ? 0 : 1;
}
