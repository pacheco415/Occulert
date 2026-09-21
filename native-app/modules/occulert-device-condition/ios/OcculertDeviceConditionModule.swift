import ExpoModulesCore
import Foundation
import AVFoundation

/**
 Exposes Apple's current process thermal state without collecting or storing
 health data. The JavaScript monitor polls this only while its screen is open.
 */
public final class OcculertDeviceConditionModule: Module {
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
    let discovery = AVCaptureDevice.DiscoverySession(
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
    return discovery.supportedMultiCamDeviceSets.contains { devices in
      devices.contains { $0.position == .front }
        && devices.contains { $0.position == .back }
    }
  }

  /**
   Builds a front-and-rear video graph long enough to read Apple's
   hardware and system-pressure budgets. It never starts the capture session,
   so this parked check does not collect or deliver camera frames.
   */
  private static func probeMultiCamConfiguration() -> [String: Any] {
    guard AVCaptureMultiCamSession.isMultiCamSupported else {
      return probeResult(state: "unsupported")
    }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      return probeResult(state: "permissionRequired")
    }

    let discovery = cameraDiscoverySession()
    guard let pair = preferredFrontBackPair(from: discovery.supportedMultiCamDeviceSets) else {
      return probeResult(state: "unsupported")
    }

    let session = AVCaptureMultiCamSession()
    do {
      let frontInput = try AVCaptureDeviceInput(device: pair.front)
      let backInput = try AVCaptureDeviceInput(device: pair.back)
      let frontOutput = AVCaptureVideoDataOutput()
      let backOutput = AVCaptureVideoDataOutput()
      frontOutput.alwaysDiscardsLateVideoFrames = true
      backOutput.alwaysDiscardsLateVideoFrames = true

      session.beginConfiguration()
      guard session.canAddInput(frontInput) else {
        session.commitConfiguration()
        return probeResult(state: "configurationFailed", front: pair.front, back: pair.back)
      }
      session.addInputWithNoConnections(frontInput)
      guard session.canAddInput(backInput) else {
        session.commitConfiguration()
        return probeResult(state: "configurationFailed", front: pair.front, back: pair.back)
      }
      session.addInputWithNoConnections(backInput)

      guard session.canAddOutput(frontOutput), session.canAddOutput(backOutput) else {
        session.commitConfiguration()
        return probeResult(state: "configurationFailed", front: pair.front, back: pair.back)
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
        session.commitConfiguration()
        return probeResult(state: "configurationFailed", front: pair.front, back: pair.back)
      }

      let frontConnection = AVCaptureConnection(inputPorts: [frontPort], output: frontOutput)
      let backConnection = AVCaptureConnection(inputPorts: [backPort], output: backOutput)
      guard session.canAddConnection(frontConnection) else {
        session.commitConfiguration()
        return probeResult(state: "configurationFailed", front: pair.front, back: pair.back)
      }
      session.addConnection(frontConnection)
      guard session.canAddConnection(backConnection) else {
        session.commitConfiguration()
        return probeResult(state: "configurationFailed", front: pair.front, back: pair.back)
      }
      session.addConnection(backConnection)
      session.commitConfiguration()

      let hardwareCost = session.hardwareCost
      let pressureCost = session.systemPressureCost
      let state = hardwareCost <= 1 && pressureCost <= 1 ? "withinBudget" : "overBudget"
      return probeResult(
        state: state,
        hardwareCost: hardwareCost,
        systemPressureCost: pressureCost,
        front: pair.front,
        back: pair.back
      )
    } catch {
      return probeResult(state: "configurationFailed", front: pair.front, back: pair.back)
    }
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
}
