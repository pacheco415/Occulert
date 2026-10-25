import AVFoundation
import Foundation

/** Observes the app's sessions; it creates no inputs, outputs or frame consumers. */
final class OcculertCameraInterruptions {
  private final class SessionReference {
    weak var session: AVCaptureSession?
    let identifier = UUID().uuidString
    init(_ session: AVCaptureSession) { self.session = session }
  }
  private let lock = NSLock()
  private let state = OcculertCameraInterruptionState()
  private let deliveryQueue = DispatchQueue(label: "com.occulert.camera-interruptions")
  private var sessions: [ObjectIdentifier: SessionReference] = [:]
  private var observers: [NSObjectProtocol] = []
  private var active = false
  private var callback: (([String: Any]) -> Void)?
  var onChange: (([String: Any]) -> Void)? {
    get { lock.lock(); defer { lock.unlock() }; return callback }
    set { lock.lock(); callback = newValue; lock.unlock() }
  }

  func start() {
    lock.lock()
    defer { lock.unlock() }
    guard observers.isEmpty else { return }
    active = true
    let center = NotificationCenter.default
    // queue:nil updates the snapshot synchronously, before bridge/event scheduling.
    observers = [
      center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: nil, queue: nil) { [weak self] note in
        let raw = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue
        self?.record(note, interrupted: true, rawReason: raw)
      },
      center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: nil, queue: nil) { [weak self] note in
        self?.record(note, interrupted: false, rawReason: nil)
      },
      // Remember live sessions before an error/watchdog asks for their state.
      center.addObserver(forName: AVCaptureSession.didStartRunningNotification, object: nil, queue: nil) { [weak self] note in
        self?.record(note, interrupted: (note.object as? AVCaptureSession)?.isInterrupted ?? false, rawReason: nil)
      }
    ]
  }

  func snapshot(deviceId: String) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    sessions = sessions.filter { $0.value.session != nil }
    let liveIds = Set(sessions.values.map { $0.identifier })
    return state.snapshot(deviceId: deviceId, liveSessionIds: liveIds)
  }

  static func multitaskingSupported() -> Bool {
    if #available(iOS 16.0, *) { return AVCaptureSession().isMultitaskingCameraAccessSupported }
    return false
  }

  func shutdown() {
    lock.lock()
    let removing = observers
    observers.removeAll()
    callback = nil
    active = false
    sessions.removeAll()
    lock.unlock()
    for observer in removing { NotificationCenter.default.removeObserver(observer) }
  }

  deinit { shutdown() }

  private func record(_ notification: Notification, interrupted: Bool, rawReason: Int?) {
    guard let session = notification.object as? AVCaptureSession else { return }
    let deviceIds: [String] = session.inputs.compactMap { input in
      guard let input = input as? AVCaptureDeviceInput, input.device.hasMediaType(.video) else { return nil }
      return input.device.uniqueID
    }
    guard !deviceIds.isEmpty else { return } // Exclude VisionCamera's separate audio-only session.
    lock.lock()
    guard active else { lock.unlock(); return }
    sessions = sessions.filter { $0.value.session != nil }
    let key = ObjectIdentifier(session)
    let reference = sessions[key] ?? SessionReference(session)
    sessions[key] = reference
    // Publish under the same lock used to discover live sessions. A query cannot
    // observe a new session without its notification state already committed.
    _ = state.update(sessionId: reference.identifier, deviceIds: deviceIds,
                     interrupted: interrupted, rawReason: rawReason)
    let deliver = callback
    // Enqueue while holding the publication lock so concurrent notifications
    // cannot deliver an end event before its preceding named interruption.
    let liveIds = Set(sessions.values.map { $0.identifier })
    for deviceId in deviceIds {
      var event = state.snapshot(deviceId: deviceId, liveSessionIds: liveIds)
      event.removeValue(forKey: "state")
      event.removeValue(forKey: "deviceId")
      event["deviceIds"] = [deviceId]
      // Aggregate all live sessions for this camera: another session ending
      // must not clear an interruption that is still active in this one.
      deliveryQueue.async { [event] in deliver?(event) }
    }
    lock.unlock()
  }
}
