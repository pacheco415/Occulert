import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { buildDriverArtifact } from './lib/driver-build.mjs';

const compiled = await buildDriverArtifact({ sourceRoot:fileURLToPath(new URL('../src',import.meta.url)),
    contractPath:fileURLToPath(new URL('../source-driver-contract.json',import.meta.url)) });
const ast=parse(compiled.code,{ecmaVersion:2022,sourceType:'script'});
const initializer = name => {
    const node=ast.body.filter(row => row.type==='VariableDeclaration').flatMap(row => row.declarations).find(row => row.id.name===name);
    assert.ok(node,name);return compiled.code.slice(node.init.start,node.init.end);
};
const helper={module:{exports:{}},URLSearchParams};
vm.runInNewContext(readFileSync(new URL('../src/detection-experiments.js',import.meta.url),'utf8'),helper);
function selection(query) {
    const context={window:{location:{search:query}},URLSearchParams};
    return {flags:vm.runInNewContext(initializer('experimentFlags'),context),minimum:vm.runInNewContext(initializer('calibrationMinimumSamples'),context)};
}
test('exact calibration-min=12 is named, local-only and non-primary in both actual parsers', () => {
    const {flags,minimum}=selection('?calibration-min=12');
    assert.equal(minimum,12);assert.equal(flags.any,true);assert.equal(flags.primary,false);
    assert.deepEqual([...flags.names],['calibrationMin']);
    assert.deepEqual(structuredClone(helper.module.exports.parseFlags('?calibration-min=12')),structuredClone(flags));
});
for (const query of ['', '?calibration-min=12&calibration-min=12','?calibration-min=012','?calibration-min=true']) test(`calibration selection preserves the released default for ${query||'empty query'}`, () => {
    const {flags,minimum}=selection(query);assert.equal(minimum,1);assert.equal(flags.any,false);assert.equal(flags.primary,false);
    assert.deepEqual([...flags.names],[]);
});
test('actual compiled cloud entrypoints cannot contact a provider under the calibration-only flag', async () => {
    const {flags}=selection('?calibration-min=12'),calls=[];
    const context={experimentFlags:flags,cloudConsent:{checked:true},cloudReady:true,running:true,sessionStart:1,lastFleetPush:0,
        FLEET_PUSH_INTERVAL:5000,Date,Promise,syncEl:{textContent:''},localStorage:{setItem(){}},
        window:{OcculertBackend:new Proxy({}, {get:(_target,key)=>()=>{calls.push(key);throw Error('Cloud call under parked calibration');}}),
            OcculertSync:{saveLiveSession:()=>{calls.push('fleet');throw Error('Fleet call under parked calibration');}}},
        set_lastFleetPush:value=>{context.lastFleetPush=value;},set_cloudReady:value=>{context.cloudReady=value;}};
    const names=['beginBackendSession','queueBackendEvent','pushFleet','initCloud'];
    const functions=ast.body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name));
    vm.createContext(context);vm.runInContext(functions.map(node=>compiled.code.slice(node.start,node.end)).join('\n'),context);
    assert.equal(await context.beginBackendSession(),null);context.queueBackendEvent('drowsy');
    await context.pushFleet(true,{});await context.initCloud();assert.deepEqual(calls,[]);assert.equal(context.cloudReady,false);
});
