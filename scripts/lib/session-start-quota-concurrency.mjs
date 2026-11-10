import assert from 'node:assert/strict';

// Invoked only by the isolated Unix-socket PostgreSQL acceptance harness.
// Every wait observes real backend lock dependencies, never a timing sleep.
export async function runSessionStartQuotaConcurrency({ admin, worker, connect, waitFor, pass }) {
  assert.equal(worker.length, 12, 'the acceptance harness supplies 12 independent service-role clients');
  const user = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const owner = '77777777-7777-4777-8777-777777777777';
  const otherOwner = '88888888-8888-4888-8888-888888888888';
  const driver = '33333333-3333-4333-8333-333333333333';
  const otherDriver = '33333333-3333-4333-8333-333333333334';
  const fleet = '44444444-4444-4444-8444-444444444444';
  const otherFleet = '44444444-4444-4444-8444-444444444445';
  const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const query = `select public.start_rate_limited_session(
    $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text) as result`;
  const start = async (client, session, actor = user) => (await client.query(query,
    [actor, session, 'fixture phone', 'fixture browser', 'web_mediapipe_ear', 'fixture.1', '1.0.0'])).rows[0].result;
  const tracked = promise => { promise.catch(() => {}); return promise; };
  const blockedBy = async (holder, waiter) => (await admin.query(
    'select $1::int=any(pg_blocking_pids($2::int)) as blocked',
    [holder.processID, waiter.processID])).rows[0].blocked;
  const allWaiting = async () => Number((await admin.query(`select count(*) from pg_stat_activity
    where pid=any($1::int[]) and wait_event_type='Lock'`, [worker.map(client => client.processID)])).rows[0].count) === worker.length;
  const reset = async () => admin.query(`truncate auth.users cascade;
    insert into auth.users values('${user}'),('${other}'),('${owner}'),('${otherOwner}');
    insert into public.fleets(id,company_name,owner_user_id) values
      ('${fleet}','First fleet','${owner}'),('${otherFleet}','Second fleet','${otherOwner}');
    insert into public.drivers(id,user_id,fleet_id,name) values
      ('${driver}','${user}','${fleet}','First driver'),
      ('${otherDriver}','${other}','${otherFleet}','Second driver');`);
  const state = async () => (await admin.query(`select
    (select count(*)::int from public.sessions) as sessions,
    (select count(*)::int from public.session_start_rate_limits) as buckets,
    (select start_count from public.session_start_rate_limits where user_id='${user}') as quota`)).rows[0];
  const delayTag = 317329;
  async function createInsertGate() {
    await admin.query('select pg_advisory_lock($1)', [delayTag]);
    await admin.query(`create function public.quota_fixture_delay() returns trigger language plpgsql as $$begin
        perform pg_advisory_xact_lock(${delayTag});return new;
      end$$;
      create trigger quota_fixture_delay before insert on public.sessions
        for each row execute function public.quota_fixture_delay();`);
  }
  const releaseInsertGate = () => admin.query('select pg_advisory_unlock($1)', [delayTag]);
  const dropInsertGate = () => admin.query(`drop trigger quota_fixture_delay on public.sessions;
    drop function public.quota_fixture_delay();`);

  await reset();
  await start(worker[0], id(100));
  await admin.query('update public.session_start_rate_limits set start_count=29');
  await admin.query(`begin;select id from public.drivers where id='${driver}' for update;`);
  const lastSlot = tracked(Promise.all(worker.map((client, n) => start(client, id(n + 1)))));
  let releasedAt;
  try {
    await waitFor('12 session starts blocked by the driver row', allWaiting);
    releasedAt = (await admin.query('select clock_timestamp()::text as now')).rows[0].now;
  } finally { await admin.query('commit'); }
  const limited = await lastSlot;
  assert.equal(limited.filter(result => result.session).length, 1);
  assert.equal(limited.filter(result => result.error === 'session_start_rate_limited').length, 11);
  for (const result of limited.filter(result => result.error)) {
    assert.ok(Number.isInteger(result.retry_after) && result.retry_after >= 1 && result.retry_after <= 3600);
  }
  assert.deepEqual(await state(), { sessions: 2, buckets: 1, quota: 30 });
  assert.equal((await admin.query('select $1::timestamptz >= $2::timestamptz as current',
    [limited.find(result => result.session).session.started_at, releasedAt])).rows[0].current, true);
  pass('12 contending new starts accept only the final hourly slot and assign time after the lock wait.');

  await reset();
  await admin.query(`begin;select id from public.drivers where id='${driver}' for update;`);
  const identical = tracked(Promise.all(worker.map(client => start(client, id(1)))));
  try { await waitFor('12 identical session starts contending', allWaiting); }
  finally { await admin.query('commit'); }
  const replays = await identical;
  assert.equal(replays.filter(result => result.replayed === false).length, 1);
  assert.equal(replays.filter(result => result.replayed === true).length, 11);
  assert.equal(new Set(replays.map(result => result.session.id)).size, 1);
  assert.deepEqual(await state(), { sessions: 1, buckets: 1, quota: 1 });
  await admin.query(`update public.session_start_rate_limits set start_count=30;
    update public.sessions set ended_at=clock_timestamp(),average_fatigue=0,alert_count=0;`);
  const original = (await admin.query('select to_jsonb(s) as session from public.sessions s')).rows[0].session;
  const atQuota = await Promise.all(worker.map(client => start(client, id(1))));
  for (const result of atQuota) assert.deepEqual(result, { session: original, replayed: true });
  assert.deepEqual(await state(), { sessions: 1, buckets: 1, quota: 30 });
  pass('12 identical UUID starts create one session and quota unit; completed replays remain free at quota.');

  await reset();
  await createInsertGate();
  const collision = tracked(Promise.all(worker.map((client, n) => start(client, id(1), n < 6 ? user : other))));
  try { await waitFor('cross-owner UUID leaders and followers contending', allWaiting); }
  finally { await releaseInsertGate(); }
  const collided = await collision;
  const accepted = collided.filter(result => result.session);
  assert.equal(accepted.length, 6);
  assert.equal(accepted.filter(result => !result.replayed).length, 1);
  assert.equal(collided.filter(result => result.error === 'session_id_conflict').length, 6);
  const winner = accepted[0].session.driver_id === driver ? user : other;
  const loser = winner === user ? other : user;
  assert.equal(Number((await admin.query('select count(*) from public.sessions')).rows[0].count), 1);
  assert.deepEqual((await admin.query('select user_id,start_count from public.session_start_rate_limits')).rows,
    [{ user_id: winner, start_count: 1 }]);
  assert.equal(Number((await admin.query('select count(*) from public.session_start_rate_limits where user_id=$1', [loser])).rows[0].count), 0);
  await dropInsertGate();
  pass('cross-owner simultaneous UUID collision stores one owner and rolls back the losing first counter.');

  // Owner deletion takes fleet then driver locks. Hold the driver so the
  // deletion is observably between those steps; the start must wait on the
  // fleet parent, rather than taking the driver first and forming a cycle.
  await reset();
  const driverHolder = await connect();
  const fleetDeleter = await connect();
  await driverHolder.query(`begin;select id from public.drivers where id='${driver}' for update;`);
  await fleetDeleter.query('begin');
  const deletingFleetOwner = tracked(fleetDeleter.query('delete from auth.users where id=$1', [owner]));
  let afterFleetDeletion;
  try {
    await waitFor('fleet-owner deletion blocked by its member driver', () => blockedBy(driverHolder, fleetDeleter));
    afterFleetDeletion = tracked(start(worker[0], id(1)));
    await waitFor('start blocked on the deleting fleet parent', () => blockedBy(fleetDeleter, worker[0]));
    await driverHolder.query('commit');
    await deletingFleetOwner;
    await fleetDeleter.query('commit');
    const result = await afterFleetDeletion;
    assert.equal(result.replayed, false);
    assert.equal(result.session.fleet_id, null);
    assert.deepEqual(await state(), { sessions: 1, buckets: 1, quota: 1 });
  } finally {
    await Promise.allSettled([driverHolder.query('rollback'), fleetDeleter.query('rollback')]);
  }
  // The same parent-first behavior must reject a deleted actor, without
  // re-creating either the driver's session or its cascade-deleted counter.
  await reset();
  const actorDeleter = await connect();
  await actorDeleter.query('begin');
  await actorDeleter.query('delete from auth.users where id=$1', [user]);
  const afterActorDeletion = tracked(start(worker[1], id(1)));
  try {
    await waitFor('start blocked on the deleting actor', () => blockedBy(actorDeleter, worker[1]));
    await actorDeleter.query('commit');
    assert.deepEqual(await afterActorDeletion, { error: 'driver_profile_not_found' });
    assert.deepEqual(await state(), { sessions: 0, buckets: 0, quota: null });
  } finally { await actorDeleter.query('rollback'); }
  pass('starts wait behind fleet-owner or actor deletion without inversion or deleted-account recreation.');

  for (const deletingUser of [owner, user]) {
    await reset();
    await createInsertGate();
    const pendingStart = tracked(start(worker[0], id(1)));
    const deleting = await connect();
    let pendingDelete;
    try {
      await waitFor('start held at its insertion after parent locks', () => blockedBy(admin, worker[0]));
      pendingDelete = tracked(deleting.query('delete from auth.users where id=$1', [deletingUser]));
      await waitFor('account deletion waiting behind the start parent lock', () => blockedBy(worker[0], deleting));
    } finally { await releaseInsertGate(); }
    const acceptedStart = await pendingStart;
    await pendingDelete;
    assert.equal(acceptedStart.replayed, false);
    if (deletingUser === user) {
      assert.deepEqual(await state(), { sessions: 0, buckets: 0, quota: null });
      assert.deepEqual(await start(worker[1], id(1)), { error: 'driver_profile_not_found' });
    } else {
      assert.deepEqual(await state(), { sessions: 1, buckets: 1, quota: 1 });
      assert.equal((await admin.query('select fleet_id from public.sessions')).rows[0].fleet_id, null);
    }
    await dropInsertGate();
  }
  pass('fleet-owner and actor deletion wait behind accepted starts, with atomic cascade cleanup.');

  await reset();
  const firstParent = await connect(), secondParent = await connect();
  await firstParent.query(`begin;select id from public.fleets where id='${fleet}' for update;`);
  let settled = false;
  const churned = tracked(start(worker[0], id(1)).then(result => { settled = true; return result; }));
  try {
    await waitFor('first membership snapshot blocked on A', () => blockedBy(firstParent, worker[0]));
    await admin.query('update public.drivers set fleet_id=$1 where id=$2', [otherFleet, driver]);
    await secondParent.query(`begin;select id from public.fleets where id='${otherFleet}' for update;`);
    await firstParent.query('commit');
    await waitFor('second membership snapshot blocked on B', () => blockedBy(secondParent, worker[0]));

    // NOWAIT also proves the failed iteration released its stale parent lock.
    await firstParent.query(`begin;select id from public.fleets where id='${fleet}' for update nowait;`);
    await firstParent.query('update public.drivers set fleet_id=$1 where id=$2', [fleet, driver]);
    await firstParent.query('commit');
    await firstParent.query(`begin;select id from public.fleets where id='${fleet}' for update;`);
    await secondParent.query('commit');
    await waitFor('third membership snapshot blocked on A', () => blockedBy(firstParent, worker[0]));

    await secondParent.query(`begin;select id from public.fleets where id='${otherFleet}' for update nowait;`);
    await secondParent.query('update public.drivers set fleet_id=$1 where id=$2', [otherFleet, driver]);
    await secondParent.query('commit');
    await secondParent.query(`begin;select id from public.fleets where id='${otherFleet}' for update;`);
    await firstParent.query('commit');
    // Keep B locked. A fourth attempt would block here instead of settling.
    await waitFor('bounded membership failure without a fourth attempt', async () => settled);
    assert.deepEqual(await churned, { error: 'membership_changed' });
    assert.deepEqual(await state(), { sessions: 0, buckets: 0, quota: null });
  } finally {
    await Promise.allSettled([firstParent.query('rollback'), secondParent.query('rollback')]);
  }
  pass('three forced membership revalidations release stale parent locks, stop before a fourth and perform no writes.');
}
