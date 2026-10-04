import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCoverage, migrationInventory } from './check-migration-readiness.mjs';

test('missing production ledger is not represented as an applied schema', () => {
  const result = checkCoverage([]);
  assert.equal(result.status, 'missing_required_versions');
  assert.equal(result.missing.length, migrationInventory().filter(row => row.version).length);
  assert.equal(result.baseline_files_not_covered_by_ledger.length, 3);
  assert.ok(result.missing.some(row => row.version === '20260927010000'));
  assert.ok(result.missing.some(row => row.version === '20260927030000'));
  assert.ok(result.missing.some(row => row.version === '20260929010000'));
  assert.ok(result.missing.some(row => row.version === '20260701000000'));
});
test('complete ledger coverage still distinguishes legacy/schema equivalence', () => {
  const files = migrationInventory();
  const result = checkCoverage(files.filter(row => row.version).map(({version}) => ({version})));
  assert.equal(result.status, 'required_versions_recorded');
  assert.equal(result.missing.length, 0);
  assert.equal(result.limitations.length, 2);
  assert.ok(files.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
});
test('malformed or numeric migration exports fail closed', () => {
  for (const rows of [null, {}, [null], [[]], [{version:20260927010000}], [{version:'20260927'}]]) assert.throws(() => checkCoverage(rows));
});
