import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE, validateSourceConfig, validateArchiveReview } from './testflight-policy.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const requiredPermissions = ['NSCameraUsageDescription', 'NSMotionUsageDescription',
  'NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription'];
const permittedPermissions = [...requiredPermissions, 'NSFaceIDUsageDescription', 'NSLocalNetworkUsageDescription'];

// Derive extension identity and source entitlements from Expo's real, locked
// config plugins. The target's bundle suffix is not guessed by the inspector.
export function archiveContract({ app, eas, introspected, source, build, artifact }) {
  validateSourceConfig(app, eas);
  const ios = introspected?._internal?.modResults?.ios;
  assert.ok(ios?.infoPlist && ios?.entitlements, 'Source iOS introspection is missing.');
  const extensions = introspected.extra?.eas?.build?.experimental?.ios?.appExtensions;
  assert.ok(Array.isArray(extensions) && extensions.length === 1, 'Exactly one source Watch target is required.');
  const watch = extensions[0];
  assert.equal(watch.targetName, 'OcculertWatch', 'Unexpected companion target.');
  assert.match(watch.bundleIdentifier ?? '', /^com\.occulert\.app\.[A-Za-z0-9-]+$/, 'Unexpected companion bundle.');
  assert.deepEqual(watch.entitlements, { 'com.apple.developer.usernotifications.time-sensitive': true }, 'Source Watch capabilities changed.');
  assert.deepEqual(ios.entitlements, { 'com.apple.developer.healthkit': true }, 'Source phone capabilities changed.');
  const health = app.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@kingstinct/react-native-healthkit')?.[1];
  assert.ok(health && health.background === false, 'Health background access is not ordinary production.');
  const permissions = {};
  for (const [key, value] of Object.entries(ios.infoPlist)) {
    if (!key.startsWith('NS') || !key.includes('UsageDescription')) continue;
    assert.ok(permittedPermissions.includes(key), 'Source introduced an unreviewed purpose string.');
    assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 2048, 'Source purpose string is malformed.');
    permissions[key] = value.replaceAll('$(PRODUCT_NAME)', app.name);
    assert.ok(!permissions[key].includes('$('), 'Source purpose string contains an unresolved build value.');
  }
  for (const key of requiredPermissions) {
    assert.equal(permissions[key], key.startsWith('NSHealth') ? health[key] : app.ios.infoPlist[key], 'Required source purpose string differs.');
  }
  assert.deepEqual(ios.infoPlist.UIBackgroundModes, ['audio'], 'Source background modes changed.');
  assert.equal(build.sourceSha, source.sourceSha, 'Inspection source differs from the built source.');
  return { schema: 1, sourceSha: source.sourceSha, nativeTree: source.nativeTree,
    buildIdSha256: build.idSha256, artifactSha256: artifact.sha256,
    appVersion: build.appVersion, appBuildVersion: build.appBuildVersion,
    appleTeamId: RELEASE.appleTeamId, productionEnvironmentVerified: source.preflight.productionEnvironmentVerified,
    phone: { bundleIdentifier: app.ios.bundleIdentifier, permissions, requiredPermissions, entitlements: ios.entitlements },
    watch: { bundleIdentifier: watch.bundleIdentifier, permissions: {}, requiredPermissions: [], entitlements: watch.entitlements } };
}

export async function inspectArchive({ sourceRoot, temporaryRoot, source, build, artifact, ipaPath, execute, env }) {
  const appRoot = resolve(sourceRoot, 'native-app');
  const require = createRequire(resolve(appRoot, 'package.json'));
  // This child receives no Expo or GitHub credential. Introspection executes
  // source config mods only; it does not sign, build, or contact an EAS counter.
  const introspected = JSON.parse(await execute(process.execPath,
    [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'], {
      cwd: appRoot, env: { ...env, NODE_ENV: 'production', EXPO_NO_TELEMETRY: '1', CI: '1' }, timeout: 120000,
    }));
  const app = JSON.parse(readFileSync(resolve(appRoot, 'app.json'), 'utf8')).expo;
  const eas = JSON.parse(readFileSync(resolve(appRoot, 'eas.json'), 'utf8'));
  const contract = archiveContract({ app, eas, introspected, source, build, artifact });
  const contractPath = resolve(temporaryRoot, 'private-archive-contract.json');
  const reportPath = resolve(temporaryRoot, 'private-archive-review.json');
  writeFileSync(contractPath, JSON.stringify(contract), { mode: 0o600, flag: 'wx' });
  await execute('python3', [resolve(root, 'scripts/lib/inspect-testflight-ipa.py'), ipaPath, contractPath, reportPath],
    { cwd: temporaryRoot, env, timeout: 10 * 60 * 1000 });
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  return validateArchiveReview(report, { source, build, artifact });
}
