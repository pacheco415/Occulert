import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createWatchPrivacyFixture, privacyMembership, repairWatchPrivacy, runReactNativePrivacyAggregation, parsePlist } from './lib/watch-privacy-fixture.mjs';

// This test is an explicit macOS CI gate, not an optional/skipped Linux test.
assert.equal(process.platform, 'darwin', 'Run the real Ruby/Xcode packaging gate on macOS.');

function buildWatch(fixture, suffix) {
  const output = join(fixture.root, suffix);
  fixture.run('xcodebuild', ['-project', dirname(fixture.projectPath), '-target', 'OcculertWatch',
    '-configuration', 'Release', '-sdk', 'watchos', '-quiet',
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
    `CONFIGURATION_BUILD_DIR=${output}`, `SYMROOT=${join(output, 'sym')}`, `OBJROOT=${join(output, 'obj')}`,
    `CLANG_MODULE_CACHE_PATH=${join(output, 'module-cache')}`, 'COMPILER_INDEX_STORE_ENABLE=NO', 'build'],
  { timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
  return join(output, 'OcculertWatch.app');
}

function checkFixed(fixture) {
  const membership = privacyMembership(fixture);
  assert.equal(membership.phone.length, 1);
  assert.equal(membership.watch.length, 1);
  assert.equal(membership.phone[0].path, join(fixture.directory, 'ios/Occulert/PrivacyInfo.xcprivacy'));
  assert.equal(membership.watch[0].path, fixture.watchManifest);
  assert.equal(membership.implicitWatchManifest, false);
  assert.deepEqual(membership.membership, ['Info.plist', 'PrivacyInfo.xcprivacy', 'expo-target.config.js']);
  assert.deepEqual(readFileSync(fixture.watchManifest), fixture.originalWatch, 'RN must not aggregate phone declarations into tracked Watch source');
  return membership;
}

test('actual RN aggregation reproduces the old duplicate and repaired/repeated prebuild compiles one Watch manifest', { timeout: 600000 }, async () => {
  const fixture = createWatchPrivacyFixture({ legacy: true });
  try {
    fixture.prebuild();
    const legacy = runReactNativePrivacyAggregation(fixture);
    assert.equal(legacy.aggregationPath, join(fixture.directory, 'ios/Occulert/PrivacyInfo.xcprivacy'));
    assert.ok(legacy.applicationTargets.includes('Occulert') && legacy.applicationTargets.includes('OcculertWatch'));
    const broken = privacyMembership(fixture);
    assert.equal(broken.watch.length, 1);
    assert.equal(broken.watch[0].path, broken.phone[0].path, 'negative control must contain RN\'s phone resource in Watch');
    assert.equal(broken.implicitWatchManifest, true, 'negative control must also contain the Watch-owned implicit resource');
    assert.throws(() => buildWatch(fixture, 'old-output'), error => {
      const log = String(error.stdout) + String(error.stderr);
      assert.match(log, /Multiple commands produce/);
      assert.match(log, /OcculertWatch\.app\/PrivacyInfo\.xcprivacy/);
      assert.ok(log.includes('/ios/Occulert/PrivacyInfo.xcprivacy') && log.includes('/targets/occulert-watch/PrivacyInfo.xcprivacy'));
      return true;
    }, 'the negative control must reproduce the observed Xcode duplicate output');

    const phoneBefore = broken.phone;
    const phoneBytes = readFileSync(phoneBefore[0].path);
    const phoneDeclarations = parsePlist(phoneBytes.toString());
    const brokenProject = readFileSync(fixture.projectPath);
    await repairWatchPrivacy(fixture);
    assert.deepEqual(checkFixed(fixture).phone, phoneBefore, 'the local repair must preserve the phone file/build references');
    assert.deepEqual(readFileSync(phoneBefore[0].path), phoneBytes, 'the local repair must not write the phone manifest');
    // The full Expo repair must also see the untouched graph produced by RN,
    // rather than benefiting from the isolated local-mod preservation check.
    writeFileSync(fixture.projectPath, brokenProject);
    assert.deepEqual(privacyMembership(fixture), broken);
    fixture.useFix();
    fixture.prebuild();
    // Expo merges the newly configured empty privacy declaration, including its
    // default tracking-domain array, and may regenerate phone reference UUIDs.
    const mergedDeclarations = { ...phoneDeclarations, NSPrivacyTrackingDomains: [] };
    assert.deepEqual(parsePlist(readFileSync(phoneBefore[0].path, 'utf8')), mergedDeclarations,
      'full Expo repair must preserve all prior phone declarations');
    const firstAggregation = runReactNativePrivacyAggregation(fixture);
    assert.equal(firstAggregation.aggregationPath, phoneBefore[0].path);
    assert.deepEqual(parsePlist(readFileSync(phoneBefore[0].path, 'utf8')), mergedDeclarations);
    const fixed = checkFixed(fixture);
    const aggregatedPhoneBytes = readFileSync(phoneBefore[0].path);
    runReactNativePrivacyAggregation(fixture);
    assert.deepEqual(checkFixed(fixture), fixed, 'actual repeated aggregation must preserve every resource reference');
    assert.deepEqual(readFileSync(phoneBefore[0].path), aggregatedPhoneBytes, 'actual repeated aggregation must be byte-identical');
    fixture.prebuild();
    runReactNativePrivacyAggregation(fixture);
    const repeated = checkFixed(fixture);
    assert.deepEqual(repeated.phone.map(file => file.path), fixed.phone.map(file => file.path));
    assert.deepEqual({ ...repeated, phone: [] }, { ...fixed, phone: [] },
      'repeated prebuild and actual aggregation must preserve exact Watch identities and one-copy membership');
    assert.deepEqual(parsePlist(readFileSync(phoneBefore[0].path, 'utf8')), mergedDeclarations);
    const product = buildWatch(fixture, 'fixed-output');
    const copied = join(product, 'PrivacyInfo.xcprivacy');
    assert.ok(existsSync(copied));
    const compiledManifest = JSON.parse(fixture.run('plutil', ['-convert', 'json', '-o', '-', copied]));
    assert.deepEqual(compiledManifest, parsePlist(fixture.originalWatch.toString()),
      'compiled Watch bundle must contain all and only its own source declarations, regardless of plist encoding');
    assert.deepEqual(readFileSync(fixture.watchManifest), fixture.originalWatch);
    assert.deepEqual(compiledManifest.NSPrivacyAccessedAPITypes,
      [{ NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] }]);
  } finally { fixture.cleanup(); }
});

test('clean full Expo generation keeps RN aggregation in the generated phone file', { timeout: 180000 }, () => {
  const fixture = createWatchPrivacyFixture();
  try {
    fixture.prebuild();
    const before = checkFixed(fixture);
    const aggregation = runReactNativePrivacyAggregation(fixture);
    assert.equal(aggregation.aggregationPath, before.phone[0].path);
    assert.deepEqual(checkFixed(fixture), before);
    const phone = parsePlist(readFileSync(before.phone[0].path, 'utf8'));
    assert.ok(phone.NSPrivacyAccessedAPITypes.some(api => api.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryUserDefaults'),
      'the actual RN implementation must add its phone core API declarations');
  } finally { fixture.cleanup(); }
});
