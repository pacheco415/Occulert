import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const retentionMs = 14 * 86400000;
export const warningMs = 7 * 86400000;
export function inspectRetiredAssets(root = process.cwd(), now = Date.now()) {
  const assetName = /\.v\d+\.(?:js|css)$/;
  const files = readdirSync(root);
  const assets = files.filter(file => assetName.test(file));
  const loadableFiles = files.filter(file => /\.(?:js|css)$/.test(file));
  // Integrity hashes and Vercel cache rules are bookkeeping, not runtime consumers.
  const runtimeFiles = files.filter(file => /\.(?:html|js|css)$/.test(file) || file === 'manifest.json');
  const sources = new Map(runtimeFiles.map(file => [file, readFileSync(join(root, file), 'utf8')]));
  const dependencies = new Map([...sources].map(([file, source]) => [file,
    loadableFiles.filter(dependency => dependency !== file && source.includes(dependency))]));
  const referringFiles = new Map(loadableFiles.map(file => [file, []]));
  for (const [file, referenced] of dependencies) {
    for (const dependency of referenced) referringFiles.get(dependency).push(file);
  }
  const currentAssets = Object.values(JSON.parse(readFileSync(join(root, 'asset-versions.json'), 'utf8')));
  const roots = [...files.filter(file => file.endsWith('.html')), 'sw.js', 'manifest.json', ...currentAssets];
  const reachable = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (reachable.has(file) || !sources.has(file)) continue;
    reachable.add(file);
    for (const dependency of dependencies.get(file)) if (!reachable.has(dependency)) queue.push(dependency);
  }
  const historyPaths = [
    'asset-versions.json',
    'manifest.json',
    ':(top,glob)*.html',
    ':(top,glob)*.js',
    ':(top,glob)*.css',
  ];

  function git(args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
  }

  if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error('Retired asset audit needs full Git history; check out with fetch-depth: 0.');
  }

  const historyDates = new Map();
  function lastReferenceChange(file) {
    if (historyDates.has(file)) return historyDates.get(file);
    // The last change to a runtime reference on main is the supersession date.
    // Some assets were never referenced on main; use their own last commit then.
    const referenceChange = git(['log', '--first-parent', '-1', '--format=%cI', '-S', file, '--', ...historyPaths]);
    const lastChange = referenceChange || git(['log', '--first-parent', '-1', '--format=%cI', '--', file]);
    const date = lastChange ? new Date(lastChange) : null;
    historyDates.set(file, date);
    return date;
  }

  function retiredAt(asset) {
    // A retired file can still mention another retired file. The dependency's
    // grace period cannot begin before the last such referring file was retired.
    const seen = new Set();
    const pending = [asset];
    let latest = null;
    while (pending.length) {
      const file = pending.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const date = lastReferenceChange(file);
      if (date && (!latest || date > latest)) latest = date;
      for (const parent of referringFiles.get(file) || []) {
        if (!reachable.has(parent) && !seen.has(parent)) pending.push(parent);
      }
    }
    return latest;
  }


  const retired = assets.filter(asset => !reachable.has(asset)).map(asset => ({ asset, date: retiredAt(asset) })).filter(({date}) => date && Number.isFinite(date.getTime()));
  return { assets, sources, dependencies, reachable, retired: retired.map(entry => ({ ...entry, ageMs: now - entry.date.getTime() })), eligible: retired.filter(entry => now - entry.date.getTime() >= retentionMs).map(entry => entry.asset) };
}

export function auditRetiredAssets(root = process.cwd(), now = Date.now(), warn = console.warn) {
 const result = inspectRetiredAssets(root, now);
 const failures = [];
 for (const {asset, date, ageMs} of result.retired) {
  if (ageMs < retentionMs) continue;
  const message = `${asset} has no runtime reference and was superseded on ${date.toISOString().slice(0, 10)}; eligible for removal after 14 days`;
  if (ageMs >= retentionMs + warningMs) failures.push(message);
  else warn(`Warning: ${message}; audit fails at 21 days after retirement.`);
 }
 if (failures.length) throw new Error(`Retired asset audit failed:\n${failures.map(message => `- ${message}`).join('\n')}`);
 return result;
}
