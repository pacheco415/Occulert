import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const versioned = /(?:^|\/)\S+\.v\d+\.(?:js|css)$/;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }).trim();

function manifest(cwd, revision) {
  const value = JSON.parse(git(cwd, 'show', `${revision}:asset-versions.json`));
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(path => typeof path !== 'string')) {
    throw new Error(`Invalid asset manifest at ${revision}`);
  }
  return value;
}

function blob(cwd, revision, path) {
  // ls-tree handles missing files without confusing absence with a failed Git read.
  const result = git(cwd, 'ls-tree', '-z', revision, '--', path);
  return result ? result.split('\t')[0].split(' ')[2] : null;
}

export function auditAssetLineage({ cwd = process.cwd(), head = 'HEAD', base = 'origin/main' } = {}) {
  const headRevision = git(cwd, 'rev-parse', '--verify', `${head}^{commit}`);
  const baseRevision = git(cwd, 'rev-parse', '--verify', `${base}^{commit}`);
  const ancestor = git(cwd, 'merge-base', headRevision, baseRevision);
  const original = manifest(cwd, ancestor);
  const proposed = manifest(cwd, headRevision);
  const current = manifest(cwd, baseRevision);
  const failures = [];
  const logicalNames = [...new Set([...Object.keys(original), ...Object.keys(proposed)])].sort();
  for (const name of logicalNames) {
    if (proposed[name] === original[name]) continue;
    if (current[name] !== original[name]) {
      failures.push(`main moved ${name} from ${original[name] || '(absent)'} to ${current[name] || '(absent)'} since this branch; rebase and re-run npm run asset:bump from ${current[name] || 'current main'}`);
    }
  }
  const changedPaths = execFileSync('git', ['diff', '--name-only', '-z', ancestor, headRevision], { cwd, encoding: 'utf8', timeout: 30000 }).split('\0').filter(Boolean);
  for (const path of changedPaths.filter(path => versioned.test(path))) {
    const proposedBlob = blob(cwd, headRevision, path);
    const currentBlob = blob(cwd, baseRevision, path);
    if (proposedBlob && currentBlob && proposedBlob !== currentBlob) {
      failures.push(`Immutable asset collision: ${path} has different bytes on this branch and main; select a fresh version from current main.`);
    }
  }
  return { head: headRevision, base: baseRevision, mergeBase: ancestor, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const result = auditAssetLineage({ head: process.env.ASSET_LINEAGE_HEAD || 'HEAD', base: process.env.ASSET_LINEAGE_BASE || 'origin/main' });
    for (const failure of result.failures) console.error(failure);
    if (result.failures.length) process.exitCode = 1;
    else console.log(`Asset lineage passed: ${result.head} against ${result.base}.`);
  } catch (error) {
    console.error(`Asset lineage could not be verified: ${error.message}`);
    process.exitCode = 1;
  }
}
