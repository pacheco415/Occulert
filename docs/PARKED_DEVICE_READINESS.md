# Parked device readiness

Current private distribution is TestFlight 1.0.0 (52): finished build,
FINISHED submission, Apple VALID / IN_BETA_TESTING, and confirmed embedded
Watch packaging. On September 26, the user reported build-52 iPhone installation
and general functionality, Watch launch, and foreground/background urgent alert
display and wrist vibration. The [authoritative roadmap](APP_ROADMAP.md)
records the reported device details, evidence limits, and build availability.
Exact delay, Focus/permission variations and the individual readiness checks
below remain undocumented. These checks apply to the actual installed
version/build; the later merged native audit fixes require a future binary and
separate physical acceptance. Included iOS usage is 15/15; no new build is queued.

The current SDK 57 package versions are recorded in `native-app/package.json`
and its lockfile. Clean installation must remain reproducible with `npm ci`;
the EAS-matching Node 22.23.1/npm 10.9.8 job and Node 24 source verification
check different runtime contracts.

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

Before treating the screen as device-verified, check the installed build 52:

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

These checks require the installed native TestFlight build and any physical
accessories included in the test. Passing a bundle export or simulated readiness tests is not evidence
of real alert delivery, fatigue accuracy, or simultaneous-camera support.
