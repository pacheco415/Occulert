# Parked device readiness

This batch also aligns installed packages with Expo SDK 57's recommended
maintenance versions, including Expo 57.0.24, audio 57.0.5, haptics 57.0.3,
router 57.0.22, and SecureStore 57.0.4. The native lockfile is updated and
must remain reproducible with `npm ci`. It follows the supported
[Expo dependency alignment workflow](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).
Because native dependencies change, distribution requires a new native build;
the existing installed TestFlight build is not changed by this source work.

The pre-drive screen now shows a read-only snapshot of front-camera availability
and permission, saved phone alert settings, optional Watch alert readiness, and
compatible-headphone motion availability. It links to the existing Settings
audio and Watch tests.

Camera permission does not mean a face is visible. Saved sound/vibration choices
do not prove that an alert was heard or felt. Watch reachability does not prove
background delivery. Headphone motion availability does not identify the current
audio route or establish a validated fatigue signal. These distinctions appear
in the screen copy; there is no overall safe-to-drive or all-devices-ready badge.

Checks run when the screen becomes focused or the app returns to the foreground,
and can be refreshed manually. Results expire after 30 seconds. Backgrounding or
leaving the screen invalidates pending reads. Duplicate refresh taps are ignored.
Each independent source has a three-second deadline; failures remain unconfirmed
without hiding other results. Failed storage reads do not masquerade as default
enabled settings.

This check does not request permissions, start camera capture or motion updates,
read health records, emit audio/haptics, change saved preferences, store results,
or upload diagnostics. It does not alter the existing safety confirmation,
monitor-start checks, scoring, or alert logic. Phone-only use remains supported.

## Validation

`npm run test:native-setup` includes readiness status, stale-data, independent
failure, and timeout regressions. Also run the root `npm run verify`, native
TypeScript checks, and the iOS JavaScript bundle export.

Before treating the new screen as device-verified, check the exact native build:

- Open pre-drive with no Watch or headphones; review the phone-only status.
- Try camera permission denied and granted. Grant/revoke access in iOS Settings
  and return; ensure the status refreshes without starting capture.
- Disable phone sound and vibration; confirm Both off appears after returning
  from app Settings. Re-enable the desired settings explicitly.
- Enable Watch alerts with the companion closed/open and with it disconnected.
  Test the wrist alert separately while parked.
- Connect/disconnect compatible headphones; compare Motion denied, permission
  pending, and available. Confirm audio availability is not inferred from motion.
- Wait 30 seconds; affirmative statuses must change to Check again.
- Rapidly refresh, visit Settings, return, and background/foreground the app;
  no old request may restore an outdated snapshot.
- Check VoiceOver and the largest supported text sizes; all actions remain usable.
- Proceed through the existing confirmations and camera setup to monitoring.

These checks require the native development/TestFlight build and physical
accessories. Passing a bundle export or simulated readiness tests is not evidence
of real alert delivery, fatigue accuracy, or simultaneous-camera support.
