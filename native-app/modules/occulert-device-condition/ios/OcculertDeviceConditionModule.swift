import ExpoModulesCore
import Foundation

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
        "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled
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
}
