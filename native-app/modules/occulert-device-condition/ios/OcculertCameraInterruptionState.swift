import Foundation

/** Metadata only. The lock publishes state before notification delivery to JS. */
final class OcculertCameraInterruptionState {
  private struct Record {
    let deviceIds: [String]
    let interrupted: Bool
    let rawReason: Int?
    let sequence: Int
  }
  private let lock = NSLock()
  private var records: [String: Record] = [:]
  private var sequence = 0

  static func reason(_ raw: Int?, interrupted: Bool) -> String {
    guard interrupted else { return "none" }
    switch raw {
    case 1: return "background"
    case 2: return "audioInUse"
    case 3: return "videoInUse"
    case 4: return "multitasking"
    case 5: return "systemPressure"
    default: return "unknown"
    }
  }

  func update(sessionId: String, deviceIds: [String], interrupted: Bool, rawReason: Int?) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    sequence += 1
    let record = Record(deviceIds: Array(Set(deviceIds)).sorted(), interrupted: interrupted,
                        rawReason: interrupted ? (rawReason ?? records[sessionId]?.rawReason) : nil, sequence: sequence)
    records[sessionId] = record
    if records.count > 64, let oldest = records.min(by: { $0.value.sequence < $1.value.sequence })?.key {
      records.removeValue(forKey: oldest)
    }
    return payload(record)
  }

  func snapshot(deviceId: String, liveSessionIds: Set<String>) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    records = records.filter { liveSessionIds.contains($0.key) }
    let matching = records.values.filter { $0.deviceIds.contains(deviceId) }
    // An interruption in any live session using this device takes precedence.
    let record = matching.filter { $0.interrupted && $0.rawReason == 4 }.max { $0.sequence < $1.sequence }
      ?? matching.filter { $0.interrupted }.max { $0.sequence < $1.sequence }
      ?? matching.max { $0.sequence < $1.sequence }
    guard let record else {
      return ["state": "notAvailable", "deviceId": deviceId, "interrupted": NSNull(),
              "reason": "unknown", "rawReason": NSNull(), "sequence": sequence]
    }
    var result = payload(record)
    result.removeValue(forKey: "deviceIds")
    result["state"] = "available"
    result["deviceId"] = deviceId
    result["sequence"] = sequence
    return result
  }

  private func payload(_ record: Record) -> [String: Any] {
    ["deviceIds": record.deviceIds, "interrupted": record.interrupted,
     "reason": Self.reason(record.rawReason, interrupted: record.interrupted),
     "rawReason": record.rawReason.map { $0 as Any } ?? NSNull(), "sequence": record.sequence]
  }
}
