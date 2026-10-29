import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  return Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
}

export function simulatorInputsSha256(inputs) {
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}
