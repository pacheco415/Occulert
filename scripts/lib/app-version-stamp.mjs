import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
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

// The trace adapter must validate the actual owned consumers, not infer their
// behavior from a matching string in a comment or from an independent version.
export function validateParkedAppVersionSources(core, helper, manifest) {
  assertDriverAppVersion(core, manifest, { required: true });
  function nodes(root, predicate) {
    const matches = [];
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (predicate(node)) matches.push(node);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value?.type) visit(value);
      }
    };
    visit(root); return matches;
  }
  function consumer(source, ownerName, flagsName, owned) {
    const ast = parse(source, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
    const owners = nodes(ast, node => node.type === 'FunctionDeclaration' && node.id?.name === ownerName);
    if (owners.length !== 1) throw new Error('Owned parked app version consumer is missing or ambiguous');
    const properties = nodes(owners[0], node => node.type === 'Property' && (
      !node.computed && node.key?.type === 'Identifier' && node.key.name === 'detectorVersion'
      || node.key?.type === 'Literal' && node.key.value === 'detectorVersion'));
    if (properties.length !== 1) throw new Error('Owned parked app version consumer is missing or ambiguous');
    const value = properties[0].value;
    if (!owned && (value.type !== 'ArrowFunctionExpression' || value.async || value.params.length)) throw new Error('Invalid parked helper app version consumer');
    const expression = owned ? value : value.body;
    const member = (node, object, property) => node?.type === 'MemberExpression' && !node.computed && node.object?.name === object && node.property?.name === property;
    const prefix = expression?.left, suffix = expression?.right, stamp = prefix?.left;
    if (expression?.type !== 'BinaryExpression' || expression.operator !== '+'
      || prefix?.type !== 'BinaryExpression' || prefix.operator !== '+'
      || stamp?.type !== 'Identifier' || stamp.name !== APP_VERSION_BINDING
      || prefix.right?.type !== 'Literal' || prefix.right.value !== ':parked:'
      || suffix?.type !== 'CallExpression' || suffix.arguments.length !== 1 || suffix.arguments[0]?.value !== '+'
      || suffix.callee?.type !== 'MemberExpression' || suffix.callee.computed || suffix.callee.property?.name !== 'join'
      || !member(suffix.callee.object, flagsName, 'names')) throw new Error('Owned parked app version consumer does not use the driver stamp');
    const scopes = analyze(ast, { ecmaVersion: 2022, sourceType: 'script', optimistic: false, ignoreEval: false });
    const bindings = scopes.scopes.flatMap(scope => scope.variables).filter(variable => variable.name === APP_VERSION_BINDING);
    const references = scopes.scopes.flatMap(scope => scope.references).filter(reference => reference.identifier === stamp);
    if (references.length !== 1 || (owned
      ? bindings.length !== 1 || bindings[0].scope !== scopes.globalScope || references[0].resolved !== bindings[0]
      : bindings.length !== 0 || references[0].resolved !== null)) throw new Error('Parked app version consumer shadows the single driver stamp');
  }
  consumer(core, 'fleetPayload', 'experimentFlags', true);
  consumer(helper, 'createMountedController', 'flags', false);
  return driverAppVersion(manifest) + ':parked:';
}
