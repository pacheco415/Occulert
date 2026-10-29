const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { simulatorTraceProfile } = require('./scripts/lib/simulator-trace-profile.cjs');

const config = getDefaultConfig(__dirname);
const sharedRoot = path.resolve(__dirname, '../lib');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sharedPattern = sharedRoot.split(path.sep).map(escape).join('[/\\\\]');

// The engine stays canonical. Do not expose the repository or other lib files.
config.watchFolders = [...new Set([...config.watchFolders, sharedRoot])];
const existingBlocks = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList : [config.resolver.blockList].filter(Boolean);
config.resolver.blockList = [
  ...existingBlocks,
  new RegExp(`^${sharedPattern}[/\\\\](?!event-outbox\\.ts$).*`),
];

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
