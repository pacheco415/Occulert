import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createAppHarness } from './lib/app-page-harness.mjs';
import { assetByStem } from './lib/current-assets.mjs';
const source = readFileSync(new URL('../' + assetByStem('occulert-backend.js'), import.meta.url), 'utf8');
const KEY = 'occulert-cloud-outbox';
const scope = { ownerId: 'owner-a', revision: 1 };
const entry = id => ({ sessionId: id, endedAt: '2026-10-03T12:00:00.000Z', localSessionId: 'local-' + id, stats: { average_fatigue: 20, max_fatigue: 40, safety_score: 70, alert_count: 1, head_nod_count: 0 } });
function fixture(values = new Map(), onSynced = () => {}) {
  let active = true, status = 200, hook = null;
  if (!values.has('occulert-auth')) values.set('occulert-auth', JSON.stringify({ access_token: 'token', refresh_token: 'refresh', expires_at: 9999999999, user: { id: scope.ownerId } }));
  const calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const window = {};
  runInNewContext(source, { window, localStorage: storage, navigator: {}, setTimeout, clearTimeout, AbortController, URLSearchParams, Response, fetch: async (url, options) => {
    if (url === '/api/public-config') return Response.json({ ok: true, supabase: { configured: true, url: 'https://example.supabase.co', anonKey: 'public' } });
    assert.equal(url, '/api/sessions');
    calls.push(JSON.parse(options.body));
    if (hook) return hook();
    return Response.json({ ok: status === 200, session: { id: calls.at(-1).session_id, ended_at: calls.at(-1).ended_at } }, { status });
  } });
  const backend = window.OcculertBackend;
  const outbox = backend.createCloudSummaryOutbox(value => active && value.revision === scope.revision, onSynced);
  return { values, calls, backend, outbox, setStatus: value => { status = value; }, revoke: () => { active = false; }, setHook: value => { hook = value; } };
}
test('offline summary survives a new browser client and retains its finish time', async () => {
  const first = fixture();
  first.outbox.enqueue(scope, entry('one'));
  first.setStatus(503); await first.outbox.flush(scope);
  const next = fixture(first.values);
  assert.ok((await next.outbox.flush(scope)).has('one'));
  assert.equal(next.calls[0].ended_at, entry('one').endedAt);
  assert.equal(next.calls[0].session_id, 'one');
  assert.equal(Object.hasOwn(next.calls[0], 'localSessionId'), false);
  assert.equal(JSON.parse(next.values.get(KEY)).length, 0);
});
test('capacity preserves twenty records and a duplicate preserves the first metrics', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) assert.equal(f.outbox.enqueue(scope, entry(String(i))), true);
  assert.equal(f.outbox.enqueue(scope, entry('overflow')), false);
  assert.equal(f.outbox.enqueue(scope, { ...entry('0'), stats: { ...entry('0').stats, safety_score: 0 } }), true);
  assert.equal(JSON.parse(f.values.get(KEY))[0].stats.safety_score, 70);
});
for (const status of [401, 408, 429, 503, 400, 404]) test(`status ${status} has a safe retry disposition`, async () => {
  const f = fixture(); f.outbox.enqueue(scope, entry('one')); f.setStatus(status); await f.outbox.flush(scope);
  assert.equal(JSON.parse(f.values.get(KEY)).length, [400, 404].includes(status) ? 0 : 1);
});
test('consent-off prevents sending and explicit removal clears saved summaries', async () => {
  const f = fixture(); f.outbox.enqueue(scope, entry('one')); f.revoke(); await f.outbox.flush(scope);
  assert.equal(f.calls.length, 0); f.outbox.clear(); assert.equal(f.values.has(KEY), false);
});
test('sign-out drops pending summaries and a different owner cannot flush them', async () => {
  const f = fixture(); f.outbox.enqueue(scope, entry('one')); f.backend.signOut();
  assert.equal(f.values.has(KEY), false);
  f.backend.adoptSession({ access_token: 'other', refresh_token: 'other-refresh', expires_at: 9999999999, user: { id: 'owner-b' } });
  await f.outbox.flush(scope); assert.equal(f.calls.length, 0);
});
test('a late successful response after consent revocation cannot acknowledge local history', async () => {
  let acknowledge = 0, respond, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(new Map(), () => { acknowledge++; });
  f.outbox.enqueue(scope, entry('one'));
  f.setHook(() => { started(); return new Promise(resolve => { respond = resolve; }); });
  const pending = f.outbox.flush(scope); await ready; f.revoke(); f.outbox.clear();
  respond(Response.json({ ok: true })); await pending;
  assert.equal(acknowledge, 0); assert.equal(f.values.has(KEY), false);
});
test('unreadable storage is preserved and never transmitted', async () => {
  const f = fixture(); f.values.set(KEY, '{broken');
  assert.throws(() => f.outbox.enqueue(scope, entry('one')));
  await assert.rejects(f.outbox.flush(scope));
  assert.equal(f.values.get(KEY), '{broken'); assert.equal(f.calls.length, 0);
});

test('an unconfirmed HTTP success never drops the original summary', async () => {
  const f = fixture(); f.outbox.enqueue(scope, entry('one'));
  f.setHook(() => Response.json({ ok: true, session: { id: 'other' } }));
  assert.equal((await f.outbox.flush(scope)).size, 0);
  assert.equal(JSON.parse(f.values.get(KEY)).length, 1);
});

test('the monitor captures finish time before waiting for pending event delivery', async () => {
  const h = createAppHarness(); h.startSession();
  h.run(`cloudConsent.checked=true;cloudReady=true;backendSessionScope={ownerId:'owner-a',revision:cloudConsentRevision};
    backendSessionId='cloud-one';backendSessionPromise=Promise.resolve('cloud-one');
    let releaseEvent;backendEventQueue=new Promise(resolve=>releaseEvent=resolve);
    window.OcculertBackend={currentUser:()=>({id:'owner-a'}),createCloudSummaryOutbox:()=>({enqueue:(scope,entry)=>{window.pendingSummary=entry;return true},flush:async()=>new Set(['cloud-one'])})};`);
  const expected = h.get('new Date().toISOString()');
  const closing = h.run('stop()');
  h.clock.advance(30000); h.run('releaseEvent()'); await closing;
  assert.equal(h.get('window.pendingSummary.endedAt'), expected);
  assert.equal(h.get('window.pendingSummary.sessionId'), 'cloud-one');
});

test('read-only pending snapshots are copied, owner-scoped and cannot clear a newer account', () => {
  const f=fixture();f.outbox.enqueue(scope,entry('read'));
  const rows=f.outbox.pendingEntries(scope);rows[0].stats.safety_score=0;
  assert.equal(f.outbox.pendingEntries(scope)[0].stats.safety_score,70);
  assert.equal(f.outbox.pendingEntries({...scope,ownerId:'different'}).length,0);
  f.values.set('occulert-auth',JSON.stringify({access_token:'new',refresh_token:'new',expires_at:9999999999,user:{id:'different'}}));
  assert.equal(f.outbox.clearOwner(scope),false);
  assert.equal(JSON.parse(f.values.get(KEY)).length,1);
});


test('a matching ID requires a valid stored end timestamp before acknowledgement',async()=>{
 for (const ended_at of [null,undefined,'','invalid','2026-02-31T12:00:00.000Z']) {
  let acknowledged=0;const f=fixture(new Map(),()=>{acknowledged++});f.outbox.enqueue(scope,entry('one'));
  f.setHook(()=>Response.json({ok:true,session:{id:'one',ended_at}}));
  assert.equal((await f.outbox.flush(scope)).size,0);assert.equal(acknowledged,0);assert.equal(JSON.parse(f.values.get(KEY)).length,1);
  f.setHook(()=>Response.json({ok:true,session:{id:'one',ended_at:'2026-10-03T12:00:00.000000+00:00'}}));
  assert.equal((await f.outbox.flush(scope)).has('one'),true);assert.equal(acknowledged,1);assert.equal(JSON.parse(f.values.get(KEY)).length,0);
 }
});

// Events belong to the consent/account lifecycle that created their session,
// even when the session response or an earlier event is still pending.
function eventHarness() {
  const h = createAppHarness();
  h.run(`cloudConsent.checked = true; cloudReady = true;
    let eventOwner = 'owner-a', eventAuthRevision = 0, releaseSession;
    const sentEvents = [];
    window.OcculertBackend = {
      currentUser: () => eventOwner ? { id: eventOwner } : null,
      captureAuthLifecycle: () => ({ ownerId: eventOwner, revision: eventAuthRevision }),
      isAuthLifecycleCurrent: scope => scope.ownerId === eventOwner && scope.revision === eventAuthRevision,
      startSession: () => new Promise(resolve => { releaseSession = () => resolve({ ok: true, body: { session: { id: 'old-session' } } }); }),
      logEvent: async (id, type, extra, isCurrent) => { if (!isCurrent || isCurrent()) sentEvents.push({ id, type, extra }); }
    };
    beginBackendSession();`);
  return h;
}
for (const [label, change] of [
  ['consent off', 'cloudConsent.checked = false; cloudConsentRevision++;'],
  ['consent off/on', 'cloudConsent.checked = false; cloudConsentRevision++; cloudConsent.checked = true; cloudConsentRevision++;'],
  ['account switch', "eventOwner = 'owner-b'; eventAuthRevision++;"],
  ['same-owner logout/login', "eventOwner = null; eventAuthRevision++; eventOwner = 'owner-a'; eventAuthRevision++;"],
]) test(`queued event is discarded after ${label} while session is pending`, async () => {
  const h = eventHarness();
  h.run(`queueBackendEvent('fatigue'); ${change} releaseSession();`);
  await h.get('backendEventQueue');
  assert.equal(h.get('sentEvents.length'), 0);
});
test('new event cannot attach to a session from an earlier consent lifecycle', async () => {
  const h = eventHarness();
  h.run('releaseSession();'); await h.get('backendSessionPromise');
  h.run("cloudConsentRevision += 2; queueBackendEvent('fatigue');");
  await h.get('backendEventQueue');
  assert.equal(h.get('sentEvents.length'), 0);
});
test('normal stop still drains a valid queued event', async () => {
  const h = eventHarness();
  h.run("queueBackendEvent('fatigue'); const detachedEvents = detachBackendSession().eventQueue; releaseSession();");
  await h.get('detachedEvents');
  assert.equal(h.get('sentEvents.length'), 1);
});
test('event waiting behind another event rechecks consent before dispatch', async () => {
  const h = eventHarness();
  h.run('releaseSession();'); await h.get('backendSessionPromise');
  h.run("let releasePrevious; backendEventQueue = new Promise(resolve => { releasePrevious = resolve; }); queueBackendEvent('fatigue'); cloudConsentRevision += 2; releasePrevious();");
  await h.get('backendEventQueue');
  assert.equal(h.get('sentEvents.length'), 0);
});
test('dispatch guard rejects consent revoked while logEvent awaits credentials', async () => {
  const h = eventHarness();
  h.run(`let releaseCredentials;
    window.OcculertBackend.logEvent = async (id, type, extra, isCurrent) => {
      await new Promise(resolve => { releaseCredentials = resolve; });
      if (!isCurrent || isCurrent()) sentEvents.push({ id, type, extra });
    };
    releaseSession();`);
  await h.get('backendSessionPromise');
  h.run("queueBackendEvent('fatigue');");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.get('typeof releaseCredentials'), 'function');
  h.run('cloudConsentRevision += 2; releaseCredentials();');
  await h.get('backendEventQueue');
  assert.equal(h.get('sentEvents.length'), 0);
});
test('new session after reconsent uploads normally without reviving old session', async () => {
  const h = eventHarness();
  h.run('releaseSession();'); await h.get('backendSessionPromise');
  h.run('cloudConsentRevision += 2; beginBackendSession(); releaseSession();');
  await h.get('backendSessionPromise');
  h.run("queueBackendEvent('fatigue');"); await h.get('backendEventQueue');
  assert.equal(h.get('sentEvents.length'), 1);
});
test('invalidated active session shows one local notice and a new session recovers', async () => {
  const h = eventHarness(); h.startSession();
  h.run('releaseSession();'); await h.get('backendSessionPromise');
  h.run("eventAuthRevision++; queueBackendEvent('fatigue'); queueBackendEvent('fatigue');");
  assert.equal(h.get('syncEl.textContent'), 'LOCAL');
  const notices = () => h.get("logEl.children.filter(entry => entry.textContent.includes('Cloud alerts paused')).length");
  assert.equal(notices(), 1);
  assert.equal(h.get('running'), true, 'local monitoring is not interrupted');
  assert.equal(h.get('sentEvents.length'), 0);
  h.run('beginBackendSession(); releaseSession();'); await h.get('backendSessionPromise');
  h.run("queueBackendEvent('fatigue');"); await h.get('backendEventQueue');
  assert.equal(h.get('sentEvents.length'), 1);
  assert.equal(h.get('syncEl.textContent'), 'ON');
  assert.equal(notices(), 1);
});
test('a detached old queue cannot mark a newer session local', async () => {
  const h = eventHarness(); h.startSession();
  h.run(`queueBackendEvent('fatigue'); const oldQueue = detachBackendSession().eventQueue;
    const releaseOld = releaseSession; eventAuthRevision++; beginBackendSession();
    syncEl.textContent = 'ON'; releaseSession(); releaseOld();`);
  await h.get('backendSessionPromise'); await h.get('oldQueue');
  assert.equal(h.get('syncEl.textContent'), 'ON');
  assert.equal(h.get("logEl.children.filter(entry => entry.textContent.includes('Cloud alerts paused')).length"), 0);
});
test('cloud readiness refresh does not hide an invalidated active-session notice', async () => {
  const h = eventHarness(); h.startSession();
  h.run('window.OcculertBackend.isConfigured = async () => true; releaseSession();');
  await h.get('backendSessionPromise');
  h.run('cloudConsentRevision += 2;');
  await h.run('initCloud()'); await h.run('initCloud()');
  assert.equal(h.get('cloudReady'), true, 'a future session can still use this account');
  assert.equal(h.get('syncEl.textContent'), 'LOCAL');
  assert.equal(h.get("logEl.children.filter(entry => entry.textContent.includes('Cloud alerts paused')).length"), 1);
});
