import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryFixture, mixedSessions, COMPLETE_REVIEW } from './lib/history-test-harness.mjs';

test('actual History TSX distinguishes unknown/zero metrics and exposes accessible review expansion', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  await f.mount();
  try {
    assert.match(f.text(), /Not recorded/);
    assert.match(f.text(), /Recovered local checkpoint/);
    const card = f.card('long');
    const toggle = card.findByProps({ accessibilityLabel: 'Show session review details' });
    assert.deepEqual(structuredClone(toggle.props.accessibilityState), { expanded: false });
    await f.invoke(toggle);
    assert.deepEqual(structuredClone(f.card('long').findByProps({ accessibilityLabel: 'Hide session review details' }).props.accessibilityState), { expanded: true });
    assert.match(f.text(), /Lighting: Low light/);
    assert.match(f.text(), /This alert rating stays only on this iPhone/);
  } finally { await f.unmount(); }
});

test('sorting and filters keep rating and deletion actions on their original saved records', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  await f.mount();
  try {
    await f.invoke(f.button('Longest first'));
    assert.equal(f.root.findAll(node => node.props.item?.sessionId).find(node => node.type.name === 'HistorySessionCard')?.props.item.sessionId, 'long');
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Unnecessary' }));
    await f.flush();
    assert.equal(f.records().find(item => item.sessionId === 'long').alertAssessment, 'false_alert');
    assert.equal(f.records().find(item => item.sessionId === 'short').alertAssessment, 'accurate');
    await f.invoke(f.button('Unnecessary alert, 1 sessions'));
    assert.ok(f.card('long'));
    assert.equal(f.card('short'), undefined);
    const deletion = f.card('long').find(node => node.props.accessibilityLabel?.startsWith('Delete session from '));
    await f.invoke(deletion);
    const confirmation = f.alerts.at(-1);
    assert.equal(confirmation[0], 'Delete this session?');
    await f.invoke({ props: { onPress: confirmation[2].find(button => button.style === 'destructive').onPress } });
    await f.flush();
    assert.deepEqual(f.records().map(item => item.sessionId), ['short', 'recovered']);
  } finally { await f.unmount(); }
});

test('pending save disables row actions and sharing and a failed write keeps the confirmed rating', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  await f.mount();
  try {
    const before = f.records();
    const gate = f.holdHistoryWrite();
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Felt right' }));
    assert.match(f.text(), /Saving changes…/);
    const rating = f.card('long').findByProps({ accessibilityLabel: 'Unnecessary' });
    assert.equal(rating.props.disabled, true);
    assert.deepEqual(structuredClone(rating.props.accessibilityState), { selected: false, disabled: true, busy: true });
    assert.equal(f.button('Wait for session changes before sharing summaries').props.disabled, true);
    gate.reject(Error('simulated failed write'));
    await f.flush();
    assert.deepEqual(f.records(), before);
    assert.equal(f.card('long').findByProps({ accessibilityLabel: 'Felt right' }).props.disabled, false);
    assert.match(f.text(), /Needs review/);
  } finally { await f.unmount(); }
});

test('date drafts leave applied filters alone until Apply dates and shown export preserves display order/privacy', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  await f.mount();
  try {
    await f.invoke(f.button('Custom dates'));
    await f.invoke(f.button('From date, YYYY-MM-DD'), 'onChangeText', '2026-10-04');
    await f.invoke(f.button('To date, YYYY-MM-DD'), 'onChangeText', '2026-10-04');
    assert.ok(f.card('long'));
    const apply = f.root.find(node => node.type === 'TouchableOpacity' && node.findAll(child => child.type === 'Text' && child.children.includes('Apply dates')).length === 1);
    await f.invoke(apply);
    assert.ok(f.card('short'));
    assert.equal(f.card('long'), undefined);
    await f.invoke(f.button('Share 1 visible session summaries'));
    assert.match(f.shares[0].message, /Shown view: 2026-10-04 through 2026-10-04/);
    assert.match(f.shares[0].message, /inclusive local calendar dates/);
    assert.doesNotMatch(f.shares[0].message, /do-not-export|privateNote|short|sensorFusion|driverId/);
  } finally { await f.unmount(); }
});

test('continue review expands the same shown record and keeps its ScrollView layout coordinates', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  await f.mount();
  try {
    const button = f.root.find(node => node.props.accessibilityLabel?.startsWith('Continue reviewing the next shown unfinished session'));
    await f.invoke(button);
    assert.ok(f.card('long'));
    assert.equal(f.card('short'), undefined);
    assert.equal(f.card('long').findByProps({ accessibilityLabel: 'Hide session review details' }).props.accessibilityState.expanded, true);
    const cardView = f.card('long').find(node => node.type === 'View' && typeof node.props.onLayout === 'function');
    await f.invoke(cardView, 'onLayout', { nativeEvent: { layout: { y: 240 } } });
    assert.deepEqual(structuredClone(f.scrolls), [{ y: 228, animated: true }]);
    await f.invoke(cardView, 'onLayout', { nativeEvent: { layout: { y: 480 } } });
    assert.equal(f.scrolls.length, 1);
  } finally { await f.unmount(); }
});

test('actual load error UI preserves storage and retries the original History controller', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions(), failReads: true });
  const before = f.stored.get('occulert-session-history');
  await f.mount();
  try {
    assert.match(f.text(), /Your saved sessions were not deleted/);
    assert.equal(f.stored.get('occulert-session-history'), before);
    assert.equal(f.card('short'), undefined);
    f.setReadFailure(false);
    await f.invoke(f.button('Retry local session history'));
    await f.flush();
    assert.ok(f.card('short'));
    assert.doesNotMatch(f.text(), /Couldn’t load local history/);
  } finally { await f.unmount(); }
});

test('empty History still routes through the parked pre-drive screen', async () => {
  const f = createHistoryFixture();
  await f.mount();
  try {
    await f.invoke(f.button('Start a new monitoring session'));
    assert.deepEqual(f.routes, ['/pre-drive']);
  } finally { await f.unmount(); }
});

test('local review observations invoke the original-index condition callbacks', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  await f.mount();
  try {
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Show session review details' }));
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Lighting: Daylight' }));
    await f.flush();
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Phone heat: Warm, tester-reported' }));
    await f.flush();
    const long = f.records().find(item => item.sessionId === 'long');
    assert.equal(long.testConditions.lighting, 'daylight');
    assert.equal(long.deviceImpact.phoneHeat, 'warm');
    assert.deepEqual(f.records().find(item => item.sessionId === 'short').deviceImpact, COMPLETE_REVIEW.deviceImpact);
  } finally { await f.unmount(); }
});

test('Review Next is offered only after a successful save and rejects a stale selected view', async () => {
  const sessions = mixedSessions();
  sessions[1] = { ...sessions[1], ...COMPLETE_REVIEW, alertAssessment: undefined };
  sessions.push({ sessionId: 'next', savedAt: new Date(2026, 9, 1).toISOString(), sensitivity: 'medium' });
  const f = createHistoryFixture({ sessions });
  await f.mount();
  try {
    const gate = f.holdHistoryWrite();
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Felt right' }));
    assert.equal(f.alerts.some(args => args[0] === 'Review complete'), false);
    gate.resolve();
    await f.flush();
    const next = f.alerts.find(args => args[0] === 'Review complete')[2].find(button => button.text === 'Review Next');
    await f.invoke(f.button('Oldest first'));
    await f.invoke({ props: { onPress: next.onPress } });
    assert.equal(f.card('next').findByProps({ accessibilityLabel: 'Show session review details' }).props.accessibilityState.expanded, false);
    assert.equal(f.records().find(item => item.sessionId === 'long').alertAssessment, 'accurate');
  } finally { await f.unmount(); }
});

test('a stale cloud owner cannot retry from an already-rendered History control', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  const scope = { ownerId: 'owner-a', projectUrl: 'https://owned-project.example' };
  f.setPendingCloud({ scope, count: 1, localIds: ['short'] });
  let calls = 0;
  f.setCloudRetry(async () => { calls++; });
  await f.mount();
  try {
    const button = f.button('Retry 1 pending cloud summaries');
    f.setCloudCurrent(false);
    await f.invoke(button);
    await f.flush();
    assert.equal(calls, 0);
    assert.ok(f.card('short'));
    assert.equal(f.root.findAllByProps({ accessibilityLabel: 'Retry 1 pending cloud summaries' }).length, 0);
  } finally { await f.unmount(); }
});

test('forced duplicate cloud retry remains single-flight and unmount cannot refresh the departed screen', async () => {
  const f = createHistoryFixture({ sessions: mixedSessions() });
  const scope = { ownerId: 'owner-a', projectUrl: 'https://owned-project.example' };
  f.setPendingCloud({ scope, count: 1, localIds: ['short'] });
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  f.setCloudRetry(async received => { assert.equal(received, scope); calls++; await pending; });
  await f.mount();
  const button = f.button('Retry 1 pending cloud summaries');
  await f.invoke(button);
  await f.invoke(button);
  assert.equal(calls, 1);
  assert.equal(f.button('Retry 1 pending cloud summaries').props.accessibilityState.busy, true);
  const writes = f.writes.length;
  await f.unmount();
  finish();
  await f.flush();
  assert.equal(f.writes.length, writes);
  assert.equal(calls, 1);
});

test('feedback opens the actual local record draft and preserves its existing private-field whitelist', async () => {
  const sessions = mixedSessions();
  sessions[1].driverId = 'private-driver';
  sessions[1].sensorFusion = { mode: 'observation-only', secret: 'private-fusion' };
  const f = createHistoryFixture({ sessions });
  await f.mount();
  try {
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Send feedback about this session' }));
    await f.flush();
    assert.equal(f.feedback.length, 1);
    const url = new URL(f.feedback[0]);
    assert.equal(url.protocol, 'mailto:');
    assert.match(url.searchParams.get('body'), /Session: long/);
    assert.doesNotMatch(url.searchParams.get('body'), /private-driver|private-fusion|sensorFusion/);
    assert.equal(f.records().find(item => item.sessionId === 'long').driverId, 'private-driver');
  } finally { await f.unmount(); }
});
