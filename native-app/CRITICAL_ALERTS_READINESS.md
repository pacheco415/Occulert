# Critical Alerts readiness

## Current decision

Do not add `com.apple.developer.usernotifications.critical-alerts` to the iPhone
or Watch target yet. Apple must approve this managed entitlement before a signed
build can use it. Adding the key first would not make delivery reliable and may
break signing or create an unsupported product claim.

## What the entitlement would and would not change

- It may allow an authorized notification to play through Silent Mode or Focus.
- It cannot keep the front camera running after Occulert leaves the foreground.
- It cannot guarantee Apple Watch delivery or remove WatchConnectivity delay.
- It does not replace the immediate in-app iPhone sound and haptic.

## Evidence to prepare before requesting access

1. Physical-device timings for the 600 ms prominent alert and 1.2 s critical
   stage across supported iPhones, lighting, eyewear, and phone positions.
2. Detection-to-phone-dispatch and Watch acknowledgement timings from local
   session diagnostics, with no camera frames retained.
3. False-alert and missed-alert reviews showing why interruption of Silent Mode
   or Focus is proportionate to the validated safety use case.
4. Clear App Review notes explaining foreground-only camera monitoring, the
   supplemental-prototype boundary, user controls, and the safe-stop workflow.
5. Apple entitlement approval, followed by a separately authorized signed build,
   TestFlight submission, and physical-device validation.

## Request wording draft

Occulert is a supplemental driver-drowsiness prototype that performs face and
eye analysis locally while the app is visibly open and the phone is mounted.
When the validated on-device detector identifies a sustained dangerous eye
closure, the iPhone immediately plays an in-app sound and haptic and instructs
the driver to pull over safely. We are requesting Critical Alerts only for this
narrow, user-enabled safety warning. Occulert does not run the camera invisibly,
does not store or upload camera frames, and does not claim to prevent crashes or
replace the driver's responsibility to stop when drowsy. Apple Watch delivery is
treated as a secondary best-effort backup rather than the primary alert.
