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
