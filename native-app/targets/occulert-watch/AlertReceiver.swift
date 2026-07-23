import Foundation
import WatchConnectivity
import WatchKit

@MainActor
final class AlertReceiver: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var connectionText = "Connecting to iPhone…"
  @Published private(set) var lastLevel = "none"
  @Published private(set) var lastMessage = "Start monitoring on your iPhone"
  @Published private(set) var lastAlertAt: Double = 0

  override init() {
    super.init()
    guard WCSession.isSupported() else {
      connectionText = "Watch connection unavailable"
      return
    }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  nonisolated func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    Task { @MainActor in
      if let error {
        self.connectionText = "Connection error: \(error.localizedDescription)"
      } else if activationState == .activated {
        self.connectionText = session.isReachable ? "iPhone connected" : "Ready — open Occulert on iPhone"
      } else {
        self.connectionText = "Connecting to iPhone…"
      }
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    Task { @MainActor in
      self.connectionText = session.isReachable ? "iPhone connected" : "Ready — open Occulert on iPhone"
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    Task { @MainActor in self.handle(message, shouldPlayHaptic: true) }
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    Task { @MainActor in self.handle(message, shouldPlayHaptic: true) }
    replyHandler(["received": true])
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    Task { @MainActor in
      let sentAt = applicationContext["at"] as? Double ?? 0
      let ageMilliseconds = Date().timeIntervalSince1970 * 1_000 - sentAt
      self.handle(applicationContext, shouldPlayHaptic: ageMilliseconds >= 0 && ageMilliseconds < 5_000)
    }
  }

  private func handle(_ message: [String: Any], shouldPlayHaptic: Bool) {
    guard message["type"] as? String == "occulert-alert" else { return }
    let sentAt = message["at"] as? Double ?? 0
    guard sentAt > lastAlertAt else { return }

    let level = message["level"] as? String ?? "alert"
    lastAlertAt = sentAt
    lastLevel = level
    lastMessage = switch level {
    case "critical": "PULL OVER NOW"
    case "alert": "Drowsiness detected"
    case "watch": "Eyes drooping"
    default: "Monitoring"
    }

    guard shouldPlayHaptic else { return }
    let device = WKInterfaceDevice.current()
    device.play(level == "critical" ? .failure : .notification)
    if level == "critical" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
        device.play(.failure)
      }
    }
  }
}
