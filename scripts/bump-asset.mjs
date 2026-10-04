import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const read = name => readFileSync(join(root, name), 'utf8');
const parse = name => JSON.parse(read(name));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJSON = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const refresh = args.includes('--refresh');
const logical = args.find(arg => !arg.startsWith('--'));
const manifest = parse('asset-versions.json');
const integrity = parse('asset-integrity.json');
if (!logical || !manifest[logical]) throw new Error('Choose a known logical asset: asset:bump -- driver-app.js [--dry-run | --refresh]');
const active = [...new Set(Object.values(manifest))];
const sources = new Map(active.map(name => [name, read(name)]));

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
  if (!dry) writeJSON('asset-integrity.json', integrity);
} else {
  const selected = new Set([manifest[logical]]);
  // Versioned importers must also be copied rather than rewritten in place.
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, source] of sources) {
      if (!selected.has(name) && [...selected].some(dependency => source.includes(dependency))) {
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
    if (digest(sources.get(name)) !== integrity[name]) throw new Error(`Published asset integrity mismatch: ${name}`);
    const match = name.match(/^(.+)\.v(\d+)\.(js|css)$/);
    if (!match) throw new Error(`Asset is not versioned: ${name}`);
    let version = Number(match[2]) + 1, next;
    do { next = `${match[1]}.v${version++}.${match[3]}`; } while (existsSync(join(root, next)) || historicalAssets.has(next) || [...replacements.values()].includes(next));
    replacements.set(name, next);
  }
  const escaped = [...replacements.keys()].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'g');
  const replace = source => source.replace(pattern, name => replacements.get(name));
  const changes = new Map();
  for (const [old, next] of replacements) {
    const bytes = replace(sources.get(old));
    changes.set(next, bytes); integrity[next] = digest(bytes);
  }
  for (const key of Object.keys(manifest)) manifest[key] = replacements.get(manifest[key]) || manifest[key];
  const walkHTML = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'native-app', 'scripts', 'tests', 'docs', 'benchmark', 'test-results', 'playwright-report'].includes(entry.name)) continue;
      const name = join(directory, entry.name);
      if (entry.isDirectory()) walkHTML(name);
      else if (entry.name.endsWith('.html')) {
        const source = read(name), updated = replace(source);
        if (source !== updated) changes.set(name, updated);
      }
    }
  };
  walkHTML('.');
  let sw = replace(read('sw.js'));
  const cache = sw.match(/const CACHE\s*=\s*(['"])(occulert-v)(\d+)\1/);
  if (!cache) throw new Error('Cannot find versioned service worker cache');
  const cacheHistory = execFileSync('git', ['log', '--all', '--full-history', '--diff-merges=first-parent', '--format=', '-p', '--unified=0', '--', 'sw.js'], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  const recordedCacheVersions = [...cacheHistory.matchAll(/^\+const CACHE\s*=\s*['"]occulert-v(\d+)['"]/gm)].map(match => Number(match[1]));
  const nextCacheVersion = Math.max(Number(cache[3]), ...recordedCacheVersions) + 1;
  sw = sw.replace(cache[0], `const CACHE = '${cache[2]}${nextCacheVersion}'`);
  changes.set('sw.js', sw);
  const config = parse('vercel.json');
  const appMarkup = existsSync(join(root, 'app.html')) ? read('app.html') : '';
  const beforeGuard = appMarkup.match(/<script id="driver-startup-guard">([\s\S]*?)<\/script>/)?.[1];
  const afterGuard = (changes.get('app.html') || appMarkup).match(/<script id="driver-startup-guard">([\s\S]*?)<\/script>/)?.[1];
  if(beforeGuard !== afterGuard && beforeGuard && afterGuard){
    const pin = source => "'sha256-" + createHash('sha256').update(source).digest('base64') + "'";
    for(const rule of config.headers)for(const header of rule.headers)if(header.key==='Content-Security-Policy')header.value=header.value.replaceAll(pin(beforeGuard),pin(afterGuard));
  }

  const versions = new Set([...replacements.values()].map(next => next.match(/\.v(\d+)\./)[1]));
  for (const version of versions) {
    const source = `/(.*)\\.v${version}\\.(js|css)`;
    const index = config.headers.findIndex(rule => rule.source === source);
    const rule = index < 0 ? { source, headers: [] } : config.headers.splice(index, 1)[0];
    rule.headers = rule.headers.filter(header => header.key.toLowerCase() !== 'cache-control');
    rule.headers.push({ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' });
    config.headers.push(rule);
  }
  console.log(JSON.stringify({ copies: Object.fromEntries(replacements), rewrites: [...changes.keys()], cache: `${cache[2]}${nextCacheVersion}`, dryRun: dry }, null, 2));
  if (!dry) {
    for (const [name, source] of changes) writeFileSync(join(root, name), source);
    writeJSON('asset-versions.json', manifest);
    writeJSON('asset-integrity.json', integrity);
    writeJSON('vercel.json', config);
  }
}
