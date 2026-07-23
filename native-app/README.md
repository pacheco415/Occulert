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
- **Expo Camera** - camera access with background capability
- **Expo Sensors** - accelerometer for head-nod detection
- **React Native Health** (iOS) / **Health Connect** (Android) - HRV and sleep data
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
|   |-- EyeTracker.tsx      # Camera + MediaPipe detection
|   |-- AlertSystem.tsx     # Alert triggering + haptics + audio
|   |-- FatigueScore.tsx    # Score display component
|   `-- SensitivitySlider.tsx # Low/Med/High sensitivity control
|-- hooks/
|   |-- useEyeTracking.ts   # EAR calculation logic
|   |-- useHeadNod.ts       # Accelerometer head-nod detection
|   `-- useHealthData.ts    # HRV/sleep from HealthKit/Health Connect
|-- constants/
|   `-- thresholds.ts       # Sensitivity presets (mirrors web app)
|-- package.json
|-- app.json                # Expo config
`-- tsconfig.json
```

## Phase Milestones

| Milestone | Status |
|-----------|--------|
| Expo project initialized | Done - scaffold created |
| Camera + EAR detection running | Done - `useEyeTracking.ts` + dev simulation loop |
| Background camera access (iOS) | Done - `useKeepAwake` + CameraView in monitor.tsx |
| Sensitivity slider | Done - `SensitivitySlider.tsx` + AsyncStorage |
| Alert system (haptic + audio) | Done - `AlertSystem.tsx` - expo-haptics + expo-av |
| Head-nod detection (accelerometer) | In progress - Phase 1: wire expo-sensors |
| HealthKit HRV/sleep integration | Planned - Phase 2 |
| Pre-drive risk score screen | Planned - Phase 2 |
| App Store submission | TODO |

Pilot testers can send general feedback from Settings or attach basic session
metrics from History. The app opens the device mail composer for review and
does not attach camera images, video, audio, or location.

## PWA Parity Checklist

Before App Store submission, the native app should match or exceed the PWA:
- [ ] EAR-based eye tracking with PERCLOS
- [ ] Sensitivity control (Low / Med / High)
- [ ] Session event log
- [ ] Fleet dashboard sync (optional)
- [ ] GPS opt-in
- [ ] Privacy-first (no video stored)
- [ ] Safety disclaimer screen

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
- keep firing while the app is backgrounded during a drive (`staysActiveInBackground`),
- duck music / navigation instead of stopping it.

iOS and Android route audio to the connected Bluetooth device automatically;
you cannot (and don't need to) address AirPods directly. Settings reports this
as automatic routing instead of presenting a misleading AirPods switch.

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
Critical alerts use a stronger repeated haptic. Settings only enables the Watch
switch when iOS confirms that the companion is installed. Expo Go remains a
safe no-op because it cannot contain the Watch target.

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
