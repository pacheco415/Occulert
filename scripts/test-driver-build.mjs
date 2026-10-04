import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import test from 'node:test';
import { buildDriverArtifact, formatDriverBundle, inspectSourceGraph } from './lib/driver-build.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = join(root, 'src'), contractPath = join(root, 'source-driver-contract.json'), contract = JSON.parse(readFileSync(contractPath));
const base = await buildDriverArtifact({ sourceRoot, contractPath });
const graph = inspectSourceGraph(sourceRoot, contract);
const ast = code => parse(code, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
const top = (code, name) => ast(code).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
const replace = (code, node, text) => code.slice(0, node.start) + text + code.slice(node.end);
function clone() { const cwd = mkdtempSync(join(tmpdir(), 'occulert-adapter-')); cpSync(sourceRoot, join(cwd, 'src'), { recursive: true }); cpSync(contractPath, join(cwd, 'driver-contract.json')); cpSync(join(root, 'package-lock.json'), join(cwd, 'package-lock.json')); return cwd; }
function change(cwd, file, old, next) { const path = join(cwd, 'src', file), code = readFileSync(path, 'utf8'); assert.ok(code.includes(old), `fixture precondition: ${file}`); writeFileSync(path, code.replace(old, next)); }
async function changed(body) { const cwd = clone(); try {
    return await body(cwd, () => buildDriverArtifact({ sourceRoot: join(cwd, 'src'), contractPath: join(cwd, 'driver-contract.json') }));
}
finally {
    rmSync(cwd, { recursive: true, force: true });
} }
test('real modules compile deterministically with source bodies, ordered initializers and owned markers', async () => {
    const second = await buildDriverArtifact({ sourceRoot, contractPath });
    assert.equal(base.code, second.code);
    assert.ok(base.proof.compiledBytes > 0);
    assert.equal(base.proof.compiledSha256, second.proof.compiledSha256);
    for (const key of ['initializerOrderExact', 'functionBodiesExact', 'sourceFunctionIdentityExact', 'sourceInitializersExact', 'sourceEffectOrderExact', 'serializedUtf8Exact', 'executableMarkersOwned'])
        assert.equal(base.proof[key], true);
    assert.equal(base.proof.partialPrefixFunctions.length, 43);
    assert.equal(Object.keys(base.provenance.sourceInputs).length, 9);
});
test('counterfeit compiled riskText cannot be certified against the unchanged real source', () => {
    const node = top(base.stock, 'riskText'), spoof = replace(base.stock, node, "function riskText(){return ['SPOOFED','safe']}");
    assert.throws(() => formatDriverBundle(spoof, graph, contract), /Source function identity changed: riskText/);
});
test('a changed compiled state initializer cannot pass source identity', () => {
    const node = ast(base.stock).body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === 'fatigue');
    const spoof = replace(base.stock, node.init, '999');
    assert.throws(() => formatDriverBundle(spoof, graph, contract), /Source initializer\/effect evaluation order changed/);
});
test('unknown/duplicate compiler globals and mixed source declaration kinds fail closed', () => {
    assert.throws(() => formatDriverBundle(base.stock + 'var unsupportedCompilerHelper=1;', graph, contract), /global name\/collision/);
    assert.throws(() => formatDriverBundle(base.stock + 'var fatigue=9;', graph, contract), /duplicate output top-level binding/);
    const declarations = ast(base.stock).body.filter(n => n.type === 'VariableDeclaration'), constant = declarations.find(n => n.declarations.every(d => graph.globals.get(d.id.name).kind === 'const')), mutable = declarations.find(n => n.declarations.every(d => graph.globals.get(d.id.name).kind === 'let'));
    const merged = 'var ' + [constant, mutable].map(n => base.stock.slice(n.start + 3, n.end).trim().replace(/;$/, '')).join(',') + ';';
    let code = base.stock;
    for (const n of [constant, mutable].sort((a, b) => b.start - a.start))
        code = replace(code, n, '');
    assert.throws(() => formatDriverBundle(merged + code, graph, contract), /ambiguous output variable group/);
});
for (const [name, file, old, next, expected] of [
    ['mutable coordinator alias', 'ui.js', 'export const start = startMonitoring;', 'export let start = startMonitoring;', /readonly coordinator alias/],
    ['mutable lifecycle capture', 'ui.js', 'const startLocalSession = start;', 'let startLocalSession = start;', /readonly lifecycle capture/],
    ['capture to global operation', 'ui.js', 'const startLocalSession = start;', 'const startLocalSession = startMonitoring;', /owned lifecycle function/],
    ['nested destination shadow', 'ui.js', 'const startLocalSession = start;', 'function descendant(start){return start}\nconst startLocalSession = start;', /shadowed lifecycle destination/],
    ['native Window.stop write', 'driver-app.js', 'initializeLocalLifecycle();', 'window.stop=()=>{};initializeLocalLifecycle();', /native\/global lifecycle property writes/],
    ['lexical lifecycle write', 'ui.js', 'const startLocalSession = start;', 'start=()=>{};const startLocalSession = start;', /reassignment/],
    ['accepted-alert reassignment', 'alerts.js', 'export function toggleVoice()', 'trigger=()=>{};export function toggleVoice()', /reassignment/],
    ['dynamic direct eval', 'driver-app.js', 'initializeLocalLifecycle();', "eval('start=1');initializeLocalLifecycle();", /dynamic eval\/with/],
    ['untracked module edge', 'driver-app.js', 'import "./metrics.js";', 'import "./untracked.js";', /untracked module/],
    ['aliased module import', 'driver-app.js', '{ initModel }', '{ initModel as otherModel }', /aliases/],
    ['marker string spoof', 'driver-app.js', "const recalBtn = document.getElementById('recalBtn');", "let recalBtn = document.getElementById('recalBtn');const markerDecoy='const recalBtn=';", /executable excerpt marker/]
])
    test(name + ' is rejected from a real copied module graph', async () => changed(async (cwd, build) => { change(cwd, file, old, next); await assert.rejects(build, expected); }));
test('duplicate module globals and untracked registry inputs are rejected before compilation', async () => changed(async (cwd, build) => {
    writeFileSync(join(cwd, 'src', 'camera.js'), readFileSync(join(cwd, 'src', 'camera.js'), 'utf8') + '\nexport const duplicatedGlobal=1;\n');
    writeFileSync(join(cwd, 'src', 'detector.js'), readFileSync(join(cwd, 'src', 'detector.js'), 'utf8') + '\nexport const duplicatedGlobal=2;\n');
    await assert.rejects(build, /duplicate module-global/);
    const other = JSON.parse(readFileSync(join(cwd, 'driver-contract.json')));
    other.modules.push('not-reachable.js');
    writeFileSync(join(cwd, 'src', 'not-reachable.js'), 'export const isolated=1;');
    writeFileSync(join(cwd, 'driver-contract.json'), JSON.stringify(other));
    await assert.rejects(build);
}));
test('a missing marker registry cannot be hidden by literal substrings', () => {
    assert.throws(() => formatDriverBundle(base.stock, graph, { ...contract, markerRules: [] }), /complete executable marker registry/);
});
test('resolved local alpha preserves noncomputed property keys and nested captures', async () => changed(async (cwd, build) => {
    change(cwd, 'ui.js', 'const startLocalSession = start;', "const keyIdentity={start2:'property'};function nestedCapture(){return start()}const startLocalSession = start;");
    const result = await build();
    assert.ok(result.code.includes("{start2:'property'}"));
    assert.ok(result.code.includes('function nestedCapture(){return start()}'));
    assert.equal(result.proof.resolvedLifecycleAlpha.find(item => item.to === 'start').references, 2);
}));
test('lone surrogates, control escapes and paired emoji preserve actual serialized JS values', async () => {
    for (const [sourceText, expected] of [["'\\uD800'", '\uD800'], ["'\\uDC00'", '\uDC00'], ["'🛑'", '🛑'], ["'\\u0000\\u000b\\n\\t'", '\0\v\n\t']])
        await changed(async (cwd, build) => {
            change(cwd, 'metrics.js', "'SAFE'", sourceText);
            const result = await build(), path = join(cwd, 'output.js');
            writeFileSync(path, result.code);
            const written = readFileSync(path, 'utf8'), node = top(written, 'riskText');
            const literals = [];
            function visit(n) { if (n?.type === 'Literal' && typeof n.value === 'string')
                literals.push(n.value); if (n && typeof n === 'object')
                for (const value of Object.values(n))
                    if (value && typeof value === 'object')
                        Array.isArray(value) ? value.forEach(visit) : visit(value); }
            visit(node);
            assert.ok(literals.includes(expected));
            assert.equal(result.code, written);
            assert.equal(result.proof.serializedUtf8Exact, true);
        });
});
for (const [name, addition] of [
    ['anonymous parameter default', 'export function reviewDefaultFunctionName(feedbackForm=()=>{}){return feedbackForm.name}'],
    ['later anonymous assignment', 'export function reviewAssignedFunctionName(){let feedbackForm;feedbackForm=()=>{};return feedbackForm.name}'],
    ['anonymous class parameter default', 'export function reviewDefaultClassName(feedbackForm=class{}){return feedbackForm.name}'],
    ['later anonymous class assignment', 'export function reviewAssignedClassName(){let feedbackForm;feedbackForm=class{};return feedbackForm.name}']
])
    test(name + ' rejects inferred-name-changing compiler alpha', async () => changed(async (cwd, build) => {
        const path = join(cwd, 'src', 'metrics.js');
        writeFileSync(path, readFileSync(path, 'utf8') + '\n' + addition + '\n');
        await assert.rejects(build, /Source function identity changed:/);
    }));
test('erased or reordered real top-level startup effects cannot pass source identity', () => {
    const body = ast(base.stock).body, effects = body.filter(node => node.type === 'ExpressionStatement');
    assert.ok(effects.length > 2);
    assert.throws(() => formatDriverBundle(replace(base.stock, effects[0], ''), graph, contract), /Source initializer\/effect evaluation order changed/);
    const first = effects[0], second = effects[1];
    const altered = replace(replace(base.stock, second, base.stock.slice(first.start, first.end)), first, base.stock.slice(second.start, second.end));
    assert.throws(() => formatDriverBundle(altered, graph, contract), /Source initializer\/effect evaluation order changed/);
});
test('marker roles cannot claim an unrelated executable owner', () => {
    const altered = structuredClone(contract);
    altered.markerRules[0].role = 'unrelated-state';
    assert.throws(() => formatDriverBundle(base.stock, graph, altered), /marker ownership registry changed/);
});
test('a lifecycle capture must be unique and preserve the two distinct operations', async () => changed(async (cwd, build) => {
    change(cwd, 'ui.js', 'const startLocalSession = start;', 'const startLocalSession = start;const startLocalSession = start;');
    await assert.rejects(build);
}));
test('inference-sensitive anonymous declaration names are not normalized', async () => changed(async (cwd, build) => {
    const path = join(cwd, 'src', 'metrics.js');
    writeFileSync(path, readFileSync(path, 'utf8') + '\nexport function reviewDeclaredFunctionName(){const feedbackForm=()=>{};return feedbackForm.name}\n');
    await assert.rejects(build, /Source function identity changed:/);
}));

test('invalid UTF-8 in any actual module fails before compilation and provenance', async () => changed(async (cwd, build) => {
 const path = join(cwd, 'src', 'metrics.js'), before = readFileSync(path), target = Buffer.from("'SAFE'");
 const index = before.indexOf(target); assert.ok(index >= 0);
 writeFileSync(path, Buffer.concat([before.subarray(0, index + 1), Buffer.from([0xed, 0xa0, 0x80]), before.subarray(index + target.length - 1)]));
 await assert.rejects(build, /source module must be valid UTF-8: metrics.js/);
}));

test('computed native lifecycle key writes fail closed in the actual module graph', async () => changed(async (cwd, build) => {
 const path = join(cwd, 'src', 'driver-app.js');
 writeFileSync(path, readFileSync(path, 'utf8') + "\nconst computedLifecycleKey='stop';window[computedLifecycleKey]=()=>{};\n");
 await assert.rejects(build, /unknown computed global property writes/);
}));

test('chart and foreground excerpts contain only their owned real function bodies', () => {
 const program = ast(base.code), functions = program.body.filter(node => node.type === 'FunctionDeclaration');
 const chart = functions.find(node => node.id.name === 'updateChart'), install = functions.find(node => node.id.name === 'triggerPWAInstall');
 assert.equal(program.body[program.body.indexOf(chart) + 1], install);
 const feedback = program.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(binding => binding.id.name === 'feedbackForm'));
 const index = program.body.indexOf(feedback), handler = program.body[index + 2], registration = program.body[index + 3];
 assert.equal(program.body[index + 1].type, 'IfStatement');
 assert.equal(handler.type, 'FunctionDeclaration'); assert.equal(handler.id.name, 'handleVisibilityChange');
 assert.equal(registration.expression.callee.object.name, 'document');
 assert.equal(registration.expression.arguments[0].value, 'visibilitychange');
 assert.equal(base.code.slice(handler.end, registration.start).trim(), '');
 assert.equal(base.code.slice(chart.end, install.start).trim(), '');
});

test('function boundary metadata cannot claim unrelated declarations', async () => changed(async (cwd, build) => {
 const altered = structuredClone(contract); altered.adjacentDeclarations[1].move = 'riskText';
 writeFileSync(join(cwd, 'driver-contract.json'), JSON.stringify(altered));
 await assert.rejects(build, /owned function adjacency registry changed/);
 altered.adjacentDeclarations = contract.adjacentDeclarations; altered.registrationBoundary.handler = 'demoAlert';
 writeFileSync(join(cwd, 'driver-contract.json'), JSON.stringify(altered));
 await assert.rejects(build, /owned registration boundary changed/);
}));

test('missing or displaced actual foreground registration fails before excerpt formatting', async () => changed(async (cwd, build) => {
 const path = join(cwd, 'src/driver-app.js'), original = readFileSync(path, 'utf8'), registration = "document.addEventListener('visibilitychange', () => { void handleVisibilityChange(); });";
 assert.ok(original.includes(registration));
 writeFileSync(path, original.replace(registration, "const registrationDecoy='document.addEventListener';"));
 await assert.rejects(build, /unique owned foreground registration/);
 writeFileSync(path, original.replace(registration, "window.addEventListener('review-interposed-event',()=>{});\n" + registration));
 await assert.rejects(build, /foreground registration must immediately follow actual feedback/);
}));

test('contract, lock and module inputs must be regular owned files before reads', async () => changed(async (cwd, build) => {
 for (const file of ['driver-contract.json', 'package-lock.json', 'src/metrics.js']) {
  const path = join(cwd, file), bytes = readFileSync(path), target = join(cwd, 'outside-' + file.replaceAll('/', '-'));
  writeFileSync(target, bytes); rmSync(path); symlinkSync(target, path);
  await assert.rejects(build, /regular owned file/);
  rmSync(path); writeFileSync(path, bytes);
 }
 const parent = join(cwd, 'linked-parent'); symlinkSync(cwd, parent, 'dir');
 await assert.rejects(() => buildDriverArtifact({ sourceRoot: join(cwd, 'src'), contractPath: join(parent, 'driver-contract.json') }), /owned directory/);
}));
