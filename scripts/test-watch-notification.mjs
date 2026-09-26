import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Compile the actual receiver methods against tiny, deterministic bridge
// stand-ins. This exercises Swift actor continuations without Apple SDKs,
// entitlements, devices, or compiling/installing an Occulert application.
const source = readFileSync(new URL('../native-app/targets/occulert-watch/AlertReceiver.swift', import.meta.url), 'utf8');
function method(name) {
  const start = source.indexOf(`  private func ${name}(`);
  assert.ok(start >= 0, `production ${name} must exist`);
  const next = source.indexOf('\n  private func ', start + 1);
  const body = source.slice(start, next >= 0 ? next : source.lastIndexOf('\n}'));
  return body.replace('private func', 'func');
}
const swift = `
import Foundation

@MainActor struct Date {
  static var clock = 100_000.0
  var timeIntervalSince1970: Double { Self.clock / 1_000 }
}
struct NotificationSettings: Sendable {
  enum Authorization: Sendable { case authorized, denied, provisional }
  var authorizationStatus: Authorization
}
@MainActor final class UNMutableNotificationContent {
  enum Sound { case \`default\` }
  enum Interruption { case timeSensitive }
  var title = "", body = ""
  var sound: Sound = .default
  var interruptionLevel: Interruption = .timeSensitive
  var relevanceScore = 0.0
  var userInfo: [String: Any] = [:]
}
@MainActor struct UNNotificationRequest {
  var identifier: String
  var content: UNMutableNotificationContent
  var trigger: String?
}
@MainActor final class UNUserNotificationCenter {
  static let singleton = UNUserNotificationCenter()
  static func current() -> UNUserNotificationCenter { singleton }
  var callbacks: [@Sendable (NotificationSettings) -> Void] = []
  var requests: [UNNotificationRequest] = []
  func getNotificationSettings(_ callback: @escaping @Sendable (NotificationSettings) -> Void) { callbacks.append(callback) }
  func add(_ request: UNNotificationRequest) { requests.append(request) }
  func reset() { callbacks = []; requests = [] }
  func release(_ index: Int = 0, authorized: NotificationSettings.Authorization = .authorized) {
    callbacks[index](NotificationSettings(authorizationStatus: authorized))
  }
}
@MainActor final class WKExtension {
  enum State { case active, background }
  static let singleton = WKExtension()
  static func shared() -> WKExtension { singleton }
  var applicationState: State = .background
}
@MainActor final class Subject {
  var lastAlertAt = 0.0, lastStatusAt = 0.0, lastStoppedStatusAt = 0.0
  var lastLevel = "none", lastMessage = "", monitoringState = "stopped"
  var isMonitoring = false
  var fatigueScore = 0, perclosPercent = 0, sessionSeconds = 0
  let statusFreshnessMilliseconds = 12_000.0
  let backgroundAlertFeedbackFreshnessMilliseconds = 2_000.0
  var statusTimeoutTask: Task<Void, Never>?
  var foregroundHaptics = 0
  func playHaptic(level: String) { foregroundHaptics += 1 }
  ${method('handleAlert')}
  ${method('scheduleBackgroundAlert')}
  ${method('handleStatus')}
  ${method('numberValue')}
}
@main struct Suite {
  @MainActor static func flush() async { for _ in 0..<16 { await Task.yield() } }
  @MainActor static func fixture() -> Subject {
    Date.clock = 100_000
    UNUserNotificationCenter.current().reset()
    WKExtension.shared().applicationState = .background
    return Subject()
  }
  @MainActor static func alert(_ subject: Subject, at: Double = 100_000, level: String = "alert", feedback: Bool = true) {
    subject.handleAlert(["type":"occulert-alert", "at":at, "level":level], shouldDeliverFeedback: feedback)
  }
  @MainActor static func stop(_ subject: Subject, at: Double) {
    subject.handleStatus(["type":"occulert-status", "at":at, "running":false])
  }
  @MainActor static func main() async {
    let center = UNUserNotificationCenter.current()
    do {
      let s = fixture(); alert(s, level:"critical")
      precondition(center.requests.isEmpty)
      center.release(); await flush()
      precondition(center.requests.count == 1)
      let request = center.requests[0]
      precondition(request.content.title == "PULL OVER NOW")
      precondition(request.content.body == "High fatigue detected. Pull over safely and rest now.")
      precondition(request.content.interruptionLevel == .timeSensitive && request.content.sound == .default)
      precondition(request.identifier == "occulert-alert-100000")
      precondition(s.foregroundHaptics == 0)
      print("PASS fresh authorized background fallback")
    }
    for elapsed in [1999.0, 2000.0, 5000.0, -1.0] {
      let s = fixture(); alert(s)
      Date.clock += elapsed
      center.release(); await flush()
      precondition(center.requests.count == (elapsed >= 0 && elapsed < 2000 ? 1 : 0))
    }
    print("PASS callback-time freshness and future rejection")
    do {
      let s = fixture(); alert(s)
      Date.clock += 10; alert(s, at:100_010, level:"tracking")
      center.release(0); await flush(); precondition(center.requests.isEmpty)
      center.release(1); await flush(); precondition(center.requests.count == 1)
      precondition(center.requests[0].content.title == "Tracking lost")
      print("PASS latest alert replaces old deferred feedback")
    }
    for stopAt in [100_000.0, 100_001.0] {
      let s = fixture(); alert(s); stop(s, at:stopAt)
      center.release(); await flush(); precondition(center.requests.isEmpty)
    }
    print("PASS same-time and newer explicit stop cancel deferred notification")
    do {
      let s = fixture(); stop(s, at:99_000); alert(s)
      // An older out-of-order stop cannot cancel a fresh alert.
      stop(s, at:98_000)
      center.release(); await flush(); precondition(center.requests.count == 1)
      print("PASS earlier stop preserves a new alert fallback")
    }
    for authorization in [NotificationSettings.Authorization.denied, .provisional] {
      let s = fixture(); alert(s); center.release(authorized:authorization)
      await flush(); precondition(center.requests.isEmpty)
    }
    print("PASS denied and provisional authorization stay silent")
    do {
      var s: Subject? = fixture(); alert(s!); s = nil
      center.release(); await flush(); precondition(center.requests.isEmpty)
      print("PASS released receiver cannot schedule late notification")
    }
    do {
      let s = fixture(); alert(s, feedback:false)
      precondition(center.callbacks.isEmpty && center.requests.isEmpty)
      WKExtension.shared().applicationState = .active
      alert(s, at:100_001)
      precondition(s.foregroundHaptics == 1 && center.callbacks.isEmpty)
      print("PASS replay stays silent and foreground haptic remains intact")
    }
  }
}
`;

test('Watch deferred notification continuations obey freshness, identity, stop, and authorization', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'occulert-watch-notification-'));
  try {
    const input = path.join(directory, 'NotificationHarness.swift'), executable = path.join(directory, 'notification-harness');
    writeFileSync(input, swift);
    const compile = spawnSync('swiftc', ['-parse-as-library', '-swift-version', '6', input, '-o', executable], { encoding: 'utf8', timeout: 30000 });
    assert.equal(compile.error, undefined, `Swift compiler required for native callback harness: ${compile.error?.message}`);
    assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
    const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.match(/^PASS /gm)?.length, 8, result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
