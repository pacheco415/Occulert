import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import babel from '@babel/core';

const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export function flattenStyle(value) {
  if (!value) return {};
  if (Array.isArray(value)) return Object.assign({}, ...value.map(flattenStyle));
  return value;
}

/** The layout's actual TSX and React run here; native rendering/measurements are separate device evidence. */
export function createMonitorLayoutFixture() {
  let dimensions = { width: 390, height: 844, fontScale: 1, scale: 3 };
  let insets = { top: 47, bottom: 34, left: 0, right: 0 };
  const scrolls = [];
  const events = { cameraMounts: 0, cameraUnmounts: 0, starts: 0, stops: 0 };
  const native = {
    View: 'View', Text: 'Text',
    StyleSheet: { create: value => value, flatten: flattenStyle },
    useWindowDimensions: () => dimensions,
    ScrollView: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ scrollTo: value => scrolls.push(structuredClone(value)) }), []);
      return React.createElement('ScrollView', props);
    }),
  };
  const filename = new URL('../../components/MonitorLayout.tsx', import.meta.url).pathname;
  const jsx = babel.transformSync(readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }]],
  }).code;
  const code = ts.transpileModule(jsx, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const bridges = {
    react: React,
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => insets },
    'react/jsx-runtime': require('react/jsx-runtime'),
  };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: specifier => {
      assert.ok(Object.hasOwn(bridges, specifier), 'unexpected layout dependency: ' + specifier);
      return bridges[specifier];
    },
    console,
  }, { filename, timeout: 1000 });
  const MonitorLayout = module.exports.MonitorLayout ?? module.exports.default;
  assert.equal(typeof MonitorLayout, 'function', 'MonitorLayout exports its actual component');
  function CameraProbe() {
    const identity = React.useRef({});
    React.useEffect(() => {
      events.cameraMounts++;
      return () => { events.cameraUnmounts++; };
    }, []);
    return React.createElement('CameraFixture', { identity: identity.current });
  }
  let props = { attentionKey: '', reduceMotion: false, running: false, preparing: false, detail: 'Parked camera setup' };
  let renderer;
  const element = () => React.createElement(MonitorLayout, {
    camera: React.createElement(CameraProbe),
    header: React.createElement('Text', null, 'Monitor navigation'),
    primaryAction: React.createElement('TouchableOpacity', {
      accessibilityLabel: props.running ? 'Stop monitoring and save this drive' : 'Start fatigue monitoring',
      accessibilityState: { disabled: props.preparing },
      disabled: props.preparing,
      onPress: () => { if (!props.preparing) events[props.running ? 'stops' : 'starts']++; },
    }),
    attentionKey: props.attentionKey,
    reduceMotion: props.reduceMotion,
  }, React.createElement('Text', { testID: 'fixture-detail' }, props.detail));
  const fixture = {
    events, scrolls,
    get root() { return renderer.root; },
    get cameraIdentity() { return renderer.root.findByType('CameraFixture').props.identity; },
    host(id) { return renderer.root.find(node => typeof node.type === 'string' && node.props.testID === id); },
    async mount() { await act(async () => { renderer = create(element()); }); },
    async update({ window: nextWindow, safeArea: nextInsets, ...nextProps } = {}) {
      dimensions = { ...dimensions, ...nextWindow };
      insets = { ...insets, ...nextInsets };
      props = { ...props, ...nextProps };
      await act(async () => { renderer.update(element()); });
    },
    async pressPrimary() {
      const button = fixture.host('monitor-primary-action').findByType('TouchableOpacity');
      await act(async () => { button.props.onPress(); });
    },
    async unmount() { await act(async () => { renderer.unmount(); }); },
  };
  return fixture;
}
