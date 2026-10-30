import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { deploymentDecision } from './ignore-vercel-deployment.mjs';

const script = fileURLToPath(new URL('./ignore-vercel-deployment.mjs', import.meta.url));
test('ignored build command stays within the Vercel configuration schema limit', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.equal(typeof config.ignoreCommand, 'string');
  assert.ok(config.ignoreCommand.length <= 256, 'Vercel limits ignoreCommand to 256 characters');
  assert.deepEqual(config.git.deploymentEnabled, { 'dependabot/**': false });
});
function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'occulert-deploy-ignore-'));
  const git = (...args) => execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
  const write = (path, data = 'Changed') => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), data); };
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'); return git('rev-parse', 'HEAD'); };
  try { git('init', '-q'); write('.vercelignore', 'docs/\nnative-app/\nscripts/\ntests/\nbenchmark/\nsupabase/\ndb/\n.github/\n*.md\nasset-size-budgets.json\n'); const base = commit(); run({ cwd, git, write, commit, base }); }
  finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

for (const path of ['docs/guide.md', 'native-app/app/monitor.tsx', '.github/workflows/site-audit.yml', 'asset-size-budgets.json']) {
  test(`${path} alone skips deployment`, () => fixture(({ cwd, write, commit, base }) => { write(path); commit(); assert.equal(deploymentDecision({ cwd, base }).skip, true); }));
}
for (const path of ['app.html', 'api/sessions.js', 'package-lock.json', 'vercel.json']) {
  test(`${path} and a documentation change require deployment`, () => fixture(({ cwd, write, commit, base }) => { write(path); write('docs/guide.md'); commit(); assert.equal(deploymentDecision({ cwd, base }).skip, false); }));
}
test('compares every commit since the deployed revision, not only HEAD parent', () => fixture(({ cwd, write, commit, base }) => {
  write('app.html'); commit(); write('docs/guide.md'); commit(); assert.equal(deploymentDecision({ cwd, base }).skip, false);
}));
test('missing, malformed and unavailable baselines require deployment', () => fixture(({ cwd }) => {
  for (const base of [undefined, 'HEAD^', 'f'.repeat(40)]) assert.equal(deploymentDecision({ cwd, base }).skip, false);
}));
test('rename from ignored directory into the public site requires deployment', () => fixture(({ cwd, write, commit }) => {
  write('docs/guide.md'); const base = commit(); renameSync(join(cwd, 'docs/guide.md'), join(cwd, 'guide.html')); commit(); assert.equal(deploymentDecision({ cwd, base }).skip, false);
}));
test('exclusion-policy or ignore-script changes require deployment', () => fixture(({ cwd, write, commit, base }) => {
  write('scripts/ignore-vercel-deployment.mjs'); commit(); assert.equal(deploymentDecision({ cwd, base }).skip, false);
  write('.vercelignore', '*\n'); commit(); assert.equal(deploymentDecision({ cwd, base }).skip, false);
}));
test('the configured Git-source command works even when excluded scripts are absent on disk', () => fixture(({ cwd, write, commit }) => {
  write('scripts/ignore-vercel-deployment.mjs', readFileSync(script)); const base = commit();
  write('docs/guide.md'); commit(); rmSync(join(cwd, 'scripts'), { recursive: true });
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  const r = spawnSync(config.ignoreCommand, { cwd, shell: true, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const missing = spawnSync(config.ignoreCommand, { cwd, shell: true, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: '' }, encoding: 'utf8' });
  assert.equal(missing.status, 1, 'an absent history must continue deployment');
}));
