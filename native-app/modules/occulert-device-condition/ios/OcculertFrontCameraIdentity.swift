import AVFoundation
import Foundation

/** Identity only. Never creates an input/session, requests permission, or reads frames. */
final class OcculertFrontCameraIdentity {
  let queue = DispatchQueue(label: "com.occulert.front-camera-identity")
  var onChange: (([String: Any]) -> Void)?
  private var owner: String?
  private var deviceId: String?
  private var revision: UInt64 = 0
  private var sequence = 0
  private var paused = false
  private var destroyed = false
  private var lastSignature: Data?
  private var observation: NSKeyValueObservation?
  private var observedDevice: AVCaptureDevice?
  private var connectionObservers: [NSObjectProtocol] = []

  init() {
    for name in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
      connectionObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] notification in
        guard let changed = notification.object as? AVCaptureDevice else { return }
        let changedId = changed.uniqueID
        self?.queue.async { [weak self] in
          guard let self, self.deviceId == changedId, !self.paused, !self.destroyed else { return }
          // A disconnected device instance never reconnects: resolve its ID again.
          self.bind(emitInitial: true)
        }
      })
    }
  }

  deinit {
    observation?.invalidate()
    for observer in connectionObservers { NotificationCenter.default.removeObserver(observer) }
  }

  static func unknown() -> [String: Any] {
    ["state": "notAvailable", "deviceId": NSNull(), "deviceType": NSNull(),
     "isVirtual": NSNull(), "constituentDeviceTypes": [], "streamingDeviceType": NSNull(),
     "streamingUniqueId": NSNull(), "streamingType": "unknown"]
  }

  private static func resolve(_ id: String) -> AVCaptureDevice? {
    guard !id.isEmpty, id.utf8.count <= 2048,
          let device = AVCaptureDevice(uniqueID: id), device.isConnected,
          device.hasMediaType(.video), device.position == .front else { return nil }
    return device
  }

  static func identity(_ id: String, includeStreaming: Bool = true) -> [String: Any] {
    guard let device = resolve(id) else { return unknown() }
    let streaming = includeStreaming ? (device.isVirtualDevice ? device.activePrimaryConstituent : device) : nil
    return [
      "state": "available", "deviceId": device.uniqueID, "deviceType": device.deviceType.rawValue,
      "isVirtual": device.isVirtualDevice,
      "constituentDeviceTypes": Array(Set(device.constituentDevices.map { $0.deviceType.rawValue })).sorted(),
      // Virtual cameras have no active constituent until their capture session runs.
      "streamingDeviceType": streaming.map { $0.deviceType.rawValue as Any } ?? NSNull(),
      "streamingUniqueId": streaming.map { $0.uniqueID as Any } ?? NSNull(),
      "streamingType": streaming.map { OcculertFrontCameraTypes.cameraRole(forDeviceType: $0.deviceType.rawValue) } ?? "unknown"
    ]
  }

  static func physicalCameras() -> [[String: Any]] {
    var types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .builtInUltraWideCamera, .builtInTrueDepthCamera]
    let duoTypes = Set(OcculertFrontCameraTypes.duoDeviceTypes())
    types += duoTypes.sorted().map { AVCaptureDevice.DeviceType(rawValue: $0) }
    let discovery = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified)
    var found: [String: AVCaptureDevice] = [:]
    // Explicit Duo physical types stay identifiable independently of direction.
    for device in discovery.devices where device.isConnected
      && (device.position == .front || duoTypes.contains(device.deviceType.rawValue)) {
      for physical in device.isVirtualDevice ? device.constituentDevices : [device] where physical.isConnected {
        found[physical.uniqueID] = physical
      }
    }
    return found.values.sorted { $0.uniqueID < $1.uniqueID }.map {
      ["uniqueId": $0.uniqueID, "deviceType": $0.deviceType.rawValue,
       "camera": OcculertFrontCameraTypes.cameraRole(forDeviceType: $0.deviceType.rawValue)]
    }
  }

  // Called only on queue by Expo's AsyncFunction scheduling.
  func start(deviceId: String, owner: String) -> [String: Any] {
    guard !destroyed, !owner.isEmpty, owner.utf8.count <= 128 else { return Self.unknown() }
    self.owner = owner
    self.deviceId = deviceId
    lastSignature = nil
    return bind(emitInitial: false)
  }

  func stop(owner: String) {
    guard self.owner == owner else { return }
    cancelObservation()
    self.owner = nil
    deviceId = nil
    lastSignature = nil
  }

  func pause() {
    queue.async { [weak self] in
      guard let self, !self.destroyed else { return }
      self.paused = true
      self.cancelObservation()
      if let id = self.deviceId { self.publish(Self.identity(id, includeStreaming: false)) }
    }
  }

  func resume() {
    queue.async { [weak self] in
      guard let self, !self.destroyed else { return }
      self.paused = false
      self.bind(emitInitial: true)
    }
  }

  func shutdown() {
    queue.async { [weak self] in
      guard let self else { return }
      self.destroyed = true
      self.cancelObservation()
      self.owner = nil
      self.deviceId = nil
      self.onChange = nil
    }
  }

  private func cancelObservation() {
    revision &+= 1
    observation?.invalidate()
    observation = nil
    observedDevice = nil
  }

  @discardableResult
  private func bind(emitInitial: Bool) -> [String: Any] {
    cancelObservation()
    guard !destroyed, let owner, let id = deviceId else { return Self.unknown() }
    let value = Self.identity(id, includeStreaming: !paused)
    if emitInitial { publish(value) }
    else { lastSignature = signature(value) }
    guard !paused, let device = Self.resolve(id), device.isVirtualDevice else { return value }
    let boundRevision = revision
    observedDevice = device
    // Apple's iOS 15+ property is explicitly KVO-observable. No polling required.
    observation = device.observe(\.activePrimaryConstituent, options: [.initial, .new]) { [weak self] _, _ in
      self?.queue.async { [weak self] in
        guard let self, !self.paused, !self.destroyed, self.owner == owner,
              self.deviceId == id, self.revision == boundRevision else { return }
        self.publish(Self.identity(id))
      }
    }
    return value
  }

  private func signature(_ value: [String: Any]) -> Data? {
    try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  }

  private func publish(_ identity: [String: Any]) {
    guard !destroyed, let owner, let deviceId else { return }
    let next = signature(identity)
    guard next != lastSignature else { return }
    lastSignature = next
    sequence += 1
    onChange?(["observationId": owner, "deviceId": deviceId, "sequence": sequence, "identity": identity])
  }
}
