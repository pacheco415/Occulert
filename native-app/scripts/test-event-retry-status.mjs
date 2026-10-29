import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const filename = new URL('../components/CloudSyncCard.tsx', import.meta.url);
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename.pathname,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;

async function mount(status) {
  const module = { exports: {} };
  const native = { ActivityIndicator: 'ActivityIndicator', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View', Switch: 'Switch',
    StyleSheet: { create: value => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, Alert: {}, Linking: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (name === 'expo-router') return { useFocusEffect: callback => React.useEffect(callback, [callback]) };
    if (name === '../lib/cloudSync') return { getCloudState: async () => ({ readStatus: 'confirmed', signedIn: true, available: true, syncEnabled: true }), nativeCloudEventRetryStatus: () => status };
    if (name === '../lib/singleFlightAction') return { createSingleFlightActionRunner };
    if (name === '../constants/theme') return { colors: {}, radii: {} };
    assert.fail('Unexpected UI dependency: ' + name);
  } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(module.exports.CloudSyncCard)); });
  const text = () => renderer.root.findAllByType('Text').map(node => node.children.join('')).join('\n');
  return { renderer, text, close: () => act(async () => renderer.unmount()) };
}

test('actual parked cloud card omits retry diagnostics when the gated getter is inactive', async () => {
  const f = await mount(null);
  try { assert.doesNotMatch(f.text(), /Alert delivery attempts|pending;|local snapshot/); }
  finally { await f.close(); }
});
test('actual parked cloud card reports pending and discard counters without implying synchronization', async () => {
  const f = await mount({ pending: 2, capacityRejected: 3, expired: 4, permanentRejected: 5, exhausted: 6, stopped: 7 });
  try {
    assert.match(f.text(), /2 pending; 3 rejected at capacity; 4 expired; 5 rejected; 6 exhausted; 7 discarded at Stop/);
    assert.match(f.text(), /does not confirm cloud synchronization/);
  } finally { await f.close(); }
});
test('actual parked card exposes unavailable retry state while preserving local alert guidance', async () => {
  const f = await mount({ unavailable: true });
  try { assert.match(f.text(), /Alert retries are paused/); assert.match(f.text(), /Monitoring and local alerts continue independently/); }
  finally { await f.close(); }
});
