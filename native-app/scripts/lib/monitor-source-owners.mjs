import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as checkpointModel from '../../lib/monitorCheckpointModel.ts';

export const MONITOR_SOURCE_PATHS = Object.freeze({
  screen: 'app/monitor.tsx',
  cloud: 'hooks/useMonitorCloudAlerts.ts',
  checkpoint: 'hooks/useMonitorCheckpoint.ts',
  camera: 'hooks/useMonitorCameraLifecycle.ts',
  identity: 'hooks/useMonitorCameraIdentity.ts',
  analysis: 'hooks/useMonitorAnalysis.ts',
  view: 'components/monitor/MonitorPresentation.tsx',
  styles: 'components/monitor/monitorStyles.ts',
  presentationModel: 'lib/monitorPresentationModel.ts',
  checkpointModel: 'lib/monitorCheckpointModel.ts',
});
const HOOKS = Object.freeze({ cloud: 'useMonitorCloudAlerts', checkpoint: 'useMonitorCheckpoint', camera: 'useMonitorCameraLifecycle', identity: 'useMonitorCameraIdentity', analysis: 'useMonitorAnalysis' });
const root = new URL('../../', import.meta.url);
const visit = (node, callback) => { callback(node); ts.forEachChild(node, child => visit(child, callback)); };

/** Fixed actual owners only; executable source is never concatenated or copied. */
export function readNativeMonitorSourceOwners(read = relative => readFileSync(new URL(relative, root), 'utf8')) {
  const sources = Object.fromEntries(Object.entries(MONITOR_SOURCE_PATHS).map(([owner, path]) => [owner, read(path)]));
  const ast = Object.fromEntries(Object.entries(sources).map(([owner, source]) => {
    const file = ts.createSourceFile(MONITOR_SOURCE_PATHS[owner], source, ts.ScriptTarget.Latest, true);
    assert.equal(file.parseDiagnostics.length, 0, `Parse the actual ${owner} owner`);
    return [owner, file];
  }));
  function imported(owner, name, specifier, local = name) {
    const matches = ast[owner].statements.filter(node => ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && node.moduleSpecifier.text === specifier)
      .flatMap(node => node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements : [])
      .filter(node => !node.isTypeOnly && (node.propertyName?.text ?? node.name.text) === name && node.name.text === local);
    assert.equal(matches.length, 1, `One real ${owner} import for ${local}`);
  }
  function calls(owner, name) {
    const found = [];
    visit(ast[owner], node => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) found.push(node); });
    assert.equal(found.length, 1, `One unambiguous ${owner} call to ${name}`);
    return found[0];
  }
  function rendered(owner, name) {
    const found = [];
    visit(ast[owner], node => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast[owner]) === name) found.push(node);
    });
    assert.equal(found.length, 1, `One actual ${name} render in ${owner}`);
    return found[0];
  }
  function wired(call, names) {
    const object = call.arguments[0];
    assert.ok(object && ts.isObjectLiteralExpression(object), 'Hook bindings remain explicit');
    for (const name of names) {
      const found = object.properties.filter(node => node.name?.getText(ast.screen) === name);
      assert.equal(found.length, 1, `One real screen binding for ${name}`);
      const value = ts.isShorthandPropertyAssignment(found[0]) ? found[0].name : found[0].initializer;
      assert.ok(ts.isIdentifier(value) && value.text === name, `Use the screen-owned ${name}`);
    }
  }
  for (const [owner, name] of Object.entries(HOOKS)) {
    imported('screen', name, '../hooks/' + name);
    const functions = ast[owner].statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.equal(functions.length, 1, `One exported implementation of ${name}`);
    assert.ok(functions[0].modifiers?.some(node => node.kind === ts.SyntaxKind.ExportKeyword));
    assert.ok(functions[0].body && !functions[0].modifiers?.some(node => node.kind === ts.SyntaxKind.DeclareKeyword), `${name} must have a runtime implementation`);
    calls('screen', name);
    assert.doesNotMatch(sources[owner], /from\s+['"](?:.*cloudSync|.*eyeBaselineStorage|.*sessionRecovery|@react-native-async-storage\/async-storage)['"]/,
      'Protected cloud/storage actions stay injected by the screen');
  }
  wired(calls('screen', HOOKS.cloud), ['cloudSessionRef', 'cloudEventQueueRef', 'logCloudAlert', 'queueNativeCloudAlert', 'alertCountRef', 'prevAlertingRef', 'setAlertCount']);
  wired(calls('screen', HOOKS.checkpoint), ['activeSessionIdRef', 'sessionStartedAtRef', 'isRunningRef', 'saveActiveSessionCheckpoint']);
  wired(calls('screen', HOOKS.identity), ['clearDeviceEyeBaseline', 'loadDeviceEyeBaseline', 'loadSavedSensitivity', 'eyeBaselineRef', 'setEyeBaseline',
    'startingRef', 'stoppingRef', 'baselineBusyRef', 'cameraInterruptionGenerationRef', 'cameraCallbackOwnerRef', 'setSetupPreviewActive']);
  wired(calls('screen', HOOKS.camera), ['handleStopRef', 'cameraEpochRef', 'cameraDeviceIdRef', 'cameraCallbackOwnerRef', 'deliverMonitoringPausedCue']);
  wired(calls('screen', HOOKS.analysis), ['saveDeviceEyeBaseline', 'processEyeOpenness', 'processNoFace', 'recordCloudAlertTransition', 'isRunningRef']);
  for (const name of ['MonitorPresentation', 'MonitorPermissionState', 'MonitorCameraUnavailable']) {
    imported('screen', name, '../components/monitor/MonitorPresentation');
    rendered('screen', name);
  }
  const view = rendered('screen', 'MonitorPresentation');
  for (const name of ['device', 'frameProcessor', 'handleCaptureConfiguration', 'handleCameraError', 'handleStart', 'handleStop', 'recordAlertTiming']) {
    const matches = view.attributes.properties.filter(node => ts.isJsxAttribute(node) && node.name.text === name);
    assert.equal(matches.length, 1, `One presentation binding for ${name}`);
    assert.equal(matches[0].initializer?.expression?.getText(ast.screen), name, `Use the actual screen ${name}`);
  }
  imported('view', 'monitorStyles', './monitorStyles', 's');
  imported('view', 'deriveMonitorPresentation', '../../lib/monitorPresentationModel');
  calls('view', 'deriveMonitorPresentation');
  imported('checkpoint', 'buildMonitorCheckpoint', '../lib/monitorCheckpointModel');
  calls('checkpoint', 'buildMonitorCheckpoint');
  for (const name of ['AlertSystem', 'MonitorLayout', 'MonitorCaptureCamera', 'LiveMetrics', 'CameraSetupGuide']) rendered('view', name);
  const callbacks = new Map();
  for (const owner of ['screen', ...Object.keys(HOOKS)]) visit(ast[owner], node => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer || !ts.isCallExpression(node.initializer)
      || node.initializer.expression.getText(ast[owner]) !== 'useCallback') return;
    assert.ok(!callbacks.has(node.name.text), `No duplicate or ambiguous callback owner: ${node.name.text}`);
    callbacks.set(node.name.text, owner);
  });
  for (const name of ['handleCaptureConfiguration', 'handleCameraInterruption', 'checkCameraInterruption', 'attemptCameraRecovery', 'handleCameraError']) {
    assert.equal(callbacks.get(name), 'camera', `Camera callback ${name} has its real owner`);
  }
  return { ...sources, runtimeOwners: Object.entries(MONITOR_SOURCE_PATHS).map(([owner, path]) => ({ owner, path, source: sources[owner] })), cameraCallbacks: ['screen', 'camera'].map(owner => ({ filename: new URL(MONITOR_SOURCE_PATHS[owner], root).pathname, source: sources[owner] })) };
}

/** Run the actual moved hooks in an existing bridge-substituted React fixture. */
export function withNativeMonitorHookBindings(bindings, load) {
  const owners = readNativeMonitorSourceOwners();
  const scope = { ...bindings, ...checkpointModel };
  for (const [owner, name] of Object.entries(HOOKS)) Object.assign(scope, load(owners[owner], [name], scope));
  return scope;
}
