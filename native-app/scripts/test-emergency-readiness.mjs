import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { EMERGENCY_READINESS_COPY, EMERGENCY_READINESS_GUIDES } from '../lib/emergencyReadiness.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const filename = new URL('../components/EmergencyReadinessCard.tsx', import.meta.url);
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename.pathname,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// The actual TSX, catalog and real React hooks run here. Only browser, platform
// and navigation focus are fixtures; an unapproved native import fails closed.
async function mount({ platform = 'ios', focused = true, open = () => Promise.resolve() } = {}) {
  const calls = [], stateWrites = [], focusEffects = new Set();
  let openURL = open, renderer;
  const appState = { currentState: 'active' };
  const react = { ...React, useState(initial) {
    const [value, setValue] = React.useState(initial);
    const trackedSet = React.useCallback(next => { stateWrites.push(next); setValue(next); }, [setValue]);
    return [value, trackedSet];
  } };
  const useFocusEffect = callback => React.useEffect(() => {
    const entry = { callback, cleanup: focused ? callback() : null };
    focusEffects.add(entry);
    return () => { entry.cleanup?.(); focusEffects.delete(entry); };
  }, [callback]);
  const bridges = {
    react,
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
      StyleSheet: { create: value => value }, Platform: { OS: platform }, AppState: appState,
      Linking: { openURL(url) { calls.push(url); return openURL(url); } } },
    'expo-router': { useFocusEffect },
    '../constants/theme': { colors: {}, radii: {} },
    '../lib/emergencyReadiness': { EMERGENCY_READINESS_COPY, EMERGENCY_READINESS_GUIDES },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(Object.hasOwn(bridges, name), 'Unexpected emergency-readiness dependency: ' + name);
    return bridges[name];
  } }, { filename: filename.pathname, timeout: 1_000 });
  await act(async () => { renderer = create(React.createElement(module.exports.EmergencyReadinessCard)); });
  const flush = async () => act(async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); });
  return {
    calls, stateWrites, appState, flush, get root() { return renderer.root; },
    get tree() { return renderer.toJSON(); },
    text() { return renderer.root.findAllByType('Text').map(node => node.children.join('')).join('\n'); },
    disclosure() { return renderer.root.findByProps({ accessibilityRole: 'button' }); },
    links() { return renderer.root.findAll(node => node.type === 'TouchableOpacity' && node.props.accessibilityRole === 'link'); },
    link(guide) { return this.links().find(node => node.props.accessibilityLabel?.includes(guide.title)); },
    async press(node) { await act(async () => { node.props.onPress(); }); },
    async expand() { await this.press(this.disclosure()); },
    setOpen(next) { openURL = next; },
    async blur() { await act(async () => {
      focused = false;
      for (const entry of focusEffects) { entry.cleanup?.(); entry.cleanup = null; }
    }); },
    async focus() { await act(async () => {
      focused = true;
      for (const entry of focusEffects) entry.cleanup = entry.callback();
    }); },
    async close() { await act(async () => renderer.unmount()); },
  };
}

test('the actual iOS card starts compact, states its limits and performs no external operation', async () => {
  const f = await mount();
  try {
    assert.deepEqual(f.calls, []);
    assert.equal(f.links().length, 0);
    assert.equal(f.disclosure().props.accessibilityLabel, 'Review Apple setup guides');
    assert.equal(f.disclosure().props.accessibilityState.expanded, false);
    assert.equal(f.root.findByProps({ accessibilityRole: 'header' }).children.join(''), EMERGENCY_READINESS_COPY.title);
    for (const key of ['parked', 'limits']) assert.ok(f.text().includes(EMERGENCY_READINESS_COPY[key]));
    assert.ok(!f.text().includes(EMERGENCY_READINESS_COPY.privacy));
    assert.ok(f.disclosure().props.style.minHeight >= 44);
  } finally { await f.close(); }
  const otherPlatform = await mount({ platform: 'android' });
  try { assert.equal(otherPlatform.tree, null); assert.deepEqual(otherPlatform.calls, []); }
  finally { await otherPlatform.close(); }
});

test('expansion exposes accessible official guides and each action opens only its matching catalog URL', async () => {
  const f = await mount();
  try {
    await f.expand();
    assert.equal(f.disclosure().props.accessibilityState.expanded, true);
    assert.equal(f.disclosure().props.accessibilityLabel, 'Hide Apple setup guides');
    assert.equal(f.links().length, EMERGENCY_READINESS_GUIDES.length);
    for (const key of ['availability', 'privacy']) assert.ok(f.text().includes(EMERGENCY_READINESS_COPY[key]));
    assert.deepEqual(f.calls, [], 'expanding guidance does not contact Apple or inspect a setting');
    for (const guide of EMERGENCY_READINESS_GUIDES) {
      const button = f.link(guide);
      assert.ok(button.props.accessibilityLabel.includes(guide.title));
      assert.ok(button.props.accessibilityLabel.includes(guide.detail), 'VoiceOver must include the feature limits hidden by an explicit touchable label');
      assert.match(button.props.accessibilityHint, /official Apple.*browser.*parked/i);
      assert.equal(button.props.accessibilityState.disabled, false);
      await f.press(button);
      assert.equal(f.calls.at(-1), guide.url);
    }
    assert.deepEqual(f.calls, EMERGENCY_READINESS_GUIDES.map(guide => guide.url));
  } finally { await f.close(); }
});

test('one pending browser action disables all controls and failure offers the exact selectable official URL', async () => {
  const request = deferred(), f = await mount({ open: () => request.promise });
  const [first, second] = EMERGENCY_READINESS_GUIDES;
  try {
    await f.expand();
    const secondHandler = f.link(second), disclosure = f.disclosure();
    await f.press(f.link(first));
    assert.equal(f.disclosure().props.disabled, true);
    assert.equal(f.disclosure().props.accessibilityState.disabled, true);
    for (const guide of EMERGENCY_READINESS_GUIDES) {
      const button = f.link(guide);
      assert.equal(button.props.disabled, true);
      assert.equal(button.props.accessibilityState.disabled, true);
      assert.equal(button.props.accessibilityState.busy, guide.id === first.id);
    }
    await f.press(secondHandler); await f.press(disclosure);
    assert.deepEqual(f.calls, [first.url], 'already-retained callbacks cannot bypass single flight');
    request.reject(Error('private-browser-error-details')); await f.flush();
    const fallback = f.root.findByProps({ selectable: true });
    assert.equal(fallback.children.join(''), first.url);
    assert.equal(f.root.findAllByProps({ accessibilityLiveRegion: 'polite' }).length, 1);
    assert.match(f.text(), /Could not open.*browser while parked/);
    assert.doesNotMatch(f.text(), /private-browser-error-details/);
    assert.ok(f.links().every(button => button.props.disabled === false));
    assert.equal(f.disclosure().props.disabled, false);
    f.setOpen(() => Promise.resolve());
    await f.press(f.link(second));
    assert.deepEqual(f.calls, [first.url, second.url]);
    assert.equal(f.root.findAllByProps({ selectable: true }).length, 0);
  } finally { await f.close(); }
});

test('foreground and focus guards reject link and disclosure callbacks outside the preparation screen', async () => {
  const f = await mount();
  try {
    f.appState.currentState = 'background'; await f.expand();
    assert.equal(f.links().length, 0);
    f.appState.currentState = 'active'; await f.expand();
    const link = f.link(EMERGENCY_READINESS_GUIDES[0]);
    f.appState.currentState = 'inactive'; await f.press(link); await f.press(f.disclosure());
    assert.deepEqual(f.calls, []);
    assert.equal(f.disclosure().props.accessibilityState.expanded, true);
    f.appState.currentState = 'active'; await f.blur();
    await f.press(link); await f.press(f.disclosure()); assert.deepEqual(f.calls, []);
    await f.focus();
    assert.equal(f.links().length, 0);
    assert.equal(f.disclosure().props.accessibilityState.expanded, false);
  } finally { await f.close(); }
});

test('a browser failure in the background clears owned busy state without a stale error on return', async () => {
  const request = deferred(), f = await mount({ open: () => request.promise });
  const guide = EMERGENCY_READINESS_GUIDES[0];
  try {
    await f.expand(); await f.press(f.link(guide));
    f.appState.currentState = 'background';
    request.reject(Error('browser dismissed')); await f.flush();
    assert.equal(f.disclosure().props.disabled, false, 'returning from the browser must not leave controls stuck');
    assert.equal(f.root.findAllByProps({ selectable: true }).length, 0);
    f.appState.currentState = 'active'; f.setOpen(() => Promise.resolve());
    await f.press(f.link(guide)); assert.deepEqual(f.calls, [guide.url, guide.url]);
  } finally { await f.close(); }
});

test('an old focus request cannot publish an error or release a newer request', async () => {
  const first = deferred(), second = deferred(), f = await mount({ open: () => first.promise });
  const [oldGuide, newGuide] = EMERGENCY_READINESS_GUIDES;
  try {
    await f.expand(); await f.press(f.link(oldGuide));
    await f.blur(); await f.focus();
    assert.equal(f.links().length, 0); assert.equal(f.disclosure().props.disabled, false);
    await f.expand(); f.setOpen(() => second.promise); await f.press(f.link(newGuide));
    first.reject(Error('old-focus-failure')); await f.flush();
    assert.equal(f.root.findAllByProps({ selectable: true }).length, 0);
    assert.equal(f.disclosure().props.disabled, true);
    assert.equal(f.link(newGuide).props.accessibilityState.busy, true);
    second.resolve(); await f.flush();
    assert.equal(f.disclosure().props.disabled, false);
    assert.deepEqual(f.calls, [oldGuide.url, newGuide.url]);
  } finally { await f.close(); }
});

test('unmount invalidates pending browser completion without later state writes', async () => {
  const request = deferred(), f = await mount({ open: () => request.promise });
  await f.expand(); await f.press(f.link(EMERGENCY_READINESS_GUIDES[0]));
  await f.close(); const writesAtUnmount = f.stateWrites.length;
  request.reject(Error('late-browser-failure')); await f.flush();
  assert.equal(f.stateWrites.length, writesAtUnmount);
});
