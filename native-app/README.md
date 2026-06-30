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

- **React Native** via [Expo](https://expo.dev) â fastest path from web skills to native
- **TypeScript** â strongly typed for safety-critical logic
- **Expo Camera** â camera access with background capability
- **Expo Sensors** â accelerometer for head-nod detection
- **React Native Health** (iOS) / **Health Connect** (Android) â HRV and sleep data
- **Expo Notifications** â push alert support
- **Expo Haptics** â vibration alerts

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
âââ app/                    # Expo Router screens
â   âââ index.tsx           # Landing / home screen
â   âââ monitor.tsx         # Main monitoring screen (camera)
â   âââ pre-drive.tsx       # Pre-drive risk score screen
â   âââ history.tsx         # Session history
â   âââ settings.tsx        # Sensitivity + preferences
âââ components/
â   âââ EyeTracker.tsx      # Camera + MediaPipe detection
â   âââ AlertSystem.tsx     # Alert triggering + haptics + audio
â   âââ FatigueScore.tsx    # Score display component
â   âââ SensitivitySlider.tsx # Low/Med/High sensitivity control
âââ hooks/
â   âââ useEyeTracking.ts   # EAR calculation logic
â   âââ useHeadNod.ts       # Accelerometer head-nod detection
â   âââ useHealthData.ts    # HRV/sleep from HealthKit/Health Connect
âââ constants/
â   âââ thresholds.ts       # Sensitivity presets (mirrors web app)
âââ package.json
âââ app.json            # Expo config
âââ tsconfig.json
```

## Phase Milestones

| Milestone | Status |
|-----------|--------|
| Expo project initialized | â Scaffold created |
| Camera + EAR detection running | â `useEyeTracking.ts` + dev simulation loop |
| Background camera access (iOS) | â `useKeepAwake` + CameraView in monitor.tsx |
| Sensitivity slider | â `SensitivitySlider.tsx` + AsyncStorage |
| Alert system (haptic + audio) | â `AlertSystem.tsx` — expo-haptics + expo-av |
| Head-nod detection (accelerometer) | â³ Phase 1: wire expo-sensors |
| HealthKit HRV/sleep integration | â³ Phase 2 |
| Pre-drive risk score screen | â³ Phase 2 |
| App Store submission | â³ TODO |

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

*Occulertâ¢ Â· Native app scaffold Â· Start here for iOS/Android development*
