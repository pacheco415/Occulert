// From 2026-10-30 Supabase no longer grants new public tables to anon,
// authenticated or service_role by default. Every table a post-baseline
// migration creates must grant service_role explicitly and enable RLS.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createdTables, migrationGrantProblems } from './lib/migration-grants.mjs';
import { initializeTestSchema } from './lib/test-schema.mjs';

const directory = new URL('../supabase/migrations/', import.meta.url);
const BASELINE = '20260701000000_baseline.sql';
// The baseline's tables predate the change and keep their existing grants.
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql') && name > BASELINE).sort()
  .map(name => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }));

test('every post-baseline migration grants service_role and enables RLS on each table it creates', () => {
  assert.ok(migrations.length > 0);
  assert.deepEqual(migrations.flatMap(({ name, sql }) => migrationGrantProblems(sql, name)), []);
});

test('a table without an explicit service_role grant or RLS is rejected', () => {
  assert.deepEqual(migrationGrantProblems('create table public.widgets (id uuid primary key);', 'x.sql'), [
    'x.sql: table widgets must enable row level security',
    'x.sql: table widgets needs an explicit grant to service_role',
  ]);
  const anonOnly = 'create table widgets (id uuid); alter table widgets enable row level security; grant select on widgets to anon, authenticated;';
  assert.deepEqual(migrationGrantProblems(anonOnly, 'x.sql'), ['x.sql: table widgets needs an explicit grant to service_role']);
  const commentedOut = 'create table widgets (id uuid); alter table widgets enable row level security;\n-- grant select on widgets to service_role;\n/* grant all on widgets to service_role; */';
  assert.deepEqual(migrationGrantProblems(commentedOut, 'x.sql'), ['x.sql: table widgets needs an explicit grant to service_role']);
  const functionOnly = 'create table widgets (id uuid); alter table widgets enable row level security; grant execute on function public.widgets(uuid) to service_role;';
  assert.deepEqual(migrationGrantProblems(functionOnly, 'x.sql'), ['x.sql: table widgets needs an explicit grant to service_role']);
});

test('multi-table, quoted, schema-qualified and whole-schema grants are recognized', () => {
  const sql = `create table if not exists public.a (id uuid); create table "b" (id uuid);
    alter table public.a enable row level security; alter table if exists "public"."b" enable row level security;
    grant select, insert on public.a, "public"."b" to anon, service_role;`;
  assert.deepEqual(migrationGrantProblems(sql, 'x.sql'), []);
  assert.deepEqual(migrationGrantProblems('create table c (id uuid); alter table c enable row level security; grant select on all tables in schema public to service_role;', 'x.sql'), []);
});

test('serial columns and created sequences need their own service_role grant', () => {
  const serial = 'create table counters (id bigserial primary key, label text); alter table counters enable row level security; grant select, insert on counters to service_role;';
  assert.deepEqual(migrationGrantProblems(serial, 'x.sql'), ['x.sql: sequence counters_id_seq needs an explicit grant to service_role']);
  assert.deepEqual(migrationGrantProblems(serial + ' grant usage, select on sequence public.counters_id_seq to service_role;', 'x.sql'), []);
  assert.deepEqual(migrationGrantProblems('create sequence public.tickets;', 'x.sql'), ['x.sql: sequence tickets needs an explicit grant to service_role']);
  assert.deepEqual(migrationGrantProblems('create sequence tickets; grant usage on all sequences in schema public to service_role;', 'x.sql'), []);
});

test('with no default privileges, replayed migrations give service_role real access to every post-baseline table and keep the browser roles out', async () => {
  // PGlite roles start with no default table grants, matching Supabase after the change.
  const db = new PGlite();
  try {
    await initializeTestSchema(db);
    const tables = migrations.flatMap(({ sql }) => createdTables(sql));
    assert.ok(tables.length > 0);
    for (const table of tables) {
      const { rows: [row] } = await db.query(`select has_table_privilege('service_role', $1, 'SELECT') as service,
        has_table_privilege('anon', $1, 'SELECT') as anon, has_table_privilege('authenticated', $1, 'SELECT') as signed_in`, ['public.' + table]);
      assert.deepEqual(row, { service: true, anon: false, signed_in: false }, table);
    }
  } finally { await db.close(); }
});
