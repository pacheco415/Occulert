import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// RN 0.87 removed RCTCxxBridge. Keep the released camera/worklet APIs, using
// RN's public JSI initialization hook instead of recovering private bridge state.
// Embedded upstream source notices are in CAMERA_PATCH_NOTICES.md.
// https://github.com/facebook/react-native/blob/v0.88.0/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleWithJSIBindings.h
const nativeAppRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const originalWorkletsSource = `#import "Worklets.h"

#import <React/RCTBridge+Private.h>
#import <React/RCTBridge.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTTurboModule.h>

@implementation Worklets

@synthesize bridge = _bridge;

RCT_EXPORT_MODULE()

- (void)invalidate {
  RNWorklet::JsiWorkletContext::invalidateDefaultInstance();
  RNWorklet::JsiWorkletApi::invalidateInstance();
  _bridge = nil;
}

- (void)setBridge:(RCTBridge *)bridge {
  _bridge = bridge;
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

void installApi(std::shared_ptr<facebook::react::CallInvoker> callInvoker,
                facebook::jsi::Runtime *runtime) {
  // Initialize the default worklet context
  RNWorklet::JsiWorkletContext::getDefaultInstance()->initialize(
      "default", runtime, [=](std::function<void()> &&f) {
        callInvoker->invokeAsync(std::move(f));
      });

  // Install the worklet API
  RNWorklet::JsiWorkletApi::installApi(*runtime);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  RCTCxxBridge *cxxBridge = (RCTCxxBridge *)_bridge;
  if (cxxBridge.runtime != nullptr) {
    auto callInvoker = cxxBridge.jsCallInvoker;
    facebook::jsi::Runtime *jsRuntime =
        (facebook::jsi::Runtime *)cxxBridge.runtime;

    installApi(callInvoker, jsRuntime);
    return @true;
  }
  return @false;
}

// Don't compile this code when we build for the old architecture.
#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  // Call installApi with c++ brigde or something similar.
  RCTCxxBridge *cxxBridge = (RCTCxxBridge *)_bridge;
  auto callInvoker = cxxBridge.jsCallInvoker;
  facebook::jsi::Runtime *jsRuntime =
      (facebook::jsi::Runtime *)cxxBridge.runtime;

  installApi(callInvoker, jsRuntime);

  return std::make_shared<facebook::react::NativeWorkletsSpecJSI>(params);
}
#endif

@end
`;

export const originalVisionCameraInstallerSource = `//
//  VisionCameraInstaller.mm
//  DoubleConversion
//
//  Created by Marc Rousavy on 20.04.24.
//

#import "VisionCameraInstaller.h"
#import "VisionCameraProxy.h"
#import <Foundation/Foundation.h>

#import <React/RCTBridge+Private.h>
#import <React/RCTBridge.h>
#import <ReactCommon/RCTTurboModuleManager.h>

@implementation VisionCameraInstaller

+ (BOOL)installWithDelegate:(id<VisionCameraProxyDelegate>)delegate {
  // TODO: Migrate away from RCTBridge to support new arch.
  RCTBridge* bridge = delegate.getBridge;
  RCTCxxBridge* cxxBridge = (RCTCxxBridge*)bridge;
  if (!cxxBridge.runtime) {
    return NO;
  }

  jsi::Runtime& runtime = *(jsi::Runtime*)cxxBridge.runtime;

  // global.VisionCameraProxy
  auto visionCameraProxy = std::make_shared<VisionCameraProxy>(runtime, bridge.jsCallInvoker, delegate);
  runtime.global().setProperty(runtime, "VisionCameraProxy", jsi::Object::createFromHostObject(runtime, visionCameraProxy));

  return YES;
}

@end
`;

// This header contains no global storage. Worklets.mm owns the single store
// shared with VisionCamera, including when CocoaPods uses separate frameworks.
// Its template is also compiled and executed by the host-side regression test.
export const runtimeBindingsHeader = `#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <utility>

namespace facebook { namespace jsi { class Runtime; } namespace react { class CallInvoker; } }

namespace RNWorklet {

template <typename Runtime, typename CallInvoker, typename Context>
class SDK58RuntimeBindingsStore final {
public:
  template <typename Initialize>
  std::uint64_t install(const void* owner, Runtime& runtime,
                        const std::shared_ptr<CallInvoker>& callInvoker,
                        Initialize&& initialize) {
    if (owner == nullptr || callInvoker == nullptr) {
      throw std::invalid_argument("Worklets requires an owner and React CallInvoker");
    }
    std::lock_guard<std::mutex> lock(_mutex);
    if (_owner != nullptr) {
      if (_owner == owner && _runtime == &runtime && valid() && _callInvoker.lock() == callInvoker) {
        return _generation;
      }
      throw std::logic_error("Invalidate the previous Worklets runtime before installing another");
    }
    // No bindings are visible until the real worklet context and global API exist.
    auto context = initialize();
    if (context == nullptr || context->getJsRuntime() != &runtime) {
      throw std::logic_error("Worklets initialized a different React runtime");
    }
    _runtime = &runtime;
    _callInvoker = callInvoker;
    _context = context;
    _owner = owner;
    return ++_generation;
  }

  bool isInstalledFor(const void* owner) const {
    std::lock_guard<std::mutex> lock(_mutex);
    return owner != nullptr && _owner == owner && valid();
  }

  template <typename Visitor>
  bool withBindings(Visitor&& visitor) const {
    std::lock_guard<std::mutex> lock(_mutex);
    auto context = _context.lock();
    auto callInvoker = _callInvoker.lock();
    if (_owner == nullptr || _runtime == nullptr || context == nullptr || callInvoker == nullptr ||
        context->getJsRuntime() != _runtime) {
      return false;
    }
    // Hold both the lifetime token and mutex until proxy construction finishes.
    // Callbacks must not re-enter this store.
    return visitor(*_runtime, callInvoker);
  }

  template <typename Invalidate>
  bool invalidate(const void* owner, Invalidate&& invalidateContext) {
    std::lock_guard<std::mutex> lock(_mutex);
    if (owner == nullptr || _owner != owner) return false;
    // Owner identity prevents a late invalidation from clearing a newer module.
    _owner = nullptr;
    _runtime = nullptr;
    _callInvoker.reset();
    _context.reset();
    // Keep teardown and a subsequent installation serialized as one operation.
    invalidateContext();
    return true;
  }

private:
  bool valid() const {
    auto context = _context.lock();
    return _runtime != nullptr && context != nullptr && !_callInvoker.expired() &&
           context->getJsRuntime() == _runtime;
  }
  mutable std::mutex _mutex;
  const void* _owner = nullptr;
  Runtime* _runtime = nullptr;
  std::weak_ptr<CallInvoker> _callInvoker;
  std::weak_ptr<Context> _context;
  std::uint64_t _generation = 0;
};

using SDK58RuntimeVisitor = std::function<bool(
    facebook::jsi::Runtime&, const std::shared_ptr<facebook::react::CallInvoker>&)>;
bool withSDK58ReactRuntime(const SDK58RuntimeVisitor& visitor);

} // namespace RNWorklet
`;

const newWorkletsImplementation = `// Worklets.h uses the former flag to choose its generated TurboModule spec.
// RN 0.88 may expose only RCT_REMOVE_LEGACY_ARCH, which also means New Architecture.
#ifndef RCT_NEW_ARCH_ENABLED
#define RCT_NEW_ARCH_ENABLED 1
#endif
#import "Worklets.h"
#import "WKTSDK58RuntimeBindings.h"
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>

namespace RNWorklet {
static SDK58RuntimeBindingsStore<facebook::jsi::Runtime, facebook::react::CallInvoker,
                                JsiWorkletContext> sdk58RuntimeBindings;

bool withSDK58ReactRuntime(const SDK58RuntimeVisitor& visitor) {
  return sdk58RuntimeBindings.withBindings(visitor);
}
} // namespace RNWorklet

@interface Worklets () <RCTTurboModuleWithJSIBindings>
@end

@implementation Worklets
RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime&)runtime
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker>&)callInvoker {
  RNWorklet::sdk58RuntimeBindings.install((__bridge const void*)self, runtime, callInvoker, [&]() {
    try {
      // Keep the upstream context, queue and API installation unchanged.
      RNWorklet::JsiWorkletContext::getDefaultInstance()->initialize(
          "default", &runtime, [callInvoker](std::function<void()>&& function) {
            callInvoker->invokeAsync(std::move(function));
          });
      RNWorklet::JsiWorkletApi::installApi(runtime);
      auto api = runtime.global().getProperty(runtime, "Worklets");
      if (!api.isObject() || !api.asObject(runtime).isHostObject<RNWorklet::JsiWorkletApi>(runtime)) {
        throw std::runtime_error("The Worklets JSI API was not installed");
      }
      return RNWorklet::JsiWorkletContext::getDefaultInstanceAsShared();
    } catch (...) {
      RNWorklet::JsiWorkletContext::invalidateDefaultInstance();
      RNWorklet::JsiWorkletApi::invalidateInstance();
      throw;
    }
  });
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(install) {
  // React invokes the JSI hook before exposing this module to JavaScript.
  // Never claim installation before that hook has installed the real API.
  return @(RNWorklet::sdk58RuntimeBindings.isInstalledFor((__bridge const void*)self));
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams&)params {
  return std::make_shared<facebook::react::NativeWorkletsSpecJSI>(params);
}

- (void)invalidate {
  RNWorklet::sdk58RuntimeBindings.invalidate((__bridge const void*)self, []() {
    RNWorklet::JsiWorkletContext::invalidateDefaultInstance();
    RNWorklet::JsiWorkletApi::invalidateInstance();
  });
}
@end
`;

export const patchedWorkletsSource = `// Occulert SDK 58 camera compatibility: keep upstream Old Architecture bytes.
#if defined(RCT_NEW_ARCH_ENABLED) || defined(RCT_REMOVE_LEGACY_ARCH)
${newWorkletsImplementation}#else
${originalWorkletsSource}#endif
`;

export const patchedVisionCameraInstallerSource = `// Occulert SDK 58 camera compatibility: consume the initialized Worklets runtime.
#if defined(RCT_NEW_ARCH_ENABLED) || defined(RCT_REMOVE_LEGACY_ARCH)
#import "VisionCameraInstaller.h"
#import "VisionCameraProxy.h"
#import "WKTSDK58RuntimeBindings.h"

@implementation VisionCameraInstaller
+ (BOOL)installWithDelegate:(id<VisionCameraProxyDelegate>)delegate {
  // VisionCameraProxy.ts requires Worklets before this synchronous native call.
  return RNWorklet::withSDK58ReactRuntime([delegate](
      jsi::Runtime& runtime, const std::shared_ptr<react::CallInvoker>& callInvoker) {
    auto visionCameraProxy = std::make_shared<VisionCameraProxy>(runtime, callInvoker, delegate);
    runtime.global().setProperty(runtime, "VisionCameraProxy",
        jsi::Object::createFromHostObject(runtime, visionCameraProxy));
    return true;
  });
}
@end
#else
${originalVisionCameraInstallerSource}#endif
`;

const patches = [
  { packageName: 'react-native-worklets-core', version: '1.6.3', file: 'ios/Worklets.mm', original: originalWorkletsSource, patched: patchedWorkletsSource },
  { packageName: 'react-native-worklets-core', version: '1.6.3', file: 'ios/WKTSDK58RuntimeBindings.h', original: null, patched: runtimeBindingsHeader },
  { packageName: 'react-native-vision-camera', version: '4.7.3', file: 'ios/FrameProcessors/VisionCameraInstaller.mm', original: originalVisionCameraInstallerSource, patched: patchedVisionCameraInstallerSource },
];

export function planSDK58CameraPatches(appRoot = nativeAppRoot) {
  const modules = join(appRoot, 'node_modules');
  const reactNative = JSON.parse(readFileSync(join(modules, 'react-native/package.json'), 'utf8'));
  if (reactNative.version !== '0.88.1') throw Error('Review the camera compatibility patch before changing React Native 0.88.1.');
  const publicHook = readFileSync(join(modules, 'react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleWithJSIBindings.h'), 'utf8');
  if (!publicHook.includes('installJSIBindingsWithRuntime:') || !publicHook.includes('callInvoker:')) {
    throw Error('React Native does not expose the expected runtime and CallInvoker initialization hook.');
  }
  return patches.map(patch => {
    const packageRoot = join(modules, patch.packageName);
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== patch.version) throw Error(`Review the camera compatibility patch before changing ${patch.packageName} ${patch.version}.`);
    const path = join(packageRoot, patch.file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current !== patch.original && current !== patch.patched) {
      throw Error(`Cannot safely patch ${patch.packageName}/${patch.file}: upstream source changed.`);
    }
    return { path, before: current, content: patch.patched, changed: current !== patch.patched };
  });
}

export function applySDK58CameraPatches(appRoot = nativeAppRoot) {
  // Validate every file before touching any; restore prior bytes on write failure.
  const plan = planSDK58CameraPatches(appRoot);
  const attempted = [];
  try {
    for (const entry of plan.filter(entry => entry.changed)) {
      attempted.push(entry);
      writeFileSync(entry.path, entry.content);
    }
  } catch (error) {
    for (const entry of attempted.reverse()) {
      if (entry.before === null) { if (existsSync(entry.path)) unlinkSync(entry.path); }
      else writeFileSync(entry.path, entry.before);
    }
    throw error;
  }
  return attempted.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const changed = applySDK58CameraPatches();
    console.log(changed ? 'Applied SDK 58 camera runtime compatibility patch.' : 'SDK 58 camera runtime compatibility patch already applied.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
