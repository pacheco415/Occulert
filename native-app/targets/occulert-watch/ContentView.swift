import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var receiver: AlertReceiver

  private var alertColor: Color {
    switch receiver.lastLevel {
    case "critical", "alert": return .red
    case "watch": return .yellow
    default: return .green
    }
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        Image(systemName: "eye.circle.fill")
          .font(.system(size: 34))
          .foregroundStyle(alertColor)

        Text(receiver.lastMessage)
          .font(.headline)
          .fontWeight(.bold)
          .multilineTextAlignment(.center)
          .foregroundStyle(alertColor)

        Text(receiver.connectionText)
          .font(.caption2)
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)

        Text("Keep this Watch app open during monitoring for live wrist alerts.")
          .font(.caption2)
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 8)
    }
  }
}
