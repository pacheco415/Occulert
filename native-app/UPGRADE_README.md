# Occulert Native App Upgrade — Real Eye Tracking + EAS Build

This package upgrades `native-app/` from simulated detection to **real on-device
eye tracking**, adds the missing **EAS build config**, and includes the
**app icon / splash assets** the build needs.

## What changed

| File | Change |
|---|---|
| `app/monitor.tsx` | Simulation loop removed. Real camera pipeline: vision-camera frame processor → ML Kit face detection → eye-open probabilities → PERCLOS scoring (~10 Hz). |
| `hooks/useEyeTracking.ts` | New `processEyeOpenness()` (ML Kit path) + `processNoFace()`. `processLandmarks()` kept for web parity. Same PERCLOS/fatigue math, same sensitivity presets. |
| `package.json` | Removed `expo-camera` + `@mediapipe/face_mesh` (web-only, couldn't run natively). Added `react-native-vision-camera`, `react-native-vision-camera-face-detector`, `react-native-worklets-core`. |
| `app.json` | `expo-camera` plugin → `react-native-vision-camera` plugin (same privacy copy). |
| `babel.config.js` | NEW — worklets plugin required for frame processors. |
| `eas.json` | NEW — development / preview / production build profiles. |
| `tsconfig.json` | NEW — was referenced in README but missing from repo. |
| `assets/` | NEW — `icon.png` (1024²), `splash.png` (2048²), `adaptive-icon.png`. On-brand placeholders; swap for final designs anytime. |

## How to apply

1. Copy every file in this folder into `native-app/` in your repo (keep the
   same paths). `eas.json` can live in `native-app/` since that's the project root.
2. ```bash
   cd native-app
   rm -rf node_modules
   npm install
   ```
3. Link EAS (one-time):
   ```bash
   npm install -g eas-cli
   eas login                # your expo.dev account
   eas init                 # writes the real projectId into app.json
   ```
4. Build a development client (~15 min in Expo's cloud, no Mac needed):
   ```bash
   eas build --profile development --platform ios
   ```
   EAS will offer to register your iPhone (ad-hoc provisioning) — say yes and
   follow the QR code on your phone. Install the build when it finishes.
5. Run it:
   ```bash
   npx expo start --dev-client
   ```
   Open the dev build on your phone, start monitoring, and your real eyes now
   drive the EAR/PERCLOS metrics.

## ⚠️ Important changes to your workflow

- **Expo Go no longer works** for the monitor screen. vision-camera is native
  code, so you must use the development build from step 4. Everything else
  about your `expo start` workflow stays the same.
- The **EYE metric** shown on the monitor screen is now eye-open probability
  mapped onto the EAR scale (1.0 open ≈ 0.30), so your existing Low/Med/High
  sensitivity thresholds behave the same as the web app.
- `AlertSystem` still streams `alert.mp3` from occulert.com — consider bundling
  it in `assets/` later so alerts work offline (cell dead zones).

## Path to TestFlight (after the dev build works)

```bash
eas build --platform ios          # production build
eas submit -p ios                 # uploads to App Store Connect
```
Before `eas submit`: create the app record in App Store Connect (name
"Occulert", bundle ID `com.occulert.app`) and put its Apple ID into
`eas.json` → `submit.production.ios.ascAppId`.

## Verified

- All JSON files parse cleanly; `babel.config.js` and `useEyeTracking.ts`
  syntax-checked; `monitor.tsx` structure-checked (balanced braces/parens).
- Full type-check will run on your machine via `npx tsc --noEmit` after
  `npm install`.
