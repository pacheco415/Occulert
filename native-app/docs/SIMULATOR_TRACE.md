# iOS Simulator Trace

The `simulator-trace` profile creates **Occulert Simulator Trace**, bundle ID
`com.occulert.app.simulatortrace`. A persistent **SIMULATOR TRACE** banner identifies
synthetic input, disables cloud transport and says it is not for driving. It is
for checking layouts, controls and scoring flows on an arm64 iOS Simulator.

This variant does not link Google ML Kit or open a camera. A bundled trace sends
eye-open probabilities to the monitor's actual `onEyeState` callback, which uses
the existing `useEyeTracking` pseudo-EAR/PERCLOS implementation and alert policy.
It repeats open eyes, a 500 ms blink, at least three closed seconds, face loss
and open eyes. The trace timer uses the existing 100 ms cadence. Stop and unmount
cancel it. Ordinary-release thresholds, camera processing and alert policy are
unchanged.

## Profile and production guards

The separate EAS profile has `ios.simulator: true`, an internal distribution and
the three explicit `OCCULERT_SIMULATOR_*` profile environment values. It does not
extend the production profile or define a submission profile. The production
profile, remote version policy and `app.json` are unchanged.

EAS evaluates profile `env` during local configuration before its worker sets
the reserved `EAS_BUILD_PROFILE` and `EAS_BUILD_PLATFORM` variables. The
[CLI evaluator](https://github.com/expo/eas-cli/blob/08c92bf937bc36c32c5f7b8c4ec73cc6bbe02f50/packages/eas-cli/src/build/evaluateConfigWithEnvVarsAsync.ts)
passes profile environment to project configuration; the
[worker environment](https://github.com/expo/eas-cli/blob/08c92bf937bc36c32c5f7b8c4ec73cc6bbe02f50/packages/worker/src/env.ts)
sets the reserved values later. The guard therefore uses explicit nonreserved
profile/platform values and rejects conflicting reserved values when present.
The tests also exercise local evaluation with only the declared profile env.

Metro substitutes only the exact ML Kit package import for this iOS profile.
React Native autolinking excludes that package for the variant. Normal builds
resolve and link the real detector. The simulator stub also refuses a runtime
without the exact simulator bundle ID and manifest marker. The generated phone
target supports only `iphonesimulator`; an iPhone SDK archive is disallowed,
and the variant's Android generation/resolution is rejected. The production
Watch target remains in ordinary builds; the layout/scoring variant omits it.

The profile tests generate both actual iOS projects. They compare the ordinary
phone Info.plist byte for byte with the saved pre-change fixture and verify
that ordinary ML Kit autolinking and the production profile are retained.
See [Expo simulator profiles](https://docs.expo.dev/build-reference/simulators/)
and [autolinking exclusions](https://docs.expo.dev/modules/autolinking/).

## Build locally

Use Node 24, the installed Xcode and CocoaPods, with a supported local Ruby.
No EAS cloud build, submission or remote version/counter command is needed.

```sh
npm ci --include=dev
npm run verify
xcrun simctl list devices available
npm run ios:simulator-trace -- --device SIMULATOR_UUID
```

The helper creates a fresh temporary project, copies installed dependencies,
runs iOS prebuild and CocoaPods, then compiles an unsigned Release simulator
app with Xcode. It verifies the resulting Mach-O architecture and platform.
It does not change the authored checkout's generated native directories.
Use `--output NEW_DIRECTORY` to select a different staging directory outside
the source project.

Use a directory outside File Provider/iCloud-managed folders. Finder metadata
on newly generated frameworks can cause the
[code-signing error described by Apple](https://developer.apple.com/library/archive/qa/qa1940/_index.html).
The default temporary location avoids this; copying dependencies keeps their
internal compilation caches out of the original checkout. No global Ruby or
code-signing configuration needs to change.

## Prove real simulator scoring

Pass the completed build directory printed by the builder:

```sh
node scripts/prove-simulator-trace.mjs --device SIMULATOR_UUID --build BUILD_DIRECTORY --receipt PROOF.json --screenshot PROOF.png
```

The helper verifies the authored-input and compiled-artifact hashes, boots the
chosen iOS Simulator and installs this distinct app. A separate XCTest UI runner
first opens Home and waits for normal interrupted-session recovery to finish,
then opens its simulator run link, handles only the system confirmation naming
Occulert Simulator Trace, and uses the actual Start control if the cold URL
arrived before the app became active. That link cannot start the ordinary app.
The runner checks the banner and Stop returning to Start. It uses the local
Ruby `xcodeproj` gem already required by CocoaPods and compiles only its separate
UI-test target; it cannot rebuild the pinned application.

The helper waits for actual monitor scoring observations: open eyes, a sub-alert
blink, a closed interval of at least three seconds and face loss. It saves the
observations and optionally a screenshot while monitoring, then terminates its
simulator app. It does not reset the simulator or clear ordinary Occulert data.
Unreadable recovery data still blocks the test through the app's normal
protection; the helper never clears that data or bypasses recovery.

The build receipt hashes authored source/config/assets from the actual copied
project, plus the compiled JS bundle, Mach-O and Info.plist. It compares those
authored inputs with the checkout before reporting success. The proof helper
checks the same inputs again. A changed authored input requires another build;
HEAD plus a dirty flag alone does not identify the built source.
The proof helper and its Swift/Ruby UI harness have separate hashes in the proof
receipt. They are support tooling, not members of the compiled app's authored
input manifest; changing them does not relabel or replace that build manifest.

Simulator scoring and layout results do not test a camera, ML Kit detection,
physical Duo behavior, phone/Watch delivery, audio routes, battery or heat.
Exact-build physical acceptance and any production/TestFlight build remain
separate actions.

## Observed local proof — October 28, 2026

The [dated source/artifact receipt](SIMULATOR_TRACE_PROOF_2026-10-28.json) records
an actual unsigned Release build completed at `2026-10-29T04:05:54.625Z` (October
28 locally), on Xcode 27.1, for the arm64 iPhone Duo simulator running iOS 27.1.
The build used base commit `282aba3258a8e5a8386a0cffd5affc1d4dab2b86` plus the
recorded 139 authored input hashes; those inputs still match the final source.
The later UI-proof tooling has its own hashes and is not part of that original
application manifest.

The complete proof passed at `2026-10-29T04:29:33.408Z`: normal Home recovery,
the warning banner, real monitoring and Stop returning to Start. Actual scoring
reported open EAR `0.3`, the short blink without an alert, `3017 ms` closed with
fatigue score `97` and a critical alert, then face loss with no alert. These are
synthetic scoring observations, not detection-accuracy measurements.

Node 24 clean installation and native verification passed **97 tests, zero
failures or skips**. The actual default prebuild reproduced the original
production phone Info.plist bytes (SHA-256
`6a6ea81cb682575398b81fb141e8e8a7fe9c33747d9818e5432e5a3e9221ff83`), while
ordinary autolinking retained the real ML Kit detector. Production profile
bytes, dependency versions, build counters and experiment defaults did not
change.
