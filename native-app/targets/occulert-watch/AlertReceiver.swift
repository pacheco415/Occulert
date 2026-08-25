import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit

@MainActor
final class AlertReceiver: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var connectionText = "Connecting to iPhone…"
  @Published private(set) var lastLevel = "none"
  @Published private(set) var lastMessage = "Start monitoring on your iPhone"
  @Published private(set) var lastAlertAt: Double = 0
  @Published private(set) var isMonitoring = false
  @Published private(set) var monitoringState = "stopped"
  @Published private(set) var fatigueScore = 0
  @Published private(set) var perclosPercent = 0
  @Published private(set) var sessionSeconds = 0
  @Published private(set) var lastStatusAt: Double = 0
  @Published private(set) var backgroundAlertsAuthorized = false
  @Published private(set) var canRequestBackgroundAlerts = false
  @Published private(set) var backgroundAlertsText = "Checking background alerts…"

  private let statusFreshnessMilliseconds = 12_000.0
  private var statusTimeoutTask: Task<Void, Never>?
  private var hapticSequenceTask: Task<Void, Never>?

  override init() {
    super.init()
    refreshNotificationAuthorization()
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
        let latestContext = session.receivedApplicationContext
        if !latestContext.isEmpty {
          // Restore the latest state immediately when the Watch app opens.
          // Context replay must never repeat an alert haptic or notification.
          self.handle(latestContext, shouldDeliverFeedback: false)
        }
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
    Task { @MainActor in self.handle(message, shouldDeliverFeedback: true) }
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    Task { @MainActor in self.handle(message, shouldDeliverFeedback: true) }
    replyHandler(["received": true])
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    Task { @MainActor in
      let sentAt = self.numberValue(applicationContext["at"])
      let ageMilliseconds = Date().timeIntervalSince1970 * 1_000 - sentAt
      self.handle(
        applicationContext,
        shouldDeliverFeedback: ageMilliseconds >= 0 && ageMilliseconds < 5_000
      )
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    Task { @MainActor in
      let sentAt = self.numberValue(userInfo["at"])
      let ageMilliseconds = Date().timeIntervalSince1970 * 1_000 - sentAt
      self.handle(
        userInfo,
        shouldDeliverFeedback: ageMilliseconds >= 0 && ageMilliseconds < 5_000
      )
    }
  }

  func refreshNotificationAuthorization() {
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
      Task { @MainActor in
        self?.updateNotificationAuthorization(settings.authorizationStatus)
      }
    }
  }

  func requestBackgroundAlertAuthorization() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { [weak self] _, _ in
      Task { @MainActor in
        self?.refreshNotificationAuthorization()
      }
    }
  }

  private func updateNotificationAuthorization(_ status: UNAuthorizationStatus) {
    switch status {
    case .authorized:
      backgroundAlertsAuthorized = true
      canRequestBackgroundAlerts = false
      backgroundAlertsText = "Background wrist alerts enabled"
    case .notDetermined:
      backgroundAlertsAuthorized = false
      canRequestBackgroundAlerts = true
      backgroundAlertsText = "Enable notifications for background wrist alerts"
    case .denied:
      backgroundAlertsAuthorized = false
      canRequestBackgroundAlerts = false
      backgroundAlertsText = "Allow Occulert notifications in Watch Settings"
    case .provisional:
      backgroundAlertsAuthorized = false
      canRequestBackgroundAlerts = false
      backgroundAlertsText = "Allow full notifications in Watch Settings"
    @unknown default:
      backgroundAlertsAuthorized = false
      canRequestBackgroundAlerts = false
      backgroundAlertsText = "Background wrist alerts unavailable"
    }
  }

  private func handle(_ message: [String: Any], shouldDeliverFeedback: Bool) {
    switch message["type"] as? String {
    case "occulert-alert":
      handleAlert(message, shouldDeliverFeedback: shouldDeliverFeedback)
    case "occulert-status":
      handleStatus(message)
    default:
      return
    }
  }

  private func handleAlert(_ message: [String: Any], shouldDeliverFeedback: Bool) {
    let sentAt = numberValue(message["at"])
    guard sentAt > lastAlertAt else { return }

    let level = message["level"] as? String ?? "alert"
    lastAlertAt = sentAt
    lastLevel = level
    lastMessage = switch level {
    case "critical": "High fatigue detected. Pull over safely and rest now."
    case "alert": "Drowsiness detected. Pull over at the next safe place."
    case "tracking": "Tracking lost — check iPhone safely"
    case "watch": "Drowsiness may be starting. Plan a safe stop."
    default: "Monitoring"
    }

    guard shouldDeliverFeedback else { return }
    guard WKExtension.shared().applicationState == .active else {
      scheduleBackgroundAlert(level: level, message: lastMessage, sentAt: sentAt)
      return
    }
    playHaptic(level: level)
  }

  private func playHaptic(level: String) {
    hapticSequenceTask?.cancel()
    hapticSequenceTask = nil

    switch level {
    case "critical":
      playCriticalHapticSequence()
    case "alert":
      playStandardAlertHapticSequence()
    case "tracking":
      WKInterfaceDevice.current().play(.retry)
    default:
      WKInterfaceDevice.current().play(.notification)
    }
  }

  private func playCriticalHapticSequence() {
    let device = WKInterfaceDevice.current()
    device.play(.failure)
    hapticSequenceTask = Task { @MainActor in
      for _ in 0..<2 {
        do {
          try await Task.sleep(nanoseconds: 400_000_000)
        } catch {
          return
        }
        guard !Task.isCancelled else { return }
        device.play(.failure)
      }
    }
  }

  private func playStandardAlertHapticSequence() {
    let device = WKInterfaceDevice.current()
    device.play(.notification)
    hapticSequenceTask = Task { @MainActor in
      do {
        try await Task.sleep(nanoseconds: 450_000_000)
      } catch {
        return
      }
      guard !Task.isCancelled else { return }
      device.play(.notification)
    }
  }

  private func scheduleBackgroundAlert(level: String, message: String, sentAt: Double) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      guard settings.authorizationStatus == .authorized else { return }

      let content = UNMutableNotificationContent()
      content.title = switch level {
      case "critical": "PULL OVER NOW"
      case "tracking": "Tracking lost"
      case "watch": "Eyes drooping"
      default: "Drowsiness detected"
      }
      content.body = message
      content.sound = .default
      content.interruptionLevel = .timeSensitive
      content.relevanceScore = level == "critical" ? 1.0 : 0.8
      content.userInfo = ["level": level, "at": sentAt]

      let identifier = "occulert-alert-\(Int64(sentAt))"
      let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
      UNUserNotificationCenter.current().add(request)
    }
  }

  private func handleStatus(_ message: [String: Any]) {
    let sentAt = numberValue(message["at"])
    guard sentAt > lastStatusAt else { return }
    lastStatusAt = sentAt
    statusTimeoutTask?.cancel()
    statusTimeoutTask = nil

    let running = message["running"] as? Bool ?? false
    let fatigue = min(100, max(0, numberValue(message["fatigueScore"])))
    fatigueScore = Int(fatigue.rounded())
    let perclos = min(1, max(0, numberValue(message["perclos"])))
    perclosPercent = Int((perclos * 100).rounded())
    let duration = min(86_400, max(0, numberValue(message["sessionTime"])))
    sessionSeconds = Int(duration)

    guard running else {
      isMonitoring = false
      monitoringState = "stopped"
      return
    }

    let state = message["state"] as? String ?? "noFace"
    let acceptedState = switch state {
    case "open", "watch", "closed", "noFace": state
    default: "noFace"
    }
    let ageMilliseconds = max(0, Date().timeIntervalSince1970 * 1_000 - sentAt)
    guard ageMilliseconds < statusFreshnessMilliseconds else {
      isMonitoring = false
      monitoringState = "stale"
      return
    }

    isMonitoring = true
    monitoringState = acceptedState
    let remainingMilliseconds = max(1, statusFreshnessMilliseconds - ageMilliseconds)
    let timeoutAt = sentAt
    statusTimeoutTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(remainingMilliseconds * 1_000_000))
      guard !Task.isCancelled, let self, self.lastStatusAt == timeoutAt else { return }
      self.isMonitoring = false
      self.monitoringState = "stale"
    }
  }

  private func numberValue(_ value: Any?) -> Double {
    let result: Double
    if let number = value as? NSNumber {
      result = number.doubleValue
    } else if let number = value as? Double {
      result = number
    } else if let number = value as? Int {
      result = Double(number)
    } else {
      return 0
    }
    return result.isFinite ? result : 0
  }
}
