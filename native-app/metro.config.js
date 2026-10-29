const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const { simulatorTraceProfile } = require('./scripts/lib/simulator-trace-profile.cjs');
const config = getDefaultConfig(__dirname);

if (simulatorTraceProfile()) {
  const original = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'react-native-vision-camera-face-detector') {
      if (platform !== 'ios') throw new Error('Scripted detector cannot enter an Android or web bundle.');
      return { type: 'sourceFile', filePath: path.join(__dirname, 'simulator/face-detector-stub.ts') };
    }
    return original ? original(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
}
module.exports = config;
