import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = readFileSync(new URL('../../asset-versions.json', import.meta.url), 'utf8');
const versions = JSON.parse(manifest);

export function asset(logicalName) {
  const filename = versions[logicalName];
  if (!filename) throw new Error(`Unknown active asset: ${logicalName}`);
  return filename;
}

export function assetPath(logicalName) {
  return `/${asset(logicalName)}`;
}

// Several pages share one versioned file but use different manifest keys.
export function assetByStem(stemAndExtension) {
  const [stem, extension] = stemAndExtension.match(/^(.+)\.(js|css)$/)?.slice(1) ?? [];
  if (!stem) throw new Error(`Invalid asset stem: ${stemAndExtension}`);
  const matches = new Set(Object.values(versions).filter((filename) =>
    filename.match(/^(.+)\.v\d+\.(js|css)$/)?.slice(1).join('.') === stemAndExtension));
  if (matches.size !== 1) throw new Error(`Expected one active version of ${stemAndExtension}; found ${matches.size}`);
  return [...matches][0];
}

export function cacheName() {
  const source = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const name = parseCacheName(source);
  if (!name) throw new Error('sw.js must declare a versioned CACHE name');
  return name;
}

function parseCacheName(source) {
  return source.match(/\bconst CACHE\s*=\s*['"](occulert-v\d+)['"]/)?.[1] ?? null;
}

// Compare with the cache before the most recent asset release. For a pending
// manifest edit, HEAD is the prior release; otherwise use the last manifest
// commit's parent. A shallow checkout has no prior release to compare.
export function priorReleaseCacheName() {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const manifestAtHead = git('show', 'HEAD:asset-versions.json');
    const revision = manifestAtHead === manifest.trim()
      ? git('log', '-1', '--format=%H', '--', 'asset-versions.json')
      : 'HEAD';
    return parseCacheName(git('show', `${revision}^:sw.js`));
  } catch {
    return null;
  }
}
