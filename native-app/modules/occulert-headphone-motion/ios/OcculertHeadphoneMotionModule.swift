import CoreMotion
import ExpoModulesCore

private let motionSampleEvent = "onMotionSample"
private let motionStatusEvent = "onStatusChange"
private let radiansToDegrees = 180.0 / Double.pi
private let minimumEmissionInterval = 0.08

/**
 Read-only bridge to Apple's processed compatible-headphone motion stream.

 The module emits transient samples only while foreground monitoring is active.
 It does not persist samples, calculate a safety score, or trigger alerts.
 */
public final class OcculertHeadphoneMotionModule: Module {
  private let manager = CMHeadphoneMotionManager()
  private let motionQueue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "com.occulert.headphone-motion"
    queue.qualityOfService = .userInitiated
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  private var lastEmittedTimestamp = -Double.infinity
  private var hasEmittedSample = false

  public func definition() -> ModuleDefinition {
    Name("OcculertHeadphoneMotion")
    Events(motionSampleEvent, motionStatusEvent)

    AsyncFunction("getStatus") { () -> [String: Any] in
      return self.statusPayload()
    }

    AsyncFunction("start") { () -> [String: Any] in
      let authorization = CMHeadphoneMotionManager.authorizationStatus()
      if authorization == .denied || authorization == .restricted {
        let status = self.statusPayload(state: "denied")
        self.emitStatus(status)
        return status
      }
      guard self.manager.isDeviceMotionAvailable else {
        let status = self.statusPayload(state: "unavailable")
        self.emitStatus(status)
        return status
      }
      if self.manager.isDeviceMotionActive {
        return self.statusPayload(state: "active")
      }

      self.lastEmittedTimestamp = -Double.infinity
      self.hasEmittedSample = false
      let starting = self.statusPayload(state: "starting")
      self.emitStatus(starting)
      self.manager.startDeviceMotionUpdates(to: self.motionQueue) { [weak self] motion, error in
        guard let self else { return }
        if let error {
          self.manager.stopDeviceMotionUpdates()
          self.emitStatus(self.statusPayload(state: "error", error: error.localizedDescription))
          return
        }
        guard let motion else { return }
        if motion.timestamp - self.lastEmittedTimestamp < minimumEmissionInterval { return }
        self.lastEmittedTimestamp = motion.timestamp

        if !self.hasEmittedSample {
          self.hasEmittedSample = true
          self.emitStatus(self.statusPayload(state: "active"))
        }
        let attitude = motion.attitude
        self.emitSample([
          "timestampMs": motion.timestamp * 1_000,
          "pitchAngle": attitude.pitch * radiansToDegrees,
          "yawAngle": attitude.yaw * radiansToDegrees,
          "rollAngle": attitude.roll * radiansToDegrees,
          "userAccelerationX": motion.userAcceleration.x,
          "userAccelerationY": motion.userAcceleration.y,
          "userAccelerationZ": motion.userAcceleration.z
        ])
      }
      return starting
    }

    AsyncFunction("stop") { () -> [String: Any] in
      self.stopUpdates()
      return self.statusPayload(state: "stopped")
    }

    OnAppEntersBackground {
      self.stopUpdates()
    }

    OnDestroy {
      self.stopUpdates()
    }
  }

  private func stopUpdates() {
    manager.stopDeviceMotionUpdates()
    motionQueue.cancelAllOperations()
    hasEmittedSample = false
  }

  private func statusPayload(state override: String? = nil, error: String? = nil) -> [String: Any] {
    let authorization = Self.authorizationLabel(CMHeadphoneMotionManager.authorizationStatus())
    let state: String
    if let override {
      state = override
    } else if authorization == "denied" || authorization == "restricted" {
      state = "denied"
    } else if manager.isDeviceMotionActive {
      state = "active"
    } else if manager.isDeviceMotionAvailable {
      state = "stopped"
    } else {
      state = "unavailable"
    }
    var payload: [String: Any] = [
      "state": state,
      "authorization": authorization,
      "isAvailable": manager.isDeviceMotionAvailable,
      "isActive": manager.isDeviceMotionActive
    ]
    if let error { payload["error"] = error }
    return payload
  }

  private func emitSample(_ payload: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(motionSampleEvent, payload)
    }
  }

  private func emitStatus(_ payload: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(motionStatusEvent, payload)
    }
  }

  private static func authorizationLabel(_ status: CMAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorized: return "authorized"
    @unknown default: return "unknown"
    }
  }
}
