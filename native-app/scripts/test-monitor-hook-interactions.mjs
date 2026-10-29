import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createMonitorHookFixture, deferred } from './lib/monitor-hook-test-harness.mjs';
import { readNativeMonitorSourceOwners, MONITOR_SOURCE_PATHS } from './lib/monitor-source-owners.mjs';

const eye = (state, score = 61) => ({ ear: .1, perclos: 0, fatigueScore: score, closedDurationMs: 0, state });
const identity = (kind, id = kind) => ({ state: 'available', deviceId: 'front', deviceType: 'virtual', isVirtual: true,
  constituentDeviceTypes: ['outer', 'inner'], streamingDeviceType: kind, streamingUniqueId: id, streamingType: kind });

test('mounted cloud hook counts locally before session/earlier work and preserves the original detection snapshot', async () => {
  const f = createMonitorHookFixture(), session = deferred(), earlier = deferred();
  f.owner.cloudSessionRef.current = session.promise; f.owner.cloudEventQueueRef.current = earlier.promise;
  await f.mount();
  try {
    const callback = f.api.cloud, refs = { count: f.owner.alertCountRef, queue: f.owner.cloudEventQueueRef };
    await f.run(() => f.api.cloud(eye('closed', 61), 1_234));
    assert.deepEqual(f.events.counts, [1]); assert.equal(f.events.logs.length, 0);
    const pending = f.owner.cloudEventQueueRef.current;
    await f.update(); assert.equal(f.api.cloud, callback); assert.equal(f.owner.alertCountRef, refs.count); assert.equal(f.owner.cloudEventQueueRef, refs.queue);
    session.resolve('cloud-detected'); earlier.resolve(); await pending;
    assert.deepEqual(f.events.logs, [{ id: 'cloud-detected', score: 61, occurredAt: '1970-01-01T00:00:01.234Z' }]);
    await f.run(() => f.api.cloud(eye('closed', 90), 5_000)); assert.deepEqual(f.events.counts, [1]);
    await f.run(() => { f.api.cloud(eye('open'), 5_100); f.api.cloud(eye('closed'), 5_200); });
    await f.owner.cloudEventQueueRef.current; assert.deepEqual(f.events.counts, [1, 2]);
  } finally { await f.unmount(); }
});

test('late cloud completion uses the original guarded action and cannot replace a later screen queue', async () => {
  const f = createMonitorHookFixture(), wait = deferred(); f.cloudWait = wait.promise; await f.mount();
  await f.run(() => f.api.cloud(eye('closed'), 1_500)); const pending = f.owner.cloudEventQueueRef.current;
  f.authorized = false; f.owner.cloudSessionRef.current = null;
  const replacement = Promise.resolve(); f.owner.cloudEventQueueRef.current = replacement;
  await f.unmount(); wait.resolve(); await pending;
  assert.deepEqual(f.events.logs, []); assert.equal(f.owner.cloudEventQueueRef.current, replacement); assert.deepEqual(f.events.counts, [1]);
});

test('mounted cloud hook adopts native retries at detection and joins earlier work without delaying local counts', async () => {
  const f = createMonitorHookFixture(), pending = deferred(), earlier = deferred(), adopted = [];
  f.owner.cloudEventQueueRef.current = earlier.promise;
  f.owner.queueNativeCloudAlert = (session, score, occurredAt) => { adopted.push({ session, score, occurredAt }); return pending.promise; };
  f.owner.logCloudAlert = async () => assert.fail('adopted work cannot become an unkeyed event');
  await f.mount();
  try {
    await f.run(() => f.api.cloud(eye('closed', 61), 1_234));
    assert.deepEqual(f.events.counts, [1]); assert.equal(adopted.length, 1);
    assert.equal(adopted[0].session, f.owner.cloudSessionRef.current); assert.equal(adopted[0].score, 61);
    assert.equal(adopted[0].occurredAt, '1970-01-01T00:00:01.234Z');
    let settled = false; const work = f.owner.cloudEventQueueRef.current.then(() => { settled = true; });
    pending.resolve(); await f.run(() => {}); assert.equal(settled, false);
    earlier.resolve(); await work; assert.equal(settled, true); assert.deepEqual(f.events.logs, []);
  } finally { await f.unmount(); }
});

test('mounted checkpoint hook snapshots current owner refs, keeps 15-second cadence and cleans inactive intervals', async () => {
  const f = createMonitorHookFixture({ running: true }), wait = deferred(); f.checkpointWait = wait.promise; await f.mount();
  try {
    assert.equal([...f.intervals.values()].filter(item => item.delay === 15_000).length, 2, 'checkpoint and device-condition timers retain their existing cadence');
    f.owner.fatigueSumRef.current = 63; f.owner.fatigueSamplesRef.current = 2; f.owner.alertCountRef.current = 3;
    let pending; await f.run(() => { pending = f.api.checkpoint(16_500); });
    assert.equal(f.events.checkpoints.length, 1); const snapshot = f.events.checkpoints[0];
    assert.equal(snapshot.sessionId, 'local-original'); assert.equal(snapshot.durationSec, 15); assert.equal(snapshot.avgFatigue, 32); assert.equal(snapshot.alertCount, 3);
    f.owner.activeSessionIdRef.current = 'local-new'; f.owner.fatigueSumRef.current = 0;
    wait.resolve(); await pending; assert.equal(snapshot.sessionId, 'local-original'); assert.equal(snapshot.avgFatigue, 32);
    const oldTimer = [...f.intervals.values()].find(item => item.delay === 15_000).work;
    f.owner.isRunningRef.current = false; await f.update({ isRunning: false });
    assert.equal([...f.intervals.values()].filter(item => item.delay === 15_000).length, 0);
    await f.run(oldTimer); assert.equal(f.events.checkpoints.length, 1, 'a disposed tick cannot persist a stopped owner');
  } finally { await f.unmount(); }
  assert.equal(f.intervals.size, 0);
});

test('checkpoint timer failures stay best effort while explicit checkpoint callers retain storage rejection', async () => {
  const f = createMonitorHookFixture({ running: true });
  f.owner.saveActiveSessionCheckpoint = async () => { throw Error('unavailable storage'); };
  await f.mount();
  try {
    await f.tick(15_000);
    await assert.rejects(f.api.checkpoint(), /unavailable storage/);
    assert.equal(f.owner.isRunningRef.current, true); assert.deepEqual(f.events.stops, []);
  } finally { await f.unmount(); }
});

test('mounted camera hook ignores disposed native callbacks and a late interruption read without spending restart budget', async () => {
  const f = createMonitorHookFixture({ running: true }), wait = deferred(); f.interruptionWait = wait.promise; await f.mount();
  const callback = f.observations.camera[0].listener;
  let pending; await f.run(() => { pending = f.api.camera.handleCameraError({ code: 'unknown/unknown' }, 0, 0); });
  await f.unmount(); wait.resolve(); await pending;
  callback({ interrupted: true, reason: 'multitasking' });
  assert.equal(f.owner.cameraRestartCountRef.current, 0); assert.equal(f.events.cues, 0); assert.deepEqual(f.events.stops, []);
  assert.equal(f.observations.camera[0].removed, true); assert.equal(f.intervals.size, 0);
});

test('camera hooks preserve ownership across rerenders and permanently latch a named interruption until explicit start', async () => {
  const f = createMonitorHookFixture({ running: true }); await f.mount();
  try {
    const callback = f.api.camera.handleCameraError, observation = f.observations.camera[0]; await f.update();
    assert.equal(f.api.camera.handleCameraError, callback); assert.equal(f.observations.camera.length, 1); assert.equal(observation.removed, false);
    await f.run(() => observation.listener({ interrupted: true, reason: 'multitasking' }));
    assert.equal(f.events.cues, 1); assert.equal(f.events.stops.length, 1); assert.equal(f.owner.cameraRestartCountRef.current, 0);
    await f.run(() => observation.listener({ interrupted: false, reason: 'none' }));
    assert.equal(f.owner.multitaskingCameraPausedRef.current, true); assert.equal(f.events.stops.length, 1);
    await f.update({ device: { id: 'front-new' } });
    assert.equal(observation.removed, true); await f.run(() => observation.listener({ interrupted: true, reason: 'multitasking' }));
    assert.equal(f.events.stops.length, 1);
  } finally { await f.unmount(); }
});

test('mounted camera-identity hook clears the screen baseline and rejects late storage completion after disposal', async () => {
  const f = createMonitorHookFixture({ experiment: true, preview: true }), wait = deferred(); f.clearWait = wait.promise; await f.mount();
  const subscription = f.observations.identity[0];
  await f.run(() => subscription.listener(identity('outer')));
  const priorClears = f.events.clears;
  await f.run(() => subscription.listener(identity('inner')));
  assert.equal(f.owner.eyeBaselineRef.current, null); assert.equal(f.owner.eyeBaseline, null); assert.equal(f.events.clears, priorClears + 1);
  assert.equal(f.owner.baselineCanSaveRef.current, false);
  await f.unmount(); wait.resolve(); await Promise.resolve(); await Promise.resolve();
  subscription.listener(identity('outer', 'late')); assert.equal(f.owner.baselineCanSaveRef.current, false); assert.equal(f.events.clears, priorClears + 1);
  assert.equal(subscription.removed, true);
});

test('mounted frame hook retains stable worklet values and the original 100ms/200ms cadence', async () => {
  const f = createMonitorHookFixture({ running: true }); await f.mount();
  try {
    const frame = { width: 640, height: 480 }, original = f.api.analysis.frameProcessor;
    await f.at(1_000, () => original(frame)); await f.at(1_099, () => original(frame)); await f.at(1_100, () => original(frame));
    assert.equal(f.detections, 2);
    await f.update(); assert.equal(f.api.analysis.frameProcessor, original);
    await f.update({ cameraLoadPolicy: { mode: 'reduced', reason: 'heat', analysisIntervalMs: 200 } });
    assert.equal(f.api.analysis.frameProcessor, original);
    await f.at(1_200, () => original(frame)); assert.equal(f.detections, 2);
    await f.at(1_300, () => original(frame)); assert.equal(f.detections, 3);
    f.owner.isRunningRef.current = false; const samples = f.events.metrics.length;
    await f.at(1_500, () => original(frame)); assert.equal(f.events.metrics.length, samples, 'a late frame cannot mutate stopped metrics');
  } finally { await f.unmount(); }
});

test('parked preview hook shares the screen start/stop guards and invalidates only its current camera callbacks', async () => {
  const f = createMonitorHookFixture(); await f.mount();
  try {
    const toggle = f.api.togglePreview, owner = f.owner.cameraCallbackOwnerRef.current;
    await f.run(toggle); assert.equal(f.owner.setupPreviewActiveRef.current, true); assert.equal(f.owner.cameraCallbackOwnerRef.current, owner + 1);
    f.owner.startingRef.current = true; await f.run(toggle);
    assert.equal(f.owner.setupPreviewActiveRef.current, true); assert.equal(f.owner.cameraCallbackOwnerRef.current, owner + 1);
    f.owner.startingRef.current = false; await f.update(); assert.equal(f.api.togglePreview, toggle);
    await f.run(toggle); assert.equal(f.owner.setupPreviewActiveRef.current, false); assert.equal(f.owner.cameraCallbackOwnerRef.current, owner + 2);
  } finally { await f.unmount(); }
});

test('fixed source-owner proof rejects detached hooks, duplicate owners and substituted screen actions', () => {
  const original = readNativeMonitorSourceOwners();
  const byPath = Object.fromEntries(Object.entries(MONITOR_SOURCE_PATHS).map(([owner, path]) => [path, original[owner]]));
  const mutations = [
    ['app/monitor.tsx', source => source.replace("import { useMonitorCloudAlerts } from '../hooks/useMonitorCloudAlerts';", '')],
    ['app/monitor.tsx', source => source.replace("import { useMonitorCloudAlerts }", "import type { useMonitorCloudAlerts }")],
    ['app/monitor.tsx', source => source.replace("import { useMonitorCloudAlerts }", "import { type useMonitorCloudAlerts }")],
    ['app/monitor.tsx', source => source.replace('const recordCloudAlertTransition = useMonitorCloudAlerts(', 'const recordCloudAlertTransition = detachedCloudHook(')],
    ['app/monitor.tsx', source => source.replace('cloudEventQueueRef, logCloudAlert', 'cloudEventQueueRef, logCloudAlert: anotherLogger')],
    ['app/monitor.tsx', source => source.replace('frameProcessor={frameProcessor}', 'frameProcessor={anotherProcessor}')],
    ['hooks/useMonitorCloudAlerts.ts', source => source + '\nexport function useMonitorCloudAlerts() {}\n'],
    ['hooks/useMonitorCloudAlerts.ts', source => source.replace('export function useMonitorCloudAlerts(', 'export declare function useMonitorCloudAlerts(')],
    ['components/monitor/MonitorPresentation.tsx', source => source.replace("import { monitorStyles as s } from './monitorStyles';", '')],
  ];
  for (const [path, change] of mutations) {
    assert.notEqual(change(byPath[path]), byPath[path], 'Mutation must alter the actual owner');
    assert.throws(() => readNativeMonitorSourceOwners(name => name === path ? change(byPath[name]) : byPath[name]));
  }
});

test('site audit resolves monitor ownership from its selected repository reader', () => {
  const source = readFileSync(new URL('../../scripts/audit-site.mjs', import.meta.url), 'utf8');
  const file = ts.createSourceFile('audit-site.mjs', source, ts.ScriptTarget.Latest, true);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'readNativeMonitorSourceOwners') calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file); assert.equal(calls.length, 1); assert.equal(calls[0].arguments.length, 1);
  const owners = readNativeMonitorSourceOwners(), selected = Object.fromEntries(owners.runtimeOwners.map(owner => ['native-app/' + owner.path, owner.source]));
  selected['native-app/components/monitor/monitorStyles.ts'] += '\n// selected-repository-only\n';
  const reads = [];
  const read = vm.runInNewContext('(' + calls[0].arguments[0].getText(file) + ')', { read: path => {
    assert.ok(Object.hasOwn(selected, path), 'The audit must select a native file in its repository'); reads.push(path); return selected[path];
  } });
  const actual = readNativeMonitorSourceOwners(read);
  assert.equal(reads.length, Object.keys(MONITOR_SOURCE_PATHS).length); assert.match(actual.styles, /selected-repository-only/);
});

test('actual whole-monitor negative guards reject forbidden code in every fixed extracted runtime owner', () => {
  const files = ['test-performance-contracts.mjs', 'test-remaining-security-fixes.mjs', 'test-monitor-lifecycle.mjs', 'audit-site.mjs'];
  const markers = ['setSessionTime', 'await startHeadphoneMotion()', "Alert.alert('Monitoring stopped'", "sensorFault: { position: 'absolute'",
    'setIsAudioActiveAsync', 'const wasRunning = isRunning;', 'export default function MonitorScreen() { useKeepAwake(',
    'Worklets.createRunOnJS', "metrics: {\n    position: 'absolute'"];
  const constraints = [];
  for (const name of files) {
    const source = readFileSync(new URL('../../scripts/' + name, import.meta.url), 'utf8');
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const negative = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'assertNotIncludes')?.getText(file);
    function visit(node) {
      if (ts.isForOfStatement(node) && /^(?:owners|monitorOwners)\.runtimeOwners$/.test(node.expression.getText(file))) {
        const statement = ts.isExpressionStatement(node.statement) ? node.statement.expression : null;
        assert.ok(statement && ts.isCallExpression(statement));
        const argument = statement.arguments[1], pattern = argument.getText(file);
        const marker = ts.isStringLiteral(argument) ? argument.text : markers.find(value => vm.runInNewContext(pattern).test(value));
        assert.ok(marker, 'Every real exclusion guard has a matching forbidden-code probe');
        constraints.push({ code: node.getText(file), marker, negative });
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  assert.equal(constraints.length, 11, 'Retain every original whole-monitor exclusion');
  const original = readNativeMonitorSourceOwners();
  for (const constraint of constraints) for (const target of original.runtimeOwners) {
    const selected = Object.fromEntries(original.runtimeOwners.map(owner => [owner.path, owner.source]));
    selected[target.path] += '\n/* forbidden-code probe: ' + constraint.marker + ' */\n';
    const owners = readNativeMonitorSourceOwners(path => selected[path]);
    const context = { owners, monitorOwners: owners, assert,
      assertionSource: path => selected[path.replace(/^native-app\//, '')], fail: message => { throw Error(message); } };
    const code = (constraint.negative ?? '') + '\n' + constraint.code;
    assert.throws(() => vm.runInNewContext(code, context), 'A moved exclusion must reject its original forbidden code in ' + target.path);
  }
});
