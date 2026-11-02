import assert from 'node:assert/strict';
import { accessSync, constants, readFileSync, openSync, readSync, closeSync, realpathSync, statSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
// All SDK dependencies are controlled stand-ins. Only Swift's standard library
// is needed to execute the unchanged production methods below.
struct UUID: Equatable {
  private static var next: UInt64 = 0
  private let value: UInt64
  init() { Self.next += 1; value = Self.next }
}
final class OperationQueue {
  static let main = OperationQueue()
}
enum Thread {
  static var isMainThread = true
}
final class DispatchQueue {
  static let main = DispatchQueue()
  var syncCalls = 0
  func sync(execute work: () -> Void) {
    precondition(!Thread.isMainThread, "must not synchronously dispatch to the current main queue")
    syncCalls += 1
    let wasMainThread = Thread.isMainThread
    Thread.isMainThread = true
    defer { Thread.isMainThread = wasMainThread }
    work()
  }
}
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
    Thread.isMainThread = true
    DispatchQueue.main.syncCalls = 0
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
    for boundary in ["background", "lifecycle", "destroy", "lifecycle-off-main", "destroy-off-main", "denied", "restricted", "pending", "nil", "future-time", "invalid-time"] {
      let m = fixture(); _ = m.startObservation(owner: "A"); let callback = m.manager.callbacks[0]
      let activity = CMMotionActivity()
      switch boundary {
      case "background": UIApplication.shared.applicationState = .background
      case "lifecycle": m.invalidateFromLifecycle(destroying: false)
      case "destroy": m.invalidateFromLifecycle(destroying: true)
      case "lifecycle-off-main":
        Thread.isMainThread = false
        m.invalidateFromLifecycle(destroying: false)
      case "destroy-off-main":
        Thread.isMainThread = false
        m.invalidateFromLifecycle(destroying: true)
      case "denied": CMMotionActivityManager.authorization = .denied
      case "restricted": CMMotionActivityManager.authorization = .restricted
      case "pending": CMMotionActivityManager.authorization = .notDetermined
      case "future-time": activity.timestamp = 11
      case "invalid-time": activity.timestamp = .nan
      default: break
      }
      if boundary == "lifecycle-off-main" || boundary == "destroy-off-main" {
        precondition(DispatchQueue.main.syncCalls == 1, boundary)
        precondition(!Thread.isMainThread, "sync restores the calling thread")
        precondition(!m.updating && m.activeOwner == nil, "lifecycle invalidates before returning")
      }
      callback(boundary == "nil" ? nil : activity)
      precondition(samples(m).isEmpty, boundary)
      precondition(!m.updating, boundary)
      callback(CMMotionActivity()); precondition(samples(m).isEmpty, boundary)
      if boundary == "destroy" {
        precondition(m.startObservation(owner: "C")["state"] as? String == "error")
        precondition(m.manager.callbacks.count == 1)
      }
      if boundary == "destroy-off-main" {
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

function swiftToolContext(name) {
  const candidates = [], lookupErrors = [];
  for (const directory of new Set((process.env.PATH ?? '/usr/bin:/bin').split(path.delimiter))) {
    const executable = path.resolve(directory || '.', name);
    try {
      accessSync(executable, constants.X_OK);
      if (statSync(executable).isFile()) candidates.push({ path: executable, canonicalPath: realpathSync(executable) });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') lookupErrors.push({ path: executable, errorCode: error.code });
    }
  }
  return { selected: candidates[0] ?? null, candidates, lookupErrors };
}

function swiftCompilerContext() {
  const compiler = swiftToolContext('swiftc'), interpreter = swiftToolContext('swift');
  const environmentKeys = ['ImageOS', 'ImageVersion', 'RUNNER_ARCH', 'SDKROOT', 'TOOLCHAINS', 'DEVELOPER_DIR',
    'SWIFT_PATH', 'SWIFT_EXEC', 'SWIFT_DRIVER_SWIFT_FRONTEND_EXEC'];
  return {
    compiler: compiler.selected,
    candidates: compiler.candidates,
    compilerLookupErrors: compiler.lookupErrors,
    interpreter: interpreter.selected,
    interpreterCandidates: interpreter.candidates,
    interpreterLookupErrors: interpreter.lookupErrors,
    node: { version: process.version, executable: process.execPath },
    npm: { userAgent: process.env.npm_config_user_agent ?? null, executable: process.env.npm_execpath ?? null },
    environment: Object.fromEntries(environmentKeys.map(key => [key, process.env[key] ?? null])),
  };
}

function boundedCompilerOutput(value) {
  const output = String(value ?? ''), limit = 16_384;
  if (output.length <= limit) return output;
  return `${output.slice(0, limit / 2)}\n[${output.length - limit} characters omitted]\n${output.slice(-limit / 2)}`;
}

function swiftDiagnostics(context, hostMode, command, argv, result, startedAt) {
  return JSON.stringify({
    ...context, hostMode, command, argv, elapsedMs: Math.round(performance.now() - startedAt),
    status: result.status, signal: result.signal, errorCode: result.error?.code ?? null,
    ...(result.phases ?? {}),
    ...(result.failureSnapshot ? { failureSnapshot: result.failureSnapshot } : {}),
    stdout: boundedCompilerOutput(result.stdout), stderr: boundedCompilerOutput(result.stderr),
  }, null, 2);
}

// Failure-only metadata from the owned compiler subtree. Each proc read is
// capped at 2 KiB; at most 48 reads and 20 ms of collection are allowed. No
// environment, source/cache contents or global process inventory is inspected.
function immediateFailureSnapshot(pid) {
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null;
  const startedAt = performance.now(), processes = [], queue = [{ pid, parent: process.pid }], seen = new Set();
  let reads = 0, truncated = false;
  const allowed = () => reads < 48 && performance.now() - startedAt < 20;
  const read = filename => {
    if (!allowed()) { truncated = true; return '[diagnostic budget exhausted]'; }
    reads += 1;
    let descriptor;
    try {
      descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      const bytes = Buffer.alloc(2_048);
      return bytes.subarray(0, readSync(descriptor, bytes, 0, bytes.length, 0)).toString('utf8').trim();
    } catch (error) { return `[${error.code ?? 'unavailable'}]`; }
    finally { if (descriptor !== undefined) closeSync(descriptor); }
  };
  while (queue.length && processes.length < 8 && allowed()) {
    const current = queue.shift();
    if (seen.has(current.pid)) continue;
    seen.add(current.pid);
    const root = `/proc/${current.pid}`, status = read(`${root}/status`);
    if (Number(status.match(/^PPid:\s+(\d+)$/m)?.[1]) !== current.parent) {
      processes.push({ pid: current.pid, state: 'owned process no longer present' });
      continue;
    }
    processes.push({ pid: current.pid,
      status: status.split('\n').filter(line => /^(?:Name|State|PPid|Threads|VmRSS|voluntary_ctxt_switches|nonvoluntary_ctxt_switches):/.test(line)),
      processStat: read(`${root}/stat`), waitChannel: read(`${root}/wchan`), scheduler: read(`${root}/schedstat`),
      command: read(`${root}/cmdline`).replaceAll('\0', ' ').slice(0, 1_024),
    });
    for (const child of read(`${root}/task/${current.pid}/children`).split(/\s+/)) {
      if (/^[1-9][0-9]*$/.test(child)) queue.push({ pid: Number(child), parent: current.pid });
    }
  }
  return { processes, reads, truncated: truncated || queue.length > 0, elapsedMs: performance.now() - startedAt };
}

const runtimeMarkerTag = 'OCCULERT_MOTION_RUNTIME_START:';
const expectedPassLines = [...swift.matchAll(/print\("(PASS [^"]+)"\)/g)].map(match => match[1]);
const immediatePOSIXHeader = `#ifndef OCCULERT_FIXTURE_POSIX_H
#define OCCULERT_FIXTURE_POSIX_H
#include <stdint.h>
#include <time.h>
#include <unistd.h>

static inline int occulert_fixture_clock_nanoseconds(uint64_t *value) {
  struct timespec stamp;
#if defined(__APPLE__)
  const clockid_t clock = CLOCK_MONOTONIC_RAW;
#else
  const clockid_t clock = CLOCK_MONOTONIC;
#endif
  if (!value || clock_gettime(clock, &stamp) != 0 || stamp.tv_sec < 0 ||
      stamp.tv_nsec < 0 || stamp.tv_nsec >= 1000000000L ||
      (uint64_t)stamp.tv_sec > (UINT64_MAX - (uint64_t)stamp.tv_nsec) / UINT64_C(1000000000)) return -1;
  *value = (uint64_t)stamp.tv_sec * UINT64_C(1000000000) + (uint64_t)stamp.tv_nsec;
  return 0;
}

static inline int occulert_fixture_write_marker(const void *bytes, size_t count) {
  const ssize_t written = write(STDERR_FILENO, bytes, count);
  return written >= 0 && (size_t)written == count ? 0 : -1;
}
#endif
`;
const immediatePOSIXModuleMap = `module OcculertFixturePOSIX {
  header "OcculertFixturePOSIX.h"
  export *
}
`;

function boundedStreamCapture() {
  const half = 8_192;
  let length = 0, head = '', tail = '';
  return {
    push(chunk) {
      length += chunk.length;
      head += chunk.slice(0, Math.max(0, half - head.length));
      tail = (tail + chunk).slice(-half);
    },
    value() {
      if (length <= half) return head;
      if (length <= half * 2) return head + tail.slice(-(length - half));
      return `${head}\n[${length - half * 2} characters omitted]\n${tail}`;
    },
  };
}

// Keep line state bounded while still detecting marker mentions beyond the
// retained prefix. A partial line at EOF is never a complete runtime marker.
function swiftLineReader(onLine) {
  let line = '', overflow = false, markerMention = false, searchTail = '';
  const emit = complete => {
    onLine({ line, overflow, markerMention, complete });
    line = ''; overflow = false; markerMention = false; searchTail = '';
  };
  return {
    push(chunk) {
      const pieces = chunk.split('\n');
      for (let index = 0; index < pieces.length; index++) {
        const piece = pieces[index], search = searchTail + piece;
        markerMention ||= search.includes(runtimeMarkerTag);
        searchTail = search.slice(-(runtimeMarkerTag.length - 1));
        if (line.length + piece.length <= 4_096 && !overflow) line += piece;
        else overflow = true;
        if (index < pieces.length - 1) emit(true);
      }
    },
    end() { if (line || overflow || markerMention) emit(false); },
  };
}

function immediateSwiftSource(markerPrefix) {
  assert.equal(swift.split('@main struct Suite {').length, 2);
  return swift.replace('@main struct Suite {', 'struct Suite {') + `
import OcculertFixturePOSIX
var fixtureStampNs: UInt64 = 0
precondition(occulert_fixture_clock_nanoseconds(&fixtureStampNs) == 0, "runtime clock unavailable")
let fixtureMarker = Array((${JSON.stringify(markerPrefix)} + String(fixtureStampNs) + "\\n").utf8)
fixtureMarker.withUnsafeBufferPointer { bytes in
  precondition(occulert_fixture_write_marker(bytes.baseAddress, bytes.count) == 0, "runtime marker write failed")
}
Suite.main()
`;
}

// Node hrtime and the child marker share CLOCK_MONOTONIC on Linux. Node 24's
// Darwin libuv uses mach_continuous_time, matching CLOCK_MONOTONIC_RAW above.
// The child timestamp prevents queued marker delivery from granting extra time.
function runImmediateSwift(argv, markerPrefix, {
  spawnProcess = spawn, now = () => process.hrtime.bigint(), schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  const preparationBudget = 30_000_000_000n, runtimeBudget = 10_000_000_000n;
  const startedNs = now(), preparationDeadline = startedNs + preparationBudget;
  return new Promise(resolve => {
    const stdout = boundedStreamCapture(), stderr = boundedStreamCapture();
    let child, timer, settled = false, closed = false, markerCount = 0, runtimeNs = null;
    let status = null, signal = null, killSignal = null, passLineCount = 0;
    const passLines = [];
    const phase = () => runtimeNs === null ? 'preparation' : 'runtime';
    const finish = (error = undefined, failurePhase = null) => {
      if (settled) return;
      settled = true;
      cancel(timer);
      const endedNs = now();
      let failureSnapshot = null;
      if (error && !closed && child) {
        try { failureSnapshot = immediateFailureSnapshot(child.pid); }
        catch (snapshotError) { failureSnapshot = { error: snapshotError.code ?? 'unavailable' }; }
        finally {
          killSignal = 'SIGKILL';
          try { child.kill(killSignal); } catch { /* Preserve the original failure. */ }
          child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.();
        }
      }
      resolve({ error, status, signal, stdout: stdout.value(), stderr: stderr.value(), passLines, passLineCount, failureSnapshot,
        phases: { markerCount, failurePhase, killSignal,
          preparationElapsedMs: Number((runtimeNs ?? endedNs) - startedNs) / 1e6,
          runtimeElapsedMs: runtimeNs === null ? null : Number(endedNs - runtimeNs) / 1e6,
          totalElapsedMs: Number(endedNs - startedNs) / 1e6 } });
    };
    const fail = (code, message, failedPhase = phase()) => finish(Object.assign(new Error(message), { code }), failedPhase);
    const checkDeadline = () => {
      if (settled) return false;
      const deadline = runtimeNs === null ? preparationDeadline : runtimeNs + runtimeBudget;
      if (now() >= deadline) { fail('ETIMEDOUT', `Swift ${phase()} deadline exceeded`); return false; }
      return true;
    };
    const arm = () => {
      cancel(timer);
      const deadline = runtimeNs === null ? preparationDeadline : runtimeNs + runtimeBudget;
      timer = schedule(() => { if (checkDeadline()) arm(); }, Math.max(1, Math.ceil(Number(deadline - now()) / 1e6)));
    };
    const outputLines = swiftLineReader(({ line, complete, overflow }) => {
      if (complete && !overflow && line.startsWith('PASS ')) {
        passLineCount += 1;
        if (passLines.length < 6) passLines.push(line);
      }
    });
    const markerLines = swiftLineReader(({ line, complete, overflow, markerMention }) => {
      if (settled || !markerMention) return;
      if (!complete || overflow || !line.startsWith(markerPrefix) || !/^[0-9]{1,20}$/.test(line.slice(markerPrefix.length))) {
        fail('EINVALIDRUNTIMEMARKER', 'Swift runtime marker is malformed'); return;
      }
      markerCount += 1;
      if (markerCount !== 1) { fail('EDUPLICATERUNTIMEMARKER', 'Swift runtime marker repeated'); return; }
      const stampNs = BigInt(line.slice(markerPrefix.length)), receiptNs = now();
      if (stampNs < startedNs || stampNs > receiptNs) {
        fail('EINVALIDRUNTIMECLOCK', 'Swift runtime marker is outside the shared clock interval'); return;
      }
      if (stampNs >= preparationDeadline) { fail('ETIMEDOUT', 'Swift preparation deadline exceeded', 'preparation'); return; }
      runtimeNs = stampNs;
      if (checkDeadline()) arm();
    });
    try { child = spawnProcess('swift', argv, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { finish(error, 'spawn'); return; }
    child.once('error', error => finish(error, 'spawn'));
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (settled) return;
      stdout.push(chunk); outputLines.push(chunk); checkDeadline();
    });
    child.stderr.on('data', chunk => {
      if (settled) return;
      stderr.push(chunk); markerLines.push(chunk); checkDeadline();
    });
    child.stdout.once('error', error => finish(error, phase()));
    child.stderr.once('error', error => finish(error, phase()));
    child.once('close', (code, childSignal) => {
      if (settled) return;
      closed = true; status = code; signal = childSignal;
      outputLines.end(); markerLines.end();
      if (!checkDeadline()) return;
      if (markerCount !== 1) { fail('EMISSINGRUNTIMEMARKER', 'Swift closed without a complete runtime marker'); return; }
      if (status !== 0) { fail('ESWIFTEXIT', 'Swift policy fixture did not exit successfully'); return; }
      if (passLineCount !== 5 || passLines.some((line, index) => line !== expectedPassLines[index])) {
        fail('ESWIFTPASSGROUPS', 'Swift policy fixture did not pass all five assertion groups'); return;
      }
      finish();
    });
    if (checkDeadline()) arm();
  });
}

test('Linux Swift phase watchdogs enforce separate preparation and runtime deadlines without losing streamed evidence', async () => {
  const base = 1_000_000_000_000n, prefix = runtimeMarkerTag + 'fixture-nonce:';
  const generated = immediateSwiftSource(prefix), entrypoint = swift.indexOf('@main struct Suite {');
  const body = swift.slice(0, entrypoint) + swift.slice(entrypoint + '@main '.length);
  assert.equal(generated.slice(0, body.length), body, 'the immediate fixture retains every actual method and assertion');
  assert.equal((swift.match(/\bprecondition\(/g) || []).length, 36);
  assert.equal((generated.match(/\bSuite\.main\(\)/g) || []).length, 1);
  assert.doesNotMatch(generated, /^import (?:Glibc|Darwin|Foundation)\b/m, 'the marker does not import a broad platform overlay');
  assert.doesNotMatch(generated, /@_silgen_name/, 'POSIX calls use the normal imported C ABI');
  assert.deepEqual([...immediatePOSIXHeader.matchAll(/^#include <([^>]+)>$/gm)].map(match => match[1]), ['stdint.h', 'time.h', 'unistd.h']);
  assert.match(immediatePOSIXModuleMap, /header "OcculertFixturePOSIX\.h"/);
  assert.doesNotMatch(generated.slice(body.length, generated.indexOf('fixtureMarker.withUnsafeBufferPointer')), /\b(?:Suite|OcculertMotionActivityModule)\s*[.(]/,
    'entrypoint preparation does not initialize or invoke the policy suite');
  assert.match(generated.slice(body.length), /fixtureMarker\.withUnsafeBufferPointer \{ bytes in\s*precondition\(occulert_fixture_write_marker\(bytes\.baseAddress, bytes\.count\) == 0, "runtime marker write failed"\)\s*\}\s*Suite\.main\(\)\s*$/,
    'the unbuffered marker write immediately precedes the only policy-suite invocation');
  const fixture = () => {
    let clock = base, sequence = 0;
    const timers = new Map(), kills = [], child = new EventEmitter();
    const stream = () => Object.assign(new EventEmitter(), { setEncoding() {}, destroy() {} });
    child.stdout = stream(); child.stderr = stream(); child.kill = signal => kills.push(signal); child.unref = () => {};
    const promise = runImmediateSwift([], prefix, { spawnProcess: () => child, now: () => clock,
      schedule: (callback, delay) => { timers.set(++sequence, { callback, delay }); return sequence; },
      cancel: id => timers.delete(id) });
    return { promise, child, timers, kills,
      at(ms) { clock = base + BigInt(ms) * 1_000_000n; },
      marker(ms, suffix = '\n') { child.stderr.emit('data', prefix + String(base + BigInt(ms) * 1_000_000n) + suffix); },
      passes() { child.stdout.emit('data', expectedPassLines.join('\n') + '\n'); },
      close(code = 0) { child.emit('close', code, null); },
      fire() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); },
    };
  };
  const errorCode = async (f, code, phase) => {
    const result = await f.promise;
    assert.equal(result.error?.code, code);
    if (phase) assert.equal(result.phases.failurePhase, phase);
    assert.equal(f.timers.size, 0);
    return result;
  };
  {
    const f = fixture(); f.at(29_000);
    const marker = prefix + String(base + 29_000_000_000n) + '\n';
    f.child.stderr.emit('data', 'x'.repeat(50_000) + '\n' + marker.slice(0, 17));
    f.child.stderr.emit('data', marker.slice(17));
    f.child.stderr.emit('data', 'y'.repeat(50_000) + '\n');
    f.child.stdout.emit('data', 'x'.repeat(50_000) + '\n'); f.passes();
    f.child.stdout.emit('data', 'y'.repeat(50_000) + '\n');
    f.at(38_000); f.close();
    const result = await f.promise;
    assert.equal(result.error, undefined);
    assert.equal(result.phases.markerCount, 1);
    assert.equal(result.phases.preparationElapsedMs, 29_000);
    assert.equal(result.phases.runtimeElapsedMs, 9_000);
    assert.deepEqual(result.passLines, expectedPassLines);
    assert.equal(result.passLineCount, 5);
    assert.ok(result.stdout.length < 17_000 && result.stderr.length < 17_000);
    assert.deepEqual(f.kills, []);
  }
  {
    const f = fixture(); f.at(1_000); f.passes(); f.close();
    await errorCode(f, 'EMISSINGRUNTIMEMARKER', 'preparation');
  }
  {
    const f = fixture(); f.at(30_000); f.fire();
    const result = await errorCode(f, 'ETIMEDOUT', 'preparation');
    assert.deepEqual(f.kills, ['SIGKILL']); // The promise settles even if kill produces no close event.
    f.marker(29_000); f.passes(); f.close();
    assert.equal(result.phases.markerCount, 0);
    assert.equal(result.passLineCount, 0);
  }
  {
    const f = fixture(); f.at(1_000); f.marker(1_000); f.marker(1_000);
    await errorCode(f, 'EDUPLICATERUNTIMEMARKER', 'runtime');
  }
  for (const marker of [prefix + String(base) + 'wrong\n', runtimeMarkerTag + 'wrong-nonce:' + String(base) + '\n', prefix + String(base)]) {
    const f = fixture(); f.child.stderr.emit('data', marker); f.close();
    await errorCode(f, 'EINVALIDRUNTIMEMARKER');
  }
  for (const stamp of [-1, 1_001]) {
    const f = fixture(); f.at(1_000); f.marker(stamp);
    await errorCode(f, 'EINVALIDRUNTIMECLOCK', 'preparation');
  }
  {
    const f = fixture(); f.at(31_000); f.marker(30_001);
    await errorCode(f, 'ETIMEDOUT', 'preparation');
  }
  {
    const f = fixture(); f.at(12_000); f.marker(1_000);
    await errorCode(f, 'ETIMEDOUT', 'runtime'); // Receipt cannot grant another ten seconds.
  }
  {
    const f = fixture(); f.at(1_000); f.marker(1_000); f.at(11_000); f.fire();
    const result = await errorCode(f, 'ETIMEDOUT', 'runtime');
    f.passes(); f.close();
    assert.equal(result.passLineCount, 0);
    assert.deepEqual(f.kills, ['SIGKILL']);
  }
  {
    const f = fixture(); f.at(1_000); f.marker(1_000); f.passes(); f.at(11_000); f.close();
    await errorCode(f, 'ETIMEDOUT', 'runtime'); // A delayed timer cannot let an over-budget close pass.
  }
  {
    const f = fixture(); f.at(5_000); f.fire();
    assert.equal(f.timers.size, 1); // Early timer callbacks recheck the clock and rearm.
    f.at(6_000); f.marker(6_000); f.passes(); f.at(7_000); f.close();
    assert.equal((await f.promise).error, undefined);
  }
  {
    const f = fixture(); f.child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await errorCode(f, 'ENOENT', 'spawn');
  }
  {
    const f = fixture(); f.at(1_000); f.marker(1_000); f.passes(); f.close(1);
    await errorCode(f, 'ESWIFTEXIT', 'runtime');
  }
  {
    const f = fixture(); f.at(1_000); f.marker(1_000); f.close();
    await errorCode(f, 'ESWIFTPASSGROUPS', 'runtime');
  }
});

test('actual Swift motion activity methods enforce ownership, permission and foreground lifecycle', async t => {
  assert.doesNotMatch(swift, /^\s*import\s+/m, 'controlled SDK stand-ins keep the fixture independent of imported SDK modules');
  const directory = mkdtempSync(path.join(tmpdir(), 'occulert-motion-activity-'));
  try {
    const input = path.join(directory, 'MotionActivityHarness.swift'), executable = path.join(directory, 'motion-activity-harness');
    const context = swiftCompilerContext();
    if (process.platform === 'linux') {
      // Immediate mode JITs the same policy and assertions without a standalone
      // host linker job. The required macOS job still compiles an executable.
      const markerPrefix = runtimeMarkerTag + randomBytes(16).toString('hex') + ':';
      writeFileSync(path.join(directory, 'OcculertFixturePOSIX.h'), immediatePOSIXHeader);
      writeFileSync(path.join(directory, 'module.modulemap'), immediatePOSIXModuleMap);
      writeFileSync(input, immediateSwiftSource(markerPrefix));
      const argv = ['-v', '-swift-version', '5', '-I', directory, '-module-cache-path', path.join(directory, 'module-cache'),
        '-Rmodule-loading', '-Xcc', '-Rmodule-build', '-Xcc', '-Rmodule-import', input];
      const startedAt = performance.now();
      const run = await runImmediateSwift(argv, markerPrefix);
      const diagnostics = swiftDiagnostics(context, 'immediate', 'swift', argv, run, startedAt);
      t.diagnostic(`Swift immediate-mode diagnostics:\n${diagnostics}`);
      if (run.error?.code === 'ENOENT' && context.compiler === null && context.interpreter === null
        && context.compilerLookupErrors.length === 0 && context.interpreterLookupErrors.length === 0) {
        t.skip('Swift compiler and interpreter absent; the required macOS native-method job executes this harness.');
        return;
      }
      assert.equal(run.error, undefined, diagnostics);
      assert.equal(run.status, 0, diagnostics);
      assert.equal(run.passLineCount, 5, diagnostics);
      assert.deepEqual(run.passLines, expectedPassLines, diagnostics);
      return;
    }

    writeFileSync(input, swift);
    const argv = ['-v', '-parse-as-library', '-swift-version', '5',
      '-module-cache-path', path.join(directory, 'module-cache'), input, '-o', executable];
    const startedAt = performance.now();
    const compile = spawnSync('swiftc', argv, {
      encoding: 'utf8', timeout: 30_000,
    });
    const diagnostics = swiftDiagnostics(context, 'standalone-compile', 'swiftc', argv, compile, startedAt);
    t.diagnostic(`Swift compile diagnostics:\n${diagnostics}`);
    if (compile.error?.code === 'ENOENT' && process.platform !== 'darwin') {
      t.skip('Swift compiler absent; the required macOS native-method job executes this harness.');
      return;
    }
    assert.equal(compile.error, undefined, diagnostics);
    assert.equal(compile.status, 0, diagnostics);
    const runStartedAt = performance.now();
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 });
    const runDiagnostics = swiftDiagnostics(context, 'standalone-execute', executable, [], run, runStartedAt);
    t.diagnostic(`Swift executable diagnostics:\n${runDiagnostics}`);
    assert.equal(run.error, undefined, runDiagnostics);
    assert.equal(run.status, 0, runDiagnostics);
    assert.equal((run.stdout.match(/^PASS /gm) || []).length, 5, run.stdout);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
