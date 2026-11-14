import { readHistorySourceOwners } from './lib/history-source-owners.mjs';
import { strings, formatString } from '../native-app/lib/strings.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { formatSessionAlertCount } from '../native-app/lib/sessionAlertCount.ts';
import { formatSessionFatigue, formatSessionDuration, sessionSavedAt } from '../native-app/lib/sessionSummaryValues.ts';
import { buildSessionHistoryExport } from '../native-app/lib/sessionHistoryExport.ts';
import { parseSessionHistory, assignMissingSessionIds, serializeSessionHistory, sessionHistoryNeedsMigration } from '../native-app/lib/sessionHistoryData.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function executeNativeModule(path, names, bindings) {
  const source = read(path).replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export (?:default )?/gm, '');
  const exports = {};
  vm.runInNewContext(`${stripTypeScriptTypes(source)}\nObject.assign(exports, { ${names.join(',')} });`,
    { exports, ...bindings, strings, formatString }, { timeout: 1000 });
  return exports;
}

const buildInfo = executeNativeModule('native-app/lib/appBuildInfo.ts', ['currentAppBuildInfo', 'formatAppBuildLabel'], {
  Constants: { expoConfig: { version: 'synthetic', ios: { buildNumber: 'synthetic' } } },
});
const feedbackBindings = {
  formatSessionAlertCount, formatSessionFatigue, formatSessionDuration, sessionSavedAt, Platform: { OS: 'ios' }, Linking: {},
  currentAppBuildInfo: buildInfo.currentAppBuildInfo,
};
const { feedbackUrl } = executeNativeModule('native-app/lib/feedback.ts', ['feedbackUrl'], feedbackBindings);
const feedbackBody = item => new URL(feedbackUrl(item)).searchParams.get('body');

test('actual build labels preserve English and template-literal coercion', () => {
  assert.equal(buildInfo.formatAppBuildLabel({}), 'Version unavailable');
  assert.equal(buildInfo.formatAppBuildLabel({ appVersion: '2.3' }), 'v2.3');
  assert.equal(buildInfo.formatAppBuildLabel({ appVersion: '2.3', appBuildNumber: '42' }), 'v2.3 (42)');
  assert.equal(buildInfo.formatAppBuildLabel({ appBuildNumber: '42' }), 'Build 42');
  for (const value of [true, 7, Infinity, ['4', '2'], '{buildNumber} $&']) {
    assert.equal(buildInfo.formatAppBuildLabel({ appBuildNumber: value }), `Build ${value}`);
  }
});

function feedbackFallbackFixture({ mailAvailable = false, shareFails = false } = {}) {
  const alerts = [], shares = [], urls = [];
  const appState = { currentState: 'active' };
  const api = executeNativeModule('native-app/lib/feedback.ts', ['openFeedbackWithFallback'], {
    ...feedbackBindings, AppState: appState,
    Linking: { openURL: async url => { urls.push(url); if (!mailAvailable) throw Error('Mail unavailable'); } },
    Alert: { alert: (...args) => alerts.push(args) },
    Share: { share: async payload => { shares.push(payload); if (shareFails) throw Error('Share unavailable'); } },
  });
  return { ...api, alerts, shares, urls, appState };
}

test('feedback fallback keeps exact dialogs and shares the unchanged draft only after the explicit choice', async () => {
  const item = { sessionId: 'local-fixture', savedAt: '2026-10-03T12:00:00Z', alertCount: 0, durationSec: 90, avgFatigue: 18 };
  const mailed = feedbackFallbackFixture({ mailAvailable: true });
  await mailed.openFeedbackWithFallback(item);
  assert.deepEqual(mailed.urls, [feedbackUrl(item)]);
  assert.deepEqual(mailed.alerts, []);
  assert.deepEqual(mailed.shares, []);

  const f = feedbackFallbackFixture();
  const pending = f.openFeedbackWithFallback(item);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.alerts[0][0], 'Mail is unavailable');
  assert.equal(f.alerts[0][1], 'Your feedback draft is ready. Share it with an app you choose, then review it before sending to hello@occulert.com. Nothing is sent automatically.');
  assert.deepEqual(Array.from(f.alerts[0][2], button => button.text), ['Cancel', 'Share draft']);
  assert.deepEqual(f.shares, [], 'failure to open Mail does not consent to sharing');
  f.alerts[0][2][1].onPress();
  await pending;
  const draft = new URL(feedbackUrl(item)).searchParams;
  assert.equal(f.shares.length, 1);
  assert.equal(f.shares[0].title, draft.get('subject'));
  assert.equal(f.shares[0].message, 'To: hello@occulert.com\nSubject: ' + draft.get('subject') + '\n\n' + draft.get('body'));
});

test('feedback fallback retains cancellation, foreground protection and the exact share failure dialog', async () => {
  for (const choice of ['cancel', 'background']) {
    const f = feedbackFallbackFixture();
    const pending = f.openFeedbackWithFallback();
    await new Promise(resolve => setImmediate(resolve));
    if (choice === 'background') f.appState.currentState = 'background';
    f.alerts[0][2][choice === 'cancel' ? 0 : 1].onPress();
    await pending;
    assert.deepEqual(f.shares, []);
  }
  const failed = feedbackFallbackFixture({ shareFails: true });
  const pending = failed.openFeedbackWithFallback();
  await new Promise(resolve => setImmediate(resolve));
  failed.alerts[0][2][1].onPress();
  await pending;
  assert.equal(failed.alerts[1][0], 'Feedback draft unavailable');
  assert.equal(failed.alerts[1][1], 'The share sheet could not open. Try again, or email hello@occulert.com from your preferred email app.');
});

// Execute the actual per-record render bindings and the Alerts Text expression.
// JSX layout and native bridges are excluded so root Node CI needs no Expo install.
const historyOwners = readHistorySourceOwners(read);
const historySource = historyOwners.card;
const renderBindings = historySource.match(/(const sessionKey = [\s\S]*?)\n  return \(/)?.[1];
assert.match(historyOwners.screen, /<HistorySessionCard[^>]*item=\{item\} index=\{i\}/);
const alertsExpression = historySource.match(/<Text[^>]*>\{([^{}]*)\}<\/Text>\s*<Text style=\{s\.statLbl\}>\{strings\.history\.card\.alerts\}<\/Text>/)?.[1];
assert.ok(renderBindings && alertsExpression, 'the production history Alerts render must be located');
assert.equal(strings.history.card.alerts, 'Alerts');
function displayedAlerts(item) {
  return vm.runInNewContext(`${renderBindings}\nString(${alertsExpression});`, {
    item, i: 0, formatSessionAlertCount, formatSessionFatigue, sessionRecordKey: () => 'fixture',
    sessionOperations: {}, historyReviewInput: record => record,
    getSessionReviewProgress: () => ({ complete: false }), expandedSessions: {},
  }, { timeout: 1000 });
}

const unavailable = [
  ['absent', undefined], ['null', null], ['boolean false', false], ['boolean true', true],
  ['numeric string', '0'], ['empty string', ''], ['negative', -1], ['fractional', 1.5],
  ['NaN', NaN], ['infinity', Infinity], ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ['object', {}], ['array', []],
];
for (const [label, value] of unavailable) {
  test(`${label} saved alert count is unavailable in history, export and feedback`, () => {
    const item = value === undefined ? { savedAt: '2026-09-26T12:00:00Z' } : { alertCount: value };
    assert.equal(formatSessionAlertCount(value), 'Not recorded');
    assert.equal(displayedAlerts(item), 'Not recorded');
    assert.match(buildSessionHistoryExport([item]), /Alerts: Not recorded(?:\n|$)/);
    assert.match(feedbackBody(item), /Alerts: Not recorded(?:\n|$)/);
  });
}

for (const count of [0, 1, 23, Number.MAX_SAFE_INTEGER]) {
  test(`measured ${count} alerts retains its exact value in all saved summaries`, () => {
    const item = Object.freeze({ alertCount: count, durationSec: 90, avgFatigue: 18 });
    assert.equal(formatSessionAlertCount(count), String(count));
    assert.equal(displayedAlerts(item), String(count));
    assert.match(buildSessionHistoryExport([item]), new RegExp(`Alerts: ${count}\\nAverage fatigue: 18`));
    assert.match(feedbackBody(item), new RegExp(`Alerts: ${count}\\nAverage fatigue: 18`));
  });
}

test('migrating and presenting mixed legacy history preserves saved fields and scores', async () => {
  const bytes = '[ {"savedAt":"legacy", "avgFatigue":31, "safetyScore":69, "unknown":{"keep":true}},'
    + '{"alertCount":0,"avgFatigue":0,"cloudSessionId":"private"},'
    + '{"alertCount":"invalid","avgFatigue":5}, {"alertCount":7,"avgFatigue":10} ]';
  let stored = bytes, writes = 0;
  const { loadSessionHistory } = executeNativeModule('native-app/lib/sessionHistory.ts', ['loadSessionHistory'], {
    parseSessionHistory, assignMissingSessionIds, serializeSessionHistory, sessionHistoryNeedsMigration,
    AsyncStorage: {
      getItem: async () => stored,
      setItem: async (_key, value) => { writes += 1; stored = value; },
      removeItem: async () => { writes += 1; stored = null; },
    },
  });
  const records = await loadSessionHistory();
  const before = JSON.stringify(records);
  assert.deepEqual(Array.from(records, displayedAlerts), ['Not recorded', '0', 'Not recorded', '7']);
  const exported = buildSessionHistoryExport(records);
  records.forEach(feedbackBody);
  assert.equal((exported.match(/Alerts: Not recorded/g) || []).length, 2);
  assert.doesNotMatch(exported, /cloudSessionId|private|safetyScore/);
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(JSON.parse(stored).sessions.map(({sessionId,...record})=>record),JSON.parse(bytes));
  assert.equal(writes, 1, 'only the identity migration writes');
  await loadSessionHistory();
  assert.equal(writes, 1, 'later reads do not rewrite migrated history');
});


for (const [label, value] of [['missing',undefined],['negative',-1],['boolean',false],['blank',''],['numeric string','0'],['nonfinite',Infinity],['NaN',NaN]]) {
 test(`${label} summary values stay unknown in both feedback and export`,()=>{
  const item={durationSec:value,avgFatigue:value,savedAt:'invalid-date',updatedAt:'invalid-too'};
  const feedback=feedbackBody(item),exported=buildSessionHistoryExport([item]);
  assert.match(feedback,/Saved: Unknown date/);assert.match(exported,/Unknown date/);
  assert.match(feedback,/Duration seconds: Not recorded/);assert.match(exported,/Duration: Not recorded/);
  assert.match(feedback,/Average fatigue: Not recorded/);assert.match(exported,/Average fatigue: Not recorded/);
 });
}
test('real zeros, fallback dates and recovered partial summaries remain explicit',()=>{
 const item={durationSec:0,avgFatigue:0,alertCount:0,savedAt:'invalid',updatedAt:'2026-10-03T12:00:00Z',recoveredFromInterruption:true,cloudSessionId:'exclude-me',location:{lat:40},rawMotion:[1]};
 const before=JSON.stringify(item),feedback=feedbackBody(item),exported=buildSessionHistoryExport([item]);
 assert.match(feedback,/Duration seconds: 0/);assert.match(feedback,/Average fatigue: 0/);
 assert.match(exported,/Duration: 0m 0s/);assert.match(exported,/Average fatigue: 0/);
 for(const text of [feedback,exported]){assert.match(text,/2026-10-03T12:00:00.000Z/);assert.match(text,/Recovered partial session/);assert.doesNotMatch(text,/exclude-me|rawMotion|lat:/)}
 assert.equal(JSON.stringify(item),before);
});
