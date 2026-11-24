import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FLEET = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const tables = ['fleet_digest_preferences', 'fleet_digest_sends'];
const signature = 'public.set_fleet_digest_preference(uuid,uuid,boolean,text)';

test('digest grants survive legacy defaults; ownership, opt-out and account deletion hold in Postgres', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await initializeTestSchema(db, { supabaseDefaults: true });
  await db.query('insert into auth.users(id) values ($1),($2)', [OWNER, OTHER]);
  await db.query("insert into fleets(id,owner_user_id,company_name) values ($1,$2,'Fixture')", [FLEET, OWNER]);
  for (const table of tables) {
    const [rls] = (await db.query('select relrowsecurity from pg_class where oid = $1::regclass', [table])).rows;
    assert.equal(rls.relrowsecurity, true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const tableAccess = role === 'service_role';
      for (const op of ['select', 'insert', 'update', 'delete']) {
        const [r] = (await db.query('select has_table_privilege($1,$2,$3) as ok', [role, table, op])).rows;
        assert.equal(r.ok, tableAccess, [role, table, op].join(' '));
      }
      const [r] = (await db.query("select has_function_privilege($1,$2,'EXECUTE') as ok", [role, signature])).rows;
      assert.equal(r.ok, tableAccess);
    }
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    for (const table of tables) await assert.rejects(db.query('select * from public.' + table), { code: '42501' });
    await db.exec('reset role');
  }
  const mutate = async (who, enabled, hash) => (await db.query(
    'select public.set_fleet_digest_preference($1,$2,$3,$4) as enabled', [who, FLEET, enabled, hash])).rows[0].enabled;
  await db.exec('set role service_role');
  assert.equal(await mutate(OTHER, true, HASH), null);
  assert.equal((await db.query('select * from fleet_digest_preferences')).rows.length, 0);
  assert.equal(await mutate(OWNER, true, HASH), true);
  assert.equal(await mutate(OWNER, true, 'b'.repeat(64)), true);
  const stale = await db.query('update fleet_digest_preferences set weekly_enabled=false,unsubscribe_token_hash=null where fleet_id=$1 and unsubscribe_token_hash=$2 returning fleet_id', [FLEET, HASH]);
  assert.equal(stale.rows.length, 0);
  assert.equal(await mutate(OWNER, false, null), false);
  assert.equal((await db.query('select unsubscribe_token_hash from fleet_digest_preferences')).rows[0].unsubscribe_token_hash, null);
  await assert.rejects(mutate(OWNER, true, null), { code: '23514' });
  await assert.rejects(mutate(OWNER, false, HASH), { code: '23514' });
  await db.query("insert into fleet_digest_sends(fleet_id,iso_week,outcome) values ($1,'2026-11-16','pending')", [FLEET]);
  await assert.rejects(db.query("insert into fleet_digest_sends(fleet_id,iso_week,outcome) values ($1,'2026-11-16','sent')", [FLEET]), { code: '23505' });
  await assert.rejects(db.query("insert into fleet_digest_sends(fleet_id,iso_week,outcome) values ($1,'2026-11-17','sent')", [FLEET]), { code: '23514' });
  await db.exec('reset role');
  await db.query('delete from auth.users where id=$1', [OTHER]);
  for (const table of tables) assert.equal((await db.query('select * from ' + table)).rows.length, 1);
  await db.query('delete from auth.users where id=$1', [OWNER]);
  for (const table of tables) assert.equal((await db.query('select * from ' + table)).rows.length, 0);
});
