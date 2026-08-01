import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('the iOS module uses the read-only headphone motion API with bounded updates', () => {
  const swift = read('native-app/modules/occulert-headphone-motion/ios/OcculertHeadphoneMotionModule.swift');
  assert.match(swift, /CMHeadphoneMotionManager\(\)/);
  assert.match(swift, /isDeviceMotionAvailable/);
  assert.match(swift, /authorizationStatus\(\)/);
  assert.match(swift, /startDeviceMotionUpdates/);
  assert.match(swift, /stopDeviceMotionUpdates\(\)/);
  assert.match(swift, /minimumEmissionInterval = 0\.08/);
  assert.doesNotMatch(swift, /AsyncStorage|UserDefaults|FileManager|URLSession/);
});

test('the native module is Apple-only and declares the required motion purpose string', () => {
  const config = JSON.parse(read('native-app/modules/occulert-headphone-motion/expo-module.config.json'));
  const app = JSON.parse(read('native-app/app.json'));
  assert.deepEqual(config.platforms, ['apple']);
  assert.deepEqual(config.apple.modules, ['OcculertHeadphoneMotionModule']);
  assert.match(app.expo.ios.infoPlist.NSMotionUsageDescription, /local-only/);
  assert.match(app.expo.ios.infoPlist.NSMotionUsageDescription, /do not change fatigue scores or alerts/);
});

test('headphone candidates remain separate, local aggregates and never enter alert delivery', () => {
  const monitor = read('native-app/app/monitor.tsx');
  const history = read('native-app/app/history.tsx');
  const cloud = read('native-app/lib/cloudSync.ts');
  const alerts = read('native-app/components/AlertSystem.tsx');

  assert.match(monitor, /headphoneHeadNodDetectorRef/);
  assert.match(monitor, /headphoneHeadNodObservations/);
  assert.match(monitor, /headphoneMotionSamples/);
  assert.match(monitor, /headphoneMotionStatus/);
  assert.match(monitor, /headphone motion never changes the fatigue score or alerts/);
  assert.match(history, /EXPERIMENTAL HEAD-MOTION DIAGNOSTICS/);
  assert.match(history, /Saved locally as aggregate observations only and included only if you choose Send session feedback/);
  assert.match(history, /Does not trigger alerts or change scores/);
  assert.doesNotMatch(cloud, /headphoneHeadNodObservations|headphoneMotionSamples|headphoneMotionStatus/);
  assert.doesNotMatch(alerts, /headphoneMotion|headphoneHeadNod/);
});

test('the optional adapter keeps camera monitoring available without a native module', () => {
  const adapter = read('native-app/lib/headphoneMotion.ts');
  assert.match(adapter, /requireOptionalNativeModule/);
  assert.match(adapter, /state: 'not-built'/);
  assert.match(adapter, /if \(!nativeModule\) return NOT_BUILT_STATUS/);
  assert.match(adapter, /Monitoring teardown must continue/);
});
