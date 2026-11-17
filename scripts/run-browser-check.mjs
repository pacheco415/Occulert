import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLibraryEvidence } from './lib/browser-library-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STDERR_TAIL_BYTES = 2 * 1024 * 1024;
const modes = Object.freeze({
  onboarding: ['tests/onboarding-form-validation.spec.mjs', '--project=webkit', '--reporter=line,json', '--output=test-results/onboarding'],
  chromium: ['--project=chromium', '--reporter=line,json', '--output=test-results/browser'],
  webkit: ['--project=webkit', '--reporter=line,json', '--output=test-results/browser'],
});
const cgroupFiles = ['memory.events', 'memory.events.local', 'memory.current', 'memory.peak', 'memory.max', 'pids.current', 'pids.max'];
const errorCode = error => typeof error?.code === 'string' ? error.code : 'UNAVAILABLE';

function readProbe(path, maximumBytes) {
  try {
    const bytes = readFileSync(path);
    return { status: 'available', text: bytes.subarray(0, maximumBytes).toString('utf8'), truncated: bytes.length > maximumBytes };
  } catch (error) { return { status: 'unavailable', error: errorCode(error) }; }
}

export function snapshotResources({ platform = process.platform, procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup', shmPath = '/dev/shm' } = {}) {
  const checkedAt = new Date().toISOString();
  if (platform !== 'linux') return { checkedAt, platform, status: 'unsupported', reason: 'Linux resource probes only' };
  let sharedMemory;
  try {
    const stats = statfsSync(shmPath, { bigint: true });
    sharedMemory = { status: 'available', totalBytes: String(stats.bsize * stats.blocks), freeBytes: String(stats.bsize * stats.bfree), availableBytes: String(stats.bsize * stats.bavail) };
  } catch (error) { sharedMemory = { status: 'unavailable', error: errorCode(error) }; }
  return {
    checkedAt, platform, status: 'collected',
    cgroupScope: 'Visible /sys/fs/cgroup mount root; ancestor and host counters may be unavailable',
    cgroupV2: Object.fromEntries(cgroupFiles.map(name => [name, readProbe(join(cgroupRoot, name), 4096)])),
    processCgroup: readProbe(join(procRoot, 'self/cgroup'), 16 * 1024),
    memory: readProbe(join(procRoot, 'meminfo'), 16 * 1024), sharedMemory,
  };
}

// The exported runner lets regressions exercise real child exits without launching a browser.
// The command-line entry point below accepts only the three fixed browser modes.
export async function runProcessWithDiagnostics({ command, args, mode, cwd = root, diagnosticDirectory = join(root, 'playwright-report/browser-process'), probeOptions, libraryProbeOptions, stdout = process.stdout, stderr = process.stderr }) {
  if (!Object.hasOwn(modes, mode)) throw new Error('Expected browser mode: onboarding, chromium or webkit');
  const receipt = {
    schema: 1, mode, startedAt: new Date().toISOString(), state: 'running',
    command: { executable: command, arguments: args }, debug: 'pw:browser',
    before: snapshotResources(probeOptions), after: null,
    exit: null, forwardedSignals: [],
    stderr: { maximumRetainedBytes: STDERR_TAIL_BYTES, totalBytes: 0, retainedBytes: 0, truncated: false },
    diagnosticErrors: [], libraries: null,
  };
  const save = (name, contents) => {
    try { mkdirSync(diagnosticDirectory, { recursive: true }); writeFileSync(join(diagnosticDirectory, name), contents); }
    catch (error) { receipt.diagnosticErrors.push({ file: name, error: errorCode(error) }); }
  };
  save(`${mode}.json`, JSON.stringify(receipt, null, 2) + '\n');
  let tail = Buffer.alloc(0), child, libraryEvidence;
  try {
    child = spawn(command, args, { cwd, env: { ...process.env, DEBUG: 'pw:browser' }, stdio: ['inherit', 'pipe', 'pipe'] });
  } catch (error) {
    receipt.exit = { code: 1, signal: null, spawnError: errorCode(error) };
  }
  if (child) {
    const forward = signal => {
      receipt.forwardedSignals.push(signal);
      child.kill(signal);
    };
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      child.stdout.pipe(stdout, { end: false });
      child.stderr.on('data', chunk => {
        receipt.stderr.totalBytes += chunk.length;
        tail = chunk.length >= STDERR_TAIL_BYTES ? Buffer.from(chunk.subarray(-STDERR_TAIL_BYTES))
          : Buffer.concat([tail.subarray(Math.max(0, tail.length + chunk.length - STDERR_TAIL_BYTES)), chunk]);
      });
      child.stderr.pipe(stderr, { end: false });
      libraryEvidence = startLibraryEvidence({ ...probeOptions, ...libraryProbeOptions, rootPid: child.pid });
      receipt.exit = await new Promise(resolveExit => {
        let spawnError = null;
        child.once('error', error => { spawnError = errorCode(error); });
        child.once('close', (code, signal) => resolveExit({ code: spawnError ? 1 : code, signal, spawnError }));
      });
    } finally {
      receipt.libraries = libraryEvidence?.stop() || null;
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  }
  if (!receipt.libraries) receipt.libraries = startLibraryEvidence({ ...probeOptions, rootPid: null }).stop();
  receipt.state = 'finished';
  receipt.finishedAt = new Date().toISOString();
  receipt.after = snapshotResources(probeOptions);
  receipt.stderr.retainedBytes = tail.length;
  receipt.stderr.truncated = receipt.stderr.totalBytes > tail.length;
  save(`${mode}.stderr.log`, tail);
  save(`${mode}.json`, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

export function finishWithChildStatus(receipt) {
  const { code, signal } = receipt.exit;
  if (signal) {
    // Restore the child's signal termination after the forwarding listeners are gone.
    process.exitCode = 128 + (constants.signals[signal] || 1);
    process.kill(process.pid, signal);
  } else process.exitCode = Number.isInteger(code) && code >= 0 ? code : 1;
}

export async function runBrowserCheck(mode) {
  if (!Object.hasOwn(modes, mode)) throw new Error('Expected browser mode: onboarding, chromium or webkit');
  return runProcessWithDiagnostics({ command: process.execPath, args: [join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...modes[mode]], mode });
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected browser mode: onboarding, chromium or webkit');
    finishWithChildStatus(await runBrowserCheck(process.argv[2]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
