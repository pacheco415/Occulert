import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createSessionOutbox } from '../native-app/lib/sessionOutbox.ts';
import { createAsyncMutationQueue } from '../native-app/lib/asyncMutationQueue.ts';
import { createCachedBooleanPreference } from '../native-app/lib/cachedBooleanPreference.ts';
const DRIVER_CLEANUP_TOKEN = '66666666-6666-4666-8666-666666666666';
const source = stripTypeScriptTypes(readFileSync(new URL('../native-app/lib/cloudSync.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '')).replace(/export /g, '');
function setup(version, {
  versionedRoutesAvailable = true,
  sessionResponseId = null,
  deleteFound = true,
  cancellationRecorded = true,
  storedFleetToken = '77777777-7777-4777-8777-777777777777',
  profileFleetToken = storedFleetToken,
  profileTokenForRequest = null,
  profileResponseForRequest = null,
  profileGetUnavailable = false,
  conflictFirstCreate = false,
  conflictFirstEvent = false,
  sessionCreateForRequest = null,
  sessionFinishForRequest = null,
  sessionCancelForRequest = null,
} = {}) {
  const disk = new Map([['occulert-cloud-sync-enabled', 'true']]);
  let auth = JSON.stringify({ access_token: 'a-token', refresh_token: 'refresh', expires_at: 4000000000, user: { id: 'a', email: 'a@example.invalid' }, fleet_sync_token: storedFleetToken, session_cleanup_token: DRIVER_CLEANUP_TOKEN });
  const calls = []; let uuid = 0; const history = []; let outboxWriteFailures = 0; let consentWriteFailures = 0;
  let secureDeleteFailures = 0; let profileRequests = 0;
  let createConflicts = conflictFirstCreate ? 1 : 0;
  let eventConflicts = conflictFirstEvent ? 1 : 0;
  const serverSessions = new Map();
  const tokenCancellations = new Set();
  const client = new Function('AsyncStorage','SecureStore','Platform','randomUUID','createSessionOutbox','updateSessionHistory','createAsyncMutationQueue','createCachedBooleanPreference','fetch',source + '\nreturn {beginCloudSession,logCloudAlert,finishCloudSession,retryCloudUploads,pendingCloudSessionIds,refreshCloudFleetGrant,setCloudSyncEnabled,signInToCloud,signOutOfCloud};')(
    { getItem: async key => disk.get(key) ?? null, setItem: async (key,value) => {
      if (key === 'occulert-session-outbox-v1' && outboxWriteFailures > 0) {
        outboxWriteFailures -= 1;
        throw new Error('temporary storage failure');
      }
      if (key === 'occulert-cloud-sync-enabled' && consentWriteFailures > 0) {
        consentWriteFailures -= 1;
        throw new Error('temporary consent storage failure');
      }
      disk.set(key,value);
    } },
    { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'protected', isAvailableAsync: async () => true, getItemAsync: async () => auth, setItemAsync: async (_key,value) => {auth=value;}, deleteItemAsync: async () => {
      if (secureDeleteFailures > 0) {
        secureDeleteFailures -= 1;
        throw new Error('temporary secure storage failure');
      }
      auth=null;
    } },
    { OS: 'ios', Version: 'test' }, () => `00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,
    createSessionOutbox, async fn => { history.splice(0,history.length,...fn(history)); }, createAsyncMutationQueue, createCachedBooleanPreference,
    async (url, init = {}) => {
      if (url.endsWith('/api/public-config')) return new Response(JSON.stringify({ session_sync_version: version, supabase: { configured: true, url: 'https://test.supabase.co', anonKey: 'public' } }));
      calls.push({ url, ...init });
      const body = init.body ? JSON.parse(init.body) : {};
      if (url.endsWith('/api/profile')) {
        const requestIndex = profileRequests++;
        if (profileResponseForRequest) return profileResponseForRequest(requestIndex, init);
        if (profileGetUnavailable && init.method === 'GET') {
          return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
        }
        const fleetToken = profileTokenForRequest
          ? await profileTokenForRequest(requestIndex)
          : profileFleetToken;
        return new Response(JSON.stringify({
          driver: { id: 'a', fleet_sync_token: fleetToken, session_cleanup_token: DRIVER_CLEANUP_TOKEN },
          ok: true,
        }));
      }
      if (url.includes('/auth/v1/token?grant_type=password')) {
        return new Response(JSON.stringify({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3_600,
          user: { id: 'new-user', email: 'new@example.invalid' },
        }));
      }
      if (url.includes('/api/session-cancel-v1')) {
        if (!versionedRoutesAvailable) {
          return new Response(JSON.stringify({ error: 'route_not_found' }), { status: 404 });
        }
        if (sessionCancelForRequest) await sessionCancelForRequest(body);
        if (body.cleanup_token !== DRIVER_CLEANUP_TOKEN) {
          return new Response(JSON.stringify({ error: 'cleanup_capability_expired' }), { status: 410 });
        }
        const cancellationKey = `${body.session_id}|${body.cancel_token}`;
        const alreadySettled = tokenCancellations.has(cancellationKey);
        const matches = serverSessions.get(body.session_id)?.cancelToken === body.cancel_token;
        const conflict = serverSessions.has(body.session_id) && !matches;
        if (matches) {
          serverSessions.delete(body.session_id);
        }
        if (!conflict) tokenCancellations.add(cancellationKey);
        return new Response(JSON.stringify({
          ok: true,
          settled: alreadySettled || !conflict,
          deleted: matches,
        }));
      }
      if (url.includes('/api/session-sync-v1') || url.includes('/api/event-sync-v1')) {
        if (!versionedRoutesAvailable) {
          return new Response(JSON.stringify({ error: 'route_not_found' }), { status: 404 });
        }
        if (url.includes('/api/session-sync-v1')) {
          if (init.method === 'DELETE') {
            if (sessionCancelForRequest) await sessionCancelForRequest(body);
            serverSessions.delete(body.session_id);
            return new Response(JSON.stringify({
              ok: true,
              deleted: deleteFound,
              cancellation_recorded: cancellationRecorded,
            }));
          }
          if (createConflicts > 0) {
            createConflicts -= 1;
            return new Response(JSON.stringify({ error: 'session_id_conflict' }), { status: 409 });
          }
          if (init.method === 'PATCH') {
            if (sessionFinishForRequest) await sessionFinishForRequest(body);
            const existing = serverSessions.get(body.session_id);
            if (!existing) return new Response(JSON.stringify({ error: 'session_not_found' }), { status: 404 });
            existing.ended = true;
            return new Response(JSON.stringify({ ok: true, session: { id: body.session_id } }));
          }
          if (sessionCreateForRequest) await sessionCreateForRequest(body);
          const sessionId = body.client_session_id || body.session_id;
          if (tokenCancellations.has(`${sessionId}|${body.cancel_token}`)) {
            return new Response(JSON.stringify({ error: 'session_start_cancelled' }), { status: 410 });
          }
          serverSessions.set(sessionId, { cancelToken: body.cancel_token, ended: false });
          return new Response(JSON.stringify({
            ok: true,
            session: { id: sessionResponseId || body.client_session_id || body.session_id },
          }));
        }
        if (eventConflicts > 0) {
          eventConflicts -= 1;
          return new Response(JSON.stringify({ error: 'event_id_conflict' }), { status: 409 });
        }
        return new Response(JSON.stringify({ ok: true, event: { id: body.client_event_id } }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });
  return {
    client,
    calls,
    disk,
    getAuth() { return auth ? JSON.parse(auth) : null; },
    failOutboxWrites(count) { outboxWriteFailures = count; },
    failConsentWrites(count) { consentWriteFailures = count; },
    failSecureDeletes(count) { secureDeleteFailures = count; },
    hasServerSession(id) { return serverSessions.has(id); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

test('an older profile response cannot overwrite a newer fleet grant', async () => {
  const older = deferred();
  const newer = deferred();
  const tokens = [older.promise, newer.promise];
  const { client, disk, getAuth } = setup(0, {
    profileTokenForRequest: index => tokens[index],
  });
  const first = client.refreshCloudFleetGrant();
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = client.refreshCloudFleetGrant();
  await new Promise(resolve => setTimeout(resolve, 0));
  newer.resolve('88888888-8888-4888-8888-888888888888');
  assert.equal(await second, true);
  older.resolve('77777777-7777-4777-8777-777777777777');
  assert.equal(await first, false);
  assert.equal(getAuth().fleet_sync_token, '88888888-8888-4888-8888-888888888888');
  assert.ok(await client.beginCloudSession());
  const queued = JSON.parse(disk.get('occulert-session-outbox-v1'));
  assert.equal(queued[0].start.fleet_sync_token, '88888888-8888-4888-8888-888888888888');
});

test('a delayed 401 from an old account cannot refresh or clear a replacement account', async () => {
  const oldResponse = deferred();
  const { client, calls, getAuth } = setup(0, {
    profileResponseForRequest: index => index === 0
      ? oldResponse.promise
      : new Response(JSON.stringify({ driver: { id: 'new-user', fleet_sync_token: null }, ok: true })),
  });
  const oldRequest = client.refreshCloudFleetGrant();
  await new Promise(resolve => setTimeout(resolve, 0));
  const signIn = await client.signInToCloud('new@example.invalid', 'secret1');
  assert.equal(signIn.ok, true);
  oldResponse.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
  assert.equal(await oldRequest, false);
  assert.equal(getAuth().user.id, 'new-user');
  assert.equal(calls.some(call => call.url.includes('grant_type=refresh_token')), false);
});

test('account replacement waits for durable consent revocation', async () => {
  const { client, calls, disk, failConsentWrites } = setup(0);
  failConsentWrites(1);
  const result = await client.signInToCloud('new@example.invalid', 'secret1');
  assert.equal(result.ok, false);
  assert.match(result.message, /clearing the previous cloud account/i);
  assert.equal(disk.get('occulert-cloud-sync-enabled'), 'true');
  assert.equal(calls.some(call => call.url.includes('/auth/v1/token')), false);
});

test('account replacement waits for durable outbox removal', async () => {
  const { client, calls, disk, failOutboxWrites } = setup(0);
  const id = await client.beginCloudSession();
  assert.ok(id);
  failOutboxWrites(1);
  const result = await client.signInToCloud('new@example.invalid', 'secret1');
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(disk.get('occulert-session-outbox-v1')).length, 1);
  assert.equal(calls.some(call => call.url.includes('/auth/v1/token')), false);
});

test('account replacement waits for durable secure-token removal', async () => {
  const { client, calls, getAuth, failSecureDeletes } = setup(0);
  failSecureDeletes(1);
  const result = await client.signInToCloud('new@example.invalid', 'secret1');
  assert.equal(result.ok, false);
  assert.equal(getAuth().user.id, 'a');
  assert.equal(calls.some(call => call.url.includes('/auth/v1/token')), false);
});
test('older backend never receives a retryable create it cannot deduplicate', async () => {
  const {client,calls} = setup(0);
  const id = await client.beginCloudSession();
  assert.ok(id);
  await client.finishCloudSession(id, { averageFatigue: 0, maxFatigue: 0, safetyScore: 100, alertCount: 0 }, 'local');
  await client.retryCloudUploads(true);
  assert.equal(calls.length, 0);
});
test('disabled sharing cancels pending starts and prevents subsequent upload writes', async () => {
  const {client,calls,disk} = setup(0);
  const id = await client.beginCloudSession();
  await client.finishCloudSession(id, { averageFatigue: 0, maxFatigue: 0, safetyScore: 100, alertCount: 0 }, 'local');
  await client.setCloudSyncEnabled(false);
  await client.retryCloudUploads(true);
  const queued = JSON.parse(disk.get('occulert-session-outbox-v1'));
  const cleanupCalls = calls.filter(call => new URL(call.url).pathname === '/api/session-cancel-v1');
  assert.equal(calls.some(call => (
    call.method === 'POST' && ['/api/session-sync-v1', '/api/event-sync-v1'].includes(new URL(call.url).pathname)
  )), false);
  assert.equal(cleanupCalls.length, 0, 'a durably never-attempted start needs no server cleanup');
  assert.deepEqual(queued, []);
  assert.equal(await client.beginCloudSession(), null);
});

test('disabling sharing cancels a session create that was already in flight', async () => {
  const started = deferred();
  const release = deferred();
  const { client, calls, disk, hasServerSession } = setup(1, {
    sessionCreateForRequest: async body => {
      started.resolve(body.client_session_id);
      await release.promise;
    },
  });
  const id = await client.beginCloudSession();
  assert.equal(await started.promise, id);
  let disableFinished = false;
  const disable = client.setCloudSyncEnabled(false).then(result => {
    disableFinished = true;
    return result;
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(disableFinished, true, 'local revocation must not wait for an in-flight network request');
  assert.equal(JSON.parse(disk.get('occulert-session-outbox-v1'))[0].abandoned, true);
  release.resolve();
  assert.equal(await disable, true);
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), false);
  assert.equal(calls.some(call => (
    new URL(call.url).pathname === '/api/session-sync-v1' && call.method === 'POST'
  )), true);
  const cancellation = calls.find(call => new URL(call.url).pathname === '/api/session-cancel-v1');
  assert.ok(cancellation);
  assert.equal(cancellation.method, 'DELETE');
  assert.equal(cancellation.headers?.Authorization, undefined);
  assert.equal(JSON.parse(cancellation.body).session_id, id);
  assert.deepEqual(JSON.parse(disk.get('occulert-session-outbox-v1')), []);
});

test('signing out cancels an acknowledged start that has no finished summary', async () => {
  const { client, calls, disk, getAuth, hasServerSession } = setup(1);
  const id = await client.beginCloudSession();
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), true);
  await client.signOutOfCloud();
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), false);
  assert.equal(getAuth(), null);
  assert.deepEqual(JSON.parse(disk.get('occulert-session-outbox-v1')), []);
  assert.equal(calls.some(call => (
    new URL(call.url).pathname === '/api/session-sync-v1' && call.method === 'POST'
  )), true);
  const cancellation = calls.find(call => new URL(call.url).pathname === '/api/session-cancel-v1');
  assert.ok(cancellation);
  assert.equal(cancellation.headers?.Authorization, undefined);
  assert.equal(JSON.parse(cancellation.body).session_id, id);
});

test('disabling sharing removes a summary whose final PATCH was already in flight', async () => {
  const finishStarted = deferred();
  const releaseFinish = deferred();
  const { client, disk, hasServerSession } = setup(1, {
    sessionFinishForRequest: async body => {
      finishStarted.resolve(body.session_id);
      await releaseFinish.promise;
    },
  });
  const id = await client.beginCloudSession();
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), true);
  await client.finishCloudSession(id, {
    averageFatigue: 20, maxFatigue: 30, safetyScore: 90, alertCount: 0,
  }, 'local');
  assert.equal(await finishStarted.promise, id);
  const disabled = client.setCloudSyncEnabled(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(disk.get('occulert-session-outbox-v1'))[0].abandoned, true);
  releaseFinish.resolve();
  assert.equal(await disabled, true);
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), false, 'token cleanup must undo the late finalization');
  assert.deepEqual(JSON.parse(disk.get('occulert-session-outbox-v1')), []);
});

test('offline server cleanup never blocks local sign-out or credential removal', async () => {
  const cancelStarted = deferred();
  const releaseCancel = deferred();
  const { client, calls, disk, getAuth, hasServerSession } = setup(1, {
    sessionCancelForRequest: async body => {
      cancelStarted.resolve(body.session_id);
      await releaseCancel.promise;
    },
  });
  const id = await client.beginCloudSession();
  await client.retryCloudUploads(true);
  await client.signOutOfCloud();
  assert.equal(getAuth(), null);
  assert.equal(await cancelStarted.promise, id);
  const queued = JSON.parse(disk.get('occulert-session-outbox-v1'));
  assert.equal(queued[0].abandoned, true);
  assert.deepEqual(queued[0].events, []);
  releaseCancel.resolve();
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), false);
  assert.deepEqual(JSON.parse(disk.get('occulert-session-outbox-v1')), []);
  assert.equal(calls.some(call => new URL(call.url).pathname === '/api/session-cancel-v1'), true);
});

test('compatible uploads use only versioned routes and confirm stable IDs', async () => {
  const { client, calls } = setup(1, {
    profileFleetToken: '88888888-8888-4888-8888-888888888888',
  });
  const id = await client.beginCloudSession();
  assert.equal(await client.logCloudAlert(id, 72), true);
  await client.finishCloudSession(id, { averageFatigue: 40, maxFatigue: 72, safetyScore: 61, alertCount: 1 }, 'local');
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  const paths = calls.map(call => new URL(call.url).pathname);
  assert.ok(paths.includes('/api/session-sync-v1'));
  assert.ok(paths.includes('/api/event-sync-v1'));
  assert.equal(paths.includes('/api/sessions'), false);
  assert.equal(paths.includes('/api/events'), false);
  const sessionCreate = calls.find(call => new URL(call.url).pathname === '/api/session-sync-v1' && call.method === 'POST');
  assert.equal(JSON.parse(sessionCreate.body).fleet_sync_token, '77777777-7777-4777-8777-777777777777', 'the drive must keep the membership token captured before it began');
  assert.deepEqual(await client.pendingCloudSessionIds(), []);
});

test('a permanent stable-ID ownership conflict is isolated from later sessions', async () => {
  const { client, calls } = setup(1, { conflictFirstCreate: true });
  assert.ok(await client.beginCloudSession());
  await client.retryCloudUploads(true);
  const second = await client.beginCloudSession();
  assert.ok(second);
  await client.finishCloudSession(second, { averageFatigue: 0, maxFatigue: 0, safetyScore: 100, alertCount: 0 }, 'later');
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  assert.equal(calls.filter(call => new URL(call.url).pathname === '/api/session-sync-v1' && call.method === 'POST').length, 2);
  assert.deepEqual(await client.pendingCloudSessionIds(), []);
});

test('a permanent event-ID conflict marks one summary partial without poisoning later sessions', async () => {
  const { client, calls } = setup(1, { conflictFirstEvent: true });
  const first = await client.beginCloudSession();
  assert.equal(await client.logCloudAlert(first, 72), true);
  await client.finishCloudSession(first, { averageFatigue: 40, maxFatigue: 72, safetyScore: 61, alertCount: 1 }, 'first');
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  const second = await client.beginCloudSession();
  await client.finishCloudSession(second, { averageFatigue: 0, maxFatigue: 0, safetyScore: 100, alertCount: 0 }, 'second');
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  assert.equal(calls.filter(call => new URL(call.url).pathname === '/api/session-sync-v1' && call.method === 'POST').length, 2);
  assert.deepEqual(await client.pendingCloudSessionIds(), []);
});

test('a deployment rollback leaves queued data intact when versioned routes disappear', async () => {
  const { client, calls } = setup(1, { versionedRoutesAvailable: false });
  const id = await client.beginCloudSession();
  await client.finishCloudSession(id, { averageFatigue: 0, maxFatigue: 0, safetyScore: 100, alertCount: 0 }, 'local');
  await client.retryCloudUploads(true);
  const paths = calls.map(call => new URL(call.url).pathname);
  assert.ok(paths.includes('/api/session-sync-v1'));
  assert.equal(paths.includes('/api/sessions'), false);
  assert.deepEqual(await client.pendingCloudSessionIds(), ['local']);
});

test('a profile-route rollback keeps the queued summary for a compatible deployment', async () => {
  const { client, calls } = setup(1, { profileGetUnavailable: true });
  const id = await client.beginCloudSession();
  await client.finishCloudSession(id, { averageFatigue: 0, maxFatigue: 0, safetyScore: 100, alertCount: 0 }, 'local');
  await client.retryCloudUploads(true);
  assert.equal(calls.some(call => (
    new URL(call.url).pathname === '/api/session-sync-v1' && call.method === 'POST'
  )), false);
  assert.deepEqual(await client.pendingCloudSessionIds(), ['local']);
});

test('an alert storage failure is persisted as partial when the final summary recovers', async () => {
  const { client, disk, failOutboxWrites } = setup(0);
  const id = await client.beginCloudSession();
  failOutboxWrites(2);
  assert.equal(await client.logCloudAlert(id, 72), false);
  assert.equal(await client.finishCloudSession(id, {
    averageFatigue: 40, maxFatigue: 72, safetyScore: 61, alertCount: 1,
  }, 'local'), true);
  const queued = JSON.parse(disk.get('occulert-session-outbox-v1'));
  assert.equal(queued[0].partial, true);
});

test('a mismatched create response cleans both possible server IDs without another create', async () => {
  const unexpectedId = '99999999-9999-4999-8999-999999999999';
  const { client, calls, disk, hasServerSession } = setup(1, {
    sessionResponseId: unexpectedId,
  });
  const id = await client.beginCloudSession();
  await new Promise(resolve => setTimeout(resolve, 0));
  await client.finishCloudSession(id, { averageFatigue: 0, maxFatigue: 0, safetyScore: 100, alertCount: 0 }, 'local');
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  const sessionCalls = calls.filter(call => new URL(call.url).pathname === '/api/session-sync-v1');
  assert.equal(sessionCalls.filter(call => call.method === 'POST').length, 1);
  assert.equal(sessionCalls.some(call => call.method === 'DELETE'), false);
  const cleanupTargets = calls
    .filter(call => new URL(call.url).pathname === '/api/session-cancel-v1')
    .map(call => JSON.parse(call.body).session_id);
  assert.deepEqual(new Set(cleanupTargets), new Set([id, unexpectedId]));
  assert.equal(hasServerSession(id), false);
  assert.deepEqual(JSON.parse(disk.get('occulert-session-outbox-v1')), []);
  assert.deepEqual(await client.pendingCloudSessionIds(), []);
});

test('a wrong cancellation secret cannot remove a server session or discard its tombstone', async () => {
  const wrongToken = '99999999-9999-4999-8999-999999999999';
  const { client, calls, disk, hasServerSession } = setup(1);
  const id = await client.beginCloudSession();
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), true);
  const queued = JSON.parse(disk.get('occulert-session-outbox-v1'));
  queued[0].cancelToken = wrongToken;
  disk.set('occulert-session-outbox-v1', JSON.stringify(queued));
  await client.signOutOfCloud();
  await client.retryCloudUploads(true);
  await client.retryCloudUploads(true);
  assert.equal(hasServerSession(id), true);
  const tombstones = JSON.parse(disk.get('occulert-session-outbox-v1'));
  assert.equal(tombstones[0].abandoned, true);
  assert.equal(tombstones[0].cancelToken, wrongToken);
  const cleanupCalls = calls.filter(call => new URL(call.url).pathname === '/api/session-cancel-v1');
  assert.ok(cleanupCalls.length >= 1);
  assert.equal(cleanupCalls.every(call => JSON.parse(call.body).cancel_token === wrongToken), true);
});
