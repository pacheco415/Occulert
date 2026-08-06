# Safe-stop Maps handoff

Occulert's first navigation handoff is intentionally narrow: after at least one
confirmed drowsiness alert, the foreground monitoring screen exposes a
persistent **Find a safe stop** action.

## Driver flow

1. Occulert confirms a drowsiness event and delivers its normal phone, audio,
   and optional Apple Watch alert.
2. A persistent action appears beneath the live monitor controls.
3. The driver uses it only after parking, or asks a passenger to use it.
4. The driver chooses **Rest area**, **Gas station**, or **Food or coffee**.
5. Occulert disarms camera monitoring and saves the current drive before
   handing the search to Apple Maps, an Android maps app, or a web fallback.

The feature does not rank businesses, promise that a result is open or safe,
or automatically start turn-by-turn navigation. The selected maps app owns the
search results and routing decision.

## Privacy boundary

This implementation does not add a location package, request coordinates, or
send GPS data to Occulert's backend. It sends only the selected search phrase
to the maps app. The maps app may use its own location permission and settings
to center results.

Camera images, video, raw motion, and location remain outside the handoff and
outside cloud session payloads.

## Foreground limitation

The handoff explicitly ends monitoring before Maps opens. Normal iPhone camera
capture is not a reliable background service, so Occulert must never imply that
the driver remains camera-monitored while another full-screen app is active.
A future navigation experience must preserve this truthful state boundary or
use a separately validated, platform-supported sensor path.

## Validation

- [x] Deterministic URL-builder tests for iOS, Android, and web fallback
- [x] Static regression guard proving the monitor saves/stops before Maps
- [x] No new location dependency or cloud field
- [ ] Physical iPhone/TestFlight handoff check
- [ ] Android device handoff check
- [ ] Accessibility and one-handed parked-use review

This feature is a safety aid, not a substitute for the driver's judgment. A
drowsy driver should stop driving as soon as it is safe to do so.
