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
}
