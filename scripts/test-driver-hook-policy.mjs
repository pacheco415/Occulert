import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetByStem } from './lib/current-assets.mjs';
import { auditDriverHooks } from './lib/driver-hook-policy.mjs';
const code = readFileSync(assetByStem('driver-app.js'), 'utf8');
test('actual released driver has explicit accepted effects and readonly lifecycle coordinators', () => assert.equal(auditDriverHooks(code), true));
for (const [label, before, after] of [
  ['function reassignment', 'const startupCore=Object.freeze', 'trigger=()=>{};const startupCore=Object.freeze'],
  ['computed native stop overwrite', 'const startupCore=Object.freeze', "const computedLifecycleKey='stop';window[computedLifecycleKey]=()=>{};const startupCore=Object.freeze"],
  ['native stop overwrite', 'const startupCore=Object.freeze', 'window.stop=()=>{};const startupCore=Object.freeze'],
  ['lost cooldown', 'now-lastAlert<12000', 'now-lastAlert<0'],
  ['dispatch omitted', 'acceptedAlertHook(reason)', 'void reason'],
  ['protected event omitted', "queueBackendEvent(reason===", "unrelatedQueue(reason==="],
]) test(label + ' fails against the actual compiled policy', () => {
  assert.ok(code.includes(before));
  assert.throws(() => auditDriverHooks(code.replace(before, after)));
});
