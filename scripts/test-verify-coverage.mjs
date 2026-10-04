import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validatePlan } from './verify.mjs';

const manifest = JSON.parse(readFileSync(new URL('./verify-steps.json', import.meta.url), 'utf8'));
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('every root test and audit has a verification entry or a documented exclusion', () => {
  const plan = validatePlan(manifest, scripts);
  assert.ok(plan.steps.length > 0);
  assert.ok(plan.additionalChecks.includes('test:verify-runner'));
  assert.equal(scripts.verify, 'node scripts/verify.mjs');
  assert.deepEqual(manifest.excluded.map(entry => entry.script).sort(), ['test:browser', 'test:watch-notification']);
  const browserWorkflow = readFileSync(new URL('../.github/workflows/browser-smoke.yml', import.meta.url), 'utf8');
  const nativeWorkflow = readFileSync(new URL('../.github/workflows/native-app-typecheck.yml', import.meta.url), 'utf8');
  assert.match(browserWorkflow, /npm run test:browser/);
  assert.match(nativeWorkflow, /node --test scripts\/test-watch-notification\.mjs/);
});

test('new scripts require coverage, and exclusions cannot hide stale names or duplicate steps', () => {
  assert.throws(() => validatePlan(manifest, { ...scripts, 'test:forgotten-regression': 'node fixture.mjs' }), /forgotten-regression/);
  assert.throws(() => validatePlan({ ...manifest, steps: [...manifest.steps, manifest.steps[0]] }, scripts), /more than once/);
  assert.throws(() => validatePlan({ ...manifest, excluded: [...manifest.excluded, { script: 'test:deleted', reason: 'Old job' }] }, scripts), /missing from package/);
  assert.throws(() => validatePlan({ ...manifest, excluded: [{ script: 'test:browser', reason: '  ' }] }, scripts), /non-empty reason/);
  assert.throws(() => validatePlan({ ...manifest, additionalChecks: ['verify'] }, scripts), /Invalid verification/);
});
