import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProcessWithDiagnostics, snapshotResources, STDERR_TAIL_BYTES } from './run-browser-check.mjs';
import { LIBRARY_EVIDENCE_LIMITS, linuxDeviceNumber, sampleLoadedLibraries, startLibraryEvidence } from './lib/browser-library-evidence.mjs';

const runnerUrl = new URL('./run-browser-check.mjs', import.meta.url).href;
const temporary = () => mkdtempSync(join(tmpdir(), 'occulert-browser-process-'));
const missingProbes = directory => ({ platform: 'linux', procRoot: join(directory, 'missing-proc'), cgroupRoot: join(directory, 'missing-cgroup'), shmPath: join(directory, 'missing-shm') });
const collect = () => {
  const stream = new PassThrough(), chunks = [];
  stream.on('data', chunk => chunks.push(chunk));
  return { stream, bytes: () => Buffer.concat(chunks) };
};
async function invoke(directory, source, extra = {}) {
  const stdout = collect(), stderr = collect();
  const receipt = await runProcessWithDiagnostics({ command: process.execPath, args: ['-e', source], mode: 'webkit', cwd: directory,
    diagnosticDirectory: join(directory, 'diagnostics'), probeOptions: missingProbes(directory), stdout: stdout.stream, stderr: stderr.stream, ...extra });
  return { receipt, stdout: stdout.bytes(), stderr: stderr.bytes() };
}
function driver(directory, source, options = {}) {
  const path = join(directory, 'driver.mjs');
  writeFileSync(path, `import { runProcessWithDiagnostics, finishWithChildStatus } from ${JSON.stringify(runnerUrl)};
    const receipt = await runProcessWithDiagnostics({ command: process.execPath, args: ['-e', ${JSON.stringify(source)}], mode: 'webkit', cwd: ${JSON.stringify(directory)}, diagnosticDirectory: ${JSON.stringify(join(directory, 'diagnostics'))}, probeOptions: ${JSON.stringify(missingProbes(directory))} });
    finishWithChildStatus(receipt);`);
  return options.async ? spawn(process.execPath, [path], { stdio: ['ignore', 'pipe', 'pipe'] }) : spawnSync(process.execPath, [path], { encoding: 'utf8', timeout: 10_000 });
}

test('real child output is forwarded byte for byte and only browser debug is enabled', async () => {
  const directory = temporary();
  try {
    const result = await invoke(directory, `process.stdout.write(Buffer.from([0,255,10])); process.stderr.write(Buffer.from([128,0,10])); if(process.env.DEBUG !== 'pw:browser') process.exitCode=8;`);
    assert.deepEqual(result.stdout, Buffer.from([0,255,10]));
    assert.deepEqual(result.stderr, Buffer.from([128,0,10]));
    assert.deepEqual(result.receipt.exit, { code: 0, signal: null, spawnError: null });
    assert.deepEqual(readFileSync(join(directory, 'diagnostics/webkit.stderr.log')), result.stderr);
    const stored = JSON.parse(readFileSync(join(directory, 'diagnostics/webkit.json')));
    assert.equal(stored.state, 'finished');
    assert.equal(stored.stderr.totalBytes, 3);
    assert.equal(stored.stderr.truncated, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a child failure exits with its actual code 7 and retains its failure output', () => {
  const directory = temporary();
  try {
    const result = driver(directory, 'process.stderr.write("actual failure\\n"); process.exitCode=7;');
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, 'actual failure\n');
    assert.equal(JSON.parse(readFileSync(join(directory, 'diagnostics/webkit.json'))).exit.code, 7);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a failed process launch cannot produce a successful receipt', async () => {
  const directory = temporary();
  try {
    const result = await invoke(directory, '', { command: join(directory, 'no-such-executable'), args: [] });
    assert.deepEqual(result.receipt.exit, { code: 1, signal: null, spawnError: 'ENOENT' });
    assert.equal(JSON.parse(readFileSync(join(directory, 'diagnostics/webkit.json'))).exit.code, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a child terminated by a signal terminates the wrapper with the same signal', () => {
  const directory = temporary();
  try {
    const result = driver(directory, 'process.kill(process.pid, "SIGTERM");');
    assert.equal(result.status, null);
    assert.equal(result.signal, 'SIGTERM');
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'diagnostics/webkit.json'))).exit, { code: null, signal: 'SIGTERM', spawnError: null });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`the wrapper forwards ${signal} to the running child`, { timeout: 15_000 }, async () => {
  const directory = temporary();
  let child;
  try {
    child = driver(directory, `process.on(${JSON.stringify(signal)},()=>{ process.stderr.write('forwarded\\n'); process.exit(23); }); process.stdout.write('ready\\n'); setInterval(()=>{},1000);`, { async: true });
    let output = '';
    const finished = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', (code, killedBy) => resolveExit({ code, killedBy })); });
    await new Promise((resolveReady, reject) => {
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('ready\n')) resolveReady(); });
      child.once('error', reject);
      child.once('close', () => reject(new Error('Wrapper exited before child readiness')));
    });
    child.kill(signal);
    assert.deepEqual(await finished, { code: 23, killedBy: null });
    const receipt = JSON.parse(readFileSync(join(directory, 'diagnostics/webkit.json')));
    assert.deepEqual(receipt.forwardedSignals, [signal]);
    assert.equal(receipt.exit.code, 23);
    assert.equal(readFileSync(join(directory, 'diagnostics/webkit.stderr.log'), 'utf8'), 'forwarded\n');
  } finally { if (child?.exitCode === null) child.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); }
});

test('large stderr keeps the exact bounded tail while the live stream stays complete', async () => {
  const directory = temporary();
  try {
    const result = await invoke(directory, `process.stderr.write(Buffer.alloc(${STDERR_TAIL_BYTES + 12345}, 65)); process.stderr.write('TAIL');`);
    const stored = readFileSync(join(directory, 'diagnostics/webkit.stderr.log'));
    assert.equal(result.receipt.exit.code, 0);
    assert.equal(result.stderr.length, STDERR_TAIL_BYTES + 12349);
    assert.equal(stored.length, STDERR_TAIL_BYTES);
    assert.deepEqual(stored, result.stderr.subarray(-STDERR_TAIL_BYTES));
    assert.deepEqual(result.receipt.stderr, { maximumRetainedBytes: STDERR_TAIL_BYTES, totalBytes: result.stderr.length, retainedBytes: STDERR_TAIL_BYTES, truncated: true });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('unavailable Linux probes and unsupported platforms are explicit and do not hide child failure', async () => {
  const directory = temporary();
  try {
    const result = await invoke(directory, 'process.exitCode=7;');
    assert.equal(result.receipt.exit.code, 7);
    for (const snapshot of [result.receipt.before, result.receipt.after]) {
      assert.equal(snapshot.status, 'collected');
      assert.equal(snapshot.memory.status, 'unavailable');
      assert.equal(snapshot.processCgroup.error, 'ENOENT');
      assert.equal(snapshot.sharedMemory.status, 'unavailable');
      assert.ok(Object.values(snapshot.cgroupV2).every(value => value.status === 'unavailable'));
    }
    assert.deepEqual(snapshotResources({ platform: 'unsupported' }).status, 'unsupported');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('diagnostic write failures leave successful and failed child statuses intact', async () => {
  const directory = temporary();
  try {
    const blocked = join(directory, 'not-a-directory'); writeFileSync(blocked, 'file');
    for (const code of [0, 7]) {
      const result = await invoke(directory, `process.stdout.write('executed'); process.exitCode=${code};`, { diagnosticDirectory: blocked });
      assert.equal(result.receipt.exit.code, code);
      assert.equal(result.stdout.toString(), 'executed');
      assert.ok(result.receipt.diagnosticErrors.length > 0);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the CLI refuses arbitrary commands and additional arguments', () => {
  const script = fileURLToPath(new URL('./run-browser-check.mjs', import.meta.url));
  for (const args of [[], ['other'], ['webkit', '--workers=1']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected browser mode/);
    assert.equal(result.stdout, '');
  }
});

test('all allowed CLI modes invoke the installed runner with the existing test arguments', () => {
  const directory = temporary();
  try {
    mkdirSync(join(directory, 'scripts/lib'), { recursive: true });
    mkdirSync(join(directory, 'node_modules/@playwright/test'), { recursive: true });
    const script = join(directory, 'scripts/run-browser-check.mjs');
    writeFileSync(script, readFileSync(new URL('./run-browser-check.mjs', import.meta.url)));
    writeFileSync(join(directory, 'scripts/lib/browser-library-evidence.mjs'), readFileSync(new URL('./lib/browser-library-evidence.mjs', import.meta.url)));
    writeFileSync(join(directory, 'node_modules/@playwright/test/cli.js'), 'process.stdout.write(JSON.stringify({args:process.argv.slice(2),debug:process.env.DEBUG}));');
    for (const mode of ['onboarding', 'chromium', 'webkit']) {
      const result = spawnSync(process.execPath, [script, mode], { encoding: 'utf8', cwd: directory, timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        args: ['test', ...(mode === 'onboarding' ? ['tests/onboarding-form-validation.spec.mjs'] : []),
          `--project=${mode === 'onboarding' ? 'webkit' : mode}`, '--reporter=line,json', `--output=test-results/${mode === 'onboarding' ? 'onboarding' : 'browser'}`],
        debug: 'pw:browser',
      });
      const receipt = JSON.parse(readFileSync(join(directory, 'playwright-report/browser-process', `${mode}.json`)));
      assert.equal(receipt.mode, mode);
      assert.equal(receipt.exit.code, 0);
      assert.equal(receipt.stderr.totalBytes, 0);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function fakeProcess(procRoot, pid, parentPid, { start = '900', role = 'node', threads = [[pid, []]], maps = '' } = {}) {
  const directory = join(procRoot, String(pid));
  mkdirSync(directory, { recursive: true });
  const fields = ['S', String(parentPid), ...Array(17).fill('0'), start];
  writeFileSync(join(directory, 'stat'), `${pid} (PRIVATE_PROCESS_NAME) ${fields.join(' ')}\n`);
  writeFileSync(join(directory, 'maps'), maps);
  writeFileSync(join(directory, 'cmdline'), 'PRIVATE_ARGUMENTS');
  writeFileSync(join(directory, 'environ'), 'PRIVATE_ENVIRONMENT');
  symlinkSync(`/usr/bin/${role}`, join(directory, 'exe'));
  for (const [tid, children] of threads) {
    mkdirSync(join(directory, 'task', String(tid)), { recursive: true });
    writeFileSync(join(directory, 'task', String(tid), 'children'), children.join(' ') + '\n');
  }
  return directory;
}

function fakeLibrary(processDirectory, { contents = 'controlled library fixture\n', name = 'libsoup-3.0.so.0.7.4', inode, deleted = false } = {}) {
  const libraryPath = `/usr/lib/${name}`, file = join(processDirectory, 'root', libraryPath);
  mkdirSync(join(processDirectory, 'root/usr/lib'), { recursive: true });
  writeFileSync(file, contents);
  const stat = statSync(file, { bigint: true });
  const major = ((stat.dev & 0x00000000000fff00n) >> 8n) | ((stat.dev & 0xfffff00000000000n) >> 32n);
  const minor = (stat.dev & 0x00000000000000ffn) | ((stat.dev & 0x00000ffffff00000n) >> 12n);
  const mapping = `1000-2000 r-xp 00000000 ${major.toString(16)}:${minor.toString(16)} ${inode || stat.ino} ${libraryPath}${deleted ? ' (deleted)' : ''}\n`;
  writeFileSync(join(processDirectory, 'maps'), mapping + '3000-4000 r--p 00000000 00:00 0 /private/UNRELATED_MAPPING\n');
  return { file, mapping, libraryPath, contents, sha256: createHash('sha256').update(contents).digest('hex') };
}

test('Linux device identity keeps high major bits out of the minor number', () => {
  // Independent glibc/os.makedev vectors; ordinary low-major devices do not catch this bug.
  assert.equal(linuxDeviceNumber(0x126789aa345bcn), '12345:6789aabc');
  assert.equal(linuxDeviceNumber(0xab123456cde78n), 'abcde:12345678');
  assert.equal(linuxDeviceNumber(0x801n), '8:1');
});

test('library sampling follows all thread children and retains only verified descendant libsoup mappings', () => {
  const directory = temporary();
  try {
    fakeProcess(directory, 100, 1, { threads: [[100, []], [110, [200, 400]]] });
    const child = fakeProcess(directory, 200, 100, { role: 'WebKitNetworkProcess' });
    const expected = fakeLibrary(child);
    // A listed PID with a different parent and an unlisted process are both excluded.
    fakeLibrary(fakeProcess(directory, 400, 1), { contents: 'PRIVATE_UNRELATED_FILE' });
    fakeLibrary(fakeProcess(directory, 500, 1), { contents: 'PRIVATE_UNLISTED_FILE' });
    const result = sampleLoadedLibraries({ rootPid: 100, procRoot: directory });
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    assert.equal(record.process.pid, 200);
    assert.equal(record.process.role, 'WebKitNetworkProcess');
    assert.deepEqual(record.lineage.map(item => item.pid), [100, 200]);
    assert.equal(record.mapping.path, expected.libraryPath);
    assert.equal(record.backingFile.status, 'verified');
    assert.equal(record.backingFile.sha256, expected.sha256);
    assert.equal(record.backingFile.sizeBytes, Buffer.byteLength(expected.contents));
    assert.equal(result.networkProcessesObserved, 1);
    assert.ok(result.issues.some(item => item.code === 'PARENT_CHANGED'));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|UNRELATED_MAPPING|cmdline|environ/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a replaced pathname, deleted mapping, or oversized file never produces a mapped-library hash', () => {
  const directory = temporary();
  try {
    fakeProcess(directory, 100, 1, { threads: [[100, [200, 300, 400]]] });
    fakeLibrary(fakeProcess(directory, 200, 100), { inode: '999999999999' });
    fakeLibrary(fakeProcess(directory, 300, 100), { deleted: true });
    fakeLibrary(fakeProcess(directory, 400, 100), { contents: 'x'.repeat(100) });
    const result = sampleLoadedLibraries({ rootPid: 100, procRoot: directory, limits: { libraryBytes: 64 } });
    assert.deepEqual(result.records.map(record => record.backingFile.error), ['MAPPED_FILE_MISMATCH', 'DELETED_MAPPING', 'LIBRARY_SIZE_LIMIT']);
    assert.ok(result.records.every(record => record.backingFile.status === 'unavailable' && !('sha256' in record.backingFile)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PID reuse and missing proc access are explicit and cannot inspect a replacement root', () => {
  const directory = temporary();
  try {
    fakeLibrary(fakeProcess(directory, 100, 1, { start: '901' }));
    const reused = sampleLoadedLibraries({ rootPid: 100, expectedRootStartTimeTicks: '900', procRoot: directory });
    assert.equal(reused.records.length, 0);
    assert.equal(reused.processesExamined, 0);
    assert.ok(reused.issues.some(item => item.code === 'ROOT_PROCESS_CHANGED'));
    const unrelated = sampleLoadedLibraries({ rootPid: 100, expectedRootParentPid: 2, procRoot: directory });
    assert.equal(unrelated.records.length, 0);
    assert.ok(unrelated.issues.some(item => item.code === 'ROOT_PARENT_CHANGED'));
    const missing = sampleLoadedLibraries({ rootPid: 200, procRoot: directory });
    assert.equal(missing.records.length, 0);
    assert.ok(missing.issues.some(item => item.stage === 'root-sample' && item.code === 'ENOENT'));
    const unsupported = startLibraryEvidence({ rootPid: 100, platform: 'unsupported' }).stop();
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(unsupported.samples, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function withFilesystemFault({ path, when, change }, inspect) {
  const original = { openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync }, descriptors = new Map();
  let fired = false;
  fs.openSync = (name, ...args) => {
    if (!fired && String(name) === path && when === 'open') { fired = true; change(); }
    const fd = original.openSync(name, ...args); descriptors.set(fd, String(name)); return fd;
  };
  fs.readSync = (fd, ...args) => {
    if (!fired && descriptors.get(fd) === path && when === 'before-read') { fired = true; change(); }
    const count = original.readSync(fd, ...args);
    if (!fired && count > 0 && descriptors.get(fd) === path && when === 'after-read') { fired = true; change(); }
    return count;
  };
  fs.closeSync = fd => { descriptors.delete(fd); return original.closeSync(fd); };
  syncBuiltinESMExports();
  try { const result = inspect(); assert.equal(fired, true, 'The actual filesystem operation must encounter the injected race'); return result; }
  finally { Object.assign(fs, original); syncBuiltinESMExports(); }
}

test('a replacement process pathname is discarded when identity changes while reading maps', () => {
  const directory = temporary();
  try {
    fakeProcess(directory, 100, 1, { threads: [[100, [200]]] });
    const child = fakeProcess(directory, 200, 100, { role: 'WebKitNetworkProcess' });
    const library = fakeLibrary(child);
    const result = withFilesystemFault({ path: join(child, 'maps'), when: 'before-read', change() {
      writeFileSync(join(child, 'stat'), readFileSync(join(child, 'stat'), 'utf8').replace(/900\n$/, '901\n'));
      writeFileSync(join(child, 'maps'), library.mapping.replace(library.libraryPath, '/REPLACEMENT_PRIVATE_PATH/libsoup-3.0.so.0.7.4'));
    } }, () => sampleLoadedLibraries({ rootPid: 100, procRoot: directory }));
    assert.equal(result.records.length, 0);
    assert.ok(result.issues.some(item => item.code === 'PROCESS_CHANGED'));
    assert.doesNotMatch(JSON.stringify(result), /REPLACEMENT_PRIVATE_PATH|libsoup-3\.0/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const during of ['hash', 'unavailable-hash']) test(`mapping provenance is discarded when a process disappears during ${during}`, () => {
  const directory = temporary();
  try {
    fakeProcess(directory, 100, 1, { threads: [[100, [200]]] });
    const child = fakeProcess(directory, 200, 100), library = fakeLibrary(child);
    const result = withFilesystemFault({ path: library.file, when: during === 'hash' ? 'after-read' : 'open', change() {
      rmSync(join(child, 'stat'));
      if (during === 'unavailable-hash') rmSync(library.file);
    } }, () => sampleLoadedLibraries({ rootPid: 100, procRoot: directory }));
    assert.equal(result.records.length, 0);
    assert.ok(result.issues.some(item => item.stage === 'mapping-provenance' && item.code === 'ENOENT'));
    assert.doesNotMatch(JSON.stringify(result), /libsoup-3\.0/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('worker receipts distinguish missing evidence and the headless WPE network process while preserving child failure', { timeout: 15_000, skip: process.platform !== 'linux' ? 'Linux /proc evidence' : false }, async () => {
  for (const state of ['complete', 'missing-children', 'capped', 'wpe-network']) {
    const directory = temporary();
    let child, collector;
    try {
      child = spawn(process.execPath, ['-e', 'process.stdin.once("data",()=>process.stdout.write("closed",()=>process.exit(7)));'], { stdio: ['pipe', 'pipe', 'pipe'] });
      const finished = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolveExit({ code, signal })); });
      const stdout = collect(); child.stdout.pipe(stdout.stream);
      const root = fakeProcess(directory, child.pid, process.pid, { role: state === 'wpe-network' ? 'WPENetworkProcess' : 'node', threads: state === 'missing-children' ? [] : [[child.pid, state === 'capped' ? [900001] : []]] });
      assert.ok(existsSync(join(root, 'maps')));
      if (state === 'wpe-network') fakeLibrary(root);
      if (state === 'capped') fakeProcess(directory, 900001, child.pid);
      collector = startLibraryEvidence({ rootPid: child.pid, procRoot: directory, limits: { intervalMs: 25, ...(state === 'capped' ? { processes: 1 } : {}) } });
      const deadline = Date.now() + 5000;
      while (collector.snapshot().samples === 0 && collector.snapshot().status === 'collecting' && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 20));
      const snapshot = collector.snapshot();
      assert.ok(snapshot.samples > 0, JSON.stringify(snapshot));
      assert.ok(snapshot.mapsRead > 0, JSON.stringify(snapshot));
      child.stdin.end('finish');
      assert.deepEqual(await finished, { code: 7, signal: null });
      const receipt = collector.stop();
      assert.equal(stdout.bytes().toString(), 'closed');
      assert.equal(receipt.status, state === 'wpe-network' ? 'observed' : state === 'complete' ? 'not_observed' : 'unavailable', JSON.stringify(receipt));
      assert.equal(receipt.records.length, state === 'wpe-network' ? 1 : 0);
      if (state === 'wpe-network') {
        assert.equal(receipt.verifiedNetworkLibraries, 1);
        assert.equal(receipt.records[0].process.role, 'WPENetworkProcess');
        assert.equal(receipt.stopReason, 'verified_network_library');
      }
      if (state === 'missing-children') assert.ok(receipt.issues.some(item => item.code === 'ENOENT'));
      if (state === 'capped') assert.equal(receipt.limited, true);
    } finally { collector?.stop(); if (child?.exitCode === null) child.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('process, task, read and maps bounds are enforced without treating truncated evidence as complete', () => {
  const directory = temporary();
  try {
    fakeProcess(directory, 100, 1, { threads: [[100, [200]], [110, [300]]] });
    const child = fakeProcess(directory, 200, 100);
    fakeLibrary(child);
    fakeLibrary(fakeProcess(directory, 300, 100));
    const processes = sampleLoadedLibraries({ rootPid: 100, procRoot: directory, limits: { processes: 1 } });
    assert.equal(processes.processesExamined, 1);
    assert.equal(processes.records.length, 0);
    assert.equal(processes.limited, true);
    const tasks = sampleLoadedLibraries({ rootPid: 100, procRoot: directory, limits: { tasksPerProcess: 1 } });
    assert.equal(tasks.limited, true);
    assert.ok(tasks.issues.some(item => item.code === 'TASK_LIMIT'));
    const reads = sampleLoadedLibraries({ rootPid: 100, procRoot: directory, limits: { procReads: 2 } });
    assert.ok(reads.procReads <= 2);
    assert.equal(reads.limited, true);
    const maps = sampleLoadedLibraries({ rootPid: 200, procRoot: directory, limits: { mapsBytes: 32 } });
    assert.equal(maps.records.length, 0);
    assert.equal(maps.limited, true);
    assert.ok(maps.issues.some(item => item.code === 'TRUNCATED'));
    assert.equal(LIBRARY_EVIDENCE_LIMITS.records, 16);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the real worker hashes a live descendant mmap and excludes a similarly mapped sibling', { timeout: 15_000, skip: process.platform !== 'linux' ? 'Linux /proc evidence' : false }, async context => {
  if (!existsSync(`/proc/${process.pid}/task/${process.pid}/children`)) return context.skip('This sandbox does not expose /proc thread children; descendant coverage remains in the native Linux CI lane');
  if (spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 2000 }).status !== 0) return context.skip('python3 is required for the controlled real mmap fixture');
  const directory = temporary();
  let sibling;
  const source = `import mmap, os, sys, time\nf = open(sys.argv[1], 'rb')\nm = mmap.mmap(f.fileno(), 0, prot=mmap.PROT_READ | mmap.PROT_EXEC)\nprint('mapped', flush=True)\ntime.sleep(float(sys.argv[2]))\nsys.exit(7)\n`;
  try {
    const descendantPath = join(directory, 'descendant/libsoup-3.0.so.0.7.4'), siblingPath = join(directory, 'sibling/libsoup-3.0.so.0.7.4');
    mkdirSync(join(directory, 'descendant')); mkdirSync(join(directory, 'sibling'));
    const contents = Buffer.alloc(4096, 65);
    writeFileSync(descendantPath, contents); writeFileSync(siblingPath, Buffer.alloc(4096, 66));
    sibling = spawn('python3', ['-u', '-c', source, siblingPath, '10'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolveReady, reject) => { sibling.stdout.once('data', resolveReady); sibling.once('error', reject); sibling.once('close', () => reject(new Error('Sibling mmap fixture exited before readiness'))); });
    const result = await invoke(directory, `const {spawn}=require('node:child_process');const child=spawn('python3',${JSON.stringify(['-u', '-c', source, descendantPath, '0.8'])},{stdio:['ignore','inherit','inherit']});child.on('error',()=>process.exitCode=1);child.on('exit',code=>process.exitCode=code);`, {
      probeOptions: {}, libraryProbeOptions: { limits: { intervalMs: 25 } },
    });
    assert.equal(result.receipt.exit.code, 7);
    assert.equal(result.stdout.toString(), 'mapped\n');
    assert.equal(result.stderr.length, 0);
    const libraries = result.receipt.libraries;
    assert.equal(libraries.status, 'observed', JSON.stringify(libraries));
    assert.equal(libraries.stopReason, 'child_closed');
    const record = libraries.records.find(item => item.mapping.path === descendantPath);
    assert.ok(record, JSON.stringify(libraries));
    assert.equal(record.backingFile.status, 'verified');
    assert.equal(record.backingFile.sha256, createHash('sha256').update(contents).digest('hex'));
    assert.equal(record.lineage.length, 2);
    assert.equal(record.process.parentPid, record.lineage[0].pid);
    assert.ok(libraries.records.every(item => item.mapping.path !== siblingPath));
    assert.equal(libraries.verifiedNetworkLibraries, 0, 'A Python mmap fixture does not establish WebKit network-process evidence');
    const snapshot = JSON.stringify(libraries);
    await new Promise(resolveWait => setTimeout(resolveWait, 75));
    assert.equal(JSON.stringify(libraries), snapshot, 'Stopped workers cannot mutate the final receipt');
  } finally { if (sibling?.exitCode === null) sibling.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); }
});

test('the real worker records a live root mapping and stops without changing the child result', { timeout: 10_000, skip: process.platform !== 'linux' ? 'Linux /proc evidence' : false }, async context => {
  if (spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 2000 }).status !== 0) return context.skip('python3 is required for the controlled real mmap fixture');
  const directory = temporary();
  try {
    const library = join(directory, 'libsoup-3.0.so.0.7.4'), contents = Buffer.alloc(4096, 72);
    writeFileSync(library, contents);
    const stdout = collect(), stderr = collect();
    const receipt = await runProcessWithDiagnostics({ command: 'python3', args: ['-u', '-c',
      `import mmap, sys, time\nf = open(sys.argv[1], 'rb')\nm = mmap.mmap(f.fileno(), 0, prot=mmap.PROT_READ | mmap.PROT_EXEC)\nprint('live root mapping', flush=True)\ntime.sleep(0.8)\nsys.exit(7)\n`, library], mode: 'webkit', cwd: directory,
      diagnosticDirectory: join(directory, 'diagnostics'), libraryProbeOptions: { limits: { intervalMs: 25 } }, stdout: stdout.stream, stderr: stderr.stream });
    assert.deepEqual(receipt.exit, { code: 7, signal: null, spawnError: null });
    assert.equal(stdout.bytes().toString(), 'live root mapping\n');
    assert.equal(stderr.bytes().length, 0);
    assert.equal(receipt.libraries.status, 'observed', JSON.stringify(receipt.libraries));
    const record = receipt.libraries.records.find(item => item.mapping.path === library);
    assert.ok(record, JSON.stringify(receipt.libraries));
    assert.equal(record.lineage.length, 1);
    assert.equal(record.backingFile.status, 'verified');
    assert.equal(record.backingFile.sha256, createHash('sha256').update(contents).digest('hex'));
    assert.equal(receipt.libraries.verifiedNetworkLibraries, 0);
    assert.equal(receipt.libraries.stopReason, 'child_closed');
    const snapshot = JSON.stringify(receipt.libraries);
    await new Promise(resolveWait => setTimeout(resolveWait, 75));
    assert.equal(JSON.stringify(receipt.libraries), snapshot);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
