import SwiftUI

@main
struct OcculertWatchApp: App {
  @StateObject private var receiver = AlertReceiver()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(receiver)
    }
  }
}
