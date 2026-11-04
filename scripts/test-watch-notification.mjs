import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Compile the whole production receiver, including properties, init, deinit,
// ingress and Tasks. Only framework interfaces, clocks and sleep are stand-ins;
// the harness contains no replacement alert or cancellation policy.
const source = readFileSync(new URL('../native-app/targets/occulert-watch/AlertReceiver.swift', import.meta.url), 'utf8');
const receiver = source
  .replace(/^import (?:UserNotifications|WatchConnectivity|WatchKit)\n/gm, '')
  .replace(/\bprivate func /g, 'func ')
  .replaceAll('Task.sleep(', 'TestClock.sleep(');
const delegateStart = receiver.indexOf('  nonisolated func session(');
const delegateEnd = receiver.indexOf('  func refreshNotificationAuthorization()', delegateStart);
assert.ok(delegateStart >= 0 && delegateEnd > delegateStart, 'delegate boundary must exist');
// The shipped target uses Swift 5. Keep a second Swift 6 lane for the actual
// policy/class lifecycle; unchanged Any-valued framework delegate crossings
// are excluded only in that strict lane, not silently rewritten as Sendable.
const strictReceiver = receiver.slice(0, delegateStart) + receiver.slice(delegateEnd);
const contentView = readFileSync(new URL('../native-app/targets/occulert-watch/ContentView.swift', import.meta.url), 'utf8');
const swift = String.raw`
import Foundation
@propertyWrapper struct Published<Value> { var wrappedValue: Value }
protocol ObservableObject: AnyObject {}
protocol WCSessionDelegate: AnyObject {}
enum WCSessionActivationState: Sendable { case notActivated, inactive, activated }
final class WCSession: @unchecked Sendable {
  static let ${'`default`'} = WCSession()
  weak var delegate: (any WCSessionDelegate)?
  var isReachable = true
  var receivedApplicationContext: [String: Any] = [:]
  static func isSupported() -> Bool { true }
  func activate() {}
}
// Epoch time is also read from the nonisolated receipt callback. Tests only
// mutate it on MainActor before releasing their controlled continuations.
struct Date {
  nonisolated(unsafe) static var clock = 100_000.0
  var timeIntervalSince1970: Double { Self.clock / 1_000 }
}
@MainActor struct ProcessInfo {
  static let processInfo = ProcessInfo()
  var systemUptime: Double { TestClock.now / 1_000 }
}
@MainActor enum TestClock {
  struct Sleep { let due: Double; let continuation: CheckedContinuation<Void, any Error> }
  static var now = 0.0
  static var pending: [Sleep] = []
  static func sleep(nanoseconds: UInt64) async throws {
    try Task.checkCancellation()
    try await withCheckedThrowingContinuation { continuation in
      pending.append(Sleep(due: now + Double(nanoseconds) / 1_000_000, continuation: continuation))
    }
  }
  static func flush() async { for _ in 0..<32 { await Task.yield() } }
  static func reset() {
    let old = pending; pending = []
    for sleep in old { sleep.continuation.resume(throwing: CancellationError()) }
    now = 0; Date.clock = 100_000
  }
  static func move(to time: Double) {
    precondition(time >= now)
    Date.clock += time - now; now = time
  }
  // Canceled sleeps also resume successfully: the real Task/generation guards
  // must reject queued old work rather than relying on the mock to remove it.
  static func releaseDue() {
    let due = pending.filter { $0.due <= now + 0.000_01 }
    pending.removeAll { $0.due <= now + 0.000_01 }
    for sleep in due { sleep.continuation.resume() }
  }
  static func advance(to time: Double) async {
    await flush()
    while let due = pending.map(\.due).filter({ $0 <= time + 0.000_01 }).min() {
      move(to: max(now, due)); releaseDue(); await flush()
    }
    move(to: time); await flush()
  }
  static func delayedWake(at time: Double) async {
    await flush(); move(to: time); releaseDue(); await flush()
  }
}
enum UNAuthorizationStatus: Sendable { case notDetermined, authorized, denied, provisional }
struct NotificationSettings: Sendable { var authorizationStatus: UNAuthorizationStatus }
struct UNAuthorizationOptions: OptionSet, Sendable {
  let rawValue: Int
  static let alert = Self(rawValue: 1), sound = Self(rawValue: 2)
}
@MainActor final class UNMutableNotificationContent {
  enum Sound { case ${'`default`'} }
  enum Interruption { case timeSensitive }
  var title = "", body = ""
  var sound: Sound = .default
  var interruptionLevel: Interruption = .timeSensitive
  var relevanceScore = 0.0
  var userInfo: [String: Any] = [:]
}
@MainActor struct UNNotificationRequest {
  var identifier: String; var content: UNMutableNotificationContent; var trigger: String?
}
@MainActor final class UNUserNotificationCenter {
  static let singleton = UNUserNotificationCenter()
  static func current() -> UNUserNotificationCenter { singleton }
  var callbacks: [@Sendable (NotificationSettings) -> Void] = []
  var requests: [UNNotificationRequest] = []
  func getNotificationSettings(_ callback: @escaping @Sendable (NotificationSettings) -> Void) { callbacks.append(callback) }
  func requestAuthorization(options: UNAuthorizationOptions, completionHandler: @escaping @Sendable (Bool, (any Error)?) -> Void) {}
  func add(_ request: UNNotificationRequest) { requests.append(request) }
  func reset() { callbacks = []; requests = [] }
  func release(_ index: Int = 0, authorized: UNAuthorizationStatus = .authorized) {
    callbacks[index](NotificationSettings(authorizationStatus: authorized))
  }
}
@MainActor final class WKExtension {
  enum State { case active, inactive, background }
  static let singleton = WKExtension()
  static func shared() -> WKExtension { singleton }
  var applicationState: State = .background
}
@MainActor final class WKInterfaceDevice {
  enum Haptic: Equatable { case failure, notification, retry }
  struct Pulse { let kind: Haptic; let at: Double }
  static let singleton = WKInterfaceDevice()
  static func current() -> WKInterfaceDevice { singleton }
  var pulses: [Pulse] = []
  func play(_ haptic: Haptic) { pulses.append(Pulse(kind: haptic, at: TestClock.now)) }
}
${receiver}
@main struct Suite {
  @MainActor static var passed = 0
  @MainActor static func pass(_ name: String) {
    passed += 1
    FileHandle.standardOutput.write(Data("PASS \(name)\n".utf8))
  }
  @MainActor static func fixture(active: Bool = false) -> AlertReceiver {
    TestClock.reset()
    WKExtension.shared().applicationState = active ? .active : .background
    WCSession.default.receivedApplicationContext = [:]
    WKInterfaceDevice.current().pulses = []
    let subject = AlertReceiver()
    UNUserNotificationCenter.current().reset() // Ignore init's settings query.
    return subject
  }
  @MainActor static func alert(_ s: AlertReceiver, at: Double? = nil, level: String = "critical", feedback: Bool = true) {
    s.handleAlert(["type":"occulert-alert", "at":at ?? Date.clock, "level":level], shouldDeliverFeedback: feedback)
  }
  @MainActor static func status(_ s: AlertReceiver, state: String = "closed", at: Double? = nil, running: Bool = true) {
    s.handleStatus(["type":"occulert-status", "at":at ?? Date.clock, "running":running, "state":state])
  }
  @MainActor static func times(_ kind: WKInterfaceDevice.Haptic = .failure) -> [Double] {
    WKInterfaceDevice.current().pulses.filter { $0.kind == kind }.map(\.at)
  }
  @MainActor static func assertTimes(_ expected: [Double], kind: WKInterfaceDevice.Haptic = .failure) {
    let actual = times(kind)
    precondition(actual.count == expected.count && zip(actual, expected).allSatisfy { abs($0 - $1) < 0.01 }, "pulse times \(actual), expected \(expected)")
  }
  @MainActor static func keepClosed(_ s: AlertReceiver, until end: Double) async {
    while TestClock.now < end {
      await TestClock.advance(to: min(end, TestClock.now + 3_000)); status(s)
    }
  }
  @MainActor static func main() async {
    let center = UNUserNotificationCenter.current()
    do {
      let s = fixture(); alert(s)
      precondition(center.requests.isEmpty)
      center.release(); await TestClock.flush()
      precondition(center.requests.count == 1)
      let r = center.requests[0]
      precondition(r.content.title == "PULL OVER NOW")
      precondition(r.content.body == "High fatigue detected. Pull over safely and rest now.")
      precondition(r.content.interruptionLevel == .timeSensitive && r.content.sound == .default)
      precondition(r.identifier == "occulert-alert-100000" && times().isEmpty)
      pass("fresh authorized background fallback")
    }
    for elapsed in [1999.0, 2000.0, 5000.0, -1.0] {
      let s = fixture(); alert(s); Date.clock += elapsed
      center.release(); await TestClock.flush()
      precondition(center.requests.count == (elapsed >= 0 && elapsed < 2000 ? 1 : 0))
    }
    pass("callback-time freshness and future rejection")
    do {
      let s = fixture(); alert(s); Date.clock += 10; alert(s, level:"tracking")
      center.release(0); await TestClock.flush(); precondition(center.requests.isEmpty)
      center.release(1); await TestClock.flush(); precondition(center.requests.count == 1)
      precondition(center.requests[0].content.title == "Tracking lost")
      pass("latest alert replaces deferred background feedback")
    }
    for stopAt in [100_000.0, 100_001.0] {
      let s = fixture(); alert(s); status(s, at:stopAt, running:false)
      center.release(); await TestClock.flush(); precondition(center.requests.isEmpty)
    }
    pass("same-time and newer stop cancel deferred notification")
    do {
      let s = fixture(); status(s, at:99_000, running:false); alert(s); status(s, at:98_000, running:false)
      center.release(); await TestClock.flush(); precondition(center.requests.count == 1)
      pass("out-of-order older stop preserves fresh fallback")
    }
    for authorization in [UNAuthorizationStatus.denied, .provisional] {
      let s = fixture(); alert(s); center.release(authorized:authorization)
      await TestClock.flush(); precondition(center.requests.isEmpty)
    }
    pass("denied and provisional authorization stay silent")
    do {
      var s: AlertReceiver? = fixture(); alert(s!); weak var weakSubject = s; s = nil
      precondition(weakSubject == nil)
      center.release(); await TestClock.flush(); precondition(center.requests.isEmpty)
      pass("disposed receiver cannot schedule late notification")
    }
    do {
      let s = fixture(); alert(s, feedback:false)
      precondition(center.callbacks.isEmpty && center.requests.isEmpty)
      WKExtension.shared().applicationState = .active; s.setForegroundActive(true)
      alert(s, at:100_001, level:"alert"); assertTimes([0], kind:.notification)
      precondition(center.callbacks.isEmpty)
      pass("replay silent and ordinary foreground haptic preserved")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:8_800)
      assertTimes([0,400,800,4000,4400,4800,8000,8400,8800])
      pass("actual triple pattern repeats every four seconds")
    }
    do {
      let s = fixture(active:true); alert(s)
      await TestClock.advance(to:1_000); status(s)
      await TestClock.advance(to:8_000); assertTimes([0,400,800])
      pass("missing status gives one shot and status alone cannot arm repeats")
    }
    for offset in [-11_999.0, -12_000.0, 1.0] {
      let s = fixture(active:true); status(s, at:Date.clock + offset); alert(s)
      await TestClock.advance(to:4_800)
      assertTimes(offset == -11_999 ? [0] : [0,400,800])
    }
    pass("status freshness is strict and future status never arms")
    for state in ["open", "noFace", "watch", "unexpected"] {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200); status(s, state:state)
      await TestClock.advance(to:8_000); assertTimes([0])
    }
    pass("open lost-face watch and malformed status cancel pending critical pulses")
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200); status(s, running:false)
      await TestClock.advance(to:8_000); assertTimes([0])
      pass("stop cancels in-flight triple and repeat timer")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:12_000)
      precondition(s.monitoringState == "stale" && !s.isMonitoring)
      assertTimes([0,400,800,4000,4400,4800,8000,8400,8800])
      await TestClock.advance(to:13_000); status(s); alert(s)
      await TestClock.advance(to:18_000); precondition(times().count == 9)
      pass("status timeout cancels at twelve seconds and closed refresh cannot revive")
    }
    for level in ["alert", "watch", "tracking", "none"] {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200); alert(s, level:level)
      await TestClock.advance(to:1_000); status(s); alert(s)
      await TestClock.advance(to:8_000); assertTimes([0])
    }
    pass("lower and replacement alerts cannot revive continuous episode")
    for state in [WKExtension.State.inactive, .background] {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200)
      WKExtension.shared().applicationState = state; s.setForegroundActive(false)
      await TestClock.advance(to:1_000)
      WKExtension.shared().applicationState = .active; s.setForegroundActive(true)
      status(s); alert(s)
      await TestClock.advance(to:8_000); assertTimes([0])
    }
    pass("inactive and background cancel without foreground-return revival")
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200); s.cancelForegroundFeedback()
      await TestClock.advance(to:8_000); assertTimes([0])
      pass("view disappearance cancels queued feedback")
    }
    do {
      var s: AlertReceiver? = fixture(active:true); status(s!); alert(s!)
      await TestClock.flush(); weak var weakSubject = s; s = nil
      precondition(weakSubject == nil, "timers must not retain receiver")
      await TestClock.advance(to:70_000); assertTimes([0])
      pass("actual deinit cancels timers and weak tasks release receiver")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200); alert(s)
      await TestClock.advance(to:4_800); assertTimes([0,4000,4400,4800])
      pass("fresh critical replacement cancels old pulses without duplicate pattern")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200); alert(s, feedback:false)
      await TestClock.advance(to:1_000); status(s); alert(s)
      await TestClock.advance(to:8_000); assertTimes([0])
      pass("display-only replacement cancels and cannot revive")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      for time in stride(from:3_000.0, through:63_000.0, by:3_000) {
        await TestClock.advance(to:time); status(s); alert(s)
      }
      precondition(times().filter { $0.truncatingRemainder(dividingBy:4_000) == 0 }.count == 15 && times().allSatisfy { $0 < 60_000 })
      precondition(s.lastMessage.contains("Pull over safely"))
      pass("repeated critical messages cannot renew sixty-second cap")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await keepClosed(s, until:55_000)
      await TestClock.delayedWake(at:59_900)
      let before = times().count
      precondition(times().last == 59_900)
      await TestClock.advance(to:60_800)
      precondition(times().count == before && times().allSatisfy { $0 < 60_000 })
      pass("trailing pulses check episode deadline")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:800); await TestClock.delayedWake(at:10_000)
      assertTimes([0,400,800,10_000])
      await TestClock.advance(to:10_800); assertTimes([0,400,800,10_000,10_400,10_800])
      pass("delayed scheduler emits one pattern without catching up")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:3_000); Date.clock += 90_000; status(s)
      await keepClosed(s, until:63_000)
      precondition(times().count == 45 && times().last == 56_800)
      precondition(s.lastMessage.contains("Pull over safely"))
      pass("forward wall-clock jump cannot move monotonic sixty-second cap")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:3_000); Date.clock -= 20_000
      await TestClock.advance(to:25_000); status(s); alert(s)
      await TestClock.advance(to:30_000); assertTimes([0,400,800])
      pass("backward wall-clock jump cancels future status without revival")
    }
    do {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200); status(s, state:"open")
      await TestClock.advance(to:1_000); status(s); alert(s)
      await TestClock.advance(to:1_800); assertTimes([0,1000,1400,1800])
      pass("fresh open permits a new critical episode")
    }
    for stopped in [false, true] {
      let s = fixture(active:true); status(s, at:99_000); alert(s)
      await TestClock.advance(to:200)
      status(s, state:"open", at:99_500, running:!stopped)
      await TestClock.advance(to:300); status(s); alert(s)
      await TestClock.advance(to:8_000); assertTimes([0])
    }
    pass("older open or stop cancels without clearing episode origin")
    for stopped in [false, true] {
      let s = fixture(active:true)
      status(s, state:"open", running:!stopped)
      await TestClock.advance(to:100); status(s)
      alert(s, at:100_000)
      await TestClock.advance(to:5_000); assertTimes([])
    }
    pass("critical sent before authoritative reopen or stop cannot play a late one-shot")
    for stopped in [false, true] {
      let s = fixture(active:true); status(s); alert(s)
      await TestClock.advance(to:200)
      status(s, state:"open", at:105_000, running:!stopped)
      await TestClock.advance(to:6_000); status(s); alert(s)
      await TestClock.advance(to:10_000); assertTimes([0])
    }
    pass("future open or stop cannot reset canceled continuous episode")
    do {
      let s = fixture(active:true); alert(s, level:"alert")
      await TestClock.advance(to:8_000); assertTimes([0,450], kind:.notification); assertTimes([])
      pass("standard alert remains two taps at four hundred fifty milliseconds")
    }
    #if !POLICY_ONLY
    for elapsed in [0.0, 1999.0, 2000.0, -1.0] {
      for withReply in [false, true] {
        let s = fixture(active:true); status(s)
        let payload: [String: Any] = ["type":"occulert-alert", "at":100_000.0 - elapsed, "level":"critical"]
        if withReply {
          s.session(WCSession.default, didReceiveMessage:payload) { receipt in
            precondition(receipt["received"] as? Bool == true)
          }
        } else { s.session(WCSession.default, didReceiveMessage:payload) }
        await TestClock.flush()
        precondition(times().count == (elapsed >= 0 && elapsed < 2000 ? 1 : 0))
      }
    }
    pass("actual ingress callbacks retain two-second and future guards")
    do {
      let s = fixture(active:true); status(s)
      WCSession.default.receivedApplicationContext = ["type":"occulert-alert", "at":100_000.0, "level":"critical"]
      s.session(WCSession.default, activationDidCompleteWith:.activated, error:nil)
      await TestClock.advance(to:8_000); assertTimes([]); precondition(center.requests.isEmpty)
      pass("actual activation replay never starts feedback")
    }
    #endif
    FileHandle.standardOutput.write(Data("SCENARIOS \(passed)\n".utf8))
  }
}
`;

for (const version of ['5', '6']) {
  test(`production Watch receiver policy obeys repeat, cancellation, cap and notification contracts (Swift ${version})`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'occulert-watch-notification-'));
    try {
      const input = path.join(directory, 'NotificationHarness.swift'), executable = path.join(directory, 'notification-harness');
      writeFileSync(input, version === '6' ? swift.replace(receiver, strictReceiver) : swift);
      const args = ['-parse-as-library', '-swift-version', version, '-module-cache-path', path.join(directory, 'module-cache')];
      if (version === '6') args.push('-D', 'POLICY_ONLY');
      const compile = spawnSync('swiftc', [...args, input, '-o', executable], { encoding: 'utf8', timeout: 30000 });
      assert.equal(compile.error, undefined, `Swift compiler required for native callback harness: ${compile.error?.message}`);
      assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
      const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const scenarios = version === '6' ? 30 : 32;
      assert.equal(result.stdout.match(/^PASS /gm)?.length, scenarios, result.stdout);
      assert.match(result.stdout, new RegExp(`SCENARIOS ${scenarios}`));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('Watch lifecycle forwards appearance, every phase, and disappearance', () => {
  assert.match(contentView, /\.onAppear\s*\{[\s\S]*?receiver\.setForegroundActive\(scenePhase == \.active\)/);
  assert.match(contentView, /\.onChange\(of: scenePhase\)\s*\{\s*_, phase in[\s\S]*?receiver\.setForegroundActive\(phase == \.active\)/);
  assert.match(contentView, /\.onDisappear\s*\{[\s\S]*?receiver\.setForegroundActive\(false\)/);
});
