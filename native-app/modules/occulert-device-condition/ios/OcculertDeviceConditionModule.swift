import ExpoModulesCore
import Foundation
import AVFoundation

private final class OcculertFrameCounter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let lock = NSLock()
  private var value = 0

  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    lock.lock()
    value += 1
    lock.unlock()
  }
}

private struct OcculertMultiCamGraph {
  let session: AVCaptureMultiCamSession
  let frontDevice: AVCaptureDevice
  let backDevice: AVCaptureDevice
  let frontConnection: AVCaptureConnection
  let backConnection: AVCaptureConnection
  let frontCounter: OcculertFrameCounter
  let backCounter: OcculertFrameCounter
}

private enum OcculertMultiCamGraphError: Error {
  case unsupported
  case permissionRequired
  case configurationFailed

  var state: String {
    switch self {
    case .unsupported: return "unsupported"
    case .permissionRequired: return "permissionRequired"
    case .configurationFailed: return "configurationFailed"
    }
  }
}

/**
 Exposes current device conditions and bounded camera checks. Camera frames
 stay inside AVFoundation and are never stored or sent across the JS bridge.
 */
public final class OcculertDeviceConditionModule: Module {
  private let stabilityQueue = DispatchQueue(
    label: "com.occulert.camera-stability",
    qos: .userInitiated
  )

  public func definition() -> ModuleDefinition {
    Name("OcculertDeviceCondition")

    AsyncFunction("getCondition") { () -> [String: Any] in
      return [
        "thermalState": Self.thermalStateLabel(ProcessInfo.processInfo.thermalState),
        "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
        "multiCamSupported": AVCaptureMultiCamSession.isMultiCamSupported,
        "frontBackMultiCamSupported": Self.frontBackMultiCamSupported()
      ]
    }

    AsyncFunction("probeMultiCamConfiguration") { () -> [String: Any] in
      return Self.probeMultiCamConfiguration()
    }

    AsyncFunction("runMultiCamStabilityTest") { (requestedDurationMs: Int) -> [String: Any] in
      return Self.runMultiCamStabilityTest(requestedDurationMs: requestedDurationMs)
    }.runOnQueue(stabilityQueue)
  }

  private static func thermalStateLabel(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  private static func frontBackMultiCamSupported() -> Bool {
    guard AVCaptureMultiCamSession.isMultiCamSupported else { return false }
    return cameraDiscoverySession().supportedMultiCamDeviceSets.contains { devices in
      devices.contains { $0.position == .front }
        && devices.contains { $0.position == .back }
    }
  }

  /**
   Builds a front-and-rear video graph long enough to read Apple's resource
   budgets. It never starts the session, so this check delivers no frames.
   */
  private static func probeMultiCamConfiguration() -> [String: Any] {
    do {
      let graph = try buildMultiCamGraph()
      let hardwareCost = graph.session.hardwareCost
      let pressureCost = graph.session.systemPressureCost
      return probeResult(
        state: hardwareCost <= 1 && pressureCost <= 1 ? "withinBudget" : "overBudget",
        hardwareCost: hardwareCost,
        systemPressureCost: pressureCost,
        front: graph.frontDevice,
        back: graph.backDevice
      )
    } catch let error as OcculertMultiCamGraphError {
      return probeResult(state: error.state)
    } catch {
      return probeResult(state: "configurationFailed")
    }
  }

  /**
   Runs both video streams for a short parked test. Only frame counts and
   device-pressure labels leave this function. If resource pressure rises,
   the rear connection is disabled while the front stream keeps running.
   */
  private static func runMultiCamStabilityTest(requestedDurationMs: Int) -> [String: Any] {
    let durationMs = min(max(requestedDurationMs, 3_000), 10_000)
    do {
      let graph = try buildMultiCamGraph()
      let hardwareCost = graph.session.hardwareCost
      let configuredPressureCost = graph.session.systemPressureCost
      guard hardwareCost <= 1, configuredPressureCost <= 1 else {
        return stabilityResult(
          state: "overBudget",
          elapsedMs: 0,
          graph: graph,
          hardwareCost: hardwareCost,
          configuredPressureCost: configuredPressureCost,
          maxPressureLevel: "unknown",
          thermalState: thermalStateLabel(ProcessInfo.processInfo.thermalState),
          roadStreamStayedEnabled: false
        )
      }

      let startedAt = Date()
      var rearDisabledForProtection = false
      var maxPressureLevel = "nominal"
      var maxPressureRank = 0
      var maxThermalState = ProcessInfo.processInfo.thermalState
      var maxThermalRank = thermalRank(maxThermalState)

      graph.session.startRunning()
      guard graph.session.isRunning else {
        return stabilityResult(
          state: "sessionFailed",
          elapsedMs: 0,
          graph: graph,
          hardwareCost: hardwareCost,
          configuredPressureCost: configuredPressureCost,
          maxPressureLevel: "unknown",
          thermalState: thermalStateLabel(maxThermalState),
          roadStreamStayedEnabled: false
        )
      }
      defer {
        if graph.session.isRunning { graph.session.stopRunning() }
      }

      while Int(Date().timeIntervalSince(startedAt) * 1_000) < durationMs {
        let pressure = highestPressureLevel(
          graph.frontDevice.systemPressureState.level,
          graph.backDevice.systemPressureState.level
        )
        let pressureRankValue = pressureRank(pressure)
        if pressureRankValue > maxPressureRank {
          maxPressureRank = pressureRankValue
          maxPressureLevel = pressureLabel(pressure)
        }

        let thermalState = ProcessInfo.processInfo.thermalState
        let thermalRankValue = thermalRank(thermalState)
        if thermalRankValue > maxThermalRank {
          maxThermalRank = thermalRankValue
          maxThermalState = thermalState
        }

        let resourceLimitReached = graph.session.hardwareCost > 1
          || graph.session.systemPressureCost > 1
          || pressureRankValue >= 2
          || thermalRankValue >= 2
        if resourceLimitReached && !rearDisabledForProtection {
          graph.backConnection.isEnabled = false
          rearDisabledForProtection = true
        }

        if !graph.session.isRunning { break }
        Thread.sleep(forTimeInterval: 0.1)
      }

      let elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1_000)
      let state: String
      if graph.frontCounter.count == 0 {
        state = "driverStreamFailed"
      } else if rearDisabledForProtection || graph.backCounter.count == 0 {
        state = "driverOnlyFallback"
      } else if !graph.session.isRunning {
        state = "sessionFailed"
      } else {
        state = "passed"
      }
      return stabilityResult(
        state: state,
        elapsedMs: elapsedMs,
        graph: graph,
        hardwareCost: hardwareCost,
        configuredPressureCost: configuredPressureCost,
        maxPressureLevel: maxPressureLevel,
        thermalState: thermalStateLabel(maxThermalState),
        roadStreamStayedEnabled: !rearDisabledForProtection && graph.backCounter.count > 0
      )
    } catch let error as OcculertMultiCamGraphError {
      return stabilityResult(state: error.state)
    } catch {
      return stabilityResult(state: "configurationFailed")
    }
  }

  private static func buildMultiCamGraph() throws -> OcculertMultiCamGraph {
    guard AVCaptureMultiCamSession.isMultiCamSupported else {
      throw OcculertMultiCamGraphError.unsupported
    }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      throw OcculertMultiCamGraphError.permissionRequired
    }
    let discovery = cameraDiscoverySession()
    guard let pair = preferredFrontBackPair(from: discovery.supportedMultiCamDeviceSets) else {
      throw OcculertMultiCamGraphError.unsupported
    }

    let session = AVCaptureMultiCamSession()
    let frontInput: AVCaptureDeviceInput
    let backInput: AVCaptureDeviceInput
    do {
      frontInput = try AVCaptureDeviceInput(device: pair.front)
      backInput = try AVCaptureDeviceInput(device: pair.back)
    } catch {
      throw OcculertMultiCamGraphError.configurationFailed
    }

    let frontOutput = AVCaptureVideoDataOutput()
    let backOutput = AVCaptureVideoDataOutput()
    frontOutput.alwaysDiscardsLateVideoFrames = true
    backOutput.alwaysDiscardsLateVideoFrames = true
    let frontCounter = OcculertFrameCounter()
    let backCounter = OcculertFrameCounter()
    frontOutput.setSampleBufferDelegate(
      frontCounter,
      queue: DispatchQueue(label: "com.occulert.camera-stability.front")
    )
    backOutput.setSampleBufferDelegate(
      backCounter,
      queue: DispatchQueue(label: "com.occulert.camera-stability.road")
    )

    session.beginConfiguration()
    defer { session.commitConfiguration() }
    guard session.canAddInput(frontInput) else {
      throw OcculertMultiCamGraphError.configurationFailed
    }
    session.addInputWithNoConnections(frontInput)
    guard session.canAddInput(backInput) else {
      throw OcculertMultiCamGraphError.configurationFailed
    }
    session.addInputWithNoConnections(backInput)
    guard session.canAddOutput(frontOutput), session.canAddOutput(backOutput) else {
      throw OcculertMultiCamGraphError.configurationFailed
    }
    session.addOutputWithNoConnections(frontOutput)
    session.addOutputWithNoConnections(backOutput)

    guard
      let frontPort = frontInput.ports(
        for: .video,
        sourceDeviceType: pair.front.deviceType,
        sourceDevicePosition: .front
      ).first,
      let backPort = backInput.ports(
        for: .video,
        sourceDeviceType: pair.back.deviceType,
        sourceDevicePosition: .back
      ).first
    else {
      throw OcculertMultiCamGraphError.configurationFailed
    }

    let frontConnection = AVCaptureConnection(inputPorts: [frontPort], output: frontOutput)
    let backConnection = AVCaptureConnection(inputPorts: [backPort], output: backOutput)
    guard session.canAddConnection(frontConnection) else {
      throw OcculertMultiCamGraphError.configurationFailed
    }
    session.addConnection(frontConnection)
    guard session.canAddConnection(backConnection) else {
      throw OcculertMultiCamGraphError.configurationFailed
    }
    session.addConnection(backConnection)

    return OcculertMultiCamGraph(
      session: session,
      frontDevice: pair.front,
      backDevice: pair.back,
      frontConnection: frontConnection,
      backConnection: backConnection,
      frontCounter: frontCounter,
      backCounter: backCounter
    )
  }

  private static func cameraDiscoverySession() -> AVCaptureDevice.DiscoverySession {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: [
        .builtInWideAngleCamera,
        .builtInUltraWideCamera,
        .builtInTelephotoCamera,
        .builtInTrueDepthCamera,
        .builtInDualCamera,
        .builtInDualWideCamera,
        .builtInTripleCamera
      ],
      mediaType: .video,
      position: .unspecified
    )
  }

  private static func preferredFrontBackPair(
    from sets: [Set<AVCaptureDevice>]
  ) -> (front: AVCaptureDevice, back: AVCaptureDevice)? {
    for devices in sets {
      let fronts = devices.filter { $0.position == .front }
      let backs = devices.filter { $0.position == .back }
      if let front = fronts.sorted(by: devicePreference).first,
         let back = backs.sorted(by: devicePreference).first {
        return (front, back)
      }
    }
    return nil
  }

  private static func devicePreference(_ lhs: AVCaptureDevice, _ rhs: AVCaptureDevice) -> Bool {
    func rank(_ device: AVCaptureDevice) -> Int {
      switch device.deviceType {
      case .builtInWideAngleCamera: return 0
      case .builtInTrueDepthCamera: return 1
      case .builtInUltraWideCamera: return 2
      case .builtInTelephotoCamera: return 3
      default: return 4
      }
    }
    return rank(lhs) < rank(rhs)
  }

  private static func highestPressureLevel(
    _ first: AVCaptureDevice.SystemPressureState.Level,
    _ second: AVCaptureDevice.SystemPressureState.Level
  ) -> AVCaptureDevice.SystemPressureState.Level {
    pressureRank(first) >= pressureRank(second) ? first : second
  }

  private static func pressureRank(_ level: AVCaptureDevice.SystemPressureState.Level) -> Int {
    switch level {
    case .nominal: return 0
    case .fair: return 1
    case .serious: return 2
    case .critical: return 3
    case .shutdown: return 4
    default: return 5
    }
  }

  private static func pressureLabel(_ level: AVCaptureDevice.SystemPressureState.Level) -> String {
    switch level {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    case .shutdown: return "shutdown"
    default: return "unknown"
    }
  }

  private static func thermalRank(_ state: ProcessInfo.ThermalState) -> Int {
    switch state {
    case .nominal: return 0
    case .fair: return 1
    case .serious: return 2
    case .critical: return 3
    @unknown default: return 4
    }
  }

  private static func probeResult(
    state: String,
    hardwareCost: Float? = nil,
    systemPressureCost: Float? = nil,
    front: AVCaptureDevice? = nil,
    back: AVCaptureDevice? = nil
  ) -> [String: Any] {
    [
      "state": state,
      "hardwareCost": hardwareCost.map { $0 as Any } ?? NSNull(),
      "systemPressureCost": systemPressureCost.map { $0 as Any } ?? NSNull(),
      "frontDeviceType": front.map { $0.deviceType.rawValue as Any } ?? NSNull(),
      "backDeviceType": back.map { $0.deviceType.rawValue as Any } ?? NSNull()
    ]
  }

  private static func stabilityResult(
    state: String,
    elapsedMs: Int = 0,
    graph: OcculertMultiCamGraph? = nil,
    hardwareCost: Float? = nil,
    configuredPressureCost: Float? = nil,
    maxPressureLevel: String = "unknown",
    thermalState: String? = nil,
    roadStreamStayedEnabled: Bool = false
  ) -> [String: Any] {
    [
      "state": state,
      "elapsedMs": elapsedMs,
      "frontFrames": graph?.frontCounter.count ?? 0,
      "roadFrames": graph?.backCounter.count ?? 0,
      "hardwareCost": hardwareCost.map { $0 as Any } ?? NSNull(),
      "configuredPressureCost": configuredPressureCost.map { $0 as Any } ?? NSNull(),
      "maxPressureLevel": maxPressureLevel,
      "thermalState": thermalState ?? thermalStateLabel(ProcessInfo.processInfo.thermalState),
      "roadStreamStayedEnabled": roadStreamStayedEnabled
    ]
  }
}
