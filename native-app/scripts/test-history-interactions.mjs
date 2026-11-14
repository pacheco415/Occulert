import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryFixture, mixedSessions, COMPLETE_REVIEW } from './lib/history-test-harness.mjs';
import { parseSessionHistory } from '../lib/sessionHistoryData.ts';

const unansweredSnapshot = () => ({ version: 1, mode: 'observation-only', evidence: 'software-output-accepted', candidates: 6,
  byMotion: { unknown: 1, unavailable: 1, denied: 1, stale: 1, 'not-moving': 1, 'reported-activity': 1 } });

function acceptedHistoryFixture(sessions) {
  const raw = JSON.stringify({ schemaVersion: 1, sessions });
  assert.deepEqual(parseSessionHistory(raw), sessions, 'these saved records are accepted by the production parser');
  const fixture = createHistoryFixture({ sessions });
  fixture.stored.set('occulert-session-history', raw);
  return { fixture, raw };
}

function renderedText(node) {
  return node.findAllByType('Text').map(text => text.children.join(''));
}

test('legacy build fields keep JSX text behavior without rewriting accepted History records', async () => {
  const variants = [
    { appVersion: true, appBuildNumber: '1', expected: 'App  · Build 1' },
    { appVersion: '2', appBuildNumber: true, expected: 'App 2 · Build ' },
    { appVersion: false, appBuildNumber: null, expected: 'App not recorded · Build not recorded' },
    { appVersion: 0, appBuildNumber: 0, expected: 'App not recorded · Build not recorded' },
    { appVersion: ['v', true, null, 2, ['.', '3', false]], appBuildNumber: [true, 4], expected: 'App v2.3 · Build 4' },
    { appVersion: 7, appBuildNumber: 8, expected: 'App 7 · Build 8' },
  ];
  const sessions = variants.map(({ expected, ...values }, index) => ({
    sessionId: `legacy-build-${index}`, savedAt: '2026-10-04T08:00:00.000Z', durationSec: 3, ...values,
  }));
  const { fixture: f, raw } = acceptedHistoryFixture(sessions);
  await f.mount();
  try {
    variants.forEach(({ expected }, index) => assert.ok(renderedText(f.card(`legacy-build-${index}`)).includes(expected), expected));
    assert.deepEqual(f.records(), sessions);
    assert.equal(f.stored.get('occulert-session-history'), raw);
    assert.equal(f.writes.filter(write => write.key === 'occulert-session-history').length, 0);
  } finally { await f.unmount(); }
});

test('overflow from accepted finite fusion counters remains visible in actual History', async () => {
  const sensorFusion = {
    mode: 'observation-only', camera: { samples: 1, trackedSamples: 1 },
    headphone: { samples: 0 }, watch: { checked: false },
    coincidences: { cameraHeadphoneNods: 1e308, elevatedCameraHeadphoneNods: 1e308 },
  };
  const sessions = [0, 1].map(index => ({ sessionId: `large-${index}`, savedAt: '2026-10-04T08:00:00.000Z', sensorFusion }));
  const { fixture: f, raw } = acceptedHistoryFixture(sessions);
  await f.mount();
  try {
    await f.invoke(f.root.findByProps({ accessibilityHint: 'Shows local aggregate camera, headphone, and Apple Watch observation coverage' }));
    assert.ok(renderedText(f.root).includes('Camera + headphone head-nod overlap: Infinity across 2 sessions · Infinity during elevated camera observations'));
    await f.invoke(f.card('large-0').findByProps({ accessibilityLabel: 'Show session review details' }));
    assert.ok(renderedText(f.card('large-0')).includes('Head-nod overlap: 1e+308 camera + headphone · 1e+308 during elevated camera observations'));
    assert.deepEqual(f.records(), sessions);
    assert.equal(f.stored.get('occulert-session-history'), raw);
    assert.equal(f.writes.filter(write => write.key === 'occulert-session-history').length, 0);
  } finally { await f.unmount(); }
});

test('legacy diagnostic fields retain JSX suppression and template interpolation separately', async () => {
  const sessions = [{
    sessionId: 'legacy-diagnostics', savedAt: '2026-10-04T08:00:00.000Z',
    monitorPerformance: {
      timeToFirstSampleMs: true, p95InferenceMs: true, averageSampleIntervalMs: false, uiUpdatesPerSecond: null,
      alertTiming: { alertsTriggered: 1, averagePhoneDispatchMs: true, maxPhoneDispatchMs: false,
        watchLiveAcknowledgements: true, watchResults: false, averageWatchRoundTripMs: true, watchQueuedFallbacks: true },
    },
    headNodObservations: true, cameraHeadNodObservations: false, headphoneHeadNodObservations: true, headphoneMotionSamples: null,
    sensorFusion: { mode: 'observation-only', camera: { trackedSamples: true, samples: false, watchSamples: null },
      headphone: {}, watch: {}, coincidences: { cameraHeadphoneNods: false, elevatedCameraHeadphoneNods: true } },
  }];
  const { fixture: f, raw } = acceptedHistoryFixture(sessions);
  await f.mount();
  try {
    await f.invoke(f.card('legacy-diagnostics').findByProps({ accessibilityLabel: 'Show session review details' }));
    const text = renderedText(f.card('legacy-diagnostics'));
    for (const expected of [
      'First camera sample: true ms',
      'Inference p95:  ms · Average sample interval:  ms',
      'Display updates: /sec · Camera stalls: ',
      'Phone software dispatch:  ms average ·  ms max',
      'Watch live acknowledgements: / · true ms average round trip · true queued backup',
      'Camera candidates: ',
      'Headphone candidates:  from 0 transient samples',
      'Camera: / tracked samples · 0 watch · 0 closed',
      'Head-nod overlap:  camera + headphone ·  during elevated camera observations',
    ]) assert.ok(text.includes(expected), expected);
    assert.deepEqual(f.records(), sessions);
    assert.equal(f.stored.get('occulert-session-history'), raw);
    assert.equal(f.writes.filter(write => write.key === 'occulert-session-history').length, 0);
  } finally { await f.unmount(); }
});

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
  sessions[1].unansweredAlerts = unansweredSnapshot();
  const f = createHistoryFixture({ sessions });
  await f.mount();
  try {
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Send feedback about this session' }));
    await f.flush();
    assert.equal(f.feedback.length, 1);
    const url = new URL(f.feedback[0]);
    assert.equal(url.protocol, 'mailto:');
    assert.match(url.searchParams.get('body'), /Session: long/);
    assert.doesNotMatch(url.searchParams.get('body'), /private-driver|private-fusion|sensorFusion|unansweredAlerts|byMotion|software-output-accepted|Unanswered-alert candidates/);
    assert.equal(f.records().find(item => item.sessionId === 'long').driverId, 'private-driver');
  } finally { await f.unmount(); }
});

test('actual expanded History shows optional local observation counts and excludes them from sharing', async () => {
  const sessions = mixedSessions(); sessions[1].unansweredAlerts = unansweredSnapshot();
  const f = createHistoryFixture({ sessions }); await f.mount();
  try {
    assert.doesNotMatch(f.text(), /Unanswered-alert candidates/);
    await f.invoke(f.card('long').findByProps({ accessibilityLabel: 'Show session review details' }));
    assert.match(f.text(), /Unanswered-alert candidates \(experimental\)/);
    assert.match(f.text(), /Motion context: Unknown/); assert.match(f.text(), /Reported stationary/); assert.match(f.text(), /Reported automotive activity/);
    assert.match(f.text(), /software acceptance of critical output/); assert.match(f.text(), /whether a person heard or felt it is unverified/);
    assert.match(f.text(), /Local observation only; no messages are sent/);
    await f.invoke(f.button('Share 3 visible session summaries'));
    assert.doesNotMatch(f.shares[0].message, /unansweredAlerts|byMotion|software-output-accepted|Unanswered-alert candidates|Reported stationary|Reported automotive activity/);
    assert.deepEqual(f.records().find(item => item.sessionId === 'long').unansweredAlerts, unansweredSnapshot());
  } finally { await f.unmount(); }
});

test('malformed optional observation diagnostics fail the actual History load without rewriting legacy bytes', async () => {
  const sessions = mixedSessions(); sessions[1].unansweredAlerts = { ...unansweredSnapshot(), rawTimeline: [] };
  const f = createHistoryFixture({ sessions }), original = f.stored.get('occulert-session-history'); await f.mount();
  try {
    assert.match(f.text(), /Your saved sessions were not deleted/);
    assert.equal(f.stored.get('occulert-session-history'), original); assert.equal(f.writes.length, 0);
    assert.equal(f.card('long'), undefined);
  } finally { await f.unmount(); }
});
