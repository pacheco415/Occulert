import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { auditAssetLineage } from './audit-asset-lineage.mjs';

function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-lineage-'));
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
  const save = (version, bytes = `const v = ${version};\n`) => {
    writeFileSync(join(cwd, `driver.v${version}.js`), bytes);
    writeFileSync(join(cwd, 'asset-versions.json'), JSON.stringify({ 'driver.js': `driver.v${version}.js` }));
  };
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'); return git('rev-parse', 'HEAD'); };
  try { git('init', '-q', '-b', 'main'); save(1); commit(); run({ cwd, git, save, commit }); }
  finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('a fresh asset release passes against unchanged main', () => fixture(({ cwd, git, save, commit }) => {
  git('checkout', '-qb', 'pr'); save(2); commit();
  assert.deepEqual(auditAssetLineage({ cwd, base: 'main' }).failures, []);
}));

test('main edits unrelated to the active logical asset do not block a release', () => fixture(({ cwd, git, save, commit }) => {
  git('checkout', '-qb', 'pr'); save(2); commit(); git('checkout', 'main');
  writeFileSync(join(cwd, 'README.md'), 'Documentation'); commit();
  assert.deepEqual(auditAssetLineage({ cwd, base: 'main', head: 'pr' }).failures, []);
}));

test('a stale PR asset fails even when its proposed filename is unused', () => fixture(({ cwd, git, save, commit }) => {
  git('checkout', '-qb', 'pr'); save(3); commit(); git('checkout', 'main'); save(2); commit();
  assert.match(auditAssetLineage({ cwd, base: 'main', head: 'pr' }).failures.join('\n'), /main moved driver.js from driver.v1.js to driver.v2.js/);
}));

test('same version name with different bytes fails independently of the manifest', () => fixture(({ cwd, git, commit }) => {
  git('checkout', '-qb', 'pr'); writeFileSync(join(cwd, 'retained.v2.js'), 'const pr = 1;'); commit();
  git('checkout', 'main'); writeFileSync(join(cwd, 'retained.v2.js'), 'const main = 1;'); commit();
  assert.match(auditAssetLineage({ cwd, base: 'main', head: 'pr' }).failures.join('\n'), /Immutable asset collision: retained.v2.js/);
}));

test('an identical retained version file on both branches is allowed', () => fixture(({ cwd, git, commit }) => {
  git('checkout', '-qb', 'pr'); writeFileSync(join(cwd, 'retained.v2.js'), 'const shared = 1;'); commit();
  git('checkout', 'main'); writeFileSync(join(cwd, 'retained.v2.js'), 'const shared = 1;'); commit();
  assert.deepEqual(auditAssetLineage({ cwd, base: 'main', head: 'pr' }).failures, []);
}));

test('using the actual PR head detects stale lineage behind a synthetic merge checkout', () => fixture(({ cwd, git, save, commit }) => {
  git('checkout', '-qb', 'pr'); save(3); const head = commit(); git('checkout', 'main'); save(2); const base = commit();
  git('checkout', '-qb', 'synthetic');
  try { git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '--no-commit', 'pr'); }
  catch (error) { assert.equal(error.status, 1, 'only the expected manifest conflict is allowed'); }
  save(3); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic resolution');
  assert.deepEqual(auditAssetLineage({ cwd, base }).failures, []);
  assert.match(auditAssetLineage({ cwd, base, head }).failures.join('\n'), /main moved/);
}));

test('missing base or malformed manifests fail closed', () => fixture(({ cwd, git, commit }) => {
  assert.throws(() => auditAssetLineage({ cwd, base: 'absent' }));
  git('checkout', '-qb', 'pr'); writeFileSync(join(cwd, 'asset-versions.json'), '[]'); commit();
  assert.throws(() => auditAssetLineage({ cwd, base: 'main' }), /Invalid asset manifest/);
}));

test('CLI checks execute through macOS temporary path aliases and exit nonzero on failure', () => fixture(({ cwd, git, save, commit }) => {
  git('checkout', '-qb', 'pr'); save(3); commit(); git('checkout', 'main'); save(2); commit();
  copyFileSync(new URL('./audit-asset-lineage.mjs', import.meta.url), join(cwd, 'audit.mjs'));
  const result = spawnSync(process.execPath, [join(cwd, 'audit.mjs')], { cwd, env: { ...process.env, ASSET_LINEAGE_HEAD: 'pr', ASSET_LINEAGE_BASE: 'main' }, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /main moved/);
}));
