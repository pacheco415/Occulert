import assert from 'node:assert/strict';

// Run only through the isolated Unix-socket PostgreSQL acceptance harness.
// Every contention assertion observes independent backend lock dependencies.
export async function runAccountWriteQuotaConcurrency({ admin, worker, connect, waitFor, pass }) {
  assert.equal(worker.length, 12, 'the harness supplies 12 independent service-role connections');
  // Keep statistics reads out of the lock holder's transaction: PostgreSQL
  // can cache activity snapshots until that transaction ends.
  const observer = await connect();
  const user = '11111111-1111-4111-8111-111111111111';
  const limits = { profile: 60, fleet: 10 };
  const workerPids = worker.map(client => client.processID);
  const reserve = async (client, operation) => (await client.query(
    'select public.reserve_account_write($1::uuid,$2::text) as result', [user, operation],
  )).rows[0].result;
  const tracked = promise => { promise.catch(() => {}); return promise; };
  const reset = () => admin.query(`truncate auth.users cascade;
    insert into auth.users(id) values ('${user}');`);
  const buckets = async () => (await admin.query(
    'select to_jsonb(b) as bucket from public.account_write_rate_limits b order by operation',
  )).rows.map(row => row.bucket);
  const absent = operation => ({ allowed: false, user_id: user, operation, error: 'account_not_found' });
  const admitted = operation => ({ allowed: true, user_id: user, operation });
  const blockedBy = async (holder, waiter) => (await observer.query(
    'select $1::int=any(pg_blocking_pids($2::int)) as blocked',
    [holder.processID, waiter.processID],
  )).rows[0].blocked;
  const allWaiting = async () => Number((await observer.query(`select count(*) from pg_stat_activity
    where pid=any($1::int[]) and wait_event_type='Lock'`, [workerPids])).rows[0].count) === worker.length;
  function limited(result, operation) {
    assert.deepEqual(Object.keys(result).sort(), ['allowed', 'error', 'operation', 'retry_after', 'user_id']);
    assert.equal(result.allowed, false);
    assert.equal(result.user_id, user);
    assert.equal(result.operation, operation);
    assert.equal(result.error, 'account_write_rate_limited');
    assert.ok(Number.isInteger(result.retry_after) && result.retry_after >= 1 && result.retry_after <= 3600);
  }
  async function deleted() {
    assert.equal(Number((await admin.query('select count(*) from auth.users where id=$1', [user])).rows[0].count), 0);
    assert.deepEqual(await buckets(), [], 'account deletion must cascade every reservation');
  }
  const gate = 317337;
  async function createGate(events) {
    assert.ok(events === 'insert' || events === 'insert or update');
    await admin.query('select pg_advisory_lock($1)', [gate]);
    // AFTER INSERT holds the first uncommitted unique row. Followers must wait
    // on that transaction, rather than all being serialized by the test gate.
    await admin.query(`create function public.account_quota_fixture_delay() returns trigger language plpgsql as $$begin
        perform pg_advisory_xact_lock(${gate});return new;
      end$$;
      create trigger account_quota_fixture_delay after ${events} on public.account_write_rate_limits
        for each row execute function public.account_quota_fixture_delay();`);
  }
  const releaseGate = () => admin.query('select pg_advisory_unlock($1)', [gate]);
  const dropGate = () => admin.query(`drop trigger account_quota_fixture_delay on public.account_write_rate_limits;
    drop function public.account_quota_fixture_delay();`);

  for (const [operation, limit] of Object.entries(limits)) {
    await reset();
    await createGate('insert');
    const pending = tracked(Promise.all(worker.map(client => reserve(client, operation))));
    let releasedAt;
    try {
      await waitFor(`12 first ${operation} reservations contending`, allWaiting);
      const dependencies = (await observer.query(`select pid,pg_blocking_pids(pid) as blockers
        from pg_stat_activity where pid=any($1::int[])`, [workerPids])).rows;
      const leaders = dependencies.filter(row => row.blockers.includes(admin.processID));
      assert.equal(leaders.length, 1, 'only the first inserted row reaches the advisory gate');
      for (const row of dependencies.filter(row => row.pid !== leaders[0].pid)) {
        assert.ok(row.blockers.some(pid => workerPids.includes(pid)), 'followers contend on another reservation backend');
      }
      releasedAt = (await admin.query('select clock_timestamp()::text as now')).rows[0].now;
    } finally { await releaseGate(); }
    const results = await pending;
    assert.equal(results.filter(result => result.allowed).length, Math.min(limit, worker.length));
    assert.equal(results.filter(result => !result.allowed).length, Math.max(0, worker.length - limit));
    for (const result of results) {
      if (result.allowed) assert.deepEqual(result, admitted(operation));
      else limited(result, operation);
    }
    const stored = await buckets();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].user_id, user);
    assert.equal(stored[0].operation, operation);
    assert.equal(stored[0].write_count, Math.min(limit, worker.length));
    assert.equal((await admin.query('select $1::timestamptz >= $2::timestamptz as current',
      [stored[0].window_started_at, releasedAt])).rows[0].current, true, 'the first window is anchored after contention');
    assert.equal(Number((await admin.query('select count(*) from public.drivers')).rows[0].count), 0);
    await dropGate();
    pass(`12 first ${operation} reservations contend on one new bucket: ${Math.min(limit, worker.length)} admitted, ${Math.max(0, worker.length - limit)} limited, no driver required.`);
  }

  for (const [operation, limit] of Object.entries(limits)) {
    await reset();
    assert.deepEqual(await reserve(worker[0], operation), admitted(operation));
    await admin.query('update public.account_write_rate_limits set write_count=$1', [limit - 1]);
    const before = (await buckets())[0];
    await admin.query('begin;select user_id from public.account_write_rate_limits for update');
    const pending = tracked(Promise.all(worker.map(client => reserve(client, operation))));
    try { await waitFor(`12 ${operation} reservations blocked on the last slot`, allWaiting); }
    finally { await admin.query('commit'); }
    const results = await pending;
    assert.equal(results.filter(result => result.allowed).length, 1);
    assert.equal(results.filter(result => !result.allowed).length, 11);
    for (const result of results) {
      if (result.allowed) assert.deepEqual(result, admitted(operation));
      else limited(result, operation);
    }
    assert.deepEqual(await buckets(), [{ ...before, write_count: limit }]);
    pass(`12 contending ${operation} reservations admit only the final hourly slot and preserve the window.`);
  }

  const deleter = await connect();
  for (const operation of Object.keys(limits)) {
    for (const existing of [false, true]) {
      await reset();
      if (existing) await reserve(worker[0], operation);
      await deleter.query('begin');
      await deleter.query('delete from auth.users where id=$1', [user]);
      const pending = tracked(reserve(worker[0], operation));
      try {
        await waitFor(`${operation} reservation blocked behind account deletion`, () => blockedBy(deleter, worker[0]));
        await deleter.query('commit');
        assert.deepEqual(await pending, absent(operation));
        await deleted();
      } finally { await deleter.query('rollback'); }
    }
  }
  pass('profile and fleet reservations wait behind account deletion and cannot recreate first or existing buckets.');

  for (const operation of Object.keys(limits)) {
    for (const existing of [false, true]) {
      await reset();
      if (existing) await reserve(worker[0], operation);
      await createGate('insert or update');
      const pending = tracked(reserve(worker[0], operation));
      let deletion;
      try {
        await waitFor(`${operation} reservation held after its parent and counter locks`, () => blockedBy(admin, worker[0]));
        deletion = tracked(deleter.query('delete from auth.users where id=$1', [user]));
        await waitFor(`account deletion blocked behind ${operation} reservation`, () => blockedBy(worker[0], deleter));
      } finally { await releaseGate(); }
      assert.deepEqual(await pending, admitted(operation));
      await deletion;
      await deleted();
      assert.deepEqual(await reserve(worker[1], operation), absent(operation));
      await dropGate();
    }
  }
  pass('account deletion waits behind first and existing profile/fleet reservations, then cascades their committed counters.');

  for (const [operation, limit] of Object.entries(limits)) {
    await reset();
    await reserve(worker[0], operation);
    await admin.query('begin');
    await admin.query(`update public.account_write_rate_limits
      set write_count=$1,window_started_at=clock_timestamp()-interval '1 hour 1 second'`, [limit]);
    const pending = tracked(reserve(worker[0], operation));
    let releasedAt;
    try {
      await waitFor(`${operation} rollover blocked on its counter`, () => blockedBy(admin, worker[0]));
      releasedAt = (await admin.query('select clock_timestamp()::text as now')).rows[0].now;
    } finally { await admin.query('commit'); }
    assert.deepEqual(await pending, admitted(operation));
    const stored = await buckets();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].write_count, 1);
    assert.equal((await admin.query(`select $1::timestamptz between $2::timestamptz
      and clock_timestamp() as current`, [stored[0].window_started_at, releasedAt])).rows[0].current, true);
  }
  pass('expired profile/fleet windows restart from database time after the observed counter lock wait.');
}
