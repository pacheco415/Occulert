import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { createSingleFlightActionRunner } from '../lib/singleFlightAction.ts';
import { strings, formatString } from '../lib/strings.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const filename = new URL('../components/CloudSyncCard.tsx', import.meta.url);
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename.pathname,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;

async function mount(status, options = {}) {
  const module = { exports: {} };
  const alerts = [];
  const native = { ActivityIndicator: 'ActivityIndicator', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View', Switch: 'Switch',
    StyleSheet: { create: value => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, Alert: { alert: (...args) => alerts.push(args) }, Linking: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (name === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (name === 'expo-router') return { useFocusEffect: callback => React.useEffect(callback, [callback]) };
    if (name === '../lib/cloudSync') return {
      getCloudState: options.getCloudState || (async () => ({ readStatus: 'confirmed', signedIn: true, available: true, syncEnabled: true })),
      signOutOfCloud: options.signOutOfCloud,
      nativeCloudEventRetryStatus: () => status,
    };
    if (name === '../lib/singleFlightAction') return { createSingleFlightActionRunner };
    if (name === '../lib/strings.ts') return { strings, formatString };
    if (name === '../constants/theme') return { colors: {}, radii: {} };
    assert.fail('Unexpected UI dependency: ' + name);
  } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(module.exports.CloudSyncCard)); });
  const text = () => renderer.root.findAllByType('Text').map(node => node.children.join('')).join('\n');
  return { renderer, text, alerts, close: () => act(async () => renderer.unmount()) };
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

test('failed local sign-out stays visibly incomplete and offers a guarded retry', async () => {
  let state = { readStatus: 'confirmed', signedIn: true, available: true, syncEnabled: true };
  let attempts = 0;
  const f = await mount(null, {
    getCloudState: async () => state,
    signOutOfCloud: async () => {
      attempts++;
      state = { ...state, signedIn: false, syncEnabled: false, signOutIncomplete: true };
      throw Error('local removal unavailable');
    },
  });
  try {
    const signOut = f.renderer.root.findByProps({ accessibilityLabel: 'Sign out of cloud account' });
    await act(async () => { signOut.props.onPress(); signOut.props.onPress(); });
    assert.equal(attempts, 1);
    assert.match(f.text(), /SIGN-OUT INCOMPLETE/);
    assert.match(f.text(), /may return after restarting/);
    assert.equal(f.alerts.length, 1);
    assert.equal(f.alerts[0][0], 'Sign-out incomplete');
    assert.equal(f.renderer.root.findAllByType('TextInput').length, 0, 'an incomplete sign-out must not look like a clean login form');
    const retry = f.renderer.root.findByProps({ accessibilityLabel: 'Retry incomplete cloud sign-out' });
    assert.equal(retry.props.disabled, false);
  } finally { await f.close(); }
});

test('an incomplete sign-out survives a fresh card mount and a successful retry restores the login form', async () => {
  let state = { readStatus: 'confirmed', signedIn: false, available: true, syncEnabled: false, signOutIncomplete: true };
  let attempts = 0;
  const f = await mount(null, {
    getCloudState: async () => state,
    signOutOfCloud: async () => { attempts++; state = { ...state, signOutIncomplete: undefined }; },
  });
  try {
    assert.match(f.text(), /SIGN-OUT INCOMPLETE/);
    const retry = f.renderer.root.findByProps({ accessibilityLabel: 'Retry incomplete cloud sign-out' });
    await act(async () => { retry.props.onPress(); });
    assert.equal(attempts, 1);
    assert.doesNotMatch(f.text(), /SIGN-OUT INCOMPLETE|Retry sign-out/);
    assert.equal(f.renderer.root.findAllByType('TextInput').length, 2);
    assert.equal(f.alerts.length, 0);
  } finally { await f.close(); }
});

for (const completedBeforeRefresh of [false, true]) {
  test(`a stalled sign-out deadline releases the card with ${completedBeforeRefresh ? 'confirmed late cleanup' : 'an actionable incomplete warning'}`, async () => {
    let state = { readStatus: 'confirmed', signedIn: true, available: true, syncEnabled: true };
    let rejectWait;
    const pending = new Promise((_resolve, reject) => { rejectWait = reject; });
    const f = await mount(null, {
      getCloudState: async () => state,
      signOutOfCloud: () => {
        state = { ...state, signedIn: false, syncEnabled: false, signOutIncomplete: true };
        return pending;
      },
    });
    try {
      await act(async () => {
        f.renderer.root.findByProps({ accessibilityLabel: 'Sign out of cloud account' }).props.onPress();
      });
      assert.equal(f.renderer.root.findByProps({ accessibilityLabel: 'Signing out of cloud account' }).props.disabled, true);
      if (completedBeforeRefresh) state = { ...state, signOutIncomplete: undefined };
      await act(async () => { rejectWait(Error('Sign-out could not be fully saved')); });
      if (completedBeforeRefresh) {
        assert.equal(f.alerts.length, 0, 'do not claim incomplete cleanup after a fresh status confirms completion');
        assert.equal(f.renderer.root.findAllByType('TextInput').length, 2);
      } else {
        assert.match(f.text(), /SIGN-OUT INCOMPLETE/);
        assert.equal(f.renderer.root.findByProps({ accessibilityLabel: 'Retry incomplete cloud sign-out' }).props.disabled, false);
        assert.equal(f.alerts[0][0], 'Sign-out incomplete');
      }
    } finally { await f.close(); }
  });
}
