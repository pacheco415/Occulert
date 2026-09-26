import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { formatSessionAlertCount } from '../native-app/lib/sessionAlertCount.ts';
import { buildSessionHistoryExport } from '../native-app/lib/sessionHistoryExport.ts';
import { parseSessionHistory } from '../native-app/lib/sessionHistoryData.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function executeNativeModule(path, names, bindings) {
  const source = read(path).replace(/^import[\s\S]*?;\s*/gm, '').replace(/^export (?:default )?/gm, '');
  const exports = {};
  vm.runInNewContext(`${stripTypeScriptTypes(source)}\nObject.assign(exports, { ${names.join(',')} });`,
    { exports, ...bindings }, { timeout: 1000 });
  return exports;
}

const { feedbackUrl } = executeNativeModule('native-app/lib/feedback.ts', ['feedbackUrl'], {
  formatSessionAlertCount, Platform: { OS: 'ios' }, Linking: {},
  currentAppBuildInfo: () => ({ appVersion: 'synthetic', appBuildNumber: 'synthetic' }),
});
const feedbackBody = item => new URL(feedbackUrl(item)).searchParams.get('body');

// Execute the actual per-record render bindings and the Alerts Text expression.
// JSX layout and native bridges are excluded so root Node CI needs no Expo install.
const historySource = read('native-app/app/history.tsx');
const renderBindings = historySource.match(/group\.sessions\.map\(\(\{ item, index: i \}\) => \{([\s\S]*?)return \(/)?.[1];
const alertsExpression = historySource.match(/<Text[^>]*>\{([^{}]*)\}<\/Text>\s*<Text style=\{s\.statLbl\}>Alerts<\/Text>/)?.[1];
assert.ok(renderBindings && alertsExpression, 'the production history Alerts render must be located');
function displayedAlerts(item) {
  return vm.runInNewContext(`${renderBindings}\nString(${alertsExpression});`, {
    item, i: 0, formatSessionAlertCount, sessionRecordKey: () => 'fixture',
    sessionOperations: {}, getSessionReviewProgress: () => ({ complete: false }), expandedSessions: {},
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

test('reading and presenting mixed legacy history preserves saved bytes and scoring fields', async () => {
  const bytes = '[ {"savedAt":"legacy", "avgFatigue":31, "safetyScore":69, "unknown":{"keep":true}},'
    + '{"alertCount":0,"avgFatigue":0,"cloudSessionId":"private"},'
    + '{"alertCount":"invalid","avgFatigue":5}, {"alertCount":7,"avgFatigue":10} ]';
  let stored = bytes, writes = 0;
  const { loadSessionHistory } = executeNativeModule('native-app/lib/sessionHistory.ts', ['loadSessionHistory'], {
    parseSessionHistory,
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
  assert.equal(stored, bytes);
  assert.equal(writes, 0);
});
