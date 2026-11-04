import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProcessWithDiagnostics, snapshotResources, STDERR_TAIL_BYTES } from './run-browser-check.mjs';

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
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'node_modules/@playwright/test'), { recursive: true });
    const script = join(directory, 'scripts/run-browser-check.mjs');
    writeFileSync(script, readFileSync(new URL('./run-browser-check.mjs', import.meta.url)));
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
