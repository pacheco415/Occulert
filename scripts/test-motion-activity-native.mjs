import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const nativeRoot = new URL('../native-app/', import.meta.url).pathname;
const moduleRoot = path.join(nativeRoot, 'modules/occulert-motion-activity');
const source = readFileSync(path.join(moduleRoot, 'ios/OcculertMotionActivityModule.swift'), 'utf8');

test('motion activity is Apple-only, permission-described, transient and has no history/network/alert APIs', () => {
  const config = JSON.parse(readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8'));
  const app = JSON.parse(readFileSync(path.join(nativeRoot, 'app.json'), 'utf8'));
  assert.deepEqual(config.platforms, ['apple']);
  assert.deepEqual(config.apple.modules, ['OcculertMotionActivityModule']);
  const podspec = readFileSync(path.join(moduleRoot, 'ios/OcculertMotionActivity.podspec'), 'utf8');
  assert.match(podspec, /s\.dependency 'ExpoModulesCore'/);
  assert.match(podspec, /s\.frameworks = 'CoreMotion'/);
  assert.match(app.expo.ios.infoPlist.NSMotionUsageDescription, /activity/i);
  assert.match(app.expo.ios.infoPlist.NSMotionUsageDescription, /do not change fatigue scores or alerts/);
  assert.equal(app.expo.android.permissions.some(value => /ACTIVITY_RECOGNITION|LOCATION/.test(value)), false);
  assert.equal((source.match(/\.runOnQueue\(\.main\)/g) || []).length, 3);
  assert.match(source, /OnAppEntersBackground \{ self\.invalidateFromLifecycle\(destroying: false\) \}/);
  assert.match(source, /OnDestroy \{ self\.invalidateFromLifecycle\(destroying: true\) \}/);
  assert.match(source, /OnAppContextDestroys \{ self\.invalidateFromLifecycle\(destroying: true\) \}/);
  assert.match(source, /startActivityUpdates\(to: OperationQueue\.main\)/);
  assert.doesNotMatch(source, /queryActivity|UserDefaults|FileManager|URLSession|CLLocation|Timer\(|sendAlert|NotificationCenter/);

  // Root-only checks may lack Swift; the required macOS lane must execute the
  // actual native methods alongside its existing Watch receiver regression.
  const workflow = readFileSync(new URL('../.github/workflows/native-app-typecheck.yml', import.meta.url), 'utf8').split('\n');
  const start = workflow.indexOf('  watch-notification:');
  assert.ok(start >= 0, 'retain the required native-method verification job');
  const next = workflow.findIndex((line, index) => index > start && /^  [\w-]+:$/.test(line));
  const job = workflow.slice(start, next < 0 ? undefined : next).join('\n');
  assert.match(job, /^    runs-on: macos-[\w.-]+$/m);
  assert.match(job, /^      - run: node --test scripts\/test-watch-notification\.mjs scripts\/test-motion-activity-native\.mjs$/m);
  assert.doesNotMatch(job, /^    (?:if|continue-on-error):/m);
});

test('actual Expo resolver includes the motion module on Apple and excludes it on Android', t => {
  const require = createRequire(path.join(nativeRoot, 'package.json'));
  let cli;
  try { cli = path.join(path.dirname(require.resolve('expo-modules-autolinking/package.json')), 'bin/expo-modules-autolinking.js'); }
  catch { t.skip('Native Expo dependencies are absent; native verification enforces the real resolver when installed.'); return; }
  assert.equal(existsSync(cli), true);
  const resolve = platform => {
    const result = spawnSync(process.execPath, [cli, 'resolve', '--platform', platform, '--json'], {
      cwd: nativeRoot, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).modules;
  };
  const apple = resolve('apple'), android = resolve('android');
  assert.ok(apple.some(entry => entry.packageName === 'occulert-motion-activity'));
  assert.equal(android.some(entry => entry.packageName === 'occulert-motion-activity'), false);
});

function productionMethods() {
  const start = source.indexOf('  public func definition() -> ModuleDefinition {');
  assert.ok(start > 0);
  let depth = 0, end = -1;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  assert.ok(end > start);
  // Only the Expo definition DSL/imports and access visibility are substituted.
  // Native start/receive/stop/status/lifecycle methods execute unchanged.
  return (source.slice(0, start) + source.slice(end))
    .replace(/^import .*\n/gm, '').replace(/\bprivate /g, '');
}

const swift = `
import Foundation

public class Module {
  var events: [(String, [String: Any])] = []
  public init() {}
  func sendEvent(_ name: String, _ payload: [String: Any]) { events.append((name, payload)) }
}
final class UIApplication {
  enum State { case active, background }
  static let shared = UIApplication()
  var applicationState: State = .active
}
enum CMAuthorizationStatus { case notDetermined, restricted, denied, authorized }
enum CMMotionActivityConfidence { case low, medium, high }
struct Date {
  static var wall = 100_000.0
  let timeIntervalSince1970: Double
  init() { timeIntervalSince1970 = Self.wall / 1_000 }
  init(timeIntervalSince1970: Double) { self.timeIntervalSince1970 = timeIntervalSince1970 }
}
final class ProcessInfo {
  static let processInfo = ProcessInfo()
  var systemUptime = 10.0
}
final class CMMotionActivity {
  var startDate = Date(timeIntervalSince1970: 98)
  var timestamp = 9.0
  var confidence: CMMotionActivityConfidence = .high
  var automotive = false, stationary = false, walking = false, running = false, cycling = false, unknown = false
}
final class CMMotionActivityManager {
  static var authorization: CMAuthorizationStatus = .authorized
  static var available = true
  static func authorizationStatus() -> CMAuthorizationStatus { authorization }
  static func isActivityAvailable() -> Bool { available }
  var callbacks: [(CMMotionActivity?) -> Void] = []
  var stops = 0
  func startActivityUpdates(to queue: OperationQueue, withHandler handler: @escaping (CMMotionActivity?) -> Void) {
    precondition(queue === OperationQueue.main)
    callbacks.append(handler)
  }
  func stopActivityUpdates() { stops += 1 }
}
${productionMethods()}

@main struct Suite {
  static func fixture() -> OcculertMotionActivityModule {
    CMMotionActivityManager.authorization = .authorized
    CMMotionActivityManager.available = true
    UIApplication.shared.applicationState = .active
    ProcessInfo.processInfo.systemUptime = 10
    Date.wall = 100_000
    return OcculertMotionActivityModule()
  }
  static func samples(_ module: OcculertMotionActivityModule) -> [[String: Any]] {
    module.events.filter { $0.0 == "onActivity" }.map { $0.1 }
  }
  static func main() {
    do {
      let m = fixture()
      precondition(m.statusPayload(owner: "A")["isActive"] as? Bool == false)
      precondition(m.manager.callbacks.isEmpty, "status must not request permission")
      for authorization in [CMAuthorizationStatus.denied, .restricted] {
        CMMotionActivityManager.authorization = authorization
        precondition(m.startObservation(owner: "A")["state"] as? String == "denied")
      }
      CMMotionActivityManager.authorization = .authorized
      CMMotionActivityManager.available = false
      precondition(m.startObservation(owner: "A")["state"] as? String == "unavailable")
      CMMotionActivityManager.available = true
      UIApplication.shared.applicationState = .background
      precondition(m.startObservation(owner: "A")["state"] as? String == "stopped")
      precondition(m.manager.callbacks.isEmpty)
      print("PASS no request on status, denied, restricted, unavailable or background")
    }
    do {
      let m = fixture()
      CMMotionActivityManager.authorization = .notDetermined
      let starting = m.startObservation(owner: "A")
      precondition(starting["state"] as? String == "starting" && starting["isActive"] as? Bool == false)
      precondition(m.manager.callbacks.count == 1)
      CMMotionActivityManager.authorization = .authorized
      let activity = CMMotionActivity(); activity.automotive = true; activity.stationary = true; activity.confidence = .medium
      m.manager.callbacks[0](activity)
      let sample = samples(m)[0]
      precondition(sample["automotive"] as? Bool == true && sample["stationary"] as? Bool == true)
      precondition(sample["confidence"] as? String == "medium" && sample["authorization"] as? String == "authorized")
      precondition(sample["activityStartedAt"] as? Double == 98_000)
      precondition(sample["sourceUptimeMs"] as? Double == 9_000 && sample["receivedUptimeMs"] as? Double == 10_000)
      precondition(sample["receivedAt"] as? Double == 100_000)
      precondition(Set(sample.keys) == Set(["owner", "authorization", "confidence", "activityStartedAt", "sourceUptimeMs", "receivedUptimeMs", "receivedAt", "automotive", "stationary", "walking", "running", "cycling", "unknown"]))
      Date.wall += 10_000
      _ = m.statusPayload(owner: "A"); _ = m.statusPayload(owner: "A")
      precondition(samples(m).count == 1 && samples(m)[0]["receivedAt"] as? Double == 100_000)
      print("PASS explicit permission path and exact uncombined flags/source/receipt timestamps; status is not a heartbeat")
    }
    do {
      let m = fixture()
      _ = m.startObservation(owner: "A"); let old = m.manager.callbacks[0]
      _ = m.startObservation(owner: "A"); precondition(m.manager.callbacks.count == 1)
      _ = m.startObservation(owner: "B"); let current = m.manager.callbacks[1]
      old(CMMotionActivity()); precondition(samples(m).isEmpty)
      let stops = m.manager.stops
      _ = m.stopObservation(owner: "A"); precondition(m.manager.stops == stops)
      current(CMMotionActivity()); precondition(samples(m).count == 1 && samples(m)[0]["owner"] as? String == "B")
      _ = m.stopObservation(owner: "B"); current(CMMotionActivity()); precondition(samples(m).count == 1)
      _ = m.startObservation(owner: "B"); current(CMMotionActivity()); precondition(samples(m).count == 1)
      m.manager.callbacks[2](CMMotionActivity()); precondition(samples(m).count == 2)
      print("PASS idempotent start, replacement owner, owner-scoped stop and same-token generation invalidation")
    }
    for boundary in ["background", "lifecycle", "destroy", "denied", "restricted", "pending", "nil", "future-time", "invalid-time"] {
      let m = fixture(); _ = m.startObservation(owner: "A"); let callback = m.manager.callbacks[0]
      let activity = CMMotionActivity()
      switch boundary {
      case "background": UIApplication.shared.applicationState = .background
      case "lifecycle": m.invalidateFromLifecycle(destroying: false)
      case "destroy": m.invalidateFromLifecycle(destroying: true)
      case "denied": CMMotionActivityManager.authorization = .denied
      case "restricted": CMMotionActivityManager.authorization = .restricted
      case "pending": CMMotionActivityManager.authorization = .notDetermined
      case "future-time": activity.timestamp = 11
      case "invalid-time": activity.timestamp = .nan
      default: break
      }
      callback(boundary == "nil" ? nil : activity)
      precondition(samples(m).isEmpty, boundary)
      precondition(!m.updating, boundary)
      callback(CMMotionActivity()); precondition(samples(m).isEmpty, boundary)
      if boundary == "destroy" {
        precondition(m.startObservation(owner: "C")["state"] as? String == "error")
        precondition(m.manager.callbacks.count == 1)
      }
    }
    print("PASS foreground, lifecycle, destruction, authorization, nil and invalid-time callback rejection")
    do {
      let m = fixture(); _ = m.startObservation(owner: "A")
      for confidence in [CMMotionActivityConfidence.low, .medium, .high] {
        let activity = CMMotionActivity(); activity.confidence = confidence
        m.manager.callbacks[0](activity)
      }
      precondition(samples(m).map { $0["confidence"] as! String } == ["low", "medium", "high"])
      precondition(samples(m).allSatisfy { $0["automotive"] as? Bool == false && $0["unknown"] as? Bool == false })
      print("PASS confidence and empty flags are forwarded without invented movement")
    }
  }
}
`;

test('actual Swift motion activity methods enforce ownership, permission and foreground lifecycle', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'occulert-motion-activity-'));
  try {
    const input = path.join(directory, 'MotionActivityHarness.swift'), executable = path.join(directory, 'motion-activity-harness');
    writeFileSync(input, swift);
    const compile = spawnSync('swiftc', ['-parse-as-library', '-swift-version', '5',
      '-module-cache-path', path.join(directory, 'module-cache'), input, '-o', executable], {
      encoding: 'utf8', timeout: 30_000,
    });
    if (compile.error?.code === 'ENOENT' && process.platform !== 'darwin') {
      t.skip('Swift compiler absent; the required macOS native-method job executes this harness.');
      return;
    }
    assert.equal(compile.error, undefined, compile.error?.message);
    assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal((run.stdout.match(/^PASS /gm) || []).length, 5, run.stdout);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
