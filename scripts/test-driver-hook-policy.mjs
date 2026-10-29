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
  ['lost cooldown', 'nowMs-state.lastAlert<12000', 'nowMs-state.lastAlert<0'],
  ['shadowed eligibility call', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){const scoringTriggerEligible=()=>true;'],
  ['shadowed confidence state', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){const confidence=100;'],
  ['shadowed clock adapter', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){const scoringReadWallClock=()=>Infinity;'],
  ['trigger clock reassignment', 'const qualified=experimentFlags.noface', 'now=Infinity;const qualified=experimentFlags.noface'],
  ['mutable private qualification', 'const qualified=experimentFlags.noface', 'let qualified=experimentFlags.noface'],
  ['clock adapter constant return', 'function scoringReadWallClock(phase){', 'function scoringReadWallClock(phase){return 0;'],
  ['clock Date shadow', 'function scoringReadWallClock(phase){', 'const Date={now:()=>0};function scoringReadWallClock(phase){'],
  ['private flag shadow', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){const experimentFlags={noface:true};'],
  ['private running shadow', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){const running=true;'],
  ['private controller shadow', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){const experimentController={qualifiedLoss:()=>true};'],
  ['reason parameter reassignment', 'function trigger(reason,eligibility){', "function trigger(reason,eligibility){reason='Face lost after fatigue';"],
  ['eligibility parameter reassignment', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){eligibility={};'],
  ['shadowed Boolean qualification', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){const Boolean=()=>true;'],
  ['unqualified no-face bypass', "reason==='Face lost after fatigue'", "reason==='Fatigue'"],
  ['state mutation before guard', 'function trigger(reason,eligibility){', 'function trigger(reason,eligibility){lastAlert=0;'],
  ['eligibility reassignment', 'const startupCore=Object.freeze', 'scoringTriggerEligible=()=>true;const startupCore=Object.freeze'],
  ['dispatch omitted', 'acceptedAlertHook(reason)', 'void reason'],
  ['protected event omitted', "queueBackendEvent(reason===", "unrelatedQueue(reason==="],
]) test(label + ' fails against the actual compiled policy', () => {
  assert.ok(code.includes(before));
  assert.throws(() => auditDriverHooks(code.replace(before, after)));
});
