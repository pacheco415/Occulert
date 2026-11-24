import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { initializeTestSchema } from './lib/test-schema.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

test('Pacific monitoring exposure and event totals from the canonical schema', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await initializeTestSchema(db, { supabaseDefaults: true });
  await db.query('insert into auth.users(id) values ($1), ($2)', [OWNER, OTHER]);

  async function fleet(user) {
    const { rows: [f] } = await db.query(`insert into fleets(company_name,owner_user_id)
      values ('fixture',$1) returning id`, [user]);
    const { rows: [d] } = await db.query(`insert into drivers(name,fleet_id)
      values ('fixture',$1) returning id`, [f.id]);
    return { id: f.id, driver: d.id };
  }
  const ours = await fleet(OWNER);
  const theirs = await fleet(OTHER);

  async function session(start, end, target = ours) {
    const { rows: [s] } = await db.query(`insert into sessions(driver_id,fleet_id,started_at,ended_at)
      values ($1,$2,$3,$4) returning id`, [target.driver, target.id, start, end]);
    return s.id;
  }
  async function event(id, type, at) {
    await db.query('insert into events(session_id,type,created_at) values ($1,$2,$3)', [id, type, at]);
  }
  async function report(days = 7, actor = OWNER) {
    const { rows: [row] } = await db.query('select public.fleet_time_of_day_report($1,$2,$3) as report',
      [actor, ours.id, days]);
    return row.report;
  }

  await t.test('only the service role can execute and the RPC rechecks ownership', async () => {
    const signature = 'public.fleet_time_of_day_report(uuid,uuid,integer)';
    await db.exec('create role public_only');
    for (const role of ['anon', 'authenticated', 'public_only', 'service_role']) {
      const { rows: [row] } = await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",
        [role, signature]);
      assert.equal(row.allowed, role === 'service_role', role);
    }
    await db.exec('set role service_role');
    try {
      assert.equal(await report(7, OTHER), null);
      assert.equal((await report(7)).blocks.length, 6);
      await assert.rejects(report(8), { code: '22023' });
    } finally { await db.exec('reset role'); }
  });

  // The real database clock reads Date.now() through PGlite. Freeze it, not the SQL.
  for (const { date, cutoff, minutes, repeated } of [
    { date: '2026-03-08', cutoff: '2026-03-09T18:00Z', minutes: 180, repeated: false },
    { date: '2026-11-01', cutoff: '2026-11-02T18:00Z', minutes: 300, repeated: true },
  ]) {
    await t.test('elapsed hours across the clock change on ' + date, async t => {
      t.mock.timers.enable({ apis: ['Date'], now: Date.parse(cutoff) });
      const id = await session(date + ' 00:00 America/Los_Angeles', date + ' 04:00 America/Los_Angeles');
      await event(id, 'drowsy', date + (repeated ? ' 01:30-07' : ' 01:30-08'));
      if (repeated) await event(id, 'drowsy', date + ' 01:30-08');
      const result = await report();
      assert.equal(Date.parse(result.window_end), Date.parse(cutoff));
      assert.deepEqual(result.blocks[0], { start_hour: 0, monitored_minutes: minutes,
        drowsy_alerts: repeated ? 2 : 1, distracted_alerts: 0, rate_available: true,
        drowsy_alerts_per_hour: repeated ? 0.4 : 0.3333 });
      assert.ok(result.blocks.slice(1).every(b => b.monitored_minutes === 0));
    });
  }

  await t.test('a multi-day session and an overlapping session accumulate fleet hours', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-10T12:00:00-07:00') });
    await session('2026-09-07T22:00-07', '2026-09-09T02:30-07');
    await session('2026-09-08T00:00-07', '2026-09-08T01:00-07');
    const result = await report();
    assert.deepEqual(result.blocks.map(b => b.monitored_minutes), [450, 240, 240, 240, 240, 360]);
  });

  await t.test('midnight, partial minutes, period boundaries, separate fleets and incomplete sessions', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-07-10T12:00:00-07:00') });
    const overnight = await session('2026-07-09T23:30-07', '2026-07-10T04:15-07');
    await event(overnight, 'drowsy', '2026-07-09T23:30-07');
    await event(overnight, 'drowsy', '2026-07-10T00:00-07');
    await event(overnight, 'distracted', '2026-07-10T03:59-07');
    await event(overnight, 'distracted', '2026-07-10T04:00-07');
    await event(overnight, 'yawn', '2026-07-10T02:00-07');
    await event(overnight, 'drowsy', '2026-07-10T04:16-07');
    await session('2026-07-10T08:00-07', '2026-07-10T09:59:59.999-07');
    await session('2026-07-06T16:00-07', '2026-07-06T18:00-07');

    for (const id of [
      await session('2026-07-09T00:00-07', null),
      await session('2026-07-09T00:00-07', '2026-07-08T23:59-07'),
      await session('2026-07-09T00:00-07', '2026-07-11T01:00-07'),
      await session('2026-07-09T00:00-07', '2026-07-09T04:00-07', theirs),
    ]) await event(id, 'drowsy', '2026-07-09T00:01-07');
    const beforeWindow = await session('2026-07-03T11:59-07', '2026-07-03T12:59-07');
    await event(beforeWindow, 'drowsy', '2026-07-03T12:30-07');

    const result = await report();
    assert.equal(result.timezone, 'America/Los_Angeles');
    assert.deepEqual(result.blocks.map(b => b.start_hour), [0, 4, 8, 12, 16, 20]);
    assert.deepEqual(result.blocks.map(b => b.monitored_minutes), [240, 15, (7200 - 0.001) / 60, 0, 120, 30]);
    assert.deepEqual(result.blocks.map(b => b.drowsy_alerts), [1, 0, 0, 0, 0, 1]);
    assert.deepEqual(result.blocks.map(b => b.distracted_alerts), [1, 1, 0, 0, 0, 0]);
    assert.deepEqual(result.blocks.map(b => b.rate_available), [true, false, false, false, true, false]);
    assert.deepEqual(result.blocks.map(b => b.drowsy_alerts_per_hour), [0.25, null, null, null, 0, null]);
    const wide = await report(30);
    assert.equal(wide.blocks[3].monitored_minutes, 59);
    assert.equal(wide.blocks[3].drowsy_alerts, 1);
  });
});
