const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

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

module.exports = config;
