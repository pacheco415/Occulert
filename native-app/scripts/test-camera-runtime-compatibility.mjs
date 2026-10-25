import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  applySDK58CameraPatches, planSDK58CameraPatches, originalWorkletsSource,
  originalVisionCameraInstallerSource, patchedWorkletsSource,
  patchedVisionCameraInstallerSource, runtimeBindingsHeader,
} from './patch-sdk58-camera.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hookPath = 'react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleWithJSIBindings.h';
const workletsPath = 'react-native-worklets-core/ios/Worklets.mm';
const installerPath = 'react-native-vision-camera/ios/FrameProcessors/VisionCameraInstaller.mm';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'occulert-camera-compatibility-'));
  const put = (path, content) => { const target = join(root, 'node_modules', path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); return target; };
  put('react-native/package.json', JSON.stringify({ version: '0.88.0' }));
  put('react-native-worklets-core/package.json', JSON.stringify({ version: '1.6.3' }));
  put('react-native-vision-camera/package.json', JSON.stringify({ version: '4.7.3' }));
  put(hookPath, '- (void)installJSIBindingsWithRuntime:(Runtime&)runtime callInvoker:(Invoker&)callInvoker;');
  put(workletsPath, originalWorkletsSource);
  put(installerPath, originalVisionCameraInstallerSource);
  return { root, put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('the patch pins published source bytes and is atomic on unknown inputs and idempotent', () => {
  assert.equal(createHash('sha256').update(originalWorkletsSource).digest('hex'), 'ce84dc440ef5da506aaf4a3f782c287ff25d5e57239e3c9a48b917fddbc2e82b');
  assert.equal(createHash('sha256').update(originalVisionCameraInstallerSource).digest('hex'), 'dbfe38b7ad56e8b60f6d010e5f8e47d81923f3472964e399680473c72c16370d');
  const f = fixture();
  try {
    f.put(installerPath, originalVisionCameraInstallerSource + '// changed upstream\n');
    assert.throws(() => applySDK58CameraPatches(f.root), /upstream source changed/);
    assert.equal(readFileSync(join(f.root, 'node_modules', workletsPath), 'utf8'), originalWorkletsSource);
    f.put(installerPath, originalVisionCameraInstallerSource);
    assert.equal(applySDK58CameraPatches(f.root), 3);
    assert.equal(applySDK58CameraPatches(f.root), 0);
    f.put('react-native-worklets-core/ios/WKTSDK58RuntimeBindings.h', 'an unrelated header');
    assert.throws(() => applySDK58CameraPatches(f.root), /upstream source changed/);
  } finally { f.cleanup(); }
});

test('unreviewed dependency versions and changed RN hooks fail before patching', () => {
  for (const [path, value] of [
    ['react-native/package.json', JSON.stringify({ version: '0.88.1' })],
    ['react-native-worklets-core/package.json', JSON.stringify({ version: '1.6.4' })],
    ['react-native-vision-camera/package.json', JSON.stringify({ version: '5.0.0' })],
    [hookPath, '- (void)installJSIBindingsWithRuntime:(Runtime&)runtime;'],
  ]) {
    const f = fixture();
    try {
      f.put(path, value);
      assert.throws(() => applySDK58CameraPatches(f.root), /Review|expected runtime/);
      assert.equal(readFileSync(join(f.root, 'node_modules', workletsPath), 'utf8'), originalWorkletsSource);
    } finally { f.cleanup(); }
  }
});

test('compiler preprocessing selects the public runtime path under both actual New Architecture flags', () => {
  const compiler = process.env.CXX || 'c++';
  for (const [name, source, expectedHook] of [
    ['Worklets', patchedWorkletsSource, 'installJSIBindingsWithRuntime:'],
    ['VisionCamera', patchedVisionCameraInstallerSource, 'withSDK58ReactRuntime'],
  ]) {
    // Resolve architecture conditionals in the actual generated native source.
    // Imports are removed so this host regression also runs on Linux without
    // Apple frameworks; the real device build checks those framework imports.
    const workletsHeader = readFileSync(join(appRoot, 'node_modules/react-native-worklets-core/ios/Worklets.h'), 'utf8')
      .replace(/^#import[^\n]*\n/gm, '');
    const input = source.replace(/^#import[^\n]*\n/gm, line => line.includes('"Worklets.h"') ? workletsHeader : '');
    for (const flags of [[], ['-DRCT_NEW_ARCH_ENABLED=1'], ['-DRCT_REMOVE_LEGACY_ARCH=1']]) {
      const output = execFileSync(compiler, ['-std=c++17', '-E', '-P', '-x', 'c++', ...flags, '-'], {
        input, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const message = `${name}: ${flags.join(' ') || 'legacy flags'}`;
      if (flags.length) {
        assert.ok(output.includes(expectedHook), `${message} must select the real runtime initializer`);
        assert.doesNotMatch(output, /RCTCxxBridge|RCTBridge\+Private/, message);
        if (name === 'Worklets') assert.match(output, /Worklets : NSObject <NativeWorkletsSpec>/, message);
      } else {
        assert.match(output, /RCTCxxBridge/, message);
        assert.ok(!output.includes(expectedHook), `${message} must preserve the original legacy initializer`);
        if (name === 'Worklets') assert.match(output, /Worklets : NSObject <RCTBridgeModule>/, message);
      }
    }
  }
});

test('native wiring uses the real RN hook, installs before publishing, and keeps the upstream frame proxy', () => {
  const hook = readFileSync(join(appRoot, 'node_modules', hookPath), 'utf8');
  assert.match(hook, /installJSIBindingsWithRuntime:[\s\S]*callInvoker:/);
  const manager = readFileSync(join(appRoot, 'node_modules/react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleManager.mm'), 'utf8');
  assert.ok(manager.indexOf('getTurboModule:params') < manager.indexOf('installJSIBindingsWithRuntime:*runtime callInvoker:_jsInvoker'));
  const newWorklets = patchedWorkletsSource.split('#else\n')[0];
  assert.doesNotMatch(newWorklets, /RCTCxxBridge|RCTBridge\+Private/);
  assert.match(newWorklets, /<RCTTurboModuleWithJSIBindings>/);
  assert.match(newWorklets, /JsiWorkletContext::getDefaultInstance\(\)->initialize\([\s\S]*"default", &runtime,[\s\S]*callInvoker->invokeAsync/);
  assert.ok(newWorklets.indexOf('JsiWorkletApi::installApi(runtime)') < newWorklets.indexOf('return RNWorklet::JsiWorkletContext::getDefaultInstanceAsShared()'));
  assert.match(newWorklets, /return @\(RNWorklet::sdk58RuntimeBindings\.isInstalledFor/);
  const turboMethod = newWorklets.slice(newWorklets.indexOf('- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:'));
  assert.doesNotMatch(turboMethod.split('- (void)invalidate')[0], /initialize|installApi|getDefaultInstance/);
  const newInstaller = patchedVisionCameraInstallerSource.split('#else\n')[0];
  assert.doesNotMatch(newInstaller, /RCTCxxBridge|\.getBridge|RCTBridge\+Private/);
  assert.match(newInstaller, /withSDK58ReactRuntime\([\s\S]*make_shared<VisionCameraProxy>\(runtime, callInvoker, delegate\)/);
  assert.match(newInstaller, /runtime\.global\(\)\.setProperty\(runtime, "VisionCameraProxy"/);
  const jsProxy = readFileSync(join(appRoot, 'node_modules/react-native-vision-camera/src/frame-processors/VisionCameraProxy.ts'), 'utf8');
  assert.ok(jsProxy.indexOf("require('react-native-worklets-core')") < jsProxy.indexOf('CameraModule.installFrameProcessorBindings()'));
  // Preserve both upstream Old Architecture implementations verbatim.
  assert.ok(patchedWorkletsSource.endsWith(originalWorkletsSource + '#endif\n'));
  assert.ok(patchedVisionCameraInstallerSource.endsWith(originalVisionCameraInstallerSource + '#endif\n'));
  const plan = planSDK58CameraPatches(appRoot);
  assert.equal(plan.length, 3);
});

test('the actual C++ binding store enforces initialization, invoker identity, teardown and runtime ownership', () => {
  const directory = mkdtempSync(join(tmpdir(), 'occulert-native-bindings-'));
  try {
    writeFileSync(join(directory, 'WKTSDK58RuntimeBindings.h'), runtimeBindingsHeader);
    writeFileSync(join(directory, 'bindings.cpp'), `
#include "WKTSDK58RuntimeBindings.h"
#include <atomic>
#include <cassert>
#include <future>
#include <thread>

struct Runtime { int calls = 0; };
struct Invoker { int calls = 0; void invoke() { ++calls; } };
struct Context { Runtime* runtime; Runtime* getJsRuntime() const { return runtime; } };
using Store = RNWorklet::SDK58RuntimeBindingsStore<Runtime, Invoker, Context>;
int main() {
  Store store;
  Runtime a, b;
  int ownerA = 1, ownerB = 2, initialized = 0, tornDown = 0;
  auto invoker = std::make_shared<Invoker>();
  auto contextA = std::make_shared<Context>(Context{&a});
  auto contextB = std::make_shared<Context>(Context{&b});
  assert(!store.isInstalledFor(&ownerA));
  assert(!store.withBindings([](auto&, auto&) { assert(false); return true; }));
  try { store.install(&ownerA, a, nullptr, [&] { ++initialized; return contextA; }); assert(false); }
  catch (const std::invalid_argument&) {}
  assert(initialized == 0);
  try { store.install(&ownerA, a, invoker, [&]() -> std::shared_ptr<Context> { throw std::runtime_error("JSI install failed"); }); assert(false); }
  catch (const std::runtime_error&) {}
  assert(!store.isInstalledFor(&ownerA));
  try { store.install(&ownerA, a, invoker, [&] { return contextB; }); assert(false); }
  catch (const std::logic_error&) {}
  assert(!store.isInstalledFor(&ownerA));
  auto first = store.install(&ownerA, a, invoker, [&] { ++initialized; ++a.calls; return contextA; });
  assert(store.isInstalledFor(&ownerA));
  assert(first == store.install(&ownerA, a, invoker, [&] { assert(false); return contextA; }));
  assert(initialized == 1 && a.calls == 1);
  assert(store.withBindings([&](auto& runtime, auto& actualInvoker) {
    assert(&runtime == &a && actualInvoker == invoker); actualInvoker->invoke(); return true;
  }));
  assert(invoker->calls == 1);
  try { store.install(&ownerB, b, invoker, [&] { assert(false); return contextB; }); assert(false); }
  catch (const std::logic_error&) {}
  contextA->runtime = &b;
  assert(!store.isInstalledFor(&ownerA));
  assert(!store.withBindings([](auto&, auto&) { assert(false); return true; }));
  contextA->runtime = &a;

  // Invalidation cannot tear the context down during proxy construction.
  std::promise<void> entered, release, invalidateStarted;
  auto releaseFuture = release.get_future().share();
  std::atomic<bool> teardownComplete{false};
  std::thread reader([&] { assert(store.withBindings([&](auto& runtime, auto& actualInvoker) {
    entered.set_value(); releaseFuture.wait(); assert(!teardownComplete.load());
    assert(&runtime == &a && actualInvoker == invoker); return true;
  })); });
  entered.get_future().wait();
  std::thread invalidator([&] { invalidateStarted.set_value(); assert(store.invalidate(&ownerA, [&] { ++tornDown; teardownComplete = true; })); });
  invalidateStarted.get_future().wait();
  assert(!teardownComplete.load());
  release.set_value(); reader.join(); invalidator.join();
  assert(tornDown == 1 && !store.isInstalledFor(&ownerA));
  assert(!store.withBindings([](auto&, auto&) { assert(false); return true; }));
  auto second = store.install(&ownerB, b, invoker, [&] { return contextB; });
  assert(second > first);
  assert(!store.invalidate(&ownerA, [] { assert(false); }));
  assert(store.isInstalledFor(&ownerB));
  contextB.reset();
  assert(!store.isInstalledFor(&ownerB));
  assert(!store.withBindings([](auto&, auto&) { assert(false); return true; }));
  assert(store.invalidate(&ownerB, [] {}));
  Store expiredInvoker;
  expiredInvoker.install(&ownerA, a, invoker, [&] { return contextA; });
  invoker.reset();
  assert(!expiredInvoker.isInstalledFor(&ownerA));
}
`);
    const executable = join(directory, 'bindings-test');
    execFileSync(process.env.CXX || 'c++', ['-std=c++17', '-pthread', '-Wall', '-Wextra', '-Werror', join(directory, 'bindings.cpp'), '-o', executable], { timeout: 30000, stdio: 'pipe' });
    execFileSync(executable, [], { timeout: 10000, stdio: 'pipe' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
