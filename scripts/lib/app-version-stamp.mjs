import { parse } from 'acorn';
import { parseRuntimeAssetPath } from './asset-paths.mjs';

// A release owns this one driver binding. Consumers read the loaded driver's
// value, so retained pages never claim the version of a newer network manifest.
export const APP_VERSION_BINDING = 'WEB_APP_VERSION';

export function driverAppVersion(manifest) {
  const { logicalName, version } = parseRuntimeAssetPath(manifest['driver-app.js']);
  if (logicalName !== 'driver-app.js' || !/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(Number(version))) throw new Error('Invalid driver version for app stamp');
  return 'web-v' + version;
}

function appVersionDeclaration(source, { sourceType = 'script', required = false } = {}) {
  const ast = parse(source, { ecmaVersion: 2022, sourceType });
  const declarations = ast.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .filter(node => node?.type === 'VariableDeclaration')
    .flatMap(node => node.declarations.filter(binding => binding.id.type === 'Identifier' && binding.id.name === APP_VERSION_BINDING)
      .map(binding => ({ kind: node.kind, ...binding })));
  if (!declarations.length && !required) return null;
  if (declarations.length !== 1 || declarations[0].kind !== 'const' || declarations[0].init?.type !== 'Literal'
    || typeof declarations[0].init.value !== 'string' || !/^web-v[1-9][0-9]*$/.test(declarations[0].init.value)) throw new Error('Expected one constant driver app version stamp');
  return declarations[0];
}

export function assertDriverAppVersion(source, manifest, options) {
  const declaration = appVersionDeclaration(source, options);
  if (declaration && declaration.init.value !== driverAppVersion(manifest)) throw new Error('Driver app version stamp does not match the released driver asset');
}

export function synchronizeDriverAppVersion(source, manifest, options) {
  const declaration = appVersionDeclaration(source, options);
  if (!declaration) return source;
  const version = driverAppVersion(manifest);
  if (declaration.init.value === version) return source;
  const quote = source[declaration.init.start];
  return source.slice(0, declaration.init.start) + quote + version + quote + source.slice(declaration.init.end);
}
