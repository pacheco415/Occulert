import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runNpmScript, runVerification } from './verify.mjs';

function plan(steps, additionalChecks = []) {
  return { steps, additionalChecks, excluded: [] };
}

test('real npm scripts keep Node flags and run sequentially after an earlier failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-verification-runner-'));
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, scripts: {
      'test:first': 'node --no-warnings fixture.mjs first 0',
      'test:failed': 'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON fixture.mjs failed 7',
      'test:last': 'node --test last.mjs',
    } }));
    writeFileSync(join(directory, 'fixture.mjs'), `import { appendFileSync } from 'node:fs';
      const [name, code] = process.argv.slice(2);
      const log = phase => appendFileSync('trace.jsonl', JSON.stringify({name, phase, flags: process.execArgv}) + '\\n');
      log('start');
      await new Promise(resolve => setTimeout(resolve, 20));
      log('end');
      process.exitCode = Number(code);
    `);
    writeFileSync(join(directory, 'last.mjs'), `import { appendFileSync } from 'node:fs';
      import test from 'node:test';
      test('last step runs', () => appendFileSync('trace.jsonl', JSON.stringify({name: 'last', phase: 'end', testContext: process.env.NODE_TEST_CONTEXT}) + '\\n'));
    `);
    const { scripts } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    // Production verification starts under npm, outside node:test. Avoid
    // inheriting this self-test's nested-test marker into the fixture runner.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = [];
    const result = await runVerification({ manifest: plan(['test:first', 'test:failed'], ['test:last']), scripts,
      runStep: name => runNpmScript(name, { cwd: directory, stdio: 'ignore', env }), write: line => output.push(line) });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.results.map(({ name, passed, code }) => ({ name, passed, code })), [
      { name: 'test:first', passed: true, code: 0 },
      { name: 'test:failed', passed: false, code: 7 },
      { name: 'test:last', passed: true, code: 0 },
    ]);
    const trace = readFileSync(join(directory, 'trace.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(trace.map(({ name, phase }) => [name, phase]), [
      ['first', 'start'], ['first', 'end'], ['failed', 'start'], ['failed', 'end'], ['last', 'end'],
    ]);
    assert.deepEqual(trace[0].flags, ['--no-warnings']);
    assert.deepEqual(trace[2].flags, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON']);
    assert.equal(trace[4].testContext, 'child-v8');
    assert.ok(result.results.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs > 0));
    assert.match(output.join('\n'), /\| PASS \| test:last \| \d+\.\d{2}s \|/);
    assert.match(output.join('\n'), /2 passed; 1 failed; 3 run/);
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('launch errors and signaled steps are reported, and remaining checks still execute', async () => {
  const calls = [], output = [];
  let time = 0;
  const result = await runVerification({ manifest: plan(['test:error', 'test:signal', 'test:ok']),
    scripts: { 'test:error': 'node a', 'test:signal': 'node b', 'test:ok': 'node c' },
    clock: () => time += 125,
    runStep: async name => {
      calls.push(name);
      if (name === 'test:error') throw new Error('fixture launch error');
      return name === 'test:signal' ? { code: null, signal: 'SIGTERM' } : { code: 0 };
    }, write: line => output.push(line) });
  assert.deepEqual(calls, ['test:error', 'test:signal', 'test:ok']);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.results.map(result => result.durationMs), [125, 125, 125]);
  assert.match(output.join('\n'), /fixture launch error/);
  assert.match(output.join('\n'), /signal SIGTERM/);
  assert.match(output.join('\n'), /1 passed; 2 failed; 3 run/);
});

test('an all-green plan returns zero, and invalid coverage launches no child', async () => {
  const result = await runVerification({ manifest: plan(['test:ok']), scripts: { 'test:ok': 'node fixture' },
    runStep: async () => ({ code: 0 }), write() {} });
  assert.equal(result.exitCode, 0);
  await assert.rejects(runVerification({ manifest: plan(['test:ok']),
    scripts: { 'test:ok': 'node fixture', 'audit:uncovered': 'node fixture' },
    runStep() { assert.fail('Invalid plans must not launch a child'); }, write() {} }), /audit:uncovered/);
});

test('the command-line runner exits nonzero after reporting all remaining steps', () => {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-verification-cli-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    copyFileSync(new URL('./verify.mjs', import.meta.url), join(directory, 'scripts/verify.mjs'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, scripts: {
      'test:failed': 'node -e "process.exitCode=4"',
      'test:following': 'node -e "console.log(\'following step executed\')"',
    } }));
    writeFileSync(join(directory, 'scripts/verify-steps.json'), JSON.stringify(plan(['test:failed', 'test:following'])));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [join(directory, 'scripts/verify.mjs')], {
      cwd: directory, env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /following step executed/);
    assert.match(result.stdout, /\| FAIL \| test:failed \| \d+\.\d{2}s \|/);
    assert.match(result.stdout, /\| PASS \| test:following \| \d+\.\d{2}s \|/);
    assert.match(result.stdout, /test:failed: exit 4/);
    assert.match(result.stdout, /1 passed; 1 failed; 2 run/);
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
