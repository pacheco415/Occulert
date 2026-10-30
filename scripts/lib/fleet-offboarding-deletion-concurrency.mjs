// Scheduling-only triggers pause before ordinary foreign-key checks. These
// cases use the caller's disposable Unix-socket cluster and synthetic identities.
import assert from 'node:assert/strict';

export async function exerciseFleetOffboardingDeletionConcurrency({ admin, worker, waitFor, pass }) {
  const owner = '11111111-1111-4111-8111-111111111111';
  const user = '33333333-3333-4333-8333-333333333333';
  const driver = '44444444-4444-4444-8444-444444444444';
  const fleet = '55555555-5555-4555-8555-555555555555';
  const session = '77777777-7777-4777-8777-777777777777';
  const remover = worker[0], deleter = worker[1];
  const scheduleKey = 879106;
  const blocked = async (blocker, waiter) => (await admin.query(
    'select $1::int=any(pg_blocking_pids($2::int)) as blocked',
    [blocker.processID, waiter.processID],
  )).rows[0].blocked;
  await admin.query(`create function fixture_offboarding_pause() returns trigger language plpgsql as $$
    begin perform pg_advisory_xact_lock(${scheduleKey}); return new; end $$;`);
  try {
    for (const operation of ['remove', 'leave', 'start']) {
      await admin.query(`truncate auth.users cascade;
        insert into auth.users values('${owner}'),('${user}');
        insert into fleets(id,owner_user_id,company_name) values('${fleet}','${owner}','Fixture');
        insert into drivers(id,user_id,fleet_id,name) values('${driver}','${user}','${fleet}','Driver');`);
      const table = operation === 'start' ? 'sessions' : 'fleet_membership_removals';
      await admin.query(`create trigger fixture_offboarding_pause before insert on ${table}
        for each row execute function fixture_offboarding_pause();`);
      // Account deletion is an admin-only synthetic operation. The mutation
      // being reviewed still executes as the actual service role.
      await deleter.query('reset role');
      let mutation, deletion;
      try {
        await admin.query('select pg_advisory_lock($1)', [scheduleKey]);
        try {
          if (operation === 'remove') mutation = remover.query(
            'select remove_fleet_driver($1::uuid,$2::uuid,$3::uuid) as result', [owner, driver, fleet],
          );
          if (operation === 'leave') mutation = remover.query(
            'select leave_fleet($1::uuid,$2::uuid) as result', [user, fleet],
          );
          if (operation === 'start') mutation = remover.query(
            'select start_offboarding_aware_session($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text) as result',
            [user, session, 'phone', 'browser', 'web_mediapipe_ear', 'test-1', 'web-test'],
          );
          mutation.catch(() => {});
          await waitFor(`${operation} paused before its foreign-key checks`, () => blocked(admin, remover));
          deletion = deleter.query('delete from auth.users where id=$1', [owner]);
          deletion.catch(() => {});
          await waitFor(`account deletion blocked on ${operation}'s parent lock`, () => blocked(remover, deleter));
        } finally {
          await admin.query('select pg_advisory_unlock($1)', [scheduleKey]);
        }
        const results = await Promise.allSettled([mutation, deletion]);
        assert.ok(results.every(result => result.status === 'fulfilled'),
          `${operation} and account deletion must both complete without a deadlock`);
        const result = results[0].value.rows[0].result;
        if (operation === 'remove') assert.equal(result.removed, true);
        if (operation === 'leave') assert.equal(result.left, true);
        if (operation === 'start') assert.equal(result.session.fleet_id, fleet);
        const state = (await admin.query(`select
          (select count(*)::int from auth.users) as users,
          (select count(*)::int from fleets) as fleets,
          (select count(*)::int from fleet_membership_removals) as audits,
          (select count(*)::int from drivers where id='${driver}' and fleet_id is null and active) as detached,
          (select count(*)::int from sessions) as sessions,
          (select count(*)::int from sessions where fleet_id is not null) as attributed`)).rows[0];
        assert.deepEqual(state, {
          users: 1, fleets: 0, audits: 0, detached: 1,
          sessions: operation === 'start' ? 1 : 0, attributed: 0,
        });
        pass(`offboarding: ${operation} and owner-account deletion complete after observed contention, preserving cascade/privacy boundaries.`);
      } finally {
        // A failed schedule still releases its latch before the outer harness
        // closes clients; each statement has the harness's bounded timeout.
        await Promise.allSettled([mutation, deletion].filter(Boolean));
        await deleter.query('set role service_role');
        await admin.query(`drop trigger fixture_offboarding_pause on ${table}`);
      }
    }
  } finally {
    await admin.query('drop function fixture_offboarding_pause()');
  }
}
