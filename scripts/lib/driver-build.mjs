import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { build, version as esbuildVersion } from 'esbuild';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
export const compilerOptions = Object.freeze({ bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, minifyIdentifiers: false, minifySyntax: false, minifyWhitespace: true, treeShaking: false, charset: 'utf8', metafile: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error('Driver build contract: ' + message); };
const requireContract = (condition, message) => { if (!condition)
    fail(message); };
const parseJs = (code, sourceType) => parse(code, { ecmaVersion: 2022, sourceType, ranges: true });
function children(node) { return Object.values(node).flatMap(value => Array.isArray(value) ? value.filter(item => item?.type) : value?.type ? [value] : []); }
function visit(node, fn, parent = null) { fn(node, parent); for (const child of children(node))
    visit(child, fn, node); }
function canonical(node) {
    if (node === null || typeof node !== 'object')
        return node;
    if (Array.isArray(node))
        return node.map(canonical);
    const omit = node.type ? ['start', 'end', 'loc', 'range', ...(node.type === 'Literal' ? ['raw'] : [])] : [];
    return Object.fromEntries(Object.keys(node).sort().filter(key => !omit.includes(key)).map(key => [key, canonical(node[key])]));
}
function rejectDynamicScope(ast) { visit(ast, node => requireContract(node.type !== 'WithStatement' && !(node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'eval'), 'dynamic eval/with scope is unsupported')); visit(ast, node => { const member = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' ? node.argument : null; requireContract(!(member?.type === 'Identifier' && ['start', 'stop', 'trigger'].includes(member.name)), 'lifecycle/accepted-alert reassignment is unsupported'); if (member?.type === 'MemberExpression' && member.object.type === 'Identifier' && ['window', 'globalThis'].includes(member.object.name)) {
    const name = member.computed && member.property.type === 'Literal' ? member.property.value : !member.computed && member.property.type === 'Identifier' ? member.property.name : null;
    requireContract(!member.computed || member.property.type === 'Literal', 'unknown computed global property writes are unsupported');
    requireContract(!['start', 'stop'].includes(name), 'native/global lifecycle property writes are unsupported');
} }); }
function sourceDeclaration(node) { return node.type === 'ExportNamedDeclaration' ? node.declaration : node; }
function declarations(ast) { return ast.body.flatMap(raw => { const node = sourceDeclaration(raw); if (!node)
    return []; if (node.type === 'VariableDeclaration')
    return node.declarations.map(binding => ({ name: binding.id.name, kind: node.kind, node: binding, declaration: node })); if (['FunctionDeclaration', 'ClassDeclaration'].includes(node.type))
    return [{ name: node.id.name, kind: node.type === 'FunctionDeclaration' ? 'function' : 'class', node, declaration: node }]; return []; }); }
function uniqueTopFunction(ast, name) { const matches = ast.body.map(sourceDeclaration).filter(node => node?.type === 'FunctionDeclaration' && node.id.name === name); requireContract(matches.length === 1, 'expected one top-level function ' + name); return matches[0]; }
function factoryBindings(ast, factory, locals) {
    rejectDynamicScope(ast);
    const manager = analyze(ast, { ecmaVersion: 2022, sourceType: ast.sourceType, optimistic: false, ignoreEval: false });
    const scope = manager.acquire(factory);
    requireContract(scope?.type === 'function', 'factory function scope missing');
    const bindings = [];
    for (const local of locals) {
        const captures = factory.body.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations.filter(decl => decl.id.type === 'Identifier' && decl.id.name === local.capture).map(decl => ({ decl, kind: node.kind })));
        requireContract(captures.length === 1 && captures[0].kind === 'const' && captures[0].decl.init?.type === 'Identifier', 'unique readonly lifecycle capture missing: ' + local.capture);
        const reference = scope.references.find(ref => ref.identifier === captures[0].decl.init), bound = reference?.resolved;
        requireContract(bound && bound.scope === scope && bound.defs.length === 1 && bound.defs[0].type === 'FunctionName', 'capture must resolve to one owned lifecycle function: ' + local.capture);
        const declaration = bound.defs[0].node;
        requireContract(factory.body.body.includes(declaration) && declaration.type === 'FunctionDeclaration', 'lifecycle function must be a direct factory declaration');
        requireContract(new RegExp('^' + local.name + '(?:[0-9]+)?$').test(bound.name), 'unexpected compiler lifecycle name: ' + bound.name);
        for (const inner of manager.scopes) {
            let owner = inner;
            while (owner && owner !== scope)
                owner = owner.upper;
            if (owner !== scope)
                continue;
            for (const variable of inner.variables)
                if (variable !== bound)
                    requireContract(![local.name, bound.name].includes(variable.name), 'shadowed lifecycle destination ' + local.name);
        }
        requireContract(bound.references.every(ref => !ref.isWrite()), 'lifecycle function reassignment is unsupported');
        bindings.push({ desired: local.name, bound, declaration });
    }
    requireContract(new Set(bindings.map(item => item.bound)).size === locals.length, 'lifecycle captures cannot share a function');
    return bindings;
}
export function inspectSourceGraph(sourceRoot, contract) {
    requireContract(!lstatSync(sourceRoot).isSymbolicLink(), 'source directory must not be a symlink');
    requireContract(contract.schema === 1 && Array.isArray(contract.modules) && new Set(contract.modules).size === contract.modules.length, 'invalid module registry');
    requireContract(contract.modules.includes(contract.entry), 'entry must be tracked by registry');
    const globals = new Map(), inputs = {}, asts = new Map(), edges = {};
    for (const module of contract.modules) {
        requireContract(/^[a-z][a-z-]*\.js$/.test(module), 'unsupported module path');
        requireContract(!lstatSync(resolve(sourceRoot, module)).isSymbolicLink(), 'source module must not be a symlink');
        const bytes = readFileSync(resolve(sourceRoot, module)), code = bytes.toString('utf8');
        requireContract(Buffer.from(code, 'utf8').equals(bytes), 'source module must be valid UTF-8: ' + module);
        const ast = parseJs(code, 'module');
        rejectDynamicScope(ast);
        inputs[module] = hash(bytes);
        asts.set(module, ast);
        requireContract(!ast.body.some(node => ['ExportAllDeclaration', 'ExportDefaultDeclaration'].includes(node.type)), 'unsupported export form');
        if (module === contract.entry)
            requireContract(!ast.body.some(node => node.type.startsWith('Export')), 'entry cannot publish ESM exports');
        edges[module] = ast.body.filter(node => node.type === 'ImportDeclaration').map(node => {
            requireContract(typeof node.source.value === 'string' && /^\.\/[^/]+\.js$/.test(node.source.value), 'imports must be explicit local modules');
            const target = node.source.value.slice(2);
            requireContract(contract.modules.includes(target), 'untracked module dependency');
            requireContract(node.specifiers.every(spec => spec.type === 'ImportSpecifier' && spec.imported.type === 'Identifier' && spec.local.name === spec.imported.name), 'import aliases/default/namespace bindings unsupported');
            return target;
        });
        for (const binding of declarations(ast)) {
            requireContract(binding.node.type !== 'VariableDeclarator' || binding.node.id.type === 'Identifier', 'top-level destructuring unsupported');
            requireContract(typeof binding.name === 'string' && !globals.has(binding.name), 'duplicate module-global binding ' + binding.name);
            globals.set(binding.name, { ...binding, module });
        }
    }
    const entryReachable = new Set();
    function reach(module) { if (entryReachable.has(module))
        return; entryReachable.add(module); edges[module].forEach(reach); }
    reach(contract.entry);
    requireContract(entryReachable.size === contract.modules.length, 'registry includes unreachable module inputs');
    for (const name of contract.partialPrefixFunctions)
        requireContract(globals.get(name)?.kind === 'function', 'prefix must name one owned function: ' + name);
    requireContract(new Set(contract.partialPrefixFunctions).size === contract.partialPrefixFunctions.length, 'duplicate prefix function');
    for (const name of Object.values(contract.adjacentDeclarations))
        requireContract(globals.get(name)?.kind === 'function', 'adjacency must name owned functions');
    for (const [name, coordinator] of Object.entries(contract.lifecycle.aliases)) {
        const binding = globals.get(name);
        requireContract(binding?.kind === 'const' && binding.node.init?.type === 'Identifier' && binding.node.init.name === coordinator, 'readonly coordinator alias changed: ' + name);
    }
    const factoryOwner = globals.get(contract.lifecycle.factory);
    requireContract(factoryOwner?.kind === 'function', 'source factory missing');
    const sourceBindings = factoryBindings(asts.get(factoryOwner.module), factoryOwner.node, contract.lifecycle.locals);
    requireContract(sourceBindings.every(binding => binding.bound.name === binding.desired), 'source lifecycle must use original readable names');
    const executionModules = [], evaluated = new Set();
    function evaluate(module) { if (evaluated.has(module))
        return; evaluated.add(module); edges[module].forEach(evaluate); executionModules.push(module); }
    evaluate(contract.entry);
    return { globals, inputs, edges, asts, executionModules };
}
function applyEdits(code, edits) {
    const unique = new Map();
    for (const edit of edits) {
        const key = edit.start + ':' + edit.end;
        requireContract(!unique.has(key) || unique.get(key).text === edit.text, 'conflicting output edits');
        unique.set(key, edit);
    }
    const ordered = [...unique.values()].sort((a, b) => b.start - a.start || b.end - a.end);
    let previous = Infinity;
    for (const edit of ordered) {
        requireContract(edit.end <= previous, 'overlapping output edits');
        code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
        previous = edit.start;
    }
    return code;
}
function alphaEdits(ast, bindings) {
    const parents = new WeakMap();
    visit(ast, (node, parent) => { if (parent)
        parents.set(node, parent); });
    const edits = [];
    for (const { desired, bound } of bindings) {
        for (const reference of bound.references)
            requireContract(reference.resolved === bound && !reference.tainted, 'unresolved/dynamic lifecycle reference');
        const identifiers = [...bound.identifiers, ...bound.references.map(ref => ref.identifier)];
        for (const identifier of identifiers) {
            const parent = parents.get(identifier);
            requireContract(!(parent?.type === 'Property' && parent.shorthand && parent.value === identifier), 'lifecycle shorthand property cannot be alpha-restored');
            if (identifier.name !== desired)
                edits.push({ start: identifier.start, end: identifier.end, text: desired });
        }
    }
    return edits;
}
function quoteString(value) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\u2028\u2029]/g, unit => '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0')).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, unit => '\\u' + unit.charCodeAt(0).toString(16));
    return "'" + escaped + "'";
}
// Compare actual source bodies modulo resolved local value-binding alpha only.
// Function names and static property keys retain their observable spelling.
function sourceFunctionFingerprint(fn) {
    const program = { type: 'Program', body: [fn], sourceType: 'script', start: 0, end: fn.end, range: [0, fn.end] };
    const manager = analyze(program, { ecmaVersion: 2022, sourceType: 'script', optimistic: false, ignoreEval: false }), renames = new WeakMap();
    for (const [scopeIndex, scope] of manager.scopes.entries()) {
        if (scope === manager.globalScope)
            continue;
        for (const [index, variable] of scope.variables.entries()) {
            // Anonymous function/class name inference observes binding spelling in
            // declarations, parameter defaults and later assignments alike. Keep any
            // such binding's real name in the source identity comparison.
            const inferenceSensitive = new Set();
            const inferred = value => value && ['FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression'].includes(value.type) && !value.id;
            const identifiers = new Set([...variable.identifiers, ...variable.references.map(ref => ref.identifier)]);
            visit(fn, node => {
                if (node.type === 'VariableDeclarator' && identifiers.has(node.id) && inferred(node.init))
                    inferenceSensitive.add(variable);
                if (node.type === 'AssignmentPattern' && identifiers.has(node.left) && inferred(node.right))
                    inferenceSensitive.add(variable);
                if (node.type === 'AssignmentExpression' && identifiers.has(node.left) && inferred(node.right))
                    inferenceSensitive.add(variable);
            });
            const safe = !inferenceSensitive.has(variable) && variable.defs.length && variable.defs.every(def => ['Parameter', 'CatchClause', 'Variable'].includes(def.type));
            if (!safe)
                continue;
            const name = `local:${scopeIndex}:${index}`;
            for (const identifier of [...variable.identifiers, ...variable.references.map(ref => ref.identifier)])
                renames.set(identifier, name);
        }
    }
    const normalize = (node, staticKey = false) => {
        if (node === null || typeof node !== 'object')
            return node;
        if (Array.isArray(node))
            return node.map(child => normalize(child));
        if (node.type === 'Identifier' && !staticKey && renames.has(node))
            return { ...canonical(node), name: renames.get(node) };
        const omit = node.type ? ['start', 'end', 'loc', 'range', ...(node.type === 'Literal' ? ['raw'] : [])] : [];
        return Object.fromEntries(Object.keys(node).sort().filter(key => !omit.includes(key)).map(key => [key, normalize(node[key], key === 'key' && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(node.type) && !node.computed)]));
    };
    return normalize(fn);
}
function executionStatements(nodes) {
    return nodes.flatMap(raw => {
        const node = sourceDeclaration(raw);
        if (!node || node.type === 'ImportDeclaration' || node.type === 'FunctionDeclaration' || node.type === 'ExportNamedDeclaration')
            return [];
        if (node.type === 'VariableDeclaration')
            return node.declarations.map(binding => ({ type: 'VariableDeclaration', kind: node.kind, declarations: [canonical(binding)] }));
        return [canonical(node)];
    });
}
function assertSourceIdentity(graph, ast) {
    const sourceEffects = graph.executionModules.flatMap(module => executionStatements(graph.asts.get(module).body));
    assert.deepEqual(executionStatements(ast.body), sourceEffects, 'Source initializer/effect evaluation order changed');
    for (const binding of declarations(ast)) {
        const source = graph.globals.get(binding.name);
        if (binding.kind === 'function')
            assert.deepEqual(sourceFunctionFingerprint(binding.node), sourceFunctionFingerprint(source.node), `Source function identity changed: ${binding.name}`);
        else if (binding.node.type === 'VariableDeclarator')
            assert.deepEqual(canonical(binding.node.init), canonical(source.node.init), `Source initializer identity changed: ${binding.name}`);
        else
            assert.deepEqual(canonical(binding.node), canonical(source.node), `Source declaration identity changed: ${binding.name}`);
    }
}
function assertExecutableMarkers(ast, code, contract, bindings) {
    requireContract(Array.isArray(contract.markerRules) && contract.markerRules.length === 9 && new Set(contract.markerRules.map(rule => rule.role)).size === 9, 'complete executable marker registry required');
    const requiredOwners = [['alert-state', 'variable', '_ac'], ['local-start', 'local-function', 'start'], ['local-stop', 'local-function', 'stop'], ['local-capture', 'capture', 'startLocalSession'], ['demo-function', 'function', 'demoAlert'], ['results-boundary', 'function', 'onResults'], ['feedback-registration', 'variable', 'feedbackForm'], ['partial-startup', 'variable', 'recalBtn'], ['core-capability', 'variable', 'startupCore']];
    assert.deepEqual(contract.markerRules.map(({ role, kind, name }) => [role, kind, name]), requiredOwners, 'Executable marker ownership registry changed');
    for (const rule of contract.markerRules) {
        let node;
        if (rule.kind === 'function')
            node = uniqueTopFunction(ast, rule.name);
        else if (rule.kind === 'local-function')
            node = bindings.find(binding => binding.desired === rule.name)?.declaration;
        else if (rule.kind === 'capture') {
            const factory = uniqueTopFunction(ast, contract.lifecycle.factory);
            node = factory.body.body.find(item => item.type === 'VariableDeclaration' && item.declarations.some(decl => decl.id.name === rule.name));
        }
        else if (rule.kind === 'variable') {
            const matches = declarations(ast).filter(binding => binding.name === rule.name);
            requireContract(matches.length === 1, 'unique marker variable missing: ' + rule.name);
            node = matches[0].declaration;
        }
        else
            fail('unsupported marker rule');
        requireContract(node && code.startsWith(rule.literal, node.start - (rule.leadingNewline ? 1 : 0)), 'missing executable excerpt marker ' + rule.role);
    }
    const feedback = declarations(ast).find(binding => binding.name === contract.newlineBeforeBindingFollower.binding), index = ast.body.indexOf(feedback?.declaration), follower = ast.body[index + 1];
    requireContract(feedback?.node.init?.type === 'CallExpression' && feedback.node.init.callee?.object?.name === 'document' && feedback.node.init.callee?.property?.name === 'getElementById' && feedback.node.init.arguments[0]?.value === 'feedbackForm' && follower?.type === 'IfStatement' && follower.test?.name === 'feedbackForm' && follower.consequent?.expression?.callee?.object?.name === 'feedbackForm' && follower.consequent.expression.arguments[0]?.value === 'submit', 'feedback marker must own the actual form registration');
    const audio = declarations(ast).find(binding => binding.name === '_ac');
    requireContract(audio?.node.init?.type === 'Literal' && audio.node.init.value === null, 'audio state marker must own the nullable context');
}
function normalizedProgram(ast) { return { initializers: ast.body.filter(node => node.type !== 'FunctionDeclaration').map(canonical), functions: ast.body.filter(node => node.type === 'FunctionDeclaration').map(canonical).sort((a, b) => a.id.name.localeCompare(b.id.name)) }; }
export function formatDriverBundle(stock, graph, contract) {
    const before = parseJs(stock, 'script');
    rejectDynamicScope(before);
    const owned = declarations(before);
    requireContract(new Set(owned.map(item => item.name)).size === owned.length, 'duplicate output top-level binding');
    requireContract(owned.length === graph.globals.size && owned.every(item => graph.globals.has(item.name)), 'unsupported compiler global name/collision');
    const factory = uniqueTopFunction(before, contract.lifecycle.factory), bindings = factoryBindings(before, factory, contract.lifecycle.locals), edits = alphaEdits(before, bindings);
    visit(before, node => {
        if (node.type === 'Literal' && typeof node.value === 'string')
            edits.push({ start: node.start, end: node.end, text: quoteString(node.value) });
        if (node.type === 'Literal' && typeof node.value === 'number' && Number.isFinite(node.value))
            edits.push({ start: node.start, end: node.end, text: String(node.value) });
        if (node.type === 'FunctionDeclaration')
            edits.push({ start: node.start, end: node.start, text: '\n' });
    });
    for (const node of before.body)
        if (node.type === 'VariableDeclaration') {
            requireContract(node.kind === 'var', 'unexpected compiler declaration kind');
            const kinds = new Set(node.declarations.map(decl => graph.globals.get(decl.id.name)?.kind));
            requireContract(kinds.size === 1 && ['const', 'let', 'var'].includes([...kinds][0]), 'ambiguous output variable group');
            edits.push({ start: node.start, end: node.start + 3, text: [...kinds][0] });
        }
    // Build the proof baseline using the same resolved binding objects, not a
    // same-spelling walk over every Identifier or object property key.
    const expectedCode = applyEdits(stock, [...alphaEdits(before, bindings), ...before.body.filter(node => node.type === 'VariableDeclaration').map(node => ({ start: node.start, end: node.start + 3, text: graph.globals.get(node.declarations[0].id.name).kind }))]);
    const expected = parseJs(expectedCode, 'script');
    let code = applyEdits(stock, edits), ast = parseJs(code, 'script');
    const anchor = uniqueTopFunction(ast, contract.adjacentDeclarations.after), moving = uniqueTopFunction(ast, contract.adjacentDeclarations.move);
    requireContract(moving.start > anchor.end, 'unexpected adjacency declaration order');
    const text = code.slice(moving.start, moving.end);
    code = code.slice(0, moving.start) + code.slice(moving.end);
    code = code.slice(0, anchor.end) + '\n' + text + code.slice(anchor.end);
    ast = parseJs(code, 'script');
    const marker = contract.newlineBeforeBindingFollower, indices = ast.body.flatMap((node, index) => node.type === 'VariableDeclaration' && node.declarations.some(decl => decl.id.name === marker.binding) ? [index] : []);
    requireContract(indices.length === 1 && ast.body[indices[0] + 1]?.type === marker.follower, 'binding/follower boundary changed');
    const follower = ast.body[indices[0] + 1];
    code = code.slice(0, follower.start) + '\n' + code.slice(follower.start);
    ast = parseJs(code, 'script');
    const prefix = ast.body.filter(node => node.type === 'FunctionDeclaration' && contract.partialPrefixFunctions.includes(node.id.name));
    requireContract(prefix.length === contract.partialPrefixFunctions.length, 'prefix declarations missing or duplicated');
    const head = prefix.map(node => code.slice(node.start, node.end)).join('\n') + '\n';
    for (const node of [...prefix].sort((a, b) => b.start - a.start))
        code = code.slice(0, node.start) + code.slice(node.end);
    code = head + code;
    const final = parseJs(code, 'script');
    const finalBindings = factoryBindings(final, uniqueTopFunction(final, contract.lifecycle.factory), contract.lifecycle.locals);
    requireContract(finalBindings.every((binding, index) => binding.bound.name === binding.desired && binding.bound.references.length === bindings[index].bound.references.length), 'alpha restoration must preserve resolved captures and references');
    assertSourceIdentity(graph, final);
    assertExecutableMarkers(final, code, contract, finalBindings);
    assert.deepEqual(canonical(parseJs(Buffer.from(code, 'utf8').toString('utf8'), 'script')), canonical(final), 'Serialized UTF-8 changed program semantics');
    assert.deepEqual(normalizedProgram(expected), normalizedProgram(final), 'Formatter changed an initializer or function body');
    for (const literal of contract.requiredLiterals)
        requireContract(code.includes(literal), 'missing runnable excerpt marker ' + JSON.stringify(literal));
    const cutoff = declarations(final).filter(binding => binding.name === contract.partialCutoffBinding);
    requireContract(cutoff.length === 1 && prefix.every(node => code.indexOf('function ' + node.id.name + '(') < cutoff[0].declaration.start), 'partial-source prerequisites missing');
    return { code, proof: { compiledSha256: hash(code), compiledBytes: Buffer.byteLength(code), initializerOrderExact: true, functionBodiesExact: true, sourceFunctionIdentityExact: true, sourceInitializersExact: true, sourceEffectOrderExact: true, serializedUtf8Exact: true, executableMarkersOwned: true, resolvedLifecycleAlpha: bindings.map(binding => ({ from: binding.bound.name, to: binding.desired, references: binding.bound.references.length })), partialPrefixFunctions: prefix.map(node => node.id.name), literalMarkers: contract.requiredLiterals.length } };
}
export async function buildDriverArtifact({ sourceRoot, contractPath }) {
    const contractBytes = readFileSync(contractPath), contractText = contractBytes.toString('utf8');
    requireContract(Buffer.from(contractText, 'utf8').equals(contractBytes), 'contract must be valid UTF-8');
    const contract = JSON.parse(contractText), graph = inspectSourceGraph(sourceRoot, contract);
    const result = await build({ ...compilerOptions, absWorkingDir: sourceRoot, entryPoints: [contract.entry] });
    const compiledInputs = Object.keys(result.metafile.inputs).map(path => relative(sourceRoot, resolve(sourceRoot, path)).replaceAll('\\', '/')).sort();
    assert.deepEqual(compiledInputs, [...contract.modules].sort(), 'Compiler read an untracked source input');
    const stock = result.outputFiles[0].text, formatted = formatDriverBundle(stock, graph, contract);
    return { ...formatted, stock, provenance: { esbuildVersion, compilerOptions, sourceInputs: graph.inputs, dependencyEvaluationEdges: graph.edges, moduleEvaluationOrder: graph.executionModules, contractSha256: hash(contractBytes), stockSha256: hash(stock), adapterSha256: hash(readFileSync(new URL(import.meta.url))), packageLockSha256: hash(readFileSync(resolve(dirname(contractPath), 'package-lock.json'))) } };
}
