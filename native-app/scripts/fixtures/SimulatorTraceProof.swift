import XCTest

final class SimulatorTraceProof: XCTestCase {
  func testActualMonitorTraceAndStop() throws {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.occulert.app.simulatortrace")
    let prompt = XCUIApplication(bundleIdentifier: "com.apple.springboard")
      .alerts["Open in “Occulert Simulator Trace”?"]
    // A prior interrupted run may leave this exact system prompt visible even
    // after its application terminates. Never confirm another app's prompt.
    if prompt.exists { prompt.buttons["Open"].tap() }
    addUIInterruptionMonitor(withDescription: "Open simulator trace") { alert in
      let title = alert.label + " " + alert.debugDescription
      guard title.contains("Occulert Simulator Trace"), alert.buttons["Open"].exists else { return false }
      alert.buttons["Open"].tap()
      return true
    }
    app.terminate()
    // Use normal Home recovery for an interrupted synthetic session. Never
    // clear storage or bypass the monitor's checkpoint ownership protection.
    app.launch()
    let begin = app.buttons["Begin pre-drive safety check"]
    XCTAssertTrue(begin.waitForExistence(timeout: 15))
    expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: begin)
    waitForExpectations(timeout: 15)
    app.open(URL(string: "occulert-simulator-trace:///monitor?trace-run=1")!)
    if prompt.waitForExistence(timeout: 3) { prompt.buttons["Open"].tap() }
    XCTAssertTrue(app.staticTexts["SIMULATOR TRACE"].waitForExistence(timeout: 15))
    // A cold URL can arrive while iOS still reports the app inactive. Use the
    // actual Start control if that one-shot run request did not start it.
    let start = app.buttons["Start fatigue monitoring"]
    if start.waitForExistence(timeout: 3) { start.tap() }
    let stop = app.buttons["Stop monitoring and save this drive"]
    XCTAssertTrue(stop.waitForExistence(timeout: 15))
    print("OCCULERT_SIMULATOR_UI_PROOF running")
    sleep(30)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Simulator trace actual monitor"
    attachment.lifetime = .keepAlways
    add(attachment)
    stop.tap()
    XCTAssertTrue(start.waitForExistence(timeout: 15))
    XCTAssertFalse(stop.exists)
    print("OCCULERT_SIMULATOR_UI_PROOF stopped")
  }
}
