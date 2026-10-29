import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createAssetLookup } from './lib/current-assets.mjs';

function fixture(t, versions) {
  const root = mkdtempSync(join(tmpdir(), 'occulert-current-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of new Set(Object.values(versions))) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), '/* Fixture runtime output. */');
  }
  return { root, lookup: createAssetLookup(root, versions) };
}

test('lookups preserve root and nested paths and deduplicate shared aliases', t => {
  const { lookup } = fixture(t, {
    'driver-app.js': 'driver-app.v12.js',
    'about-page.js': 'assets/runtime/public-page.v2.js',
    'install-page.js': 'assets/runtime/public-page.v2.js',
    'public-page.css': 'assets/runtime/public-page.v3.css',
  });
  assert.equal(lookup.asset('driver-app.js'), 'driver-app.v12.js');
  assert.equal(lookup.assetPath('driver-app.js'), '/driver-app.v12.js');
  assert.equal(lookup.assetByStem('driver-app.js'), 'driver-app.v12.js');
  assert.equal(lookup.asset('about-page.js'), 'assets/runtime/public-page.v2.js');
  assert.equal(lookup.assetPath('install-page.js'), '/assets/runtime/public-page.v2.js');
  assert.equal(lookup.assetByStem('public-page.js'), 'assets/runtime/public-page.v2.js');
  assert.equal(lookup.assetByStem('public-page.css'), 'assets/runtime/public-page.v3.css');
  assert.throws(() => lookup.asset('missing.js'), /Unknown active asset/);
  assert.throws(() => lookup.asset('toString'), /Unknown active asset/);
  assert.throws(() => lookup.assetByStem('missing.js'), /found 0/);
});

test('the same stem in distinct output locations or versions is ambiguous', t => {
  for (const nested of ['assets/runtime/driver-app.v1.js', 'assets/runtime/driver-app.v2.js']) {
    const { lookup } = fixture(t, { 'driver-app.js': 'driver-app.v1.js', 'other.js': nested });
    assert.throws(() => lookup.assetByStem('driver-app.js'), /found 2/);
  }
});

test('lookups reject invalid manifest paths and invalid logical stems', t => {
  const { root } = fixture(t, {});
  for (const name of ['../driver-app.v1.js', '/driver-app.v1.js', 'src/driver-app.v1.js', 'assets/runtime/../driver-app.v1.js', 'assets/runtime/driver-app.v1.js?x=1', null]) {
    const lookup = createAssetLookup(root, { 'driver-app.js': name });
    assert.throws(() => lookup.asset('driver-app.js'), /Invalid runtime asset path/);
    assert.throws(() => lookup.assetPath('driver-app.js'), /Invalid runtime asset path/);
    assert.throws(() => lookup.assetByStem('driver-app.js'), /Invalid runtime asset path/);
  }
  const lookup = createAssetLookup(root, {});
  for (const stem of ['assets/runtime/driver-app.js', '../driver-app.js', 'driver-app.v1.js?x=1', 'driver-app', null, 1]) {
    assert.throws(() => lookup.assetByStem(stem), /Invalid asset stem/);
  }
});

test('lookups reject missing output and symlinked runtime parents', t => {
  const { root, lookup } = fixture(t, { 'driver-app.js': 'assets/runtime/driver-app.v1.js' });
  rmSync(join(root, 'assets/runtime'), { recursive: true });
  assert.throws(() => lookup.asset('driver-app.js'), /does not exist/);
  writeFileSync(join(root, 'driver-app.v1.js'), '/* Outside the runtime directory. */');
  symlinkSync(root, join(root, 'assets/runtime'), 'dir');
  assert.throws(() => lookup.asset('driver-app.js'), /symlink/i);
  assert.throws(() => lookup.assetPath('driver-app.js'), /symlink/i);
  assert.throws(() => lookup.assetByStem('driver-app.js'), /symlink/i);
});
