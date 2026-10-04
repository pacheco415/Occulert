import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { migrationInventory } from './check-migration-readiness.mjs';
import { ledgerQuery, readMigrationLedger, runStatus, statusReport } from './migration-status.mjs';

test('ledger reports pending routes and baseline adoption without inventing deployed definitions', () => {
  const versions = migrationInventory().filter(row => row.version).map(({ version }) => ({ version }));
  const partial = statusReport(versions.filter(row => !['20260701000000', '20260927010000'].includes(row.version)));
  assert.equal(partial.pending.length, 2);
  assert.deepEqual(partial.pending.find(row => row.version === '20260927010000').dependent_api_routes, ['/api/fleet-period-report']);
  assert.equal(partial.baseline_registration_requires_catalog_verification, true);
  const complete = statusReport([...versions, { version: '20260930000000' }]);
  assert.equal(complete.pending.length, 0);
  assert.deepEqual(complete.remote_only_versions, ['20260930000000']);
  assert.match(complete.limitations.join(' '), /not permission to replay SQL/);
  assert.throws(() => statusReport([{ version: 20260701000000 }]));
  assert.equal(statusReport(null).pending, null);
});

test('fixed ledger SQL observes an actual catalog in a read-only transaction and refuses writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);
      insert into supabase_migrations.schema_migrations values ('20260927010000'),('20260701000000');`);
    const results = await db.exec(ledgerQuery);
    const observation = results.find(result => result.rows.length)?.rows[0].json_build_object;
    assert.equal(observation.read_only, true);
    assert.deepEqual(observation.ledger, [{ version: '20260701000000' }, { version: '20260927010000' }]);
    await db.exec('begin transaction read only');
    await assert.rejects(db.exec(`insert into supabase_migrations.schema_migrations values ('20261001000000')`), /read-only transaction/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as count from supabase_migrations.schema_migrations')).rows[0].count, 2);
  } finally { await db.close(); }
});

test('real child transport uses fixed stdin, no startup files/password prompt, and hides credentials on failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-ledger-'));
  const url = 'postgresql://readonly:fixture-secret@database.invalid:5432/postgres';
  const fixture = join(directory, 'client.mjs'), capture = join(directory, 'query.sql');
  writeFileSync(fixture, `import {writeFileSync} from 'node:fs';
    let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',chunk=>input+=chunk);
    process.stdin.on('end',()=>{writeFileSync(process.env.CAPTURE,input);
      if(process.env.MODE==='fail'){console.error(process.env.PGDATABASE);process.exitCode=1;return;}
      if(process.env.MODE==='huge'){process.stdout.write('x'.repeat(1024*1024+1));return;}
      if(process.env.MODE==='hang'){setInterval(()=>{},1000);return;}
      console.log(JSON.stringify({read_only:process.env.MODE!=='not_readonly',ledger:[{version:'20260701000000'}]}));});`);
  let invocation;
  const launch = (executable, args, options) => { invocation = { executable, args, options }; return spawn(process.execPath, [fixture, ...args], options); };
  const env = { ...process.env, CI: '', CAPTURE: capture };
  try {
    assert.deepEqual(await readMigrationLedger({ databaseUrl: url, env, launch }), [{ version: '20260701000000' }]);
    assert.equal(readFileSync(capture, 'utf8'), ledgerQuery);
    assert.equal(invocation.executable, 'psql');
    assert.ok(invocation.args.includes('-X') && invocation.args.includes('--no-password') && invocation.args.includes('--set=ON_ERROR_STOP=1'));
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.env.PGDATABASE, url);
    assert.ok(!JSON.stringify(invocation.args).includes('fixture-secret'));
    for (const [mode, reason] of [['fail', 'ledger_query_failed'], ['not_readonly', 'invalid_ledger_response'], ['huge', 'ledger_response_too_large'], ['hang', 'ledger_observation_timed_out']]) {
      const result = await runStatus({ env: { ...env, DATABASE_URL: url }, observe: () => readMigrationLedger({ databaseUrl: url, env: { ...env, MODE: mode }, launch, timeoutMs: mode === 'hang' ? 300 : 10000 }) });
      assert.equal(result.code, 2);
      assert.equal(result.report.reason, reason);
      assert.equal(result.report.pending, null);
      assert.ok(!JSON.stringify(result).includes('fixture-secret'));
      assert.ok(!JSON.stringify(result).includes('database.invalid'));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CI and unavailable inputs never connect; offline evidence remains usable in CI', async () => {
  const observe = () => assert.fail('No connection should be launched');
  const blocked = await runStatus({ env: { CI: 'true', DATABASE_URL: 'postgresql://secret@database.invalid/postgres' }, observe });
  assert.equal(blocked.report.reason, 'live_connection_disabled_in_ci');
  assert.equal(blocked.report.applied, null);
  for (const databaseUrl of [undefined, '', 'https://secret@database.invalid', 'postgresql://secret@database.invalid/postgres\n']) {
    await assert.rejects(readMigrationLedger({ databaseUrl, env: {}, launch: observe }), error => error.reason === 'database_url_missing_or_invalid');
  }
  const directory = mkdtempSync(join(tmpdir(), 'occulert-ledger-export-'));
  const exportFile = join(directory, 'ledger.json');
  try {
    writeFileSync(exportFile, JSON.stringify(migrationInventory().filter(row => row.version).map(({ version }) => ({ version }))));
    const result = await runStatus({ args: ['--ledger', exportFile], env: { CI: 'true' }, observe });
    assert.equal(result.code, 0);
    assert.equal(result.report.source, 'offline_ledger_export');
    writeFileSync(exportFile, '{"secret":"fixture-secret"}');
    const malformed = await runStatus({ args: ['--ledger', exportFile], env: { CI: 'true' }, observe });
    assert.equal(malformed.code, 2);
    assert.ok(!JSON.stringify(malformed).includes('fixture-secret'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
