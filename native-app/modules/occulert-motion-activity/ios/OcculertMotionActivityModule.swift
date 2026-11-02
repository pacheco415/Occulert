import CoreMotion
import ExpoModulesCore
import UIKit

private let activityEvent = "onActivity"
private let activityStatusEvent = "onStatusChange"

/** Transient activity classifications only; no speed, history or send authority. */
public final class OcculertMotionActivityModule: Module {
  private let manager = CMMotionActivityManager()
  private var activeOwner: String?
  private var generation = UUID()
  private var updating = false
  private var destroyed = false
  private var currentState = "stopped"

  public func definition() -> ModuleDefinition {
    Name("OcculertMotionActivity")
    Events(activityEvent, activityStatusEvent)

    AsyncFunction("start") { (owner: String) -> [String: Any] in
      self.startObservation(owner: owner)
    }.runOnQueue(.main)

    AsyncFunction("stop") { (owner: String) -> [String: Any] in
      self.stopObservation(owner: owner)
    }.runOnQueue(.main)

    AsyncFunction("getStatus") { (owner: String) -> [String: Any] in
      self.statusPayload(owner: owner)
    }.runOnQueue(.main)

    OnAppEntersBackground { self.invalidateFromLifecycle(destroying: false) }
    OnDestroy { self.invalidateFromLifecycle(destroying: true) }
    OnAppContextDestroys { self.invalidateFromLifecycle(destroying: true) }
  }

  private func startObservation(owner: String) -> [String: Any] {
    guard !destroyed, !owner.isEmpty, owner.utf8.count <= 200 else {
      return statusPayload(owner: owner, state: "error")
    }
    guard UIApplication.shared.applicationState == .active else {
      invalidate(state: "stopped")
      return statusPayload(owner: owner, state: "stopped")
    }
    let authorization = CMMotionActivityManager.authorizationStatus()
    guard authorization != .denied && authorization != .restricted else {
      invalidate(state: "denied")
      return statusPayload(owner: owner, state: "denied")
    }
    guard authorization == .authorized || authorization == .notDetermined else {
      invalidate(state: "error")
      return statusPayload(owner: owner, state: "error")
    }
    guard CMMotionActivityManager.isActivityAvailable() else {
      invalidate(state: "unavailable")
      return statusPayload(owner: owner, state: "unavailable")
    }
    if activeOwner == owner && updating { return statusPayload(owner: owner) }

    invalidate(state: "stopped")
    activeOwner = owner
    updating = true
    currentState = "starting"
    let callbackGeneration = generation
    let status = statusPayload(owner: owner)
    sendEvent(activityStatusEvent, status)
    // This is the only permission-requesting path, called by explicit flagged Start.
    manager.startActivityUpdates(to: OperationQueue.main) { [weak self] activity in
      self?.receive(activity, owner: owner, generation: callbackGeneration)
    }
    return status
  }

  private func stopObservation(owner: String) -> [String: Any] {
    if activeOwner == owner { invalidate(state: "stopped") }
    return statusPayload(owner: owner, state: "stopped")
  }

  private func receive(_ activity: CMMotionActivity?, owner: String, generation callbackGeneration: UUID) {
    guard !destroyed, updating, activeOwner == owner, generation == callbackGeneration else { return }
    guard UIApplication.shared.applicationState == .active else {
      invalidate(state: "stopped")
      return
    }
    let authorization = CMMotionActivityManager.authorizationStatus()
    guard authorization == .authorized else {
      invalidate(state: authorization == .denied || authorization == .restricted ? "denied" : "error")
      return
    }
    guard let activity else { invalidate(state: "error"); return }
    let activityStartedAt = activity.startDate.timeIntervalSince1970 * 1_000
    let sourceUptimeMs = activity.timestamp * 1_000
    let receivedUptimeMs = ProcessInfo.processInfo.systemUptime * 1_000
    let receivedAt = Date().timeIntervalSince1970 * 1_000
    guard [activityStartedAt, sourceUptimeMs, receivedUptimeMs, receivedAt].allSatisfy({ $0.isFinite && $0 >= 0 }),
      sourceUptimeMs <= receivedUptimeMs else { invalidate(state: "error"); return }
    if currentState != "active" {
      currentState = "active"
      sendEvent(activityStatusEvent, statusPayload(owner: owner))
    }
    sendEvent(activityEvent, [
      "owner": owner, "authorization": Self.authorizationLabel(authorization),
      "confidence": Self.confidenceLabel(activity.confidence),
      "activityStartedAt": activityStartedAt, "sourceUptimeMs": sourceUptimeMs,
      "receivedUptimeMs": receivedUptimeMs, "receivedAt": receivedAt,
      "automotive": activity.automotive, "stationary": activity.stationary,
      "walking": activity.walking, "running": activity.running,
      "cycling": activity.cycling, "unknown": activity.unknown
    ])
  }

  private func invalidate(state: String) {
    let owner = activeOwner
    generation = UUID()
    activeOwner = nil
    updating = false
    currentState = state
    manager.stopActivityUpdates()
    if let owner { sendEvent(activityStatusEvent, statusPayload(owner: owner, state: state)) }
  }

  private func invalidateFromLifecycle(destroying: Bool) {
    let work = {
      if destroying { self.destroyed = true }
      self.invalidate(state: "stopped")
    }
    // Invalidate before the lifecycle callback returns, including queued events.
    if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
  }

  private func statusPayload(owner: String, state override: String? = nil) -> [String: Any] {
    let authorization = CMMotionActivityManager.authorizationStatus()
    let state = override ?? (activeOwner == owner ? currentState : "stopped")
    return [
      "owner": owner, "state": state, "authorization": Self.authorizationLabel(authorization),
      "isAvailable": CMMotionActivityManager.isActivityAvailable(),
      "isActive": activeOwner == owner && updating && state == "active"
        && authorization == .authorized && UIApplication.shared.applicationState == .active
    ]
  }

  private static func authorizationLabel(_ authorization: CMAuthorizationStatus) -> String {
    switch authorization {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "authorized"
    @unknown default: return "unknown"
    }
  }

  private static func confidenceLabel(_ confidence: CMMotionActivityConfidence) -> String {
    switch confidence {
    case .low: return "low"
    case .medium: return "medium"
    case .high: return "high"
    @unknown default: return "unknown"
    }
  }
}
