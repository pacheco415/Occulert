import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyQueryDecoderPatch, patchQueryDecoder } from './patch-query-decoder.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));

test('generated iOS HealthKit declarations include both Apple-required purpose strings', () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const cli = require.resolve('expo/bin/cli');
  const config = JSON.parse(execFileSync(process.execPath, [cli, 'config', '--type', 'introspect', '--json'], {
    cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
  }));
  const ios = config._internal.modResults.ios;
  assert.match(ios.infoPlist.NSHealthShareUsageDescription, /reads.*sleep.*heart rate variability/i);
  assert.match(ios.infoPlist.NSHealthUpdateUsageDescription, /does not write or modify Apple Health data/i);
  assert.equal(ios.entitlements['com.apple.developer.healthkit'], true);
  assert.notEqual(ios.entitlements['com.apple.developer.healthkit.background-delivery'], true);
});

test('Expo 58, React Native and the React renderer use matching supported versions', () => {
  const expo = require('expo/package.json');
  const bundled = require('expo/bundledNativeModules.json');
  const react = require('react/package.json').version;
  assert.match(expo.version, /^58\./);
  assert.equal(require('react-native/package.json').version, bundled['react-native']);
  assert.equal(react, bundled.react);
  assert.equal(require('react-dom/package.json').version, react);
  assert.equal(require('react-test-renderer/package.json').version, react);
});

for (const [consumer, intermediates] of [
  ['@bacons/apple-targets', ['glob', 'minimatch']],
  ['@expo/fingerprint', ['minimatch']],
]) {
  test(`${consumer} brace expansion preserves globs and bounds hostile patterns`, async () => {
    let consumerRequire = createRequire(require.resolve(consumer));
    for (const dependency of intermediates) {
      consumerRequire = createRequire(consumerRequire.resolve(dependency));
    }
    const entry = consumerRequire.resolve('brace-expansion');
    const worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      const module = require(${JSON.stringify(entry)});
      const expand = module.expand || module.default || module;
      const normal = expand('src/{app,lib}/*.{ts,tsx}');
      for (const pattern of [
        '{a,'.repeat(4000) + 'z' + '}'.repeat(4000),
        '{'.repeat(3200) + 'a,b' + '}'.repeat(3200),
        '{a}' + '}'.repeat(64000) + ',z}',
      ]) expand(pattern);
      parentPort.postMessage(normal);
    `, { eval: true });
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Brace expansion stalled')), 3000);
        worker.once('message', value => { clearTimeout(timer); resolve(value); });
        worker.once('error', error => { clearTimeout(timer); reject(error); });
      });
      assert.deepEqual(result, ['src/app/*.ts', 'src/app/*.tsx', 'src/lib/*.ts', 'src/lib/*.tsx']);
    } finally { await worker.terminate(); }
  });
}

test('React DevTools shell quoting preserves arguments and rejects line terminators after comments', () => {
  const devtoolsRequire = createRequire(require.resolve('react-devtools-core'));
  const { parse, quote } = devtoolsRequire('shell-quote');
  const args = ['echo', 'driver name', "driver's route", 'route; literal', 'Café'];
  assert.deepEqual(parse(quote(args)), args);
  assert.deepEqual(parse('echo "driver name"'), ['echo', 'driver name']);
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => quote(['echo', 'ok', { comment: 'fixture' }, `a${terminator}id;#`]), TypeError);
  }
});

test('SDK 58 Router preserves route query values without the legacy decoder', () => {
  const routerRoot = dirname(require.resolve('expo-router/package.json'));
  const { parseQueryParams } = require(join(routerRoot, 'build/fork/getStateFromPath-forks.js'));
  const { stringifySearchParams } = require(join(routerRoot, 'build/utils/queryParams.js'));
  const parse = path => ({ ...parseQueryParams(path, { name: 'fixture' }) });
  assert.deepEqual(parse('/?name=Caf%C3%A9+driver&name=Second&key=a%26b'), { name: ['Café driver', 'Second'], key: 'a&b' });
  assert.deepEqual(parse('/?' + stringifySearchParams({ route: 'a/b', name: 'Café driver', empty: null })), { route: 'a/b', name: 'Café driver', empty: '' });
  assert.deepEqual(parse('/?driver=one&driver=two'), { driver: ['one', 'two'] });
  assert.equal(parse('occulert://accept-invite?code=a%2Bb#details').code, 'a+b');
  assert.throws(() => require.resolve('query-string/package.json'), { code: 'MODULE_NOT_FOUND' });
  assert.equal(applyQueryDecoderPatch(), false, 'SDK 58 has no legacy decoder to patch');
  const patched = patchQueryDecoder("const decodeComponent = require('decode-uri-component');");
  assert.equal(patchQueryDecoder(patched.source).changed, false, 'the legacy patch remains idempotent');
  assert.throws(() => patchQueryDecoder('unrecognized upstream source'), /Cannot safely patch/);
});

test('malformed URL input is decoded without an unbounded CPU wait', async () => {
  const parser = join(dirname(require.resolve('expo-router/package.json')), 'build/fork/getStateFromPath-forks.js');
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');const {parseQueryParams}=require(${JSON.stringify(parser)});parentPort.postMessage(typeof parseQueryParams('/?value='+ '%FF'.repeat(12000),{name:'fixture'}).value);`, { eval: true });
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Malformed query decoding stalled')), 3000);
      worker.once('message', message => { clearTimeout(timer); resolve(message); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(result, 'string');
  } finally { await worker.terminate(); }
});

test('Watch build plist parser and UUID generation retain their supported APIs', () => {
  const baconsRequire = createRequire(require.resolve('@bacons/xcode'));
  const plistModule = baconsRequire('@expo/plist');
  const plist = plistModule.default || plistModule;
  const value = { CFBundleIdentifier: 'com.occulert.fixture.watch', nested: { enabled: true }, array: ['a', 42] };
  assert.deepEqual(plist.parse(plist.build(value)), value);
  const plistRequire = createRequire(baconsRequire.resolve('@expo/plist'));
  const { DOMImplementation } = plistRequire('@xmldom/xmldom');
  assert.throws(() => new DOMImplementation().createDocument(null, 'root', null).createEntityReference('bad name'));
  for (const consumer of ['xcode', '@bacons/xcode']) {
    const consumerRequire = createRequire(require.resolve(consumer));
    const uuid = consumerRequire('uuid');
    assert.match(uuid.v4(), /^[0-9a-f-]{36}$/);
    assert.throws(() => uuid.v5('fixture', uuid.v5.DNS, new Uint8Array(1)), /buffer|bounds|length/i);
  }
  const project = require('xcode').project('fixture.pbxproj');
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
});

// Exercise Expo's real resolver; a JS platform guard cannot prevent Gradle linking.
test('Android excludes Apple Watch connectivity while iOS and Android cameras stay linked', () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const cli = join(dirname(require.resolve('expo-modules-autolinking/package.json')), 'bin/expo-modules-autolinking.js');
  const config = platform => JSON.parse(execFileSync(process.execPath, [cli, 'react-native-config', '--platform', platform, '--json'], { cwd, encoding:'utf8', timeout:30000, stdio:['ignore','pipe','pipe'] }));
  const android = config('android').dependencies, ios = config('ios').dependencies;
  assert.equal(android['react-native-watch-connectivity'], undefined);
  assert.ok(ios['react-native-watch-connectivity']?.platforms?.ios);
  assert.ok(android['react-native-vision-camera']?.platforms?.android);
});
