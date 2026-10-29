import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharedInput = 'lib/event-outbox.ts';
const requiredInputs = ['native-app/package.json', 'native-app/package-lock.json', 'native-app/metro.config.js',
  'native-app/eas.json', 'native-app/lib/nativeEventOutbox.ts', 'native-app/lib/cloudSync.ts',
  'native-app/app/monitor.tsx', sharedInput];
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const forbidden = /(?:^|\/)(?:node_modules|\.git|\.expo|\.eas|\.cache|\.verification-receipts|dependency-reports|dist|web-build|build|test-results|playwright-report|\.idea|\.vscode)(?:\/|$)|(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|credentials\.json|\.DS_Store|Thumbs\.db)$|\.(?:log|jks|p8|p12|key|mobileprovision|swp)$|\.orig\.[^/]*$|^native-app\/(?:ios|android)\/|^native-app\/targets\/occulert-watch\/(?:Assets\.xcassets\/|Info\.plist$)/;

export function auditNativeArchive({ sourceRoot, archiveRoot }) {
  sourceRoot = resolve(sourceRoot);
  archiveRoot = resolve(archiveRoot);
  assert.ok(lstatSync(resolve(sourceRoot, sharedInput)).isFile(), 'Canonical shared input must be regular');
  assert.equal(lstatSync(resolve(sourceRoot, sharedInput)).isSymbolicLink(), false, 'Canonical shared input cannot be a symlink');
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry), name = relative(archiveRoot, path).split(sep).join('/');
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, `Archive symlink is unsupported: ${name}`);
      assert.ok(!forbidden.test(name), `Secret/generated path in archive: ${name}`);
      assert.ok(name === 'native-app' || name.startsWith('native-app/') || name === 'lib' || name === sharedInput,
        `Unexpected repository exposure: ${name}`);
      if (stat.isDirectory()) walk(path);
      else { assert.ok(stat.isFile(), `Archive input must be regular: ${name}`); files.push(name); }
    }
  }
  walk(archiveRoot);
  for (const name of requiredInputs) {
    assert.ok(files.includes(name), `Missing archive input: ${name}`);
  }
  verifyArchiveInputs({ sourceRoot, archiveRoot });
  return { files: files.length, nativeFiles: files.filter(name => name.startsWith('native-app/')).length,
    sharedInput, sharedSha256: digest(resolve(archiveRoot, sharedInput)), outsideApp: files.filter(name => !name.startsWith('native-app/')) };
}

// Run again after install/export without claiming that generated dependencies
// are part of the pristine EAS archive. Authored inputs must remain identical.
export function verifyArchiveInputs({ sourceRoot, archiveRoot }) {
  const hashes = {};
  for (const name of requiredInputs) {
    for (const base of [sourceRoot, archiveRoot]) {
      const stat = lstatSync(resolve(base, name));
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Input must be regular: ${name}`);
    }
    hashes[name] = digest(resolve(sourceRoot, name));
    assert.equal(digest(resolve(archiveRoot, name)), hashes[name], `Archive bytes differ: ${name}`);
  }
  return hashes;
}

export function auditNativeExport({ archiveRoot, exportRoot }) {
  const directory = resolve(exportRoot, '_expo/static/js/ios');
  const names = readdirSync(directory), bundles = names.filter(name => name.endsWith('.hbc'));
  assert.equal(bundles.length, 1, 'Expected one actual iOS Hermes bundle');
  assert.ok(statSync(resolve(directory, bundles[0])).size > 0, 'Hermes bundle must not be empty');
  const maps = names.filter(name => name.endsWith('.map')), inputs = [];
  function visit(map) {
    for (const section of map.sections ?? []) visit(section.map);
    for (let index = 0; index < (map.sources ?? []).length; index++) {
      const name = map.sources[index];
      if (name === sharedInput || name.endsWith('/' + sharedInput)) {
        assert.equal(typeof map.sourcesContent?.[index], 'string', 'Canonical engine source content must be recorded');
        inputs.push(createHash('sha256').update(map.sourcesContent[index]).digest('hex'));
      }
    }
  }
  for (const name of maps) visit(JSON.parse(readFileSync(resolve(directory, name), 'utf8')));
  assert.equal(inputs.length, 1, 'Canonical engine must resolve exactly once in the actual iOS export');
  const sharedSha256 = digest(resolve(archiveRoot, sharedInput));
  assert.equal(inputs[0], sharedSha256, 'Bundled shared source differs from the inspected archive');
  return { bundle: bundles[0], bundleBytes: statSync(resolve(directory, bundles[0])).size,
    bundleSha256: digest(resolve(directory, bundles[0])), sharedSourceCount: inputs.length, sharedSha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceRoot, archiveRoot, exportRoot] = process.argv.slice(2);
  assert.ok(sourceRoot && archiveRoot, 'Usage: node check-native-archive.mjs SOURCE_ROOT ARCHIVE_ROOT [EXPORT_ROOT]');
  console.log(JSON.stringify(exportRoot
    ? { inputs: verifyArchiveInputs({ sourceRoot, archiveRoot }), export: auditNativeExport({ archiveRoot, exportRoot }) }
    : { archive: auditNativeArchive({ sourceRoot, archiveRoot }) }, null, 2));
}
