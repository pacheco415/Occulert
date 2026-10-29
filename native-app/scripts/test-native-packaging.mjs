import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditNativeArchive, auditNativeExport, verifyArchiveInputs } from './check-native-archive.mjs';

const app = resolve(fileURLToPath(new URL('../', import.meta.url))), root = resolve(app, '..');
const require = createRequire(new URL('../package.json', import.meta.url));
const config = require('./metro.config.js');
const baseline = require('expo/metro-config').getDefaultConfig(app);
const shared = join(root, 'lib', 'event-outbox.ts');

test('Metro adds only the canonical shared directory and retains Expo resolution defaults', () => {
  assert.equal(config.projectRoot, baseline.projectRoot);
  assert.equal(config.server.unstable_serverRoot, baseline.server.unstable_serverRoot);
  assert.deepEqual(baseline.watchFolders, [], 'an SDK default expansion needs explicit review');
  assert.deepEqual(config.watchFolders, [join(root, 'lib')]);
  for (const [name, value] of Object.entries(baseline.resolver)) {
    if (name === 'blockList') continue;
    if (typeof value === 'function') assert.equal(config.resolver[name].toString(), value.toString(), name);
    else assert.deepEqual(config.resolver[name], value, name);
  }
  assert.equal(lstatSync(shared).isSymbolicLink(), false);
  assert.ok(lstatSync(shared).isFile());
});

test('the shared Metro directory cannot expose another file or drop existing exclusions', () => {
  const blocks = config.resolver.blockList;
  assert.deepEqual(blocks.slice(0, baseline.resolver.blockList.length).map(String), baseline.resolver.blockList.map(String));
  const blocked = file => blocks.some(pattern => pattern.test(file));
  assert.equal(blocked(shared), false);
  for (const name of ['other.ts', 'event-outbox.ts.map', 'event-outbox.ts/child', '.env', 'nested/engine.ts']) {
    assert.equal(blocked(join(root, 'lib', name)), true, name);
  }
  assert.equal(blocked(join(app, 'lib', 'cloudSync.ts')), false);
});

test('the EAS ignore policy retains every Git exclusion and admits only the intended layout', () => {
  const policy = readFileSync(join(root, '.easignore'), 'utf8');
  for (const line of readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#'))) {
    assert.ok(policy.split(/\r?\n/).includes(line), 'Missing original exclusion: ' + line);
  }
  assert.ok(policy.split(/\r?\n/).includes('.git'), 'the EAS shallow clone must explicitly exclude Git metadata');
  const allowed = ['native-app/package.json', 'native-app/package-lock.json', 'native-app/metro.config.js',
    'native-app/app/monitor.tsx', 'native-app/modules/fixture/android/src/main/Fixture.kt',
    'native-app/modules/fixture/ios/Fixture.swift', 'native-app/targets/occulert-watch/index.swift', 'lib/event-outbox.ts'];
  const excluded = ['api/events.js', 'src/cloud-sync.js', 'package.json', 'lib/other.ts', 'lib/nested/engine.ts',
    'lib/event-outbox.ts.map', '.env', 'native-app/.env.production', 'native-app/.npmrc',
    'native-app/credentials.json', 'native-app/signing.p8', 'native-app/signing.p12', 'native-app/signing.key',
    'native-app/profile.mobileprovision', 'native-app/node_modules/fixture/index.js', 'native-app/.expo/types/router.d.ts',
    'native-app/.eas/metadata.json', 'native-app/ios/project.pbxproj', 'native-app/android/build.gradle',
    'native-app/targets/occulert-watch/Assets.xcassets/image.png', 'native-app/targets/occulert-watch/Info.plist',
    'native-app/dist/bundle.js', 'native-app/build/output.js', 'native-app/test-results/result.json',
    'native-app/.verification-receipts/receipt.json', 'native-app/app/build.log'];
  const fixture = mkdtempSync(join(tmpdir(), 'occulert-eas-policy-'));
  try {
    execFileSync('git', ['init', '-q', fixture]);
    writeFileSync(join(fixture, '.gitignore'), policy);
    // EAS fs.cp tests directory names without a trailing slash. Check these
    // before creating directories, so Git cannot infer their type for us.
    const deniedDirectories = ['native-app/.eas', 'native-app/.expo', 'native-app/.cache', 'native-app/node_modules',
      'native-app/ios', 'native-app/android', 'native-app/dist', 'native-app/build', 'native-app/.verification-receipts'];
    let directoryOutput;
    try { directoryOutput = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { cwd: fixture, input: ['native-app', 'lib', ...deniedDirectories].join('\0') + '\0', encoding: 'utf8' }); }
    catch (error) { if (error.status !== 1) throw error; directoryOutput = error.stdout; }
    assert.deepEqual(new Set(directoryOutput.split('\0').filter(Boolean)), new Set(deniedDirectories),
      'EAS may traverse only intended entries; generated directories must be excluded before descent');
    for (const name of [...allowed, ...excluded]) { mkdirSync(dirname(join(fixture, name)), { recursive: true }); writeFileSync(join(fixture, name), 'Synthetic packaging fixture\n'); }
    let output;
    try { output = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { cwd: fixture, input: [...allowed, ...excluded].join('\0') + '\0', encoding: 'utf8' }); }
    catch (error) { if (error.status !== 1) throw error; output = error.stdout; }
    const ignored = new Set(output.split('\0').filter(Boolean));
    for (const name of allowed) assert.equal(ignored.has(name), false, 'Required input excluded: ' + name);
    for (const name of excluded) assert.equal(ignored.has(name), true, 'Unexpected exposure: ' + name);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

function archiveFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-eas-archive-'));
  const sourceRoot = join(directory, 'source'), archiveRoot = join(directory, 'archive');
  for (const name of ['native-app/package.json', 'native-app/package-lock.json', 'native-app/metro.config.js',
    'native-app/eas.json', 'native-app/lib/nativeEventOutbox.ts', 'native-app/lib/cloudSync.ts',
    'native-app/app/monitor.tsx', 'lib/event-outbox.ts']) for (const base of [sourceRoot, archiveRoot]) {
    mkdirSync(dirname(join(base, name)), { recursive: true }); writeFileSync(join(base, name), 'Synthetic ' + name + '\n');
  }
  return { directory, sourceRoot, archiveRoot };
}

test('archive proof accepts one byte-identical shared engine and rejects missing, changed or extra inputs', () => {
  const fixture = archiveFixture();
  try {
    const result = auditNativeArchive(fixture);
    assert.deepEqual(result.outsideApp, ['lib/event-outbox.ts']);
    assert.equal(result.sharedSha256, createHash('sha256').update(readFileSync(join(fixture.sourceRoot, 'lib/event-outbox.ts'))).digest('hex'));
    const engine = join(fixture.archiveRoot, 'lib/event-outbox.ts'), original = readFileSync(engine);
    writeFileSync(engine, 'Changed engine'); assert.throws(() => auditNativeArchive(fixture), /Archive bytes differ/);
    rmSync(engine); assert.throws(() => auditNativeArchive(fixture), /Missing archive input/); writeFileSync(engine, original);
    for (const name of ['lib/other.ts', 'api/events.js', 'native-app/.env.production', 'native-app/credentials.json', 'native-app/.git/config']) {
      mkdirSync(dirname(join(fixture.archiveRoot, name)), { recursive: true }); writeFileSync(join(fixture.archiveRoot, name), 'Synthetic forbidden fixture');
      assert.throws(() => auditNativeArchive(fixture), /Unexpected repository exposure|Secret\/generated path/);
      rmSync(join(fixture.archiveRoot, name), { force: true });
      // Empty forbidden directories are also rejected; remove this fixture's parents.
      if (name.startsWith('api/')) rmSync(join(fixture.archiveRoot, 'api'), { recursive: true, force: true });
      if (name.startsWith('native-app/.git/')) rmSync(join(fixture.archiveRoot, 'native-app/.git'), { recursive: true, force: true });
    }
    const link = join(fixture.archiveRoot, 'native-app', 'engine-link.ts');
    symlinkSync(join(fixture.sourceRoot, 'lib/event-outbox.ts'), link);
    assert.throws(() => auditNativeArchive(fixture), /Archive symlink/);
  } finally { rmSync(fixture.directory, { recursive: true, force: true }); }
});

test('iOS export proof requires one canonical source with exact archived bytes', () => {
  const fixture = archiveFixture(), exportRoot = join(fixture.directory, 'export');
  const directory = join(exportRoot, '_expo/static/js/ios');
  try {
    mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'entry.hbc'), 'Synthetic Hermes fixture');
    const content = readFileSync(join(fixture.archiveRoot, 'lib/event-outbox.ts'), 'utf8');
    const map = { version: 3, sources: ['/lib/event-outbox.ts'], sourcesContent: [content] };
    const save = value => writeFileSync(join(directory, 'entry.hbc.map'), JSON.stringify(value));
    save(map);
    assert.equal(auditNativeExport({ ...fixture, exportRoot }).sharedSourceCount, 1);
    mkdirSync(join(fixture.archiveRoot, 'native-app/node_modules'), { recursive: true });
    writeFileSync(join(fixture.archiveRoot, 'native-app/node_modules/installed'), 'Synthetic installed dependency');
    assert.equal(Object.keys(verifyArchiveInputs(fixture)).length, 8, 'post-install input proof stays valid without mislabeling dependencies as archived inputs');
    assert.throws(() => auditNativeArchive(fixture), /Secret\/generated path/, 'pristine archive audit stays strict');
    save({ ...map, sourcesContent: ['Changed shared source'] });
    assert.throws(() => auditNativeExport({ ...fixture, exportRoot }), /Bundled shared source differs/);
    save({ ...map, sources: [], sourcesContent: [] });
    assert.throws(() => auditNativeExport({ ...fixture, exportRoot }), /must resolve exactly once/);
    save({ version: 3, sections: [{ map }, { map }] });
    assert.throws(() => auditNativeExport({ ...fixture, exportRoot }), /must resolve exactly once/);
  } finally { rmSync(fixture.directory, { recursive: true, force: true }); }
});
