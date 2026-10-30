import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function migrationInventory() {
  return ['db/schema.sql', ...['db/migrations', 'supabase/migrations'].flatMap(directory => readdirSync(resolve(root, directory)).filter(name => name.endsWith('.sql')).sort().map(name => `${directory}/${name}`))].map(path => ({ path, version: path.startsWith('supabase/migrations/') ? path.split('/').at(-1).split('_')[0] : null, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') }));
}
export function checkCoverage(ledger, inventory = migrationInventory()) {
  if (!Array.isArray(ledger) || ledger.some(row => !row || typeof row !== 'object' || Array.isArray(row) || typeof row.version !== 'string' || !/^\d{14}$/.test(row.version))) throw new Error('Expected a JSON array of migration rows with 14-digit string versions');
  const recorded = new Set(ledger.map(row => row.version));
  const required = inventory.filter(row => row.version);
  const missing = required.filter(row => !recorded.has(row.version));
  return { status: missing.length ? 'missing_required_versions' : 'required_versions_recorded', missing, recorded_required_count: required.length - missing.length, baseline_files_not_covered_by_ledger: inventory.filter(row => !row.version), limitations: ['Ledger presence does not prove deployed SQL matches these source hashes.', 'Verify archived baseline definitions, RLS and service-role grants before baseline adoption or feature activation; missing ledger entries do not authorize SQL replay.'] };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const inventory = migrationInventory();
  const ledgerPath = process.argv[2];
  if (!ledgerPath) {
    console.log(JSON.stringify({ status: 'production_not_verified', inventory, read_only_ledger_query: "select version::text from supabase_migrations.schema_migrations order by version;", instructions: 'Export the query rows as JSON and pass the file path. This tool never connects to or changes a database.' }, null, 2));
    process.exitCode = 2;
  } else {
    try {
      const result = checkCoverage(JSON.parse(readFileSync(resolve(ledgerPath), 'utf8')), inventory);
      console.log(JSON.stringify(result, null, 2));
      if (result.missing.length) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
