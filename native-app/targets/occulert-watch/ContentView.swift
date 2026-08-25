import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var receiver: AlertReceiver
  @Environment(\.scenePhase) private var scenePhase

  private var alertColor: Color {
    switch receiver.lastLevel {
    case "critical", "alert": return .red
    case "tracking", "watch": return .yellow
    default: return .green
    }
  }

  private var statusColor: Color {
    switch receiver.monitoringState {
    case "closed": return .red
    case "watch": return .yellow
    case "noFace": return .orange
    case "open": return .green
    default: return .secondary
    }
  }

  private var statusTitle: String {
    guard receiver.isMonitoring else {
      return receiver.monitoringState == "stale" ? "Status paused" : "Not monitoring"
    }
    return switch receiver.monitoringState {
    case "closed": "Eyes closed"
    case "watch": "Eyes drooping"
    case "noFace": "Tracking lost"
    default: "Eyes open"
    }
  }

  private var latestAlertTitle: String {
    switch receiver.lastLevel {
    case "critical": return "PULL OVER NOW"
    case "alert": return "DROWSINESS DETECTED"
    case "tracking": return "TRACKING LOST"
    case "watch": return "EYES DROOPING"
    default: return "LATEST ALERT"
    }
  }

  private var sessionDuration: String {
    let hours = receiver.sessionSeconds / 3_600
    let minutes = (receiver.sessionSeconds % 3_600) / 60
    let seconds = receiver.sessionSeconds % 60
    if hours > 0 {
      return String(format: "%d:%02d:%02d", hours, minutes, seconds)
    }
    return String(format: "%d:%02d", minutes, seconds)
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 9) {
        Image(systemName: receiver.isMonitoring ? "eye.circle.fill" : "eye.circle")
          .font(.system(size: 32))
          .foregroundStyle(statusColor)

        Text(receiver.isMonitoring ? "LIVE MONITORING" : "IPHONE STATUS")
          .font(.caption2)
          .fontWeight(.bold)
          .foregroundStyle(.secondary)

        Text(statusTitle)
          .font(.headline)
          .fontWeight(.bold)
          .multilineTextAlignment(.center)
          .foregroundStyle(statusColor)

        if receiver.isMonitoring {
          ProgressView(value: Double(receiver.fatigueScore), total: 100)
            .tint(statusColor)
            .accessibilityLabel("Fatigue score")
            .accessibilityValue("\(receiver.fatigueScore) out of 100")

          HStack(spacing: 7) {
            metric(label: "Fatigue", value: "\(receiver.fatigueScore)")
            metric(label: "PERCLOS", value: "\(receiver.perclosPercent)%")
            metric(label: "Time", value: sessionDuration)
          }
        } else if receiver.monitoringState == "stale" {
          Text("Live updates stopped. Check the iPhone only after pulling over safely.")
            .font(.caption2)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
        } else {
          Text("Start monitoring on your iPhone to see live status here.")
            .font(.caption2)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
        }

        if receiver.lastLevel != "none" {
          VStack(spacing: 4) {
            Text(latestAlertTitle)
              .font(.caption2)
              .fontWeight(.heavy)
              .foregroundStyle(alertColor)
            Text(receiver.lastMessage)
              .font(.caption2)
              .fontWeight(.semibold)
              .multilineTextAlignment(.center)
              .foregroundStyle(.primary)
          }
          .padding(.horizontal, 8)
          .padding(.vertical, 9)
          .frame(maxWidth: .infinity)
          .background(alertColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
          .accessibilityElement(children: .combine)
        }

        if !receiver.backgroundAlertsAuthorized {
          Divider()
          Text(receiver.backgroundAlertsText)
            .font(.caption2)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
          if receiver.canRequestBackgroundAlerts {
            Button("Enable background alerts") {
              receiver.requestBackgroundAlertAuthorization()
            }
            .font(.caption2)
            .buttonStyle(.borderedProminent)
          }
        }

        Divider()
        Text(receiver.connectionText)
          .font(.caption2)
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)

        Text("Open this Watch app for the fastest live status and wrist alerts.")
          .font(.caption2)
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 8)
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        receiver.refreshNotificationAuthorization()
      }
    }
  }

  private func metric(label: String, value: String) -> some View {
    VStack(spacing: 1) {
      Text(value)
        .font(.caption)
        .fontWeight(.bold)
        .lineLimit(1)
        .minimumScaleFactor(0.72)
      Text(label)
        .font(.system(size: 8))
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }
}
