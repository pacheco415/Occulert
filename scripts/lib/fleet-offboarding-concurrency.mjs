// Runs inside the existing disposable PostgreSQL 17 Unix-socket harness.
// PGlite functional fixtures do not substitute for these independent backends.
import assert from 'node:assert/strict';
import { exerciseFleetOffboardingDeletionConcurrency } from './fleet-offboarding-deletion-concurrency.mjs';
import { readFileSync } from 'node:fs';
export const offboardingMigration = '20261030043839_fleet_offboarding.sql';
export async function exerciseFleetOffboardingConcurrency({ admin, worker, waitFor, pass }) {
  await admin.query(readFileSync(new URL(`../../supabase/migrations/${offboardingMigration}`, import.meta.url), 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  const user = '33333333-3333-4333-8333-333333333333', driver = '44444444-4444-4444-8444-444444444444';
  const fleet = '55555555-5555-4555-8555-555555555555', next = '66666666-6666-4666-8666-666666666666';
  const session = '77777777-7777-4777-8777-777777777777', prior = '88888888-8888-4888-8888-888888888888';
  const startSql = 'select start_offboarding_aware_session($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text) as result';
  const start = async c => (await c.query(startSql, [user, session, 'phone', 'browser', 'web_mediapipe_ear', 'test-1', 'web-test'])).rows[0].result;
  const remove = async c => (await c.query('select remove_fleet_driver($1::uuid,$2::uuid,$3::uuid) as result', [owner, driver, fleet])).rows[0].result;
  const leave = async c => (await c.query('select leave_fleet($1::uuid,$2::uuid) as result', [user, fleet])).rows[0].result;
  const reset = async () => admin.query(`truncate auth.users cascade;
    insert into auth.users values('${owner}'),('${other}'),('${user}');
    insert into fleets(id,owner_user_id,company_name) values('${fleet}','${owner}','First'),('${next}','${other}','Next');
    insert into drivers(id,user_id,fleet_id,name) values('${driver}','${user}','${fleet}','Fixture');
    insert into sessions(id,driver_id,fleet_id,started_at) values('${prior}','${driver}','${fleet}',clock_timestamp()-interval '1 hour');`);
  const blocked = async (blocker, waiter) => (await admin.query(`with recursive blockers(pid,path) as (
    select $2::int,array[$2::int]
    union all select next.pid,array_append(blockers.path,next.pid) from blockers
      cross join lateral unnest(pg_blocking_pids(blockers.pid)) as next(pid)
      where not next.pid=any(blockers.path)
  ) select exists(select 1 from blockers where pid=$1::int) as blocked`, [blocker.processID, waiter.processID])).rows[0].blocked;

  await reset();
  await worker[0].query('begin');
  assert.equal((await remove(worker[0])).removed, true);
  const afterRemoval = start(worker[1]); afterRemoval.catch(() => {});
  await waitFor('session start blocked on uncommitted owner removal', () => blocked(worker[0], worker[1]));
  const releaseTime = (await admin.query('select clock_timestamp() as value')).rows[0].value;
  await worker[0].query('commit');
  const detached = (await afterRemoval).session;
  assert.equal(detached.fleet_id, null);
  assert.ok(Date.parse(detached.started_at) >= releaseTime.getTime(), 'start time is assigned after waiting for membership');
  assert.equal((await admin.query('select fleet_id from sessions where id=$1', [prior])).rows[0].fleet_id, fleet);
  pass('offboarding: real removal lock blocks a new start, which uses detached membership after commit.');

  await reset();
  await worker[0].query('begin');
  const started = (await start(worker[0])).session; assert.equal(started.fleet_id, fleet);
  const afterStart = remove(worker[1]); afterStart.catch(() => {});
  await waitFor('owner removal blocked on uncommitted session start', () => blocked(worker[0], worker[1]));
  await worker[0].query('commit');
  assert.equal((await afterStart).removed, true);
  assert.equal((await start(worker[2])).session.fleet_id, fleet, 'owned replay preserves its ongoing session');
  await admin.query('insert into events(session_id,type) values($1,$2)', [session, 'drowsy']);
  assert.equal((await admin.query('select s.fleet_id from events e join sessions s on s.id=e.session_id')).rows[0].fleet_id, fleet);
  pass('offboarding: start-first ordering blocks removal and preserves ongoing-session attribution, including later events.');

  await reset();
  await worker[0].query('begin'); assert.equal((await leave(worker[0])).left, true);
  const afterLeave = start(worker[1]); afterLeave.catch(() => {});
  await waitFor('session start blocked on uncommitted driver leave', () => blocked(worker[0], worker[1]));
  await worker[0].query('rollback');
  assert.equal((await afterLeave).session.fleet_id, fleet);
  assert.equal((await admin.query('select count(*)::int as n from fleet_membership_removals')).rows[0].n, 0);
  pass('offboarding: rolled-back leave releases its lock without changing membership or audit history.');

  await reset();
  await admin.query('update drivers set fleet_id=null where id=$1', [driver]);
  await admin.query(`insert into fleet_invitations(fleet_id,email,token_hash,invited_by,expires_at) values($1,'fixture@example.com',$2,$3,clock_timestamp()+interval '1 day')`, [next, 'a'.repeat(64), other]);
  await worker[0].query('begin');
  const accepted = (await worker[0].query('select accept_fleet_invitation($1,$2::uuid,$3) as result', ['a'.repeat(64), user, 'fixture@example.com'])).rows[0].result;
  assert.equal(accepted.fleet_id, next);
  const afterInvitation = start(worker[1]), staleLeave = leave(worker[2]);
  afterInvitation.catch(() => {}); staleLeave.catch(() => {});
  await waitFor('both start and stale leave blocked on invitation reassignment', async () =>
    await blocked(worker[0], worker[1]) && await blocked(worker[0], worker[2]));
  await worker[0].query('commit');
  assert.equal((await afterInvitation).session.fleet_id, next);
  assert.equal((await staleLeave).error, 'membership_changed');
  assert.equal((await admin.query('select fleet_id from drivers where id=$1', [driver])).rows[0].fleet_id, next);
  pass('offboarding: invitation reassignment serializes with start/stale leave without changing the replacement fleet.');

  await reset();
  const results = await Promise.all(worker.map(c => start(c)));
  assert.equal(new Set(results.map(result => result.session.id)).size, 1);
  assert.equal(new Set(results.map(result => result.session.started_at)).size, 1);
  assert.equal((await admin.query('select count(*)::int as n from sessions where id=$1', [session])).rows[0].n, 1);
  assert.ok(results.every(result => result.session.driver_id === driver && result.session.fleet_id === fleet));
  pass('offboarding: twelve simultaneous owned-UUID starts create one unchanged session.');

  await reset();
  const replacement = '99999999-9999-4999-8999-999999999999';
  await worker[0].query('begin');
  await worker[0].query('update fleets set owner_user_id=$1 where id=$2', [user, fleet]);
  await worker[0].query('insert into fleets(id,owner_user_id,company_name) values($1,$2,$3)', [replacement, owner, 'Replacement']);
  await worker[0].query('update drivers set fleet_id=$1 where id=$2', [replacement, driver]);
  const staleOwner = remove(worker[1]); staleOwner.catch(() => {});
  await waitFor('stale owner confirmation blocked on fleet replacement', () => blocked(worker[0], worker[1]));
  await worker[0].query('commit');
  assert.ok(['fleet_not_found', 'membership_changed'].includes((await staleOwner).error));
  assert.equal((await admin.query('select fleet_id from drivers where id=$1', [driver])).rows[0].fleet_id, replacement);
  assert.equal((await remove(worker[2])).error, 'membership_changed', 'a committed replacement rejects the old displayed fleet');
  assert.equal((await admin.query('select count(*)::int as n from fleet_membership_removals')).rows[0].n, 0);
  pass('offboarding: stale owner confirmation cannot remove membership in a replacement owned fleet.');

  // Force three real membership changes between the snapshot and row lock.
  // Each new blocker is observed before releasing the previous one. Updates
  // back to the prior fleet prove stale parent locks were rolled back.
  await reset();
  await worker[0].query('begin');
  await worker[0].query('select id from fleets where id=$1 for update', [fleet]);
  const churning = start(worker[1]); churning.catch(() => {});
  await waitFor('first start attempt waiting on fleet A', () => blocked(worker[0], worker[1]));
  await worker[2].query('update drivers set fleet_id=$1 where id=$2', [next, driver]);
  await worker[3].query('begin');
  await worker[3].query('select id from fleets where id=$1 for update', [next]);
  await worker[0].query('commit');
  await waitFor('second start attempt waiting on fleet B', () => blocked(worker[3], worker[1]));
  await worker[2].query('update drivers set fleet_id=$1 where id=$2', [fleet, driver]);
  await worker[0].query('begin');
  await worker[0].query('select id from fleets where id=$1 for update', [fleet]);
  await worker[3].query('commit');
  await waitFor('third start attempt waiting on fleet A', () => blocked(worker[0], worker[1]));
  await worker[2].query('update drivers set fleet_id=$1 where id=$2', [next, driver]);
  await worker[3].query('begin');
  await worker[3].query('select id from fleets where id=$1 for update', [next]);
  await worker[0].query('commit');
  const bounded = await churning;
  assert.equal(bounded.error, 'membership_changed');
  assert.equal((await admin.query('select count(*)::int as n from sessions where id=$1', [session])).rows[0].n, 0);
  assert.equal((await admin.query('select fleet_id from drivers where id=$1', [driver])).rows[0].fleet_id, next);
  await worker[3].query('commit');
  pass('offboarding: three real membership changes release stale locks and return conflict without a fourth attempt or insert.');

  await exerciseFleetOffboardingDeletionConcurrency({ admin, worker, waitFor, pass });
}
