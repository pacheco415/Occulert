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
    return Response.json({ ok: status === 200, session: { id: calls.at(-1).session_id } }, { status });
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
