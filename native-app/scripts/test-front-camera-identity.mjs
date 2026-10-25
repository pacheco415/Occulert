import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import {
  createFrontCameraObservation, normalizeFrontCameraIdentity,
  normalizeFrontPhysicalCameras, unknownFrontCameraIdentity,
} from '../lib/frontCameraIdentity.ts';
import * as model from '../lib/frontCameraIdentity.ts';
import * as interruptions from '../lib/cameraInterruptions.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const identity = (kind = 'outer', id = 'virtual-front') => ({
  state: 'available', deviceId: id, deviceType: 'virtual-type', isVirtual: true,
  constituentDeviceTypes: ['outer-raw-type', 'inner-raw-type'],
  streamingDeviceType: `${kind}-raw-type`, streamingUniqueId: `${kind}-camera`, streamingType: kind,
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function transport() {
  const starts = [], stops = [], listeners = new Set();
  return { starts, stops, listeners,
    addListener(name, listener) { assert.equal(name, 'frontCameraChanged'); listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
    startObservingFrontCamera(id, owner) { const pending = deferred(); starts.push({ id, owner, ...pending }); return pending.promise; },
    async stopObservingFrontCamera(owner) { stops.push(owner); },
    emit(owner, id, value, sequence = 1) { for (const listener of listeners) listener({ observationId: owner, deviceId: id, identity: value, sequence }); },
  };
}

test('physical camera labels preserve unknown before streaming and distinguish inner/outer switches', () => {
  assert.equal(normalizeFrontCameraIdentity(identity('outer'), 'virtual-front').streamingType, 'outer');
  assert.equal(normalizeFrontCameraIdentity(identity('inner'), 'virtual-front').streamingType, 'inner');
  const beforeStart = normalizeFrontCameraIdentity({ ...identity(), streamingDeviceType: null, streamingUniqueId: null, streamingType: 'standard' }, 'virtual-front');
  assert.equal(beforeStart.state, 'available');
  assert.equal(beforeStart.isVirtual, true);
  assert.equal(beforeStart.streamingType, 'unknown');
  assert.equal(beforeStart.streamingUniqueId, null);
  const physical = normalizeFrontCameraIdentity({ ...identity('standard', 'physical-front'), isVirtual: false, constituentDeviceTypes: [], streamingUniqueId: 'physical-front' }, 'physical-front');
  assert.equal(physical.streamingType, 'standard');
});

test('malformed, unavailable and mismatched identities fail safe without inventing a camera', () => {
  for (const value of [null, [], {}, { ...identity(), deviceId: 'other' }, { ...identity(), isVirtual: null }, { ...identity(), constituentDeviceTypes: [3] }]) {
    assert.deepEqual(normalizeFrontCameraIdentity(value, 'virtual-front'), unknownFrontCameraIdentity());
  }
  assert.deepEqual(normalizeFrontCameraIdentity(identity(), ''), unknownFrontCameraIdentity());
  const inconsistent = normalizeFrontCameraIdentity({ ...identity(), isVirtual: false }, 'virtual-front');
  assert.equal(inconsistent.streamingType, 'unknown');
  assert.equal(inconsistent.streamingUniqueId, null);
  assert.equal(normalizeFrontCameraIdentity({ ...identity(), streamingType: 'future-camera' }, 'virtual-front').streamingType, 'unknown');
});

test('raw physical inventory is deduplicated without collapsing Duo cameras into VC generic labels', () => {
  const outer = { uniqueId: 'outer', deviceType: 'actual-outer-type', camera: 'outer' };
  const inner = { uniqueId: 'inner', deviceType: 'actual-inner-type', camera: 'inner' };
  assert.deepEqual(normalizeFrontPhysicalCameras([outer, inner, outer, null, { uniqueId: 'broken' }]), [inner, outer]);
  assert.deepEqual(normalizeFrontPhysicalCameras(null), []);
});

test('observation registers before start, publishes initial state and orders matching camera events', async () => {
  const native = transport(), updates = [];
  const observation = createFrontCameraObservation(native, 'virtual-front', value => updates.push(value));
  assert.equal(native.listeners.size, 1);
  const { owner } = native.starts[0];
  native.starts[0].resolve(identity());
  assert.equal((await observation.ready).streamingType, 'outer');
  native.emit('obsolete-owner', 'virtual-front', identity('inner'), 1);
  native.emit(owner, 'wrong-camera', identity('inner'), 1);
  native.emit(owner, 'virtual-front', identity('inner'), 2);
  native.emit(owner, 'virtual-front', identity('outer'), 1);
  assert.deepEqual(updates.map(value => value.streamingType), ['outer', 'inner']);
  observation.remove();
  observation.remove();
  await tick();
  assert.deepEqual(native.stops, [owner]);
  assert.equal(native.listeners.size, 0);
});

test('a change arriving before start resolves cannot be rolled back by the initial snapshot', async () => {
  const native = transport(), updates = [];
  const observation = createFrontCameraObservation(native, 'virtual-front', value => updates.push(value));
  native.emit(native.starts[0].owner, 'virtual-front', identity('inner'), 1);
  native.starts[0].resolve(identity('outer'));
  assert.equal((await observation.ready).streamingType, 'inner');
  assert.deepEqual(updates.map(value => value.streamingType), ['inner']);
  observation.remove();
});

test('removal before asynchronous start resolves blocks callbacks and repeats only its own cleanup', async () => {
  const native = transport(), updates = [];
  const first = createFrontCameraObservation(native, 'front-one', value => updates.push(value));
  const old = native.starts[0];
  first.remove();
  const second = createFrontCameraObservation(native, 'front-two', value => updates.push(value));
  const current = native.starts[1];
  current.resolve(identity('inner', 'front-two'));
  await second.ready;
  old.resolve(identity('outer', 'front-one'));
  assert.deepEqual(await first.ready, unknownFrontCameraIdentity());
  native.emit(old.owner, 'front-one', identity('outer', 'front-one'), 10);
  await tick();
  assert.deepEqual(updates.map(value => value.deviceId), ['front-two']);
  assert.ok(native.stops.every(owner => owner === old.owner));
  second.remove();
});

test('a superseded subscription cannot deliver delayed events or initial results', async () => {
  const native = transport(), firstUpdates = [], secondUpdates = [];
  const first = createFrontCameraObservation(native, 'virtual-front', value => firstUpdates.push(value));
  const second = createFrontCameraObservation(native, 'virtual-front', value => secondUpdates.push(value));
  native.emit(native.starts[0].owner, 'virtual-front', identity('outer'), 1);
  native.starts[0].resolve(identity());
  native.starts[1].resolve(identity('inner'));
  await Promise.all([first.ready, second.ready]);
  assert.equal(firstUpdates.length, 0);
  assert.equal(secondUpdates[0].streamingType, 'inner');
  first.remove(); second.remove();
});

test('missing, older and rejecting bridges report unavailable and remain removable', async () => {
  for (const native of [null, {}, { ...transport(), startObservingFrontCamera: async () => { throw Error('unavailable'); } }]) {
    const updates = [];
    const observation = createFrontCameraObservation(native, 'virtual-front', value => updates.push(value));
    assert.deepEqual(await observation.ready, unknownFrontCameraIdentity());
    assert.equal(updates.length, 1);
    observation.remove();
  }
});

function loadModule(file, bindings) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Script(code).runInNewContext({ exports, require: name => { if (!(name in bindings)) throw Error(`Unexpected dependency ${name}`); return bindings[name]; }, Promise, WeakMap, Map, Set, Date, Math, setTimeout, clearTimeout });
  return exports;
}

test('public wrappers support a missing optional module and native readiness reports physical front inventory', async () => {
  const missing = loadModule('../lib/deviceCondition.ts', { 'expo-modules-core': { requireOptionalNativeModule: () => null }, './frontCameraIdentity': model, './cameraInterruptions': interruptions });
  assert.deepEqual(await missing.getFrontCameraIdentity('virtual-front'), unknownFrontCameraIdentity());
  assert.equal((await missing.getFrontPhysicalCameras()).length, 0);
  assert.equal(await missing.isMultitaskingCameraAccessSupported(), null);
  assert.equal((await missing.getCameraInterruptionState('virtual-front')).state, 'notAvailable');
  const cameras = [{ uniqueId: 'inner', deviceType: 'native-inner', camera: 'inner' }];
  const wrapper = loadModule('../lib/deviceCondition.ts', {
    'expo-modules-core': { requireOptionalNativeModule: () => ({ getFrontCameraIdentity: async () => identity('inner'), getFrontPhysicalCameras: async () => cameras,
      isMultitaskingCameraAccessSupported: async () => true,
      getCameraInterruptionState: async deviceId => ({ state: 'available', deviceId, interrupted: true, rawReason: 4, sequence: 9 }),
    }) },
    './frontCameraIdentity': model,
    './cameraInterruptions': interruptions,
  });
  assert.equal((await wrapper.getFrontCameraIdentity('virtual-front')).streamingType, 'inner');
  assert.equal(await wrapper.isMultitaskingCameraAccessSupported(), true);
  assert.equal((await wrapper.getCameraInterruptionState('virtual-front')).reason, 'multitasking');
  const sources = loadModule('../lib/deviceReadinessSources.ts', {
    '@react-native-async-storage/async-storage': {},
    'react-native-vision-camera': { Camera: { getAvailableCameraDevices: () => [{ position: 'front', physicalDevices: ['wide-angle-camera'] }], getCameraPermissionStatus: () => 'granted' } },
    './alertPreferenceStore': {}, './watchPreferences': {}, './watchBridge': {}, './headphoneMotion': {},
    './deviceCondition': { getDeviceCondition: async () => ({ multiCamSupported: false, frontBackMultiCamSupported: false }), getFrontPhysicalCameras: wrapper.getFrontPhysicalCameras },
  }).deviceReadinessSources;
  assert.equal(JSON.stringify((await sources.camera()).frontPhysicalDevices), JSON.stringify(cameras));
});

test('older SDK compilation excludes new camera constants and native observation stays metadata-only', () => {
  const source = readFileSync(new URL('../modules/occulert-device-condition/ios/OcculertFrontCameraTypes.m', import.meta.url), 'utf8');
  for (const version of [260600, 270100]) {
    const output = execFileSync(process.env.CC || 'cc', ['-E', '-P', '-x', 'c', `-D__IPHONE_OS_VERSION_MAX_ALLOWED=${version}`, '-'], { input: source.replace(/^#import[^\n]*\n/gm, ''), encoding: 'utf8', timeout: 10000 });
    if (version < 270100) assert.doesNotMatch(output, /AVCaptureDeviceTypeBuiltIn(?:Outer|Inner)UltraWideCamera/);
    else assert.match(output, /AVCaptureDeviceTypeBuiltInOuterUltraWideCamera/);
  }
  const observer = readFileSync(new URL('../modules/occulert-device-condition/ios/OcculertFrontCameraIdentity.swift', import.meta.url), 'utf8');
  assert.match(observer, /observe\(\\\.activePrimaryConstituent/);
  assert.match(observer, /self\.revision == boundRevision/);
  assert.match(observer, /guard self\.owner == owner/);
  assert.doesNotMatch(observer, /AVCaptureDeviceInput|startRunning|requestAccess|CMSampleBuffer|Timer/);
});
