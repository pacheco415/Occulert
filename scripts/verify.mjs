import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function validatePlan(manifest, scripts) {
  if (!manifest || !Array.isArray(manifest.steps) || !manifest.steps.length ||
      !Array.isArray(manifest.additionalChecks) || !Array.isArray(manifest.excluded)) {
    throw new Error('Verification manifest requires steps, additionalChecks, and excluded lists.');
  }
  const seen = new Set();
  function include(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][\w:.-]*$/.test(name) || name === 'verify') {
      throw new Error(`Invalid verification script name: ${JSON.stringify(name)}`);
    }
    if (!Object.hasOwn(scripts, name) || typeof scripts[name] !== 'string' || !scripts[name].trim()) {
      throw new Error(`Verification script is missing from package.json: ${name}`);
    }
    if (seen.has(name)) throw new Error(`Verification script is listed more than once: ${name}`);
    seen.add(name);
    return name;
  }
  const steps = manifest.steps.map(include);
  const additionalChecks = manifest.additionalChecks.map(include);
  for (const entry of manifest.excluded) {
    if (!entry || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error('Every excluded verification script requires a non-empty reason.');
    }
    include(entry.script);
  }
  const uncovered = Object.keys(scripts).filter(name => /^(?:test|audit):/.test(name) && !seen.has(name));
  if (uncovered.length) throw new Error(`Verification scripts need a manifest entry or exclusion reason: ${uncovered.join(', ')}`);
  return { steps, additionalChecks };
}

export function runNpmScript(name, { cwd = projectRoot, stdio = 'inherit', env = process.env } = {}) {
  // Invoke npm rather than reconstructing its script. Existing Node flags,
  // multi-command scripts, PATH setup, and lifecycle behavior stay intact.
  const npmPath = env.npm_execpath;
  const executable = npmPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = [...(npmPath ? [npmPath] : []), 'run', name];
  return new Promise(resolveResult => {
    const child = spawn(executable, args, {
      cwd, env, stdio, shell: !npmPath && process.platform === 'win32',
    });
    child.once('error', error => resolveResult({ code: null, error: error.message }));
    child.once('close', (code, signal) => resolveResult({ code, signal }));
  });
}

export async function runVerification({ manifest, scripts, runStep = runNpmScript,
  clock = () => performance.now(), write = line => console.log(line) }) {
  // Validate the complete plan before launching any step, so omitted tests or
  // a stale script name fail visibly instead of silently reducing coverage.
  const plan = validatePlan(manifest, scripts);
  write(`Verification: ${plan.steps.length} existing steps + ${plan.additionalChecks.length} runner self-checks.`);
  const results = [];
  for (const [kind, names] of [['step', plan.steps], ['self-check', plan.additionalChecks]]) {
    for (const name of names) {
      write(`\n[${results.length + 1}/${plan.steps.length + plan.additionalChecks.length}] ${name}${kind === 'self-check' ? ' (runner self-check)' : ''}`);
      const started = clock();
      let outcome;
      try { outcome = await runStep(name); }
      catch (error) { outcome = { code: null, error: error.message }; }
      const durationMs = Math.max(0, clock() - started);
      const passed = outcome?.code === 0 && !outcome.signal && !outcome.error;
      results.push({ name, kind, passed, durationMs, ...outcome });
    }
  }
  write('\nVerification results:');
  write('| Result | Script | Duration |');
  write('| --- | --- | ---: |');
  for (const result of results) {
    write(`| ${result.passed ? 'PASS' : 'FAIL'} | ${result.name} | ${(result.durationMs / 1000).toFixed(2)}s |`);
    if (!result.passed) write(`  ${result.name}: ${result.error || (result.signal ? `signal ${result.signal}` : `exit ${result.code ?? 'unknown'}`)}`);
  }
  const failed = results.filter(result => !result.passed);
  write(`\n${results.length - failed.length} passed; ${failed.length} failed; ${results.length} run.`);
  return { results, exitCode: failed.length ? 1 : 0 };
}

// macOS exposes temporary directories through /var and /private/var aliases.
// Resolve both paths so direct execution through a symlink still runs the CLI.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'scripts/verify-steps.json'), 'utf8'));
    const { scripts } = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    const result = await runVerification({ manifest, scripts });
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`Verification plan failed: ${error.message}`);
    process.exitCode = 1;
  }
}
