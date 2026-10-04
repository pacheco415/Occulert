# Native source setup and upgrades

Work from a reviewed repository revision. Keep current tracked files and the
committed lockfile; copying an older source package can discard later history,
consent and audio fixes. The [native README](README.md) describes the current
architecture, and the [October 4 release intent](../docs/RELEASE_2026-10-04.md)
records source, distribution receipts and the remaining device checks.

## Reproducible setup

Select Node 24 from the root `.nvmrc`, then run:

```bash
cd native-app
npm ci --include=dev
npm run verify
```

Verification checks Expo dependency compatibility and TypeScript, then runs the
installed dependency regressions and React/Expo short-cue lifecycle cases.
Record the exact source and result; these checks do not measure physical audio,
camera accuracy or Watch perception. The separate `eas-install` job in
[Native App Typecheck](../.github/workflows/native-app-typecheck.yml) uses the same
Node 24 source and npm 10.9.8 for a clean install and full native verification.
Use that exact package manager for the additional release compatibility check.

Run an already provisioned development client with `npx expo start --dev-client`.
VisionCamera, ML Kit, HealthKit and the Watch target require a custom native
build; Expo Go cannot supply them. Installed versions are defined by
`package.json` and `package-lock.json`, not this guide. Android requires API 26
or later. A private Android preview of the build-56 source finished; this
new candidate has no Android build or device acceptance yet.

## Current behavior

Foreground VisionCamera frames feed ML Kit eye-open probabilities. Native
scales those probabilities to a 0–0.3 signal; browser geometric EAR is a separate
pipeline. Sensitivity presets do not establish equal accuracy across the two.
The optional parked eye-baseline flag is experimental and local; keep it off
for an ordinary release unless a separate experiment is explicitly selected.

Alert tones, directional variants, the monitoring-paused warning and Settings
sound test are bundled WAV assets. Short-cue players automatically release the
shared audio session while silent; owned layout cleanup precedes Expo disposal.
A playing warning may finish as monitoring stops on foreground loss. Silent
mode, Bluetooth routing and restoration of external music still need the
exact-build device checks. Headphone motion is foreground observation only.

## Existing release identities

`app.json` already contains the EAS project and iOS bundle/team identities.
`eas.json` already contains production build/submission profiles and the App
Store app ID. Preserve them when preparing a release; do not create a duplicate
project or App Store record.

`cli.appVersionSource` is `remote`, and production `autoIncrement` is `true`.
The configured app version is 1.0.0; `ios.buildNumber` is intentionally absent.
EAS assigns the next remote build number at the separately authorized build
step. A local number does not reserve it, and preparation does not reset or
synchronize a remote counter. Record the returned exact source, build and
submission receipts before updating distribution status.
[Expo app version management](https://docs.expo.dev/build-reference/app-versions/)

## Upgrading Expo SDK

Use one planned `codex/` branch for each SDK upgrade. Review the target SDK's
release notes and the camera, face detector, worklets and custom Watch module
compatibility before changing dependencies. Move one SDK version at a time.

With Node 24 selected from the repository's `.nvmrc`, install the reviewed Expo
version in `native-app/`, then run:

```bash
npx expo install --fix
npx expo-doctor
npm ci --include=dev && npm run verify
```

Review and commit the manifest and lockfile together. Keep React, React Native,
Babel, React types and TypeScript on the versions selected for that SDK; resolve
compatibility failures before continuing. Dependabot holds those packages and
native major updates for this coordinated process. Continue reviewing dependency
audit reports while an SDK upgrade is pending.

Run root verification and the npm 10.9.8 `eas-install` compatibility job linked
above. Follow [RELEASING.md](../RELEASING.md) and the
[device checklist](../docs/DEVICE_ACCEPTANCE.md) for the resulting native build.
See the [official Expo upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).
