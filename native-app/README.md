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

- **React Native** via [Expo](https://expo.dev) — fastest path from web skills to native
- **TypeScript** — strongly typed for safety-critical logic
- **Expo Camera** — camera access with background capability
- **Expo Sensors** — accelerometer for head-nod detection
- **React Native Health** (iOS) / **Health Connect** (Android) — HRV and sleep data
- **Expo Notifications** — push alert support
- **Expo Haptics** — vibration alerts

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
├── app/                    # Expo Router screens
│   ├── index.tsx           # Landing / home screen
│   ├── monitor.tsx         # Main monitoring screen (camera)
│   ├── pre-drive.tsx       # Pre-drive risk score screen
│   ├── history.tsx         # Session history
│   └── settings.tsx        # Sensitivity + preferences
├── components/
│   ├── EyeTracker.tsx      # Camera + MediaPipe detection
│   ├── AlertSystem.tsx     # Alert triggering + haptics + audio
│   ├── FatigueScore.tsx    # Score display component
│   └── SensitivitySlider.tsx # Low/Med/High sensitivity control
├── hooks/
│   ├── useEyeTracking.ts   # EAR calculation logic
│   ├── useHeadNod.ts       # Accelerometer head-nod detection
│   └── useHealthData.ts    # HRV/sleep from HealthKit/Health Connect
├── constants/
│   └── thresholds.ts       # Sensitivity presets (mirrors web app)
├── package.json
├── app.json            # Expo config
└── tsconfig.json
```

## Phase Milestones

| Milestone | Status |
|-----------|--------|
| Expo project initialized | ✅ Scaffold created |
| Camera + EAR detection running | ⏳ TODO |
| Background camera access (iOS) | ⏳ TODO |
| Sensitivity slider | ⏳ TODO |
| Alert system (haptic + audio) | ⏳ TODO |
| Head-nod detection (accelerometer) | ⏳ TODO |
| HealthKit HRV/sleep integration | ⏳ TODO |
| Pre-drive risk score screen | ⏳ TODO |
| App Store submission | ⏳ TODO |

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

*Occulert™ · Native app scaffold · Start here for iOS/Android development*
