import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoredSimulatorInputs, simulatorInputsSha256 } from './lib/simulator-build-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), options = {}, args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  if (!['--device', '--build', '--receipt', '--screenshot'].includes(args[index]) || !args[index + 1] || Object.hasOwn(options, args[index])) throw Error('Use prove-simulator-trace --device UUID --build BUILD_DIRECTORY [--receipt FILE] [--screenshot PNG]');
  options[args[index]] = args[index + 1];
}
if (process.platform !== 'darwin' || !options['--device'] || !options['--build']) throw Error('Choose a local iOS Simulator and completed local build.');
const build = JSON.parse(readFileSync(join(resolve(options['--build']), 'build-receipt.json')));
const bundle = 'com.occulert.app.simulatortrace', digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(build.bundleIdentifier, bundle); assert.equal(build.platform, 'iphonesimulator'); assert.equal(build.architecture, 'arm64');
assert.equal(build.sharedInput, '../lib/event-outbox.ts');
assert.equal(build.sharedInputSha256, build.authoredInputs[build.sharedInput]);
assert.equal(build.authoredInputsSha256, simulatorInputsSha256(authoredSimulatorInputs(root)), 'Rebuild after any authored input changes');
assert.equal(digest(join(build.appPath, 'main.jsbundle')), build.compiledJsSha256);
assert.equal(digest(join(build.appPath, 'OcculertSimulatorTrace')), build.machOSha256);
assert.equal(digest(join(build.appPath, 'Info.plist')), build.appInfoPlistSha256);
const tool = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const uiProject = mkdtempSync(join(resolve(options['--build']), 'proof-ui-'));
for (const name of ['SimulatorTraceProof.swift', 'create-simulator-proof-project.rb']) copyFileSync(join(root, 'scripts/fixtures', name), join(uiProject, name));
// CocoaPods already depends on xcodeproj. Use the caller's local Ruby/gem
// environment; do not install or change global tooling for the proof runner.
execFileSync('ruby', [join(uiProject, 'create-simulator-proof-project.rb')], { stdio: ['ignore', 'pipe', 'pipe'] });
const devices = JSON.parse(tool('list', 'devices', 'available', '-j')).devices;
const match = Object.entries(devices).filter(([runtime]) => runtime.includes('.iOS-')).flatMap(([runtime, rows]) => rows.map(device => ({ ...device, runtime }))).find(device => device.udid === options['--device']);
assert.ok(match?.isAvailable, 'The destination must be an available iOS Simulator');
if (match.state !== 'Booted') tool('boot', match.udid);
tool('bootstatus', match.udid, '-b');
tool('install', match.udid, build.appPath);
try { tool('terminate', match.udid, bundle); } catch (_) {}

const observations = [], startedAt = Date.now();
let uiRunner = null, uiStatus = null, uiError = null, screenshotTaken = false;
const uiLog = join(uiProject, 'ui-test.log'), uiDescriptor = openSync(uiLog, 'w');
let log = '', exited = false;
let streamError = null;
const stream = spawn('xcrun', ['simctl', 'spawn', match.udid, 'log', 'stream', '--style', 'compact', '--level', 'debug',
  '--predicate', 'process == "OcculertSimulatorTrace" AND eventMessage CONTAINS "OCCULERT_SIMULATOR_SCORING"'], { stdio: ['ignore', 'pipe', 'pipe'] });
function receive(data) {
  log += String(data);
  if (log.length > 2_000_000) { streamError = Error('Simulator proof log exceeded its bound'); return; }
  try {
    const rows = [...log.matchAll(/OCCULERT_SIMULATOR_SCORING (\{[^\n]*?\})/g)].map(match => JSON.parse(match[1]));
    observations.splice(0, observations.length, ...rows.slice(0, 64));
  } catch (error) { streamError = error; }
}
stream.stdout.on('data', receive); stream.stderr.on('data', data => { log += String(data); }); stream.on('exit', () => { exited = true; });
stream.on('error', error => { streamError = error; exited = true; });
const complete = () => observations.some(row => row.state === 'open' && row.ear === .3)
  && observations.some(row => row.state === 'watch' && row.elapsedMs >= 1_900 && row.elapsedMs < 3_000)
  && observations.some(row => row.state === 'closed' && row.closedDurationMs >= 3_000 && row.fatigueScore > 0)
  && observations.some(row => row.state === 'noFace');
try {
  await new Promise(resolve => setTimeout(resolve, 500));
  // XCTest handles iOS's scoped Open confirmation and the actual Start/Stop
  // controls. This isolated project cannot recompile the application binary.
  uiRunner = spawn('xcodebuild', ['test', '-project', join(uiProject, 'TraceProof.xcodeproj'), '-scheme', 'TraceProof',
    '-configuration', 'Release', '-destination', 'platform=iOS Simulator,id=' + match.udid,
    '-derivedDataPath', join(uiProject, 'DerivedData'), '-resultBundlePath', join(uiProject, 'TestResult.xcresult'),
    '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '90', '-maximum-test-execution-time-allowance', '90',
    'CODE_SIGNING_ALLOWED=NO'], { cwd: uiProject, stdio: ['ignore', uiDescriptor, uiDescriptor] });
  uiRunner.on('exit', code => { uiStatus = code ?? -1; });
  uiRunner.on('error', error => { uiError = error; uiStatus = -1; });
  while ((!complete() || uiStatus === null) && !exited && !streamError && !uiError && Date.now() - startedAt < 150_000) {
    if (complete() && options['--screenshot'] && !screenshotTaken) {
      mkdirSync(dirname(resolve(options['--screenshot'])), { recursive: true });
      tool('io', match.udid, 'screenshot', resolve(options['--screenshot'])); screenshotTaken = true;
    }
    if (uiStatus !== null && uiStatus !== 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ifError(streamError);
  assert.ifError(uiError);
  assert.equal(uiStatus, 0, 'The actual simulator UI Start/Stop test must pass; inspect ' + uiLog);
  assert.ok(complete(), 'The actual simulator must show open/blink/three-second closure/no-face through real scoring');
  assert.match(readFileSync(uiLog, 'utf8'), /OCCULERT_SIMULATOR_UI_PROOF stopped/);
  assert.equal(build.authoredInputsSha256, simulatorInputsSha256(authoredSimulatorInputs(root)), 'Authored input changed during proof');
  const receipt = { kind: 'actual_ios_simulator_scoring_proof', observedAt: new Date().toISOString(), device: match.name, runtime: match.runtime,
    sourceBase: build.sourceBase, authoredInputsSha256: build.authoredInputsSha256, compiledJsSha256: build.compiledJsSha256,
    machOSha256: build.machOSha256, bundleIdentifier: bundle, platform: build.platform, architecture: build.architecture,
    sharedInput: build.sharedInput, sharedInputSha256: build.sharedInputSha256,
    productionInfoPlistSha256: digest(join(root, 'scripts/fixtures/production-info-plist-before-simulator.plist')),
    proofRunnerSha256: digest(fileURLToPath(import.meta.url)),
    uiTestSha256: digest(join(uiProject, 'SimulatorTraceProof.swift')),
    uiProjectGeneratorSha256: digest(join(uiProject, 'create-simulator-proof-project.rb')),
    uiChecks: { simulatorBanner: true, actualStart: true, actualStopReturnsToStart: true }, observations };
  if (options['--receipt']) { mkdirSync(dirname(resolve(options['--receipt'])), { recursive: true }); writeFileSync(resolve(options['--receipt']), JSON.stringify(receipt, null, 2) + '\n'); }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  stream.kill('SIGTERM');
  if (uiStatus === null) uiRunner?.kill('SIGTERM');
  closeSync(uiDescriptor);
  try { tool('terminate', match.udid, bundle); } catch (_) {}
  writeFileSync(join(resolve(options['--build']), 'simulator-proof.log'), log);
}
