import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRuntimeAssetPath, resolveRuntimeAssetPath } from './asset-paths.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = readFileSync(new URL('../../asset-versions.json', import.meta.url), 'utf8');
const versions = JSON.parse(manifest);

// Keep fixture manifests independent of the checkout's active release.
export function createAssetLookup(assetRoot, assetVersions) {
  function checked(filename) {
    resolveRuntimeAssetPath(assetRoot, filename);
    return filename;
  }
  function asset(logicalName) {
    if (!Object.hasOwn(assetVersions, logicalName)) throw new Error(`Unknown active asset: ${logicalName}`);
    return checked(assetVersions[logicalName]);
  }
  function assetPath(logicalName) {
    return parseRuntimeAssetPath(asset(logicalName)).publicPath;
  }
  // Several pages share one output; match its basename, retaining the full path.
  function assetByStem(stemAndExtension) {
    if (typeof stemAndExtension !== 'string' || !/^[\w-]+\.(js|css)$/.test(stemAndExtension)) throw new Error(`Invalid asset stem: ${stemAndExtension}`);
    const matches = new Set(Object.values(assetVersions).filter(filename =>
      parseRuntimeAssetPath(filename).logicalName === stemAndExtension));
    if (matches.size !== 1) throw new Error(`Expected one active version of ${stemAndExtension}; found ${matches.size}`);
    return checked([...matches][0]);
  }
  return { asset, assetPath, assetByStem };
}

export const { asset, assetPath, assetByStem } = createAssetLookup(root, versions);

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
