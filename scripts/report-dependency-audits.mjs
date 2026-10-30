import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, process.argv[2] || 'dependency-reports');
mkdirSync(destination, { recursive: true });
const run = (args, cwd = root) => spawnSync('npm', args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
const npmVersion = run(['--version']);
if (npmVersion.status !== 0) throw new Error('Cannot determine npm version');
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (revision.status !== 0) throw new Error('Cannot determine source revision');
const receipt = { schema: 1, checked_at: new Date().toISOString(), revision: revision.stdout.trim(), node: process.version, npm: npmVersion.stdout.trim(), reports: [] };
let failed = false;
for (const [label, subdirectory, omitDev] of [['site-all', '.', false], ['native-all', 'native-app', false], ['native-production-tree', 'native-app', true]]) {
  const cwd = resolve(root, subdirectory);
  const result = run(['audit', '--json', ...(omitDev ? ['--omit=dev'] : [])], cwd);
  let report;
  try { report = JSON.parse(result.stdout); } catch { /* A network/process error is not a clean audit. */ }
  const usable = [0, 1].includes(result.status) && !result.error && report && !report.error && report.metadata?.vulnerabilities && report.vulnerabilities && typeof report.vulnerabilities === 'object';
  const lock_sha256 = createHash('sha256').update(readFileSync(resolve(cwd, 'package-lock.json'))).digest('hex');
  if (!usable) {
    failed = true;
    receipt.reports.push({ label, lock_sha256, status: 'unavailable' });
    console.error(`${label}: audit unavailable; no clean result claimed`);
    continue;
  }
  writeFileSync(resolve(destination, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
  receipt.reports.push({ label, lock_sha256, status: 'checked', counts: report.metadata.vulnerabilities });
  console.log(`${label}: ${JSON.stringify(report.metadata.vulnerabilities)}`);
}
writeFileSync(resolve(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
if (failed) process.exitCode = 1;
