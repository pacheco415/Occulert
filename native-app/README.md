# Occulert Native App

This directory contains the React Native (Expo) scaffold for the Occulert native iOS and Android app.

## Why Native?

The PWA at occulert.com is the top-of-funnel entry point, but it has critical limitations:

- Camera and MediaPipe processing pauses when the screen locks or the browser is backgrounded
- No access to HealthKit (iOS) or Google Health Connect (Android) for HRV/sleep data
- No access to Bluetooth earbud accelerometer APIs
- No push notifications
- No real wakelock guarantee on iOS Safari

A native app removes all of these blockers.

## Stack

- **React Native** via [Expo](https://expo.dev) - fastest path from web skills to native
- **TypeScript** - strongly typed for safety-critical logic
- **VisionCamera + ML Kit** - foreground camera access and on-device face/eye
  analysis
- **ML Kit face pose** - experimental pitch-cycle observations for future
  head-nod validation
- **React Native HealthKit** (iOS) - optional read-only HRV and sleep context
- **Expo Notifications** - push alert support
- **Expo Haptics** - vibration alerts

## Setup

### Prerequisites
- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS: Xcode 15+ with iOS 16+ simulator or physical device
- Android: Android Studio with API 31+ emulator

### Install
```bash
cd native-app
npm install
```

### Run
```bash
# iOS simulator
npx expo start --ios

# Android emulator  
npx expo start --android

# Scan QR code with Expo Go app (fastest for testing on real device)
npx expo start
```

## Project Structure

```
native-app/
|-- app/                    # Expo Router screens
|   |-- index.tsx           # Landing / home screen
|   |-- monitor.tsx         # Main monitoring screen (camera)
|   |-- pre-drive.tsx       # Pre-drive risk score screen
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
|   `-- thresholds.ts       # Sensitivity presets (mirrors web app)
|-- targets/
|   `-- occulert-watch/     # SwiftUI watchOS companion
|-- package.json
|-- app.json                # Expo config
`-- tsconfig.json
```

## Phase Milestones

| Milestone | Status |
|-----------|--------|
| Expo project initialized | Done - scaffold created |
| Camera + EAR detection running | Done - `useEyeTracking.ts` + dev simulation loop |
| Foreground camera monitoring (iOS) | Done - `useKeepAwake` + VisionCamera in `monitor.tsx` |
| Screen-off / app-backgrounded camera monitoring | Not supported - keep the app foregrounded |
| Sensitivity slider | Done - `SensitivitySlider.tsx` + AsyncStorage |
| Alert system (haptic + audio) | Done - `AlertSystem.tsx` - expo-haptics + expo-audio |
| Apple Watch companion + wrist haptics | Done - private TestFlight build 15 validated |
| Per-session pre-drive safety confirmation | Done - required before monitoring |
| Structured session alert review | Done - local correct / false / missed labels |
| Structured session test conditions | Done - private TestFlight build 15 |
| Pilot test-condition coverage summary | Done - private TestFlight build 15 |
| Tester-reported battery use + phone heat | Done - private TestFlight build 15 |
| Collapsible session reviews + completion status | Done - private TestFlight build 15 |
| Per-session app version + native build stamp | Done - private TestFlight build 15 |
| Local false/missed alert pattern summary | Done - private TestFlight build 15 |
| Pilot accuracy checkpoint | Implemented - local 10-session Medium progress summary |
| Optional protected cloud session sync | Implemented - secure sign-in + explicit consent |
| Head-nod detection | Experimental local camera and compatible-headphone observations; does not trigger alerts or sync |
| HealthKit HRV/sleep integration | Done - optional read-only local context validated in private TestFlight build 19 |
| Pre-drive risk score screen | Foundation in source - factual sleep/HRV context only; no score or alert influence |
| Private iOS distribution | TestFlight build 19 validated on iPhone and Apple Watch; no external testing or App Review started |

Pilot testers can send general feedback from Settings or attach basic session
metrics and a structured alert assessment from History. Alert assessments stay
on the iPhone unless the tester chooses to open an editable feedback email.
The app does not attach camera images, video, audio, raw motion readings, or
location.

History can also record lighting, eyewear, and phone position after the tester
is safely parked. These structured conditions stay local unless the tester
opens the editable session feedback email. They are included in the validated
private TestFlight build 19 baseline.

The same local review can capture subjective battery use and phone heat after
the tester parks. These are explicitly described as tester observations rather
than device measurements, remain out of cloud sync, and can be included in the
editable feedback email. A temperature warning tells the tester to stop using
Occulert and let the iPhone cool before another session.

Each new local session also preserves the sensitivity used for that session.
History counts reviewed Medium-sensitivity sessions toward the first 10-session
accuracy checkpoint and summarizes felt-right, false, and missed ratings
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
- [ ] EAR-based eye tracking with PERCLOS
- [ ] Sensitivity control (Low / Med / High)
- [ ] Session event log
- [x] Fleet dashboard sync (optional)
- [ ] GPS opt-in
- [ ] Privacy-first (no video stored)
- [x] Per-session safety confirmation screen

---

*Occulert - Native app scaffold - Start here for iOS/Android development*

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

### Compatible-headphone motion diagnostics (source only)

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
alerts, Watch haptics, or cloud payloads. A new native development/TestFlight
build and real compatible-headphone calibration are still required before this
can be treated as a validated signal.

### Directional in-ear alert pattern (source only)

Settings keeps the existing centered alert tone as the default and offers an
opt-in **Alternate L/R** pattern for stereo earbuds. The derived stereo assets
emphasize one channel at a time while retaining a quieter copy in the other ear,
then alternate emphasis across early and standard drowsiness alerts. Critical
and tracking-loss alerts always use the centered tone at full audibility.

The pattern never claims to detect a left/right hazard and does not depend on
headphone-motion observations. Speaker, car-audio, and single-earbud users
should leave the centered default selected. A new TestFlight build and physical
stereo-earbud check remain required before this source change is considered
device-verified.

### Apple Watch alerts (requires a development / TestFlight build)

Wrist haptics need a native watchOS companion app plus `WatchConnectivity`.
This **cannot run in Expo Go** - it requires a development build (EAS) or a
TestFlight build.

The phone side in `lib/watchBridge.ts` sends alerts through
`react-native-watch-connectivity`. The packaged SwiftUI companion lives in
`targets/occulert-watch/` and is added to EAS/Xcode by
`@bacons/apple-targets`. Its bundle identifier is provisioned separately from
the iPhone app.

The companion shows the latest alert and plays a Watch haptic for a live alert.
The phone uses an immediate message when the Watch app is reachable and a
queued fallback when it is not. Critical alerts use a stronger repeated
haptic. Settings only enables the Watch switch when iOS confirms that the
companion is installed and includes a direct Watch alert test. Expo Go remains
a safe no-op because it cannot contain the Watch target.

Build and submit both targets together with the production EAS profile. On the
physical devices, open the Occulert Watch app, confirm the iPhone reports the
companion as installed, opt into Watch alerts, and verify the phone alert still
works as the fallback.

### Android (Wear OS)

The same `watchBridge` pattern applies; swap in a Wear OS `MessageClient`
module in a dev build. `bluetooth-central` background mode is already declared
in `app.json`.

### Message contract

Each alert sends: `{ type: 'occulert-alert', level, perclos, at }` where
`level` is one of `none | watch | alert | critical`.
