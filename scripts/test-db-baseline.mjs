import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';
import { schemaCatalog } from './lib/schema-catalog.mjs';

test('canonical baseline and ordered migrations preserve the legacy catalog and service-role boundaries', async () => {
  const historical = new PGlite(), canonical = new PGlite();
  try {
    const historicalFiles = await initializeTestSchema(historical, { legacy: true });
    const canonicalFiles = await initializeTestSchema(canonical);
    assert.equal(canonicalFiles[0], '20260701000000_baseline.sql');
    assert.ok(canonicalFiles.includes('20260929010000_billing_ignored_webhook_events.sql'));
    assert.ok(canonicalFiles.includes('20261022120000_revoke_direct_table_access.sql'));
    assert.equal(canonicalFiles.length, historicalFiles.length - 1);
    const expected = await schemaCatalog(historical);
    assert.deepEqual(await schemaCatalog(canonical), expected);
    assert.equal(expected.policies.length, 6);
    assert.ok(expected.relations.filter(row => row.relkind === 'r').every(row => row.relrowsecurity));
    assert.ok(expected.functions.some(row => row.proname === 'check_pilot_lead_rate_limit' && row.prosecdef));

    // Exercise the real atomic baseline function and its grants after replay.
    for (const role of ['anon', 'authenticated']) {
      await canonical.exec(`set role ${role}`);
      await assert.rejects(canonical.query(`select * from public.check_pilot_lead_rate_limit($1,2,900)`, ['a'.repeat(64)]), /permission denied/);
      await canonical.exec('reset role');
    }
    await canonical.exec('set role service_role');
    for (const allowed of [true, true, false]) {
      const row = (await canonical.query(`select * from public.check_pilot_lead_rate_limit($1,2,900)`, ['a'.repeat(64)])).rows[0];
      assert.equal(row.allowed, allowed);
      assert.ok(row.retry_after_seconds >= 1);
    }
    await canonical.exec('reset role');

    // Prove the catalog would catch meaningful drift, not just table names.
    await canonical.exec('alter table public.events disable row level security');
    assert.notDeepEqual((await schemaCatalog(canonical)).relations, expected.relations);
    await canonical.exec('alter table public.events enable row level security; grant execute on function public.accept_fleet_invitation(text,uuid,text) to authenticated');
    assert.notDeepEqual((await schemaCatalog(canonical)).functions, expected.functions);
    await canonical.exec('revoke execute on function public.accept_fleet_invitation(text,uuid,text) from authenticated; alter table public.sessions drop constraint sessions_fleet_id_fkey; alter table public.sessions add constraint sessions_fleet_id_fkey foreign key(fleet_id) references public.fleets(id) on delete cascade');
    assert.notDeepEqual((await schemaCatalog(canonical)).constraints, expected.constraints);
  } finally { await historical.close(); await canonical.close(); }
});

test('baseline contains the archived SQL exactly in its original order', () => {
  const baseline = readFileSync(new URL('../supabase/migrations/20260701000000_baseline.sql', import.meta.url), 'utf8');
  const sources = ['db/schema.sql', ...readdirSync(new URL('../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort().map(name => `db/migrations/${name}`)];
  let end = 0;
  for (const path of sources) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const position = baseline.indexOf(source, end);
    assert.ok(position >= end, `${path} must remain verbatim in the ordered baseline`);
    end = position + source.length;
  }
});

test('the pilot-lead rate limiter prunes idle rows in bounded batches without resetting live windows', async () => {
  const db = new PGlite();
  try {
    const replayed = await initializeTestSchema(db);
    assert.ok(replayed.includes('20261023010000_prune_pilot_lead_rate_limits.sql'));
    const key = n => n.toString(16).padStart(64, '0');
    // 150 rows idle for two days, 3 recent rows, and the caller's own live window.
    await db.exec(`insert into public.pilot_lead_rate_limits(rate_key,window_started_at,request_count,updated_at)
      select lpad(to_hex(n),64,'0'), now()-interval '2 days', 5, now()-interval '2 days' from generate_series(1,150) n;
      insert into public.pilot_lead_rate_limits(rate_key,window_started_at,request_count,updated_at)
      select lpad(to_hex(n),64,'0'), now()-interval '1 minute', 2, now()-interval '1 minute' from generate_series(1001,1003) n;
      insert into public.pilot_lead_rate_limits values ('${key(2000)}', now()-interval '1 minute', 5, now()-interval '1 minute');`);
    const count = async () => Number((await db.query('select count(*)::int as n from public.pilot_lead_rate_limits')).rows[0].n);
    // Only the API's service role may call the limiter; it has no table grant of its own.
    const call = async (rateKey, windowSeconds = 900) => {
      await db.exec('set role service_role');
      try { return (await db.query('select * from public.check_pilot_lead_rate_limit($1,5,$2)', [rateKey, windowSeconds])).rows[0]; }
      finally { await db.exec('reset role'); }
    };
    // The caller already used 5 of 5 in this window: still limited after cleanup.
    assert.equal((await call(key(2000))).allowed, false);
    assert.equal(await count(), 54, 'one call removes at most 100 idle rows');
    assert.equal((await call(key(3000))).allowed, true);
    assert.equal(await count(), 5, 'the next call removes the remaining idle rows and adds its own');
    assert.equal(Number((await db.query("select count(*)::int as n from public.pilot_lead_rate_limits where updated_at < now() - interval '1 day'")).rows[0].n), 0);
    // A window longer than a day keeps rows that are still inside it.
    await db.exec(`insert into public.pilot_lead_rate_limits values ('${key(4000)}', now()-interval '2 days', 5, now()-interval '2 days')`);
    assert.equal((await call(key(4000), 3 * 86400)).allowed, false, 'a three-day window must survive its own cleanup');
    const fn = (await db.query("select prosecdef, proconfig, has_function_privilege('anon',p.oid,'EXECUTE') as anon, has_function_privilege('authenticated',p.oid,'EXECUTE') as authed, has_function_privilege('service_role',p.oid,'EXECUTE') as service from pg_proc p where proname='check_pilot_lead_rate_limit'")).rows;
    assert.deepEqual(fn, [{ prosecdef: true, proconfig: ['search_path=public, pg_temp'], anon: false, authed: false, service: true }]);
  } finally { await db.close(); }
});
