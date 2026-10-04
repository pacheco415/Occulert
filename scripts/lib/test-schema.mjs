import { readFileSync, readdirSync } from 'node:fs';

/** Model Supabase-managed auth objects without contacting a project. */
export async function initializeTestAuth(db) {
  await db.exec(`create schema auth;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;`);
}

/** Fresh databases use the canonical Supabase chain, never both baselines. */
export async function initializeTestSchema(db, { legacy = false, baselineSql } = {}) {
  await initializeTestAuth(db);
  const files = (legacy ? ['db/migrations', 'supabase/migrations'] : ['supabase/migrations']).flatMap(directory =>
    readdirSync(new URL(`../../${directory}/`, import.meta.url)).filter(name => name.endsWith('.sql'))
      .map(name => ({ name, path: new URL(`../../${directory}/${name}`, import.meta.url) })))
    .filter(file => !legacy || file.name !== '20260701000000_baseline.sql')
    .sort((left, right) => left.name.localeCompare(right.name));
  // PGlite has gen_random_uuid built in but does not ship pgcrypto. Removing
  // only the extension statement is a test-engine adaptation, not a SQL edit.
  const portable = sql => sql.replace('create extension if not exists "pgcrypto";', '');
  if (legacy) await db.exec(portable(readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8')));
  for (const file of files) {
    try { await db.exec(portable(file.name === '20260701000000_baseline.sql' && baselineSql !== undefined
      ? baselineSql : readFileSync(file.path, 'utf8'))); }
    catch (error) { throw new Error(`Migration replay failed: ${file.name}`, { cause: error }); }
  }
  return files.map(file => file.name);
}
