import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nativeRoot = fileURLToPath(new URL('../', import.meta.url));
const hasAndroidSdk = Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT);

test('assemble both Wear spike APKs and run the wire contract tests', {
  skip: hasAndroidSdk ? false : 'Android SDK unavailable',
}, () => {
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  const result = spawnSync(
    `./node_modules/@react-native/gradle-plugin/${gradle}`,
    ['--project-dir', 'wear-os-spike', '--console=plain', 'assembleDebug', 'testWearDebugUnitTest'],
    { cwd: nativeRoot, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Wear OS debug build and JVM contract tests');
});
