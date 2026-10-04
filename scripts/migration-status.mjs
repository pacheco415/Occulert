import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkCoverage, migrationInventory } from './check-migration-readiness.mjs';

// Fixed metadata query only: no data, schema changes or ledger repairs.
export const ledgerQuery = `BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT json_build_object('read_only', current_setting('transaction_read_only') = 'on',
  'ledger', coalesce(json_agg(json_build_object('version', version::text) ORDER BY version), '[]'::json))
FROM supabase_migrations.schema_migrations;
COMMIT;
`;

const dependencies = {
  '20260701000000': { routes: ['profile', 'sessions', 'events', 'fleets', 'fleet-summary', 'fleet-session-history', 'fleet-invitations', 'accept-invitation', 'fleet-followups', 'fleet-period-report', 'pilot-leads', 'account', 'billing-status', 'billing-checkout', 'billing-portal', 'billing-webhook'], purpose: 'Core tables, tenant read policies, invitation acceptance and durable pilot-lead rate limiting; adopted databases need catalog verification before baseline registration.' },
  '20260912170153': { routes: ['account'], purpose: 'Atomic account deletion foreign-key cleanup.' },
  '20260921040303': { routes: ['fleet-followups', 'fleet-summary', 'fleet-session-history', 'fleet-period-report'], purpose: 'Owner-scoped follow-up records and save function.' },
  '20260921042324': { routes: ['fleet-summary', 'fleet-session-history', 'fleet-period-report', 'fleet-invitations', 'account'], purpose: 'Query and foreign-key cleanup performance indexes; not an authorization gate.' },
  '20260926010000': { routes: ['fleet-invitations'], purpose: 'Atomic invitation creation and revocation.' },
  '20260926200000': { routes: ['sessions', 'fleet-summary', 'fleet-session-history'], purpose: 'Client-reported detector provenance fields.' },
  '20260927010000': { routes: ['fleet-period-report'], purpose: 'Complete owner-scoped 7/30-day aggregates.' },
  '20260927030000': { routes: ['billing-status', 'billing-checkout', 'billing-portal', 'billing-webhook'], purpose: 'Informational Stripe test-mode state and service-role functions; no live billing or entitlements.' },
  '20260929010000': { routes: ['billing-webhook'], purpose: 'Durable acknowledgment of ignored Stripe test webhook events.' },
};

export function statusReport(ledger, { inventory = migrationInventory(), source = 'offline_ledger_export' } = {}) {
  const canonical = inventory.filter(row => row.version);
  if (ledger === null) return { status: 'migration_status_unknown', source, applied: null, pending: null,
    migrations: canonical.map(row => ({ ...row, state: 'unknown' })),
    limitation: 'No successful ledger observation. Missing credentials, client, ledger or permissions are not evidence of pending/applied SQL.' };
  const coverage = checkCoverage(ledger, inventory);
  const recorded = new Set(ledger.map(row => row.version));
  const known = new Set(canonical.map(row => row.version));
  const migrations = canonical.map(row => ({ ...row, state: recorded.has(row.version) ? 'applied' : 'pending',
    dependent_api_routes: dependencies[row.version]?.routes.map(route => `/api/${route}`) ?? null,
    purpose: dependencies[row.version]?.purpose ?? 'Route dependencies have not been mapped for this migration.' }));
  return { status: coverage.status, source, applied: migrations.filter(row => row.state === 'applied'),
    pending: migrations.filter(row => row.state === 'pending'), remote_only_versions: [...recorded].filter(version => !known.has(version)).sort(),
    baseline_registration_requires_catalog_verification: !recorded.has('20260701000000'),
    limitations: [...coverage.limitations, 'Pending means absent from the ledger, not permission to replay SQL. This tool never applies, resets or repairs migrations.'] };
}

function unavailable(reason) { return Object.assign(new Error('Migration ledger observation unavailable'), { reason }); }

/** A URL explicitly supplied for this invocation is passed only to libpq's environment. */
export function readMigrationLedger({ databaseUrl, env = process.env, launch = spawn, timeoutMs = 10000 } = {}) {
  if (env.CI) return Promise.reject(unavailable('live_connection_disabled_in_ci'));
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || /[\r\n\u0000]/.test(databaseUrl)) throw Error();
  } catch { return Promise.reject(unavailable('database_url_missing_or_invalid')); }
  return new Promise((accept, reject) => {
    let child, settled = false, output = '', bytes = 0;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child?.kill('SIGKILL'); reject(error); }
      else accept(result);
    };
    const timer = setTimeout(() => finish(unavailable('ledger_observation_timed_out')), timeoutMs);
    try {
      child = launch('psql', ['-X', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1'], {
        shell: false, stdio: ['pipe', 'pipe', 'ignore'], env: { ...env,
          PGDATABASE: databaseUrl, PGCONNECT_TIMEOUT: '4', PGAPPNAME: 'occulert-read-only-migration-status',
          PGOPTIONS: '-c default_transaction_read_only=on', },
      });
      child.once('error', () => finish(unavailable('postgres_client_unavailable')));
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) return finish(unavailable('ledger_response_too_large'));
        output += chunk.toString('utf8');
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        if (code !== 0 || signal) return finish(unavailable('ledger_query_failed'));
        try {
          const result = JSON.parse(output.trim());
          if (result?.read_only !== true) throw Error();
          checkCoverage(result.ledger);
          finish(null, result.ledger);
        } catch { finish(unavailable('invalid_ledger_response')); }
      });
      child.stdin.once('error', () => finish(unavailable('ledger_query_failed')));
      child.stdin.end(ledgerQuery);
    } catch { finish(unavailable('postgres_client_unavailable')); }
  });
}

export async function runStatus({ args = [], env = process.env, observe = readMigrationLedger } = {}) {
  if (args.length === 1 && args[0] === '--help') return { code: 0, report: { usage: 'node scripts/migration-status.mjs [--ledger path/to/export.json]',
    instructions: 'With no arguments, explicitly provide a read-only DATABASE_URL and installed psql. Live observation is disabled in CI. No database writes or credentials are printed.' } };
  try {
    let ledger, source;
    if (args.length === 2 && args[0] === '--ledger') {
      if (statSync(resolve(args[1])).size > 1024 * 1024) throw unavailable('ledger_export_too_large');
      ledger = JSON.parse(readFileSync(resolve(args[1]), 'utf8'));
      source = 'offline_ledger_export';
    } else if (args.length === 0) {
      // Refuse CI before invoking even an injected transport.
      if (env.CI) throw unavailable('live_connection_disabled_in_ci');
      ledger = await observe({ databaseUrl: env.DATABASE_URL, env });
      source = 'read_only_database_ledger';
    } else throw unavailable('invalid_arguments');
    const report = statusReport(ledger, { source });
    return { code: report.pending.length ? 1 : 0, report };
  } catch (error) {
    return { code: 2, report: { ...statusReport(null, { source: 'unavailable' }), reason: error.reason || 'invalid_or_unavailable_ledger_evidence' } };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { code, report } = await runStatus({ args: process.argv.slice(2) });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = code;
}
