import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoredSimulatorInputs, simulatorInputsSha256, stageSimulatorSharedInput, SIMULATOR_SHARED_INPUT } from './lib/simulator-build-inputs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--device', '--output'].includes(args[index]) || !args[index + 1] || Object.hasOwn(options, args[index])) throw Error('Use build-simulator-trace --device SIMULATOR_UUID [--output NEW_DIRECTORY]');
  options[args[index]] = args[index + 1];
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('This proof requires an arm64 Mac and local Xcode.');
if (!/^[0-9a-f-]{36}$/i.test(options['--device'] || '')) throw Error('Choose an installed iOS Simulator UUID with --device.');
const output = options['--output'] ? resolve(options['--output']) : mkdtempSync(join(tmpdir(), 'occulert-simulator-trace-'));
if (!relative(root, output).startsWith('..' + sep)) throw Error('Keep build output outside the source project.');
if (options['--output']) { if (existsSync(output)) throw Error('Build output must be a new directory.'); mkdirSync(output, { recursive: true }); }
const project = join(output, 'project');
cpSync(root, project, { recursive: true, filter: path => !['node_modules', 'ios', 'android', '.expo', 'build'].includes(relative(root, path).split(sep)[0])
  && !relative(root, path).split(sep).some(name => name === '.DS_Store' || name === '.env' || name.startsWith('.env.')) });
stageSimulatorSharedInput(root, project);
// Dependency build scripts compile inside their own package directories. A
// symlink would leak those writes back into the authored checkout (and inherit
// Finder metadata in File Provider folders), so stage actual dependency bytes.
const dependencies = join(root, 'node_modules');
cpSync(dependencies, join(project, 'node_modules'), { recursive: true, verbatimSymlinks: true,
  filter: path => !relative(dependencies, path).split(sep).some(name => ['.DerivedData', '.build', '.DS_Store'].includes(name)) });
const env = { ...process.env, EAS_BUILD_PROFILE: 'simulator-trace', EAS_BUILD_PLATFORM: 'ios', OCCULERT_SIMULATOR_TRACE: '1',
  OCCULERT_SIMULATOR_PROFILE: 'simulator-trace', OCCULERT_SIMULATOR_PLATFORM: 'ios',
  EXPO_PUBLIC_EYE_BASELINE_EXPERIMENT: '0', EXPO_PUBLIC_CAPTURE_LOAD_EXPERIMENT: '0', OCCULERT_MULTITASKING_CAMERA_EXPERIMENT: '0',
  EXPO_NO_TELEMETRY: '1', CI: '1', COCOAPODS_DISABLE_STATS: 'true', COPYFILE_DISABLE: '1' };
function run(name, executable, args, cwd = project) {
  const log = join(output, name + '.log'), descriptor = openSync(log, 'w');
  console.log(name + ': ' + log);
  let result;
  try { result = spawnSync(executable, args, { cwd, env, stdio: ['ignore', descriptor, descriptor] }); }
  finally { closeSync(descriptor); }
  if (result.error || result.status !== 0) throw Error(name + ' failed; inspect ' + log);
}

// These are local tools only. This script never invokes EAS, a signing service,
// a submission command, or an app version/counter operation.
run('prebuild', process.execPath, [join(project, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install']);
const authoredInputs = authoredSimulatorInputs(project);
if (simulatorInputsSha256(authoredInputs) !== simulatorInputsSha256(authoredSimulatorInputs(root))) throw Error('Prebuild changed an authored input; review the staged source before compiling.');
run('pods', 'pod', ['install'], join(project, 'ios'));
run('xcodebuild', 'xcodebuild', ['-workspace', join(project, 'ios/OcculertSimulatorTrace.xcworkspace'), '-scheme', 'OcculertSimulatorTrace',
  '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', 'id=' + options['--device'],
  '-derivedDataPath', join(output, 'DerivedData'), '-jobs', '2', 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=NO', 'RCT_NO_LAUNCH_PACKAGER=1', 'build']);
const app = join(output, 'DerivedData/Build/Products/Release-iphonesimulator/OcculertSimulatorTrace.app');
if (!existsSync(app)) throw Error('The arm64 simulator app was not produced.');
const executable = join(app, 'OcculertSimulatorTrace');
const architecture = execFileSync('xcrun', ['lipo', '-archs', executable], { encoding: 'utf8' }).trim();
const platform = execFileSync('xcrun', ['vtool', '-show-build', executable], { encoding: 'utf8' });
if (architecture !== 'arm64' || !/platform IOSSIMULATOR/.test(platform)) throw Error('Built output is not an arm64 iOS Simulator binary.');
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const receipt = {
  kind: 'local_ios_simulator_trace_build', completedAt: new Date().toISOString(),
  sourceBase: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeChanges: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  nativeLockSha256: digest(join(root, 'package-lock.json')), platform: 'iphonesimulator', architecture,
  sharedInput: SIMULATOR_SHARED_INPUT, sharedInputSha256: authoredInputs[SIMULATOR_SHARED_INPUT],
  bundleIdentifier: 'com.occulert.app.simulatortrace', signingAllowed: false,
  appInfoPlistSha256: digest(join(app, 'Info.plist')), appPath: app,
  authoredInputs, authoredInputsSha256: simulatorInputsSha256(authoredInputs),
  compiledJsSha256: digest(join(app, 'main.jsbundle')), machOSha256: digest(executable),
};
if (receipt.authoredInputsSha256 !== simulatorInputsSha256(authoredSimulatorInputs(root))
    || receipt.authoredInputsSha256 !== simulatorInputsSha256(authoredSimulatorInputs(project))) throw Error('Authored inputs changed during compilation; rebuild before publication.');
writeFileSync(join(output, 'build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('Built local simulator app: ' + app);
