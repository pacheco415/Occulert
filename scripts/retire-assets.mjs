import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectRetiredAssets, retentionMs, warningMs } from './lib/retired-assets.mjs';

const dayMs = 86400000;

// Roots, including sw.js, are never rewritten to make an asset removable.
export function retireAssets({ root = process.cwd(), now = Date.now(), write = false, check = false, failWithinDays, log = console.log } = {}) {
  if (write && check) throw new Error('Retirement --check is a dry run and cannot be combined with --write.');
  if (failWithinDays !== undefined && !check) throw new Error('--fail-within-days requires --check.');
  const noticeDays = failWithinDays === undefined ? 3 : failWithinDays;
  if (!Number.isInteger(noticeDays) || noticeDays < 1 || noticeDays * dayMs > retentionMs + warningMs) {
    throw new Error('--fail-within-days must be an integer from 1 through 21.');
  }
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
  if (check) {
    // Use the audit's retirement clock even when a retained consumer blocks
    // removal. Protection must not hide a file whose audit deadline is near.
    const due = inspection.retired.filter(({ ageMs }) => ageMs >= retentionMs + warningMs - noticeDays * dayMs);
    for (const { asset, date, ageMs } of due) {
      const deadline = new Date(date.getTime() + retentionMs + warningMs).toISOString();
      const status = removals.has(asset) ? 'eligible for removal' : ageMs < retentionMs
        ? 'protected by the 14-day retention window' : 'protected by a retained consumer; review references before cleanup';
      log(`- ${asset}: audit fails at ${deadline}; ${status}`);
    }
    if (due.length) throw new Error(`Retired asset cleanup required: ${due.length} file(s) are within ${noticeDays} days of their day-21 audit failure or overdue.`);
  }
  if (!write || !files.length) return files;
  const read = file => readFileSync(join(root, file), 'utf8');
  const integrity = JSON.parse(read('asset-integrity.json'));
  for (const file of files) delete integrity[file];
  const config = JSON.parse(read('vercel.json'));
  const retained = readdirSync(root).filter(file => !removals.has(file));
  config.headers = config.headers.filter(rule => {
    // Only prune owned root JS/CSS version rules, including legacy unescaped dots.
    // Nested audio/vendor assets are outside this tool's retained root file list.
    if (!rule.headers?.some(header => header.key.toLowerCase() === 'cache-control' && header.value.includes('immutable'))) return true;
    if (!/^\/[^/]*\\?\.v\d+\\?\.(?:js|css|\(js\|css\))$/.test(rule.source)) return true;
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
export function parseRetirementArgs(args) {
  const windows = args.filter(arg => arg.startsWith('--fail-within-days='));
  if (windows.length > 1 || args.some(arg => !['--write', '--check'].includes(arg) && !/^--fail-within-days=[1-9]\d*$/.test(arg))) {
    throw new Error('Usage: npm run asset:retire -- [--write | --check [--fail-within-days=1..21]]');
  }
  return { write: args.includes('--write'), check: args.includes('--check'),
    ...(windows.length ? { failWithinDays: Number(windows[0].split('=')[1]) } : {}) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  retireAssets(parseRetirementArgs(process.argv.slice(2)));
}
