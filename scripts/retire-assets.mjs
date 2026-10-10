import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectRetiredAssets } from './lib/retired-assets.mjs';

// Roots, including sw.js, are never rewritten to make an asset removable.
export function retireAssets({ root = process.cwd(), now = Date.now(), write = false, log = console.log } = {}) {
  const inspection = inspectRetiredAssets(root, now);
  const removals = new Set(inspection.eligible);
  // Even an unreachable file inside its retention window must keep its imports.
  let changed;
  do {
    changed = false;
    for (const [consumer, dependencies] of inspection.dependencies) {
      if (removals.has(consumer)) continue;
      for (const dependency of dependencies) if (removals.delete(dependency)) changed = true;
    }
  } while (changed);
  const files = [...removals].sort();
  log(`${write ? 'Remove' : 'Dry run: eligible for removal'} (${files.length}):${files.map(file => `\n- ${file}`).join('')}`);
  if (!write || !files.length) return files;
  const read = file => readFileSync(join(root, file), 'utf8');
  const integrity = JSON.parse(read('asset-integrity.json'));
  for (const file of files) delete integrity[file];
  const config = JSON.parse(read('vercel.json'));
  const retained = readdirSync(root).filter(file => !removals.has(file));
  config.headers = config.headers.filter(rule => {
    // Only prune the owned immutable version rules; preserve all other policies.
    if (!rule.headers?.some(header => header.key.toLowerCase() === 'cache-control' && header.value.includes('immutable'))) return true;
    // Older owned rules used unescaped dots in their versioned filenames.
    if (!/\\?\.v\d+\\?\./.test(rule.source)) return true;
    const pattern = new RegExp(`^${rule.source}$`);
    return retained.some(file => pattern.test(`/${file}`));
  });
  let sw = read('sw.js');
  const match = sw.match(/const CACHE\s*=\s*(['"])occulert-v(\d+)\1/);
  if (!match) throw new Error('Cannot find versioned service worker cache');
  const history = execFileSync('git', ['log', '--all', '--full-history', '--diff-merges=first-parent', '--format=', '-p', '--unified=0', '--', 'sw.js'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const versions = [...history.matchAll(/^\+const CACHE\s*=\s*['"]occulert-v(\d+)['"]/gm)].map(entry => Number(entry[1]));
  sw = sw.replace(match[0], `const CACHE = 'occulert-v${Math.max(Number(match[2]), ...versions) + 1}'`);
  // Prepare every update before deletion. Fixtures are removed only when their
  // exact asset filename is no longer referenced by any other test/tool file.
  const fixtures = join(root, 'tests/fixtures');
  const fixtureRemovals = [];
  try {
    for (const fixture of readdirSync(fixtures)) if (removals.has(fixture)) {
      let references = '';
      try {
        references = execFileSync('git', ['grep', '-l', '-F', fixture, '--', 'scripts', 'tests', `:(exclude)tests/fixtures/${fixture}`], { cwd: root, encoding: 'utf8' }).trim();
      } catch (error) { if (error.status !== 1) throw error; }
      if (!references) fixtureRemovals.push(join(fixtures, fixture));
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.status !== 1) throw error;
  }
  writeFileSync(join(root, 'asset-integrity.json'), `${JSON.stringify(integrity, null, 2)}\n`);
  writeFileSync(join(root, 'vercel.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(root, 'sw.js'), sw);
  for (const file of files) unlinkSync(join(root, file));
  for (const file of fixtureRemovals) unlinkSync(file);
  return files;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--write')) throw new Error('Usage: npm run asset:retire -- [--write]');
  retireAssets({ write: process.argv.includes('--write') });
}
