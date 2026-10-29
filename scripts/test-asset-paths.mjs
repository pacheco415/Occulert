import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { parseRuntimeAssetPath, resolveRuntimeAssetPath } from './lib/asset-paths.mjs';

function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), 'occulert-asset-paths-'));
  try { body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function write(root, name, bytes) {
  const filename = join(root, name);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, bytes);
  return filename;
}

test('root and nested runtime paths preserve full paths and share logical identity', () => {
  for (const prefix of ['', 'assets/runtime/']) {
    assert.deepEqual(parseRuntimeAssetPath(`${prefix}driver-app.v093.js`), {
      relativePath: `${prefix}driver-app.v093.js`, publicPath: `/${prefix}driver-app.v093.js`,
      basename: 'driver-app.v093.js', logicalName: 'driver-app.js', version: '093', extension: 'js',
    });
    assert.deepEqual(parseRuntimeAssetPath(`${prefix}driver_overview-2.v0.css`), {
      relativePath: `${prefix}driver_overview-2.v0.css`, publicPath: `/${prefix}driver_overview-2.v0.css`,
      basename: 'driver_overview-2.v0.css', logicalName: 'driver_overview-2.css', version: '0', extension: 'css',
    });
  }
});

test('only exact owned versioned path shapes are accepted', () => {
  const invalid = [
    undefined, null, false, true, 1, 0, NaN, 1n, Symbol('asset'), () => {}, [], {},
    Object.create(null), { toString() { throw new Error('must not coerce input'); } },
    new String('driver.v1.js'),
    '', 'driver.js', 'driver.v.js', 'driver.v-1.js', 'driver.v1.2.js', 'driver.v1.JS',
    'driver.v1.css.map', 'driver.v1.json', 'driver.v1.jsx', '.v1.js', 'driver.app.v1.js',
    '/driver.v1.js', '/assets/runtime/driver.v1.js', 'https://example.com/driver.v1.js',
    '//example.com/driver.v1.js', 'C:\\driver.v1.js', 'assets\\runtime\\driver.v1.js',
    '../driver.v1.js', './driver.v1.js', 'assets/runtime/../driver.v1.js',
    'assets/./runtime/driver.v1.js', 'assets/runtime//driver.v1.js',
    'assets/runtime/other/driver.v1.js', 'assets/driver.v1.js', 'src/driver.v1.js',
    'other/runtime/driver.v1.js', 'Assets/runtime/driver.v1.js',
    'assets/runtime/%2e%2e/driver.v1.js', '%64river.v1.js', 'driver.v1.js?x=1',
    'driver.v1.js#fragment', 'driver.v1.js/', ' driver.v1.js', 'driver.v1.js ',
    'driver.v1.js\n', 'driver.v1.js\r\n', 'driver\tv1.js', 'driver\0.v1.js',
    'drivér.v1.js', 'assets∕runtime∕driver.v1.js',
  ];
  for (const name of invalid) {
    assert.throws(() => parseRuntimeAssetPath(name), /Invalid runtime asset path/);
    assert.throws(() => resolveRuntimeAssetPath(tmpdir(), name), /Invalid runtime asset path/);
  }
});

test('resolution reads exact root and nested bytes and returns an absolute path', () => fixture(root => {
  for (const [name, bytes] of [
    ['driver-app.v1.js', 'const rootRelease = 1;\n'],
    ['assets/runtime/driver-app.v2.js', 'const nestedRelease = 2;\n'],
    ['assets/runtime/overview.v3.css', 'body { color: green; }\n'],
  ]) {
    write(root, name, bytes);
    const filename = resolveRuntimeAssetPath(root, name);
    assert.equal(filename, resolve(root, name));
    assert.equal(readFileSync(filename, 'utf8'), bytes);
  }
}));

test('missing paths and non-file or non-directory components are rejected', () => fixture(root => {
  assert.throws(() => resolveRuntimeAssetPath(root, 'missing.v1.js'), /does not exist/);
  assert.throws(() => resolveRuntimeAssetPath(root, 'assets/runtime/missing.v1.js'), /does not exist/);
  mkdirSync(join(root, 'directory.v1.css'));
  assert.throws(() => resolveRuntimeAssetPath(root, 'directory.v1.css'), /not a regular file/);
  write(root, 'assets', 'not a directory');
  assert.throws(() => resolveRuntimeAssetPath(root, 'assets/runtime/driver.v1.js'), /not a directory/);
  rmSync(join(root, 'assets'));
  write(root, 'assets/runtime', 'not a directory');
  assert.throws(() => resolveRuntimeAssetPath(root, 'assets/runtime/driver.v1.js'), /not a directory/);
}));

test('file symlinks are rejected even when their target is inside the trusted root', () => fixture(root => {
  const target = write(root, 'original.v1.js', 'const untouched = 1;\n');
  symlinkSync(target, join(root, 'linked.v1.js'));
  assert.throws(() => resolveRuntimeAssetPath(root, 'linked.v1.js'), /must not be symlinks/);
  assert.equal(readFileSync(target, 'utf8'), 'const untouched = 1;\n');
}));

test('symlinked parent directories are rejected at every nested component', () => {
  for (const link of ['assets', 'assets/runtime']) fixture(root => {
    const target = join(root, 'target');
    mkdirSync(target);
    if (link === 'assets') write(root, 'target/runtime/driver.v1.js', 'target');
    else {
      write(root, 'target/driver.v1.js', 'target');
      mkdirSync(join(root, 'assets'));
    }
    symlinkSync(target, join(root, link), 'dir');
    assert.throws(() => resolveRuntimeAssetPath(root, 'assets/runtime/driver.v1.js'), /must not be symlinks/);
  });
});

test('dangling file and directory symlinks are rejected instead of treated as missing', () => {
  for (const name of ['linked.v1.js', 'assets', 'assets/runtime', 'assets/runtime/linked.v1.js']) fixture(root => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    symlinkSync(join(root, 'absent-target'), join(root, name));
    const output = name.endsWith('.js') ? name : 'assets/runtime/linked.v1.js';
    assert.throws(() => resolveRuntimeAssetPath(root, output), /must not be symlinks/);
  });
});

test('a FIFO cannot be resolved as runtime output', { skip: process.platform === 'win32' }, () => fixture(root => {
  execFileSync('mkfifo', [join(root, 'pipe.v1.js')]);
  assert.throws(() => resolveRuntimeAssetPath(root, 'pipe.v1.js'), /not a regular file/);
}));
