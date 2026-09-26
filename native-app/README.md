# Occulert Native App

This directory contains the React Native (Expo) iPhone and Apple Watch source.
Android configuration remains source; no released Android app is claimed.

Current private distribution is TestFlight **1.0.0 (52)**: finished build,
FINISHED submission, Apple VALID / IN_BETA_TESTING, and confirmed embedded
Watch packaging. Its exact source remains
`969849b0c551edb2de6f9230cbeecdce89346b6f`. **Build 52 has user-reported iPhone
installation/general functional, Watch launch, and foreground/background urgent
display/wrist vibration passes.** The user reports iPhone 17 Pro Max on iOS 27.2
and Apple Watch Ultra 4, with Watch software described as the same version 27.2;
these details are not independently verified. Exact delay, Focus/permission
variations and individual accessory, safe-stop, recovery, accessibility,
battery/heat checks remain undocumented. Earlier build-15/19/36 and build-49
feedback is evidence for those exact builds.

PR #144 is merged at `d3ae5a3` and its website/backend release is live. The
native audit fixes in that source await a future binary and separate physical
acceptance. Included iOS build usage is **15/15**; the next period begins
**September 30 at 5 p.m. Pacific**. No new EAS build, submission, or OTA update
is queued. See the [authoritative roadmap](../docs/APP_ROADMAP.md).

## Why Native?

The PWA at occulert.com is the top-of-funnel entry point, but it has critical limitations:

- Camera and MediaPipe processing pauses when the screen locks or the browser is backgrounded
- No access to HealthKit (iOS) or Google Health Connect (Android) for HRV/sleep data
- No access to Bluetooth earbud accelerometer APIs
- No push notifications
- No real wakelock guarantee on iOS Safari

Native adds device APIs and a packaged Watch companion, but camera monitoring
still requires the foreground. Permission, accessory availability, and physical
alert delivery remain separate checks.

## Stack

- **React Native** via [Expo](https://expo.dev) - fastest path from web skills to native
- **TypeScript** - strongly typed for safety-critical logic
- **VisionCamera + ML Kit** - foreground camera access and on-device face/eye
  analysis
- **ML Kit face pose** - experimental pitch-cycle observations for future
  head-nod validation
- **React Native HealthKit** (iOS) - optional read-only HRV and sleep context
- **Watch UserNotifications** - explicit opt-in backup wrist notifications
- **Expo Haptics** - vibration alerts

## Setup

### Prerequisites
- Node 24 for source verification; EAS install CI matches Node 22.23.1/npm 10.9.8
- Use the project's Expo CLI through `npx expo`; native features need a custom development or TestFlight build
- iOS: SDK 57-compatible Xcode/toolchain; the production EAS profile pins Xcode 26.6
- Android: Android Studio with API 31+ emulator

### Install
```bash
cd native-app
npm ci --include=dev
```

### Run
```bash
# iOS simulator
npx expo start --ios

# Android emulator  
npx expo start --android

# Start the custom native development client; Expo Go cannot run these native modules
npx expo start --dev-client
```

## Project Structure

```
native-app/
|-- app/                    # Expo Router screens
|   |-- index.tsx           # Landing / home screen
|   |-- monitor.tsx         # Main monitoring screen (camera)
|   |-- pre-drive.tsx       # Parked checks + optional local Health context
|   |-- history.tsx         # Session history
|   `-- settings.tsx        # Sensitivity + preferences
|-- components/
|   |-- AlertSystem.tsx     # Alert triggering + haptics + audio
|   |-- CloudSyncCard.tsx   # Optional protected account sync
|   `-- SensitivitySlider.tsx # Low/Med/High sensitivity control
|-- hooks/
|   `-- useEyeTracking.ts   # Eye openness + PERCLOS scoring
|-- lib/
|   |-- headNodDetector.ts  # Experimental face-pitch observation state machine
|   |-- sessionHistory.ts   # Serialized local session storage
|   `-- watchBridge.ts      # iPhone-to-Watch alert delivery
|-- constants/
|   `-- thresholds.ts       # Native sensitivity presets
|-- targets/
|   `-- occulert-watch/     # SwiftUI watchOS companion
|-- package.json
|-- app.json                # Expo config
`-- tsconfig.json
```

## Phase Milestones

Build-15/19 statuses below describe historical evidence. They do not establish
physical acceptance of the available build 52.

| Milestone | Status |
|-----------|--------|
| Expo project initialized | Done - scaffold created |
| Native eye probability + PERCLOS scoring | Implemented - ML Kit + `useEyeTracking.ts`; browser EAR is a separate pipeline |
| Foreground camera monitoring (iOS) | Done - session-scoped `useKeepAwake` + VisionCamera in `monitor.tsx` |
| Screen-off / app-backgrounded camera monitoring | Not supported - keep the app foregrounded |
| Sensitivity slider | Done - `SensitivitySlider.tsx` + AsyncStorage |
| Alert system (haptic + audio) | Done - `AlertSystem.tsx` - expo-haptics + expo-audio |
| Earlier sustained-closure escalation | Source complete - prominent alert at 600 ms, stronger stage at 1.2 s; physical calibration pending |
| Foreground-loss spoken warning | Source complete - camera stops and a local warning begins immediately; physical validation pending |
| Apple Watch companion + wrist haptics | Build 52 user-reported launch and foreground/background urgent alert display/wrist vibration passes; exact timing and Focus/permission variations remain undocumented |
| Per-session pre-drive safety confirmation | Done - required before monitoring |
| Structured session alert review | Implemented - local felt-right / false / missed / late labels |
| Structured session test conditions | Done - private TestFlight build 15 |
| Pilot test-condition coverage summary | Done - private TestFlight build 15 |
| Tester-reported battery use + phone heat | Done - private TestFlight build 15 |
| Collapsible session reviews + completion status | Done - private TestFlight build 15 |
| Per-session app version + native build stamp | Done - private TestFlight build 15 |
| Local false/missed alert pattern summary | Done - private TestFlight build 15 |
| Pilot review checkpoint | Implemented - local 10-session Medium progress summary; not measured accuracy |
| Optional protected cloud session sync | Implemented - secure sign-in + explicit consent |
| Head-nod detection | Experimental local camera and compatible-headphone observations; does not trigger alerts or sync |
| HealthKit HRV/sleep integration | Done - optional read-only local context validated in private TestFlight build 19 |
| Pre-drive risk score screen | Foundation in source - factual sleep/HRV context only; no score or alert influence |
| Private iOS distribution | TestFlight 1.0.0 (52), FINISHED submission and Apple VALID / IN_BETA_TESTING; limited user-reported phone/Watch passes above, remaining acceptance open; PR #144 native audit fixes await a future binary |

Pilot testers can send general feedback from Settings or attach basic session
metrics and a structured alert assessment from History. Alert assessments stay
on the iPhone unless the tester chooses to open an editable feedback email.
The app does not attach camera images, video, audio, raw motion readings, or
location.

History can also record lighting, eyewear, and phone position after the tester
is safely parked. These structured conditions stay local unless the tester
opens the editable session feedback email. These features are implemented;
earlier build-19 validation is historical, and build-52 acceptance remains open.

The same local review can capture subjective battery use and phone heat after
the tester parks. These are explicitly described as tester observations rather
than device measurements, remain out of cloud sync, and can be included in the
editable feedback email. A temperature warning tells the tester to stop using
Occulert and let the iPhone cool before another session.

Each new local session also preserves the sensitivity used for that session.
History counts reviewed Medium-sensitivity sessions toward the first 10-session
review checkpoint and summarizes felt-right, false, missed, and late ratings
without uploading those ratings.

When false or missed alerts are reviewed, History also groups their local
observation counts by sensitivity, lighting, eyewear, and phone position. The
app labels these as observations rather than error rates and calls out missing
test-condition context so small or incomplete samples are not overinterpreted.

The pre-drive screen can optionally request read access to Apple Health sleep
analysis and heart rate variability (SDNN). Occulert stores only a derived
24-hour sleep total and the latest HRV value in the iPhone keychain. It does not
write Health data, enable background HealthKit delivery, upload these values,
calculate medical or driving fitness, or use them to change fatigue scoring or
alerts. Apple Health access is requested only when the user taps the connect
button and can be changed later in iOS Health settings.

Drivers with an existing Occulert account can optionally sign in from Settings
and separately enable cloud session sync. Access and refresh tokens are stored
with Expo SecureStore. Synced data is limited to session timestamps, fatigue
scores, safety score, alert counts, and drowsy alert events. Monitoring and
local history continue to work when signed out or offline. Camera images,
video, audio, GPS location, and structured alert ratings are not uploaded.

## PWA Parity Checklist

Before App Store submission, the native app should match or exceed the PWA:
- [ ] Exact-build native ML Kit eye-probability/PERCLOS acceptance; browser EAR is separate
- [ ] Sensitivity control (Low / Med / High)
- [ ] Session event log
- [x] Fleet dashboard sync (optional)
- [ ] GPS opt-in
- [ ] Privacy-first (no video stored)
- [x] Per-session safety confirmation screen

---

*Occulert native source; release and physical evidence are recorded separately.*

## Connected Devices (AirPods & Apple Watch)

Occulert is designed to use the driver's existing Apple / Android hardware the
same way the web app does, but with deeper device access in a native build.

### AirPods / Bluetooth audio (works today)

Alert sounds route to whatever audio output is connected (AirPods Pro, car
audio, headphones). This is handled by `lib/audioSession.ts`, which configures
the audio session so alerts:

- play even when the phone's mute switch is on (`playsInSilentModeIOS`),
- keep the audio session available during active foreground monitoring,
- duck music / navigation instead of stopping it.

iOS and Android route audio to the connected Bluetooth device automatically;
you cannot (and don't need to) address AirPods directly. Settings reports this
as automatic routing instead of presenting a misleading AirPods switch.

### Compatible-headphone motion diagnostics (observation only)

The private local Expo module in
`modules/occulert-headphone-motion/` uses Apple's
`CMHeadphoneMotionManager` to read processed motion from compatible connected
headphones during active foreground monitoring. iOS requires Motion access and
the `NSMotionUsageDescription` entry in `app.json` before updates can start.

The JavaScript adapter in `lib/headphoneMotion.ts` gracefully reports
`not-built`, unavailable, denied, and error states, so monitoring continues with
the camera when headphone motion cannot run. Transient pitch/yaw/roll samples
feed a separate candidate head-nod detector. Raw motion samples are discarded;
session history stores only sample and candidate counts plus the source status.

This path is diagnostic only. It does **not** change PERCLOS, fatigue scoring,
alerts, Watch haptics, or cloud payloads. Use the available build 52 for physical
checks; compatible-headphone calibration and independent validation remain
required before treating these observations as a validated signal.

### Directional in-ear alert pattern (physical acceptance pending)

Settings keeps the existing centered alert tone as the default and offers an
opt-in **Alternate L/R** pattern for stereo earbuds. The derived stereo assets
emphasize one channel at a time while retaining a quieter copy in the other ear,
then alternate emphasis across early and standard drowsiness alerts. Critical
and tracking-loss alerts always use the centered tone at full audibility.

The pattern never claims to detect a left/right hazard and does not depend on
headphone-motion observations. Speaker, car-audio, and single-earbud users
should leave the centered default selected. A physical stereo-earbud check on
the available build 52 remains required before treating this as device-verified.

### Apple Watch alerts (requires a development / TestFlight build)

Wrist haptics need a native watchOS companion app plus `WatchConnectivity`.
This **cannot run in Expo Go** - it requires a development build (EAS) or a
TestFlight build.

The phone side in `lib/watchBridge.ts` sends alerts through
`react-native-watch-connectivity`. The packaged SwiftUI companion lives in
`targets/occulert-watch/` and is added to EAS/Xcode by
`@bacons/apple-targets`. Its bundle identifier is provisioned separately from
the iPhone app.

The companion shows the latest alert and plays a direct Watch haptic while the
Watch app is active. Because WatchKit cannot play that direct haptic while the
app is inactive or backgrounded, the companion can also schedule a Time
Sensitive local notification after the tester explicitly enables background
alerts in the Watch app. Silent Mode still permits the notification haptic;
Focus and the user's notification settings remain authoritative.

The phone uses an immediate message when the Watch app is reachable and saves
the latest alert as application context when it is not. The live message is
dispatched before reachability checks and records acknowledgement round-trip
timing in the local session diagnostics. Background WatchConnectivity delivery
can be delayed; messages older than two seconds update the Watch display without
producing a late wrist tap. Occulert does not use the separate user-info transfer
queue because its native error callback can receive a missing payload. A
post-install guard also makes that callback nil-safe for transfers left by an
older build. The iPhone alert remains primary and Occulert must not promise a
guaranteed background wrist alert. Critical live alerts use a
stronger repeated direct haptic. Settings only enables the Watch switch when
iOS confirms that the companion is installed and includes a direct Watch alert
test. Expo Go remains a safe no-op because it cannot contain the Watch target.

Build and submit both targets together with the production EAS profile. On the
physical devices, open the Occulert Watch app, enable background alerts, confirm
the iPhone reports the companion as installed, opt into Watch alerts, and test
both the active-app haptic and the background notification. Verify the phone
alert still works as the fallback.

For build 52, the user reported the TestFlight Watch **Open** button, then
confirmed the foreground urgent test displayed an alert and produced wrist
vibration. The background test was also reported to display a notification and
produce wrist vibration after returning to the watch face. These limited
passes do not supply exact delivery delay or Focus/permission variations and
do not accept the later merged native audit fixes, which need a future binary.

### Background camera and reduced-mode boundary

iOS stops ordinary front-camera capture after Occulert leaves the foreground or
the screen locks. Occulert therefore ends and saves the session, starts a
distinct spoken/haptic warning, and shows an explicit stopped state when the app
returns. It does not claim that face monitoring continued invisibly.

Compatible-headphone motion remains an observation-only foreground diagnostic.
It is not presented as a reduced background detector because it has not been
validated as a drowsiness signal and iOS does not provide a general-purpose
background camera path for this app. A truly independent background face signal
would require supported dedicated camera hardware and separate validation.

Critical Alerts are also a separate Apple entitlement gate. Source must not add
or claim that entitlement until Apple approves the use case and a signed build
can be verified. See `CRITICAL_ALERTS_READINESS.md`.

### Android (Wear OS)

The same `watchBridge` pattern applies; swap in a Wear OS `MessageClient`
module in a dev build. `bluetooth-central` background mode is already declared
in `app.json`.

### Message contract

Each alert sends: `{ type: 'occulert-alert', level, perclos, at }` where
`level` is one of `none | watch | alert | critical`.
