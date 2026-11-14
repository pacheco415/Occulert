import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageSimulatorSharedInput } from './simulator-build-inputs.mjs';

export const app = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const require = createRequire(join(app, 'package.json'));
export const { XcodeProject, PBXNativeTarget } = require('@bacons/xcode');
export const parsePlist = require('@expo/plist').default.parse;
export const manifestName = 'PrivacyInfo.xcprivacy';

export function createWatchPrivacyFixture({ legacy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'occulert-watch-packaging-'));
  const directory = join(root, 'native-app');
  cpSync(app, directory, { recursive: true, filter: path =>
    !['node_modules', 'ios', 'android', '.expo', 'build', '.verification-receipts'].includes(relative(app, path).split(sep)[0]) });
  symlinkSync(join(app, 'node_modules'), join(directory, 'node_modules'), 'dir');
  stageSimulatorSharedInput(app, directory);
  const configPath = join(directory, 'app.json');
  const currentConfig = readFileSync(configPath);
  if (legacy) {
    const config = JSON.parse(currentConfig);
    config.expo.plugins = config.expo.plugins.filter(plugin => plugin !== './plugins/with-watch-privacy');
    delete config.expo.ios.privacyManifests;
    writeFileSync(configPath, JSON.stringify(config));
  }
  const env = { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', NODE_ENV: 'production' };
  for (const key of ['EXPO_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM',
    'OCCULERT_SIMULATOR_TRACE', 'OCCULERT_SIMULATOR_PROFILE', 'OCCULERT_SIMULATOR_PLATFORM']) delete env[key];
  const projectPath = join(directory, 'ios/Occulert.xcodeproj/project.pbxproj');
  const watchManifest = join(directory, 'targets/occulert-watch', manifestName);
  const originalWatch = readFileSync(watchManifest);
  function run(command, args, options = {}) {
    return execFileSync(command, args, { cwd: directory, env, encoding: 'utf8', timeout: 90000,
      maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  }
  return { root, directory, projectPath, watchManifest, originalWatch, env, run,
    prebuild: () => run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install']),
    introspect: () => JSON.parse(run(process.execPath, [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'])),
    useFix: () => writeFileSync(configPath, currentConfig),
    project: () => XcodeProject.open(projectPath),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function privacyMembership(fixture) {
  const project = fixture.project();
  const targets = project.rootObject.props.targets.filter(target => PBXNativeTarget.is(target));
  const watch = targets.find(target => target.isWatchOSTarget());
  const phone = targets.find(target => target.props.productType === 'com.apple.product-type.application' && !target.isWatchOSTarget());
  const explicit = target => target.getResourcesBuildPhase().props.files
    .filter(file => file.props.fileRef?.props.path?.endsWith(manifestName))
    .map(file => ({ buildFile: file.uuid, fileRef: file.props.fileRef.uuid, path: resolve(file.props.fileRef.getRealPath()) }));
  const group = watch.props.fileSystemSynchronizedGroups[0];
  const membership = group.props.exceptions.find(exception => exception.props.target === watch).props.membershipExceptions;
  return { phone: explicit(phone), watch: explicit(watch), membership,
    implicitWatchManifest: existsSync(fixture.watchManifest) && !membership.includes(manifestName) };
}

// Isolate the actual local mod from Expo's other resource-generation steps, so
// the repair test can prove it preserves the phone's existing reference UUIDs.
export async function repairWatchPrivacy(fixture) {
  const withWatchPrivacy = require(join(app, 'plugins/with-watch-privacy.js'));
  const config = withWatchPrivacy({});
  const result = await config.mods.ios.xcodeProjectBeta2({
    ...config, modResults: fixture.project(),
    modRequest: { projectRoot: fixture.directory, platformProjectRoot: join(fixture.directory, 'ios'),
      platform: 'ios', modName: 'xcodeProjectBeta2' },
  });
  writeFileSync(fixture.projectPath, require('@bacons/xcode/json').build(result.modResults.toJSON()));
}

export function runReactNativePrivacyAggregation(fixture) {
  const helper = join(app, 'scripts/fixtures/aggregate-watch-privacy.rb');
  const aggregator = require.resolve('react-native/scripts/cocoapods/privacy_manifest_utils.rb');
  return JSON.parse(fixture.run('ruby', [helper, dirname(fixture.projectPath), aggregator]));
}
