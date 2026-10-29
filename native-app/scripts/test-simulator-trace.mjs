import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isSimulatorTraceConfiguration, simulatorTraceSample } from '../lib/simulatorTraceModel.ts';
import { authoredSimulatorInputs, simulatorInputsSha256, simulatorSharedInput, stageSimulatorSharedInput, SIMULATOR_SHARED_INPUT } from './lib/simulator-build-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const { BUNDLE_ID, simulatorTraceProfile } = require('./lib/simulator-trace-profile.cjs');
const base = JSON.parse(readFileSync(join(root, 'app.json'))).expo;
const production = { ...process.env };
const gateKeys = ['EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM', 'OCCULERT_SIMULATOR_TRACE', 'OCCULERT_SIMULATOR_PROFILE', 'OCCULERT_SIMULATOR_PLATFORM'];
for (const key of gateKeys) delete production[key];
const simulator = { ...production, EAS_BUILD_PROFILE: 'simulator-trace', EAS_BUILD_PLATFORM: 'ios', OCCULERT_SIMULATOR_TRACE: '1', OCCULERT_SIMULATOR_PROFILE: 'simulator-trace', OCCULERT_SIMULATOR_PLATFORM: 'ios' };
function environment(env, work) {
  const previous = Object.fromEntries(gateKeys.map(key => [key, process.env[key]]));
  try {
    for (const key of Object.keys(previous)) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
    return work();
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
function stagedProject() {
  const directory = join(mkdtempSync(join(tmpdir(), 'occulert-simulator-profile-')), 'native-app');
  cpSync(root, directory, { recursive: true, filter: path => !['node_modules', 'ios', 'android', '.expo', 'build'].includes(relative(root, path).split(sep)[0]) });
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  stageSimulatorSharedInput(root, directory);
  return directory;
}
function run(directory, env, ...args) {
  return execFileSync(process.execPath, args, { cwd: directory, env: { ...env, CI: '1', EXPO_NO_TELEMETRY: '1' }, encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

test('simulator profile requires all build gates; production cannot select the stub', () => {
  assert.equal(simulatorTraceProfile(production), false);
  assert.equal(simulatorTraceProfile(simulator), true);
  for (const env of [
    { ...simulator, EAS_BUILD_PROFILE: 'production' }, { ...simulator, EAS_BUILD_PLATFORM: 'android' },
    { ...simulator, OCCULERT_SIMULATOR_PLATFORM: undefined }, { ...simulator, OCCULERT_SIMULATOR_TRACE: undefined },
    { ...simulator, OCCULERT_SIMULATOR_PROFILE: undefined },
  ]) assert.throws(() => simulatorTraceProfile(env), /requires the simulator-trace profile/);
  const config = require('../app.config.js');
  environment(production, () => assert.deepEqual(config(), base));
  environment(simulator, () => {
    const result = config(); assert.equal(result.ios.bundleIdentifier, BUNDLE_ID); assert.equal(result.extra.simulatorTrace, true);
    assert.equal(result.plugins.includes('@bacons/apple-targets'), false); assert.equal(result.ios.infoPlist.OcculertSimulatorTrace, true);
  });
  const eas = JSON.parse(readFileSync(join(root, 'eas.json')));
  assert.deepEqual(eas.build.production, { autoIncrement: true, ios: { image: 'sdk-58' } });
  assert.equal(eas.cli.appVersionSource, 'remote'); assert.equal(base.ios.buildNumber, undefined);
  assert.equal(eas.build['simulator-trace'].ios.simulator, true); assert.equal(eas.build['simulator-trace'].distribution, 'internal');
  assert.equal(eas.build['simulator-trace'].extends, undefined); assert.equal(eas.submit['simulator-trace'], undefined);
  assert.deepEqual(eas.build['simulator-trace'].env, { OCCULERT_SIMULATOR_TRACE: '1', OCCULERT_SIMULATOR_PROFILE: 'simulator-trace', OCCULERT_SIMULATOR_PLATFORM: 'ios' });
  const clientEvaluation = { ...production, ...eas.build['simulator-trace'].env };
  assert.equal(simulatorTraceProfile(clientEvaluation), true, 'EAS client config evaluation has only profile env, before worker EAS_BUILD_* variables');
  environment(clientEvaluation, () => assert.equal(config().ios.bundleIdentifier, BUNDLE_ID));
  assert.equal(isSimulatorTraceConfiguration('ios', true, BUNDLE_ID), true);
  for (const values of [['ios', true, base.ios.bundleIdentifier], ['android', true, BUNDLE_ID], ['ios', 'true', BUNDLE_ID], ['ios', false, BUNDLE_ID]]) assert.equal(isSimulatorTraceConfiguration(...values), false);
});

test('bundled trace contains open, a sub-alert blink, three closed seconds, face loss and repeat', () => {
  assert.deepEqual([0, 2_000, 2_500, 4_000, 7_000, 7_100, 9_100].map(at => simulatorTraceSample(at).phase),
    ['open', 'slow blink', 'open', 'closed for 3 seconds', 'closed for 3 seconds', 'face lost', 'open']);
  assert.equal(simulatorTraceSample(7_100).faceFound, false);
  assert.deepEqual(simulatorTraceSample(11_000), simulatorTraceSample(0));
  assert.deepEqual(simulatorTraceSample(NaN), simulatorTraceSample(0));
});

test('the real Metro resolver substitutes ML Kit only for the simulator iOS profile', () => {
  const filename = require.resolve('../metro.config.js');
  environment({ ...production, EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'ios' }, () => {
    delete require.cache[filename]; const config = require(filename);
    const realEntry = require.resolve('react-native-vision-camera-face-detector');
    const context = { resolveRequest: () => ({ type: 'sourceFile', filePath: realEntry }) };
    const result = config.resolver.resolveRequest
      ? config.resolver.resolveRequest(context, 'react-native-vision-camera-face-detector', 'ios')
      : context.resolveRequest(context, 'react-native-vision-camera-face-detector', 'ios');
    assert.equal(result.filePath, realEntry, 'The production Metro graph must retain the real detector entry, never the simulator stub');
  });
  environment(simulator, () => {
    delete require.cache[filename]; const config = require(filename);
    const result = config.resolver.resolveRequest({}, 'react-native-vision-camera-face-detector', 'ios');
    assert.equal(result.filePath, join(root, 'simulator/face-detector-stub.ts')); assert.equal(result.type, 'sourceFile');
    assert.deepEqual(config.watchFolders, [join(root, '../lib')]);
    const blocked = name => config.resolver.blockList.some(pattern => pattern.test(join(root, '../lib', name)));
    assert.equal(blocked('event-outbox.ts'), false);
    for (const name of ['other.ts', '.env', 'event-outbox.ts.map', 'nested/engine.ts']) assert.equal(blocked(name), true);
    assert.throws(() => config.resolver.resolveRequest({}, 'react-native-vision-camera-face-detector', 'android'), /cannot enter/);
  });
  environment({ ...simulator, EAS_BUILD_PROFILE: 'production' }, () => {
    delete require.cache[filename]; assert.throws(() => require(filename), /Simulator trace requires/);
  });
  delete require.cache[filename];
});

test('the copied authored-input manifest detects source edits and links while excluding generated build output', () => {
  const directory = stagedProject();
  try {
    const before = simulatorInputsSha256(authoredSimulatorInputs(directory));
    const shared = join(directory, SIMULATOR_SHARED_INPUT), sharedBytes = readFileSync(shared);
    assert.equal(authoredSimulatorInputs(directory)[SIMULATOR_SHARED_INPUT], simulatorSharedInput(root).sha256);
    assert.deepEqual(readdirSync(dirname(shared)), ['event-outbox.ts']);
    writeFileSync(shared, Buffer.concat([sharedBytes, Buffer.from('\n// changed canonical engine input\n')]));
    assert.notEqual(simulatorInputsSha256(authoredSimulatorInputs(directory)), before);
    writeFileSync(shared, sharedBytes);
    const metroPath = join(directory, 'metro.config.js'), metro = readFileSync(metroPath);
    assert.ok(authoredSimulatorInputs(directory)['metro.config.js'], 'The stub-selecting Metro configuration is a required recorded build input');
    writeFileSync(metroPath, Buffer.concat([metro, Buffer.from('\n// changed stub resolver input\n')]));
    assert.notEqual(simulatorInputsSha256(authoredSimulatorInputs(directory)), before, 'Changing Metro must fail the proof helper\'s original-input identity comparison');
    writeFileSync(metroPath, metro);
    assert.equal(simulatorInputsSha256(authoredSimulatorInputs(directory)), before);
    mkdirSync(join(directory, 'ios')); writeFileSync(join(directory, 'ios/generated.m'), 'generated');
    assert.equal(simulatorInputsSha256(authoredSimulatorInputs(directory)), before);
    const path = join(directory, 'lib/simulatorTraceModel.ts'), source = readFileSync(path);
    writeFileSync(path, Buffer.concat([source, Buffer.from('\n// changed authored bytes\n')]));
    assert.notEqual(simulatorInputsSha256(authoredSimulatorInputs(directory)), before);
    rmSync(path); symlinkSync(join(directory, 'missing-input.ts'), path);
    assert.throws(() => authoredSimulatorInputs(directory), /must not be links/);
  } finally { rmSync(dirname(directory), { recursive: true, force: true }); }
});

test('shared snapshot staging copies only canonical UTF-8 bytes and rejects links and invalid input', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'occulert-simulator-shared-'));
  const source = join(fixture, 'source/native-app'), target = join(fixture, 'output/project');
  const library = join(fixture, 'source/lib'), shared = join(library, 'event-outbox.ts');
  try {
    mkdirSync(source, { recursive: true }); mkdirSync(library); mkdirSync(target, { recursive: true });
    const bytes = Buffer.from('export const canonicalEngine = true;\n');
    writeFileSync(shared, bytes); writeFileSync(join(library, 'other.ts'), 'must not be staged');
    const hash = stageSimulatorSharedInput(source, target);
    assert.equal(hash, simulatorSharedInput(source).sha256);
    assert.deepEqual(readdirSync(join(fixture, 'output/lib')), ['event-outbox.ts']);
    assert.deepEqual(readFileSync(join(fixture, 'output/lib/event-outbox.ts')), bytes);
    writeFileSync(shared, Buffer.from([0xff])); assert.throws(() => simulatorSharedInput(source), /encoded data/);
    rmSync(shared); symlinkSync(join(library, 'missing.ts'), shared);
    assert.throws(() => simulatorSharedInput(source), /never a link/);
    rmSync(shared); writeFileSync(shared, bytes);
    const linkedSource = join(fixture, 'source-linked'); symlinkSync(join(fixture, 'source'), linkedSource, 'dir');
    assert.throws(() => simulatorSharedInput(join(linkedSource, 'native-app')), /owned directory/);
    const otherTarget = join(fixture, 'linked-output/project'); mkdirSync(otherTarget, { recursive: true });
    symlinkSync(library, join(fixture, 'linked-output/lib'), 'dir');
    assert.throws(() => stageSimulatorSharedInput(source, otherTarget), /owned directory/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('actual production prebuild preserves phone Info.plist bytes; simulator excludes ML Kit and cannot target iPhone SDK', () => {
  for (const [mode, env, name] of [['production', production, 'Occulert'], ['simulator', simulator, 'OcculertSimulatorTrace']]) {
    const directory = stagedProject();
    try {
      run(directory, env, join(directory, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install');
      const plist = readFileSync(join(directory, 'ios', name, 'Info.plist'));
      const links = JSON.parse(run(directory, env, join(directory, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js'), 'react-native-config', '--platform', 'ios', '--json'));
      const detector = links.dependencies['react-native-vision-camera-face-detector']?.platforms?.ios;
      if (mode === 'production') {
        assert.deepEqual(plist, readFileSync(join(root, 'scripts/fixtures/production-info-plist-before-simulator.plist')), 'Generated production Info.plist must remain byte-identical');
        assert.ok(detector?.podspecPath, 'ordinary builds must retain the real ML Kit module');
      } else {
        assert.ok(!detector, 'simulator must not autolink ML Kit'); assert.ok(links.dependencies['react-native-vision-camera']?.platforms?.ios);
        const project = readFileSync(join(directory, 'ios', name + '.xcodeproj/project.pbxproj'), 'utf8');
        assert.equal((project.match(/SUPPORTED_PLATFORMS = iphonesimulator;/g) || []).length, 2);
        assert.equal((project.match(/SDKROOT = iphonesimulator;/g) || []).length, 2);
        assert.match(plist.toString(), /<key>OcculertSimulatorTrace<\/key>\s*<true\/>/);
        assert.ok(!existsSync(join(directory, 'ios', 'OcculertWatch')));
      }
      assert.ok(readdirSync(join(directory, 'ios')).length > 0);
    } finally { rmSync(dirname(directory), { recursive: true, force: true }); }
  }
});
