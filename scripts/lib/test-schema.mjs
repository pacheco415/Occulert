import { readFileSync, readdirSync } from 'node:fs';

/** Replay the complete checked-in schema in an isolated PGlite database. */
export async function initializeTestSchema(db) {
  await db.exec(`create schema auth;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;`);
  // PGlite provides gen_random_uuid directly; pgcrypto is not needed by these
  // migrations. Production source and migration filenames remain unchanged.
  await db.exec(readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8')
    .replace('create extension if not exists "pgcrypto";', ''));
  const files = ['db/migrations', 'supabase/migrations'].flatMap(directory =>
    readdirSync(new URL(`../../${directory}/`, import.meta.url)).filter(name => name.endsWith('.sql'))
      .map(name => ({ name, path: new URL(`../../${directory}/${name}`, import.meta.url) })))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const file of files) {
    try { await db.exec(readFileSync(file.path, 'utf8')); }
    catch (error) { throw new Error(`Migration replay failed: ${file.name}`, { cause: error }); }
  }
  return files.map(file => file.name);
}
