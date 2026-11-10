import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const SIMULATOR_SHARED_INPUT = '../lib/event-outbox.ts';

function ownedDirectory(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Simulator input parent must be an owned directory: ' + path);
}

/** The native graph may use exactly this canonical sibling, never the repository. */
export function simulatorSharedInput(root) {
  root = resolve(root);
  ownedDirectory(root); ownedDirectory(dirname(root)); ownedDirectory(resolve(root, '../lib'));
  const path = resolve(root, SIMULATOR_SHARED_INPUT), stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw Error('Shared simulator input must be a regular file, never a link.');
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try { bytes = readFileSync(descriptor); } finally { closeSync(descriptor); }
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function stageSimulatorSharedInput(sourceRoot, projectRoot) {
  const input = simulatorSharedInput(sourceRoot);
  ownedDirectory(resolve(projectRoot)); ownedDirectory(dirname(resolve(projectRoot)));
  const library = resolve(projectRoot, '../lib');
  mkdirSync(library, { recursive: true }); ownedDirectory(library);
  writeFileSync(resolve(projectRoot, SIMULATOR_SHARED_INPUT), input.bytes, { flag: 'wx' });
  return input.sha256;
}

const directories = ['app', 'assets', 'components', 'constants', 'hooks', 'lib', 'modules', 'targets', 'simulator', 'plugins'];
const files = ['app.json', 'app.config.js', 'eas.json', 'metro.config.js', 'babel.config.js', 'react-native.config.js',
  'package.json', 'package-lock.json', 'tsconfig.json', 'expo-env.d.ts', 'scripts/build-simulator-trace.mjs',
  'scripts/lib/simulator-trace-profile.cjs', 'scripts/lib/simulator-build-inputs.mjs'];

/** Hash the actual source/config/assets used by prebuild, Metro and native compilation. */
export function authoredSimulatorInputs(root) {
  const inputs = {};
  const visit = name => {
    const path = join(root, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error('Authored simulator inputs must not be links: ' + name);
    if (stat.isDirectory()) { for (const child of readdirSync(path).sort()) if (child !== '.DS_Store' && !child.startsWith('._')) visit(name + '/' + child); }
    else if (stat.isFile()) inputs[name] = createHash('sha256').update(readFileSync(path)).digest('hex');
    else throw Error('Authored simulator input must be regular: ' + name);
  };
  for (const name of [...directories, ...files]) if (existsSync(join(root, name))) visit(name);
  for (const name of readdirSync(join(root, 'scripts')).sort()) if (/^patch-.*\.mjs$/.test(name)) visit('scripts/' + name);
  inputs[SIMULATOR_SHARED_INPUT] = simulatorSharedInput(root).sha256;
  return Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
}

export function simulatorInputsSha256(inputs) {
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}
