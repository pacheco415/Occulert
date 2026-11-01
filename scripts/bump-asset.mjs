import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertReleaseBaseline, commitAssetPlan, loadSourceAssets, synchronizeSourceEntry } from './lib/source-assets.mjs';
import { assertInitialCopyRuntimeSource, replaceInitialCopyUrl, synchronizeInitialCopyHtml, synchronizeInitialCopyWorker } from './lib/initial-copy-assets.mjs';

const root = process.cwd();
const read = name => readFileSync(join(root, name), 'utf8');
const parse = name => JSON.parse(read(name));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJSON = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const refresh = args.includes('--refresh');
const release = args.includes('--release');
const initialFlags = args.filter(arg => arg.startsWith('--init-copy='));
const initCopy = initialFlags.length ? initialFlags[0].slice('--init-copy='.length) : null;
const logical = args.find(arg => !arg.startsWith('--'));
const manifest = parse('asset-versions.json');
const integrity = parse('asset-integrity.json');
const beforeManifest = { ...manifest };
if (args.some(arg => arg.startsWith('--') && !['--dry-run', '--refresh', '--release'].includes(arg) && !arg.startsWith('--init-copy=')) || args.filter(arg => !arg.startsWith('--')).length > 1 || (release && (refresh || logical)) || initialFlags.length > 1 || (initCopy !== null && !release)) throw new Error('Use asset:release [--init-copy=<new-logical-name>] [--dry-run] or asset:bump -- <logical-name> [--dry-run | --refresh]');
if (!release && (!logical || !manifest[logical])) throw new Error('Choose a known logical asset: asset:bump -- driver-app.js [--dry-run | --refresh]');
const active = [...new Set(Object.values(manifest))];
const sources = new Map(active.map(name => [name, read(name)]));
const sourceEntries = loadSourceAssets(root, manifest, { required: release, initCopy });
const initialEntry = sourceEntries.find(entry => entry.initial);
if (initialEntry) {
  if (lstatSync(join(root, initCopy), { throwIfNoEntry: false })) throw new Error('Initial copy logical URL collides with an unversioned file');
  sources.set(initCopy, initialEntry.bytes.toString('utf8'));
  for (const [filename, source] of sources) assertInitialCopyRuntimeSource(source, { logical: initCopy, filename });
  for (const entry of sourceEntries) assertInitialCopyRuntimeSource(entry.bytes.toString('utf8'), { logical: initCopy, filename: entry.logical });
}
const releaseInputs = new Map();
if (release) {
  assertReleaseBaseline(root, manifest, integrity, { initCopy });
  for (const entry of sourceEntries) {
    if (entry.logical.endsWith('.js')) new Function(entry.bytes.toString('utf8'));
    const name = entry.initial ? entry.logical : entry.active;
    const prior = releaseInputs.get(name);
    if (prior && !prior.equals(entry.bytes)) throw new Error(`Conflicting source aliases: ${entry.active}`);
    releaseInputs.set(name, entry.bytes);
  }
  if (!sourceEntries.some(entry => entry.changed)) {
    console.log(JSON.stringify({ mode: 'release', sources: sourceEntries.map(({ logical, source, active, sha256 }) => ({ logical, source, active, sha256 })), copies: {}, rewrites: [], noOp: true, dryRun: dry }, null, 2));
    process.exit(0);
  }
} else if (sourceEntries.some(entry => entry.changed && (!refresh || entry.sha256 !== integrity[entry.active]))) {
  throw new Error('Pending source edits: use asset:release before bumping or refreshing an importer');
}

function synchronizeRegisteredSources(changes) {
  for (const entry of sourceEntries) {
    const filename = manifest[entry.logical];
    const bytes = changes.get(filename) ?? read(filename);
    for (const [name, source] of synchronizeSourceEntry(root, entry, bytes, beforeManifest, manifest)) changes.set(name, source);
  }
}

function synchronizeExperimentHelper(changes) {
  const name = manifest['detection-experiments.js'];
  if (!name) return;
  const coreName = manifest['driver-app.js'];
  if (!coreName) throw new Error('The experimental helper needs its owned driver importer');
  const source = changes.get(name) ?? sources.get(name) ?? read(name);
  const pin = 'sha256-' + createHash('sha256').update(source).digest('base64');
  const core = changes.get(coreName) ?? sources.get(coreName) ?? read(coreName);
  if (!core.includes(name) || !/const EXPERIMENT_HELPER_INTEGRITY='[^']+';/.test(core)) throw new Error('The driver must own the selected experimental helper URL and pin');
  let atHead;
  try { atHead = JSON.parse(execFileSync('git', ['show', 'HEAD:asset-versions.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { throw new Error('Helper pin synchronization requires Git history'); }
  if (Object.values(atHead).includes(name) && digest(source) !== integrity[name]) throw new Error('Cannot synchronize edited published helper bytes; bump it first');
  const updated = core.replace(/const EXPERIMENT_HELPER_INTEGRITY='[^']+';/, `const EXPERIMENT_HELPER_INTEGRITY='${pin}';`);
  if (updated !== core && Object.values(atHead).includes(coreName)) throw new Error('Cannot rewrite the published helper importer; bump the helper with its importer first');
  if (updated !== core) changes.set(coreName, updated);
  integrity[name] = digest(source);
  integrity[coreName] = digest(updated);
  const sw = changes.get('sw.js') ?? read('sw.js');
  if (!/const EXPERIMENT_HELPER_ASSETS = \[[\s\S]*?\];/.test(sw)) throw new Error('The helper must have its optional pinned worker entry');
  const worker = sw.replace(/const EXPERIMENT_HELPER_ASSETS = \[[\s\S]*?\];/, `const EXPERIMENT_HELPER_ASSETS = ${JSON.stringify([{url:'/'+name,integrity:pin}])};`);
  if (worker !== sw) changes.set('sw.js', worker);
}

function synchronizeStartupGuard(changes) {
  const name = manifest['driver-startup-guard.js'];
  if (!name) return;
  const source = changes.get(name) ?? sources.get(name) ?? read(name);
  const pin = 'sha256-' + createHash('sha256').update(source).digest('base64');
  const app = changes.get('app.html') ?? read('app.html');
  const tag = app.match(/<script\b(?=[^>]*\bid="driver-startup-guard")[^>]*><\/script>/)?.[0];
  if (!tag?.includes(`src="/${name}"`) || !/\bintegrity="[^"]+"/.test(tag)) throw new Error('External startup guard must have its owned URL and integrity attribute');
  const updated = app.replace(tag, tag.replace(/\bintegrity="[^"]+"/, `integrity="${pin}"`));
  if (updated !== app) changes.set('app.html', updated);
  const sw = changes.get('sw.js') ?? read('sw.js');
  const entry = `const STARTUP_GUARD_ASSETS = ${JSON.stringify([{ url: '/' + name, integrity: pin }])};`;
  if (!/const STARTUP_GUARD_ASSETS = \[[\s\S]*?\];/.test(sw)) throw new Error('Startup guard must be part of the pinned worker assets');
  const worker = sw.replace(/const STARTUP_GUARD_ASSETS = \[[\s\S]*?\];/, entry);
  if (worker !== sw) changes.set('sw.js', worker);
}

if (refresh) {
  const filename = manifest[logical];
  // A committed active asset is published for this tool's purposes. Refresh
  // only an uncommitted new release, never legitimize editing a published file.
  let atHead;
  try { atHead = JSON.parse(execFileSync('git', ['show', 'HEAD:asset-versions.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { throw new Error('Refresh requires Git history to verify the new release is unpublished'); }
  if (Object.values(atHead).includes(filename)) throw new Error('Cannot refresh a published active asset; bump it first');
  integrity[filename] = digest(sources.get(filename));
  console.log(`Refresh integrity: ${filename}`);
  const changes = new Map();
  synchronizeExperimentHelper(changes);
  synchronizeStartupGuard(changes);
  synchronizeRegisteredSources(changes);
  if (!dry) {
    for (const [name, source] of changes) writeFileSync(join(root, name), source);
    writeJSON('asset-integrity.json', integrity);
  }
} else {
  const selected = new Set(release ? sourceEntries.filter(entry => entry.changed).map(entry => entry.initial ? entry.logical : entry.active) : [manifest[logical]]);
  // Versioned importers must also be copied rather than rewritten in place.
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, source] of sources) {
      if (!selected.has(name) && [...selected].some(dependency => dependency !== initCopy && source.includes(dependency))) {
        selected.add(name); changed = true;
      }
    }
  }
  // A URL already used on another prepared branch must never be reused with
  // different immutable bytes. Traverse full history and include merge diffs:
  // a conflict resolution can introduce a URL absent from both parent commits.
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' }).trim() !== 'false') throw new Error('Fetch full Git history before choosing new immutable asset URLs');
  const historicalAssets = new Set(execFileSync('git', ['log', '--all', '--full-history', '--diff-merges=first-parent', '--format=', '--name-only', '--', ':(top,glob)*.v*.js', ':(top,glob)*.v*.css'], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).map(name => name.trim()).filter(Boolean));
  const replacements = new Map();
  for (const name of selected) {
    if (name !== initCopy && digest(sources.get(name)) !== integrity[name]) throw new Error(`Published asset integrity mismatch: ${name}`);
    const initialMatch = name === initCopy ? initCopy.match(/^(.+)\.(js|css)$/) : null;
    const match = initialMatch ? [initialMatch[0], initialMatch[1], '0', initialMatch[2]] : name.match(/^(.+)\.v(\d+)\.(js|css)$/);
    if (!match) throw new Error(`Asset is not versioned: ${name}`);
    let version = Number(match[2]) + 1, next;
    if (name === initCopy) {
      const reserved = [...historicalAssets, ...readdirSync(root)].map(path => path.match(new RegExp('^' + match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.v(\\d+)\\.' + match[3] + '$'))).filter(Boolean).map(value => Number(value[1]));
      if (reserved.some(value => !Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER)) throw new Error('Initial copy version history exceeds the safe version range');
      version = Math.max(0, ...reserved) + 1;
    }
    do { next = `${match[1]}.v${version++}.${match[3]}`; } while (existsSync(join(root, next)) || historicalAssets.has(next) || [...replacements.values()].includes(next));
    if (lstatSync(join(root, next), { throwIfNoEntry: false })) throw new Error(`Asset destination collision: ${next}`);
    replacements.set(name, next);
  }
  const existingReplacements = [...replacements].filter(([name]) => name !== initCopy);
  const escaped = existingReplacements.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.length ? new RegExp(escaped.join('|'), 'g') : null;
  const replace = source => pattern ? source.replace(pattern, name => replacements.get(name)) : source;
  const replaceReferences = source => initialEntry ? replaceInitialCopyUrl(replace(source), initCopy, replacements.get(initCopy)) : replace(source);
  const changes = new Map();
  for (const [old, next] of replacements) {
    const bytes = replace(releaseInputs.get(old)?.toString('utf8') ?? sources.get(old));
    if (initialEntry) assertInitialCopyRuntimeSource(bytes, { logical: initCopy, filename: next });
    changes.set(next, bytes); integrity[next] = digest(bytes);
  }
  for (const key of Object.keys(manifest)) manifest[key] = replacements.get(manifest[key]) || manifest[key];
  if (initialEntry) manifest[initCopy] = replacements.get(initCopy);
  const initialAsset = initialEntry ? { logical: initCopy, filename: manifest[initCopy], bytes: changes.get(manifest[initCopy]) } : null;
  const walkHTML = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'native-app', 'scripts', 'tests', 'docs', 'benchmark', 'src', 'build', 'test-results', 'playwright-report'].includes(entry.name)) continue;
      const name = join(directory, entry.name);
      if (entry.isDirectory()) walkHTML(name);
      else if (entry.name.endsWith('.html')) {
        const source = read(name), rewritten = replaceReferences(source);
        const updated = initialAsset ? synchronizeInitialCopyHtml(rewritten, initialAsset) : rewritten;
        if (source !== updated) changes.set(name, updated);
      }
    }
  };
  walkHTML('.');
  let sw = replaceReferences(read('sw.js'));
  const cache = sw.match(/const CACHE\s*=\s*(['"])(occulert-v)(\d+)\1/);
  if (!cache) throw new Error('Cannot find versioned service worker cache');
  const cacheHistory = execFileSync('git', ['log', '--all', '--full-history', '--diff-merges=first-parent', '--format=', '-p', '--unified=0', '--', 'sw.js'], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  const recordedCacheVersions = [...cacheHistory.matchAll(/^\+const CACHE\s*=\s*['"]occulert-v(\d+)['"]/gm)].map(match => Number(match[1]));
  const nextCacheVersion = Math.max(Number(cache[3]), ...recordedCacheVersions) + 1;
  if (!Number.isSafeInteger(nextCacheVersion) || nextCacheVersion < 1) throw new Error('Cannot advance an invalid cache version');
  sw = sw.replace(cache[0], `const CACHE = '${cache[2]}${nextCacheVersion}'`);
  if (initialAsset) sw = synchronizeInitialCopyWorker(sw, initialAsset);
  changes.set('sw.js', sw);
  const config = parse('vercel.json');
  synchronizeExperimentHelper(changes);
  synchronizeStartupGuard(changes);
  synchronizeRegisteredSources(changes);

  const versions = new Set([...replacements.values()].map(next => next.match(/\.v(\d+)\./)[1]));
  for (const version of versions) {
    const source = `/(.*)\\.v${version}\\.(js|css)`;
    const index = config.headers.findIndex(rule => rule.source === source);
    const rule = index < 0 ? { source, headers: [] } : config.headers.splice(index, 1)[0];
    rule.headers = rule.headers.filter(header => header.key.toLowerCase() !== 'cache-control');
    rule.headers.push({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' });
    config.headers.push(rule);
  }
  console.log(JSON.stringify({ ...(release ? { mode: 'release', sources: sourceEntries.map(({ logical, source, active, sha256, changed, initial }) => ({ logical, source, active, sha256, changed, ...(initial ? { initial: true } : {}) })) } : {}), copies: Object.fromEntries(existingReplacements), ...(initialEntry ? { initializations: { [initCopy]: manifest[initCopy] } } : {}), rewrites: [...changes.keys()], cache: `${cache[2]}${nextCacheVersion}`, dryRun: dry }, null, 2));
  if (!dry) {
    changes.set('asset-versions.json', JSON.stringify(manifest, null, 2) + '\n');
    changes.set('asset-integrity.json', JSON.stringify(integrity, null, 2) + '\n');
    changes.set('vercel.json', JSON.stringify(config, null, 2) + '\n');
    commitAssetPlan(root, changes);
  }
}
