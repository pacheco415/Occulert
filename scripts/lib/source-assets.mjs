import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'acorn';

export const SOURCE_REGISTRY = 'source-assets.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (root, name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const git = (root, ...args) => execFileSync('git', args, { cwd: root, timeout: 15000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

// The registry is build configuration, never a path supplied by a browser.
function ownedFile(root, name) {
  if (typeof name !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(name) || name.split('/').some(part => part === '.' || part === '..')) throw new Error(`Invalid asset path: ${name}`);
  let path = root;
  for (const part of name.split('/')) {
    path = join(path, part);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Asset paths must not be symlinks: ${name}`);
  }
  return path;
}

export function loadSourceAssets(root, manifest, { required = false } = {}) {
  const path = ownedFile(root, SOURCE_REGISTRY);
  if (!existsSync(path)) {
    if (required) throw new Error(`Missing ${SOURCE_REGISTRY}`);
    return [];
  }
  const registry = json(root, SOURCE_REGISTRY);
  if (registry?.schemaVersion !== 1 || !registry.assets || Array.isArray(registry.assets) || typeof registry.assets !== 'object' || Object.keys(registry).some(key => !['schemaVersion', 'assets'].includes(key))) throw new Error('Invalid source asset registry');
  const usedSources = new Set();
  const entries = Object.entries(registry.assets).map(([logical, entry]) => {
    if (!/^[\w-]+\.(js|css)$/.test(logical) || !Object.hasOwn(manifest, logical)) throw new Error(`Unknown source-managed logical asset: ${logical}`);
    if (!entry || !['copy', 'bundle'].includes(entry.mode) || Object.keys(entry).some(key => !['source', 'mode'].includes(key)) || typeof entry.source !== 'string' || !/^src\/(?:[\w-]+\/)*[\w.-]+\.(js|css)$/.test(entry.source) || !entry.source.endsWith(logical.slice(logical.lastIndexOf('.')))) throw new Error(`Unsupported source entry: ${logical}`);
    if (usedSources.has(entry.source)) throw new Error(`Source registered twice: ${entry.source}`);
    usedSources.add(entry.source);
    const active = manifest[logical];
    if (typeof active !== 'string' || !/^[\w-]+\.v\d+\.(js|css)$/.test(active)) throw new Error(`Invalid active source asset: ${logical}`);
    if (entry.mode === 'bundle' && (logical !== 'driver-app.js' || entry.source !== 'src/driver-app.js')) throw new Error(`Unsupported bundled source entry: ${logical}`);
    const bytes = entry.mode === 'bundle' ? renderDriverBundle(root) : readFileSync(ownedFile(root, entry.source));
    if (!Buffer.from(bytes.toString('utf8')).equals(bytes)) throw new Error(`Source must be UTF-8: ${entry.source}`);
    const published = readFileSync(ownedFile(root, active));
    return { logical, ...entry, active, bytes, changed: !bytes.equals(published), sha256: sha(bytes) };
  });
  if (!entries.length) throw new Error('Register at least one source asset');
  return entries;
}

export function assertReleaseBaseline(root, manifest, integrity) {
  if (git(root, 'rev-parse', '--is-shallow-repository').toString().trim() !== 'false') throw new Error('Fetch full Git history before releasing source assets');
  try { git(root, 'merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'); }
  catch { throw new Error('Fetch and integrate origin/main before releasing source assets'); }
  const atHead = JSON.parse(git(root, 'show', 'HEAD:asset-versions.json'));
  if (JSON.stringify(manifest) !== JSON.stringify(atHead)) throw new Error('Finish or discard the existing unpublished asset release before releasing source');
  const headIntegrity = JSON.parse(git(root, 'show', 'HEAD:asset-integrity.json'));
  for (const [name, hash] of Object.entries(integrity)) {
    const bytes = readFileSync(ownedFile(root, name));
    if (!/^[a-f0-9]{64}$/.test(hash) || sha(bytes) !== hash) throw new Error(`Published asset integrity mismatch: ${name}`);
    if (Object.hasOwn(headIntegrity, name)) {
      if (headIntegrity[name] !== hash || !git(root, 'show', `HEAD:${name}`).equals(bytes)) throw new Error(`Cannot release edited published bytes: ${name}`);
    }
  }
  for (const name of Object.keys(headIntegrity)) {
    if (!Object.hasOwn(integrity, name)) throw new Error(`Cannot drop a retained integrity entry during source release: ${name}`);
  }
}

export function auditSourceAssets(root = process.cwd()) {
  const manifest = json(root, 'asset-versions.json');
  const integrity = json(root, 'asset-integrity.json');
  const entries = loadSourceAssets(root, manifest, { required: true });
  if (!entries.some(entry => entry.logical === 'driver-app.js')) throw new Error('The driver source pilot must remain registered');
  for (const entry of entries) {
    if (entry.changed) throw new Error(`Source mismatch: ${entry.logical}: ${entry.source} differs from ${entry.active}; run asset:release`);
    if (integrity[entry.active] !== entry.sha256) throw new Error(`Source output integrity mismatch: ${entry.active}`);
  }
  const exclusions = new Set(readFileSync(join(root, '.vercelignore'), 'utf8').split(/\r?\n/).map(line => line.trim()));
  for (const name of ['src/', 'build/', SOURCE_REGISTRY, ...(entries.some(entry => entry.mode === 'bundle') ? ['source-driver-contract.json', 'jsconfig.json', 'eslint.config.mjs'] : [])]) if (!exclusions.has(name)) throw new Error(`.vercelignore must exclude ${name}`);
  const worker = readFileSync(join(root, 'sw.js'), 'utf8');
  if (/["'`]\/?(?:src\/|build\/|source-assets\.json|source-driver-contract\.json|jsconfig\.json|eslint\.config\.mjs)/.test(worker)) throw new Error('Development source must not enter the offline cache');
  return entries.map(({ logical, source, mode, active, sha256 }) => ({ logical, source, mode, active, sha256 }));
}

// Validate and stage every byte before replacing any checkout path. Restore the
// original files if a later rename fails; the optional operation is a fixture
// seam for exercising a mid-commit filesystem failure.
export function commitAssetPlan(root, changes, { rename = renameSync } = {}) {
  const directory = mkdtempSync(join(root, '.asset-release-'));
  const originals = new Map();
  const applied = [];
  try {
    for (const [name, bytes] of changes) {
      const target = ownedFile(root, name);
      if (existsSync(target)) {
        if (!lstatSync(target).isFile()) throw new Error(`Asset target is not a file: ${name}`);
        originals.set(name, { bytes: readFileSync(target), mode: lstatSync(target).mode });
        const backup = join(directory, 'old', name);
        mkdirSync(dirname(backup), { recursive: true });
        writeFileSync(backup, originals.get(name).bytes);
        chmodSync(backup, originals.get(name).mode);
      } else if (!existsSync(dirname(target))) throw new Error(`Asset target directory is missing: ${name}`);
      const staged = join(directory, 'new', name);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, bytes);
      if (originals.has(name)) chmodSync(staged, originals.get(name).mode);
    }
    for (const name of changes.keys()) {
      rename(join(directory, 'new', name), join(root, name));
      applied.push(name);
    }
  } catch (error) {
    for (const name of applied.reverse()) {
      const original = originals.get(name);
      if (original) {
        renameSync(join(directory, 'old', name), join(root, name));
      } else rmSync(join(root, name));
    }
    throw error;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

// The compiler is a fixed repository build step, never a registry-supplied
// executable. --stdout compiles without creating persistent build output.
function renderDriverBundle(root, overrides) {
  ownedFile(root, 'src/driver-app.js');
  const args = [ownedFile(root, 'scripts/build-driver.mjs'), '--stdout'];
  if (overrides) args.push('--overrides');
  return execFileSync(process.execPath, args, { cwd: root, input: overrides ? JSON.stringify(overrides) : undefined, timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function synchronizeSourceEntry(root, entry, expected, beforeManifest, afterManifest) {
  const bytes = Buffer.from(expected);
  if (entry.bytes.equals(bytes)) return new Map();
  if (entry.mode === 'copy') return new Map([[entry.source, bytes]]);
  const contract = json(root, 'source-driver-contract.json');
  const replacements = new Map(Object.keys(beforeManifest).filter(key => beforeManifest[key] !== afterManifest[key]).map(key => [beforeManifest[key], afterManifest[key]]));
  const escaped = [...replacements.keys()].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.length ? new RegExp(escaped.join('|'), 'g') : null;
  const output = parse(bytes.toString('utf8'), { ecmaVersion: 2022, sourceType: 'script' });
  const pin = output.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations).find(node => node.id.name === 'EXPERIMENT_HELPER_INTEGRITY')?.init;
  const changes = new Map(), overrides = {};
  for (const name of contract.modules) {
    const path = 'src/' + name, original = readFileSync(ownedFile(root, path), 'utf8');
    let updated = pattern ? original.replace(pattern, value => replacements.get(value)) : original;
    if (pin?.type === 'Literal' && typeof pin.value === 'string') {
      const ast = parse(updated, { ecmaVersion: 2022, sourceType: 'module' });
      const owned = ast.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node).filter(node => node?.type === 'VariableDeclaration').flatMap(node => node.declarations).find(node => node.id.name === 'EXPERIMENT_HELPER_INTEGRITY');
      if (owned) updated = updated.slice(0, owned.init.start) + JSON.stringify(pin.value) + updated.slice(owned.init.end);
    }
    if (updated !== original) { overrides[name] = updated; changes.set(path, updated); }
  }
  if (!renderDriverBundle(root, overrides).equals(bytes)) throw new Error('Bundled importer changes must originate in actual source modules; update source and use asset:release');
  return changes;
}
