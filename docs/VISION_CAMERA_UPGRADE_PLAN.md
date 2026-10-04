# Native camera compatibility plan

Prepared October 3, 2026 against `main` at
`1138e5d6b0f714a10d06e1a7e0430fcac1d2a19f`. This is a plan, with no
dependency, runtime, build, or release change. No candidate binary or physical
camera result has been validated. Perform this migration in one coordinated
branch, following [AGENTS.md](../AGENTS.md) and [RELEASING.md](../RELEASING.md).

## Installed baseline and upstream evidence

The checked-in native lockfile resolves the following baseline. Preserve it
until an exact replacement set passes the gates below.

| Component | Installed version | Candidate contract to verify |
|---|---|---|
| Expo | 57.0.26 | Keep Expo's supported dependency set; a camera upgrade does not justify an independent SDK jump. |
| React Native / React | 0.86.3 / 19.2.3 | Detector v2 declares broad minimum peers; these do not prove compatibility with this pair. |
| VisionCamera | 4.7.3 | Detector v2 requires VisionCamera >=5.0, which changes the frame API. |
| Face detector | 1.10.2 | Investigated tag v2.0.0; this plan does not select it for release. |
| Nitro modules | 0.36.5 | Detector v2 declares >=0.35; verify the chosen camera and generated native code together. |
| Worklets Core | 1.6.3 | Current processor uses its shared values, JS bridge, and Babel plugin. V5 frame processing uses a different worklets stack. |
| TypeScript | 6.0.3 | Preserve Expo-supported tooling and verify all candidate exported types. |

The [detector v2.0.0 package](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/package.json)
declares VisionCamera >=5.0 and Nitro >=0.35. Its development dependencies use
RN 0.83.6, VisionCamera ^5.0.9 and Worklets 0.7.4; that example is not evidence
for Occulert's Expo 57 / RN 0.86.3 combination or a recommended version set.

The [tagged README](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/README.md)
still calls v2 beta and warns about non-portrait/front-camera orientations; its
install example names a prerelease despite the package declaring 2.0.0.
[Issue #229](https://github.com/luicfrr/react-native-vision-camera-face-detector/issues/229)
is closed, and the [May 18 maintainer comment](https://github.com/luicfrr/react-native-vision-camera-face-detector/issues/229#issuecomment-4477868528)
says it was fixed in v2.0.0. Record this documentation conflict; neither the
stale warning nor the closing comment establishes exact-build device behavior.
Verify the published tarball against the chosen tag and review its release
notes, types, and native implementation before choosing a version.

## Contracts the migration must preserve

Current [monitor.tsx](../native-app/app/monitor.tsx) consumes ML Kit eye-open
probabilities, not EAR landmarks. The detector runs in fast mode with eye
classification enabled, landmarks/contours/tracking disabled, front camera,
and unscaled bounds (`autoMode` defaults false). It chooses the largest face
and forwards primitive eye probabilities, head angles, bounds, frame width /
height, and measured inference duration. Missing eyes remain `-1`; no face is
reported explicitly. Frames stay on the device and are neither saved nor sent.

Inference is throttled *before detection* to 100 ms normally and 200 ms under
the load policy. Critical heat stops monitoring. The existing 10-second
startup grace, 5-second stall detection, one-restart limit, permission/setup
checks, and foreground stop behavior must continue to work. Preserve the
fatigue thresholds, time windows, optional baseline experiment flag, sound
timing, consent boundaries, and observation-only sensor-fusion policy.

| Current contract | Required v5 / detector v2 adaptation |
|---|---|
| `FrameFaceDetectionOptions`, `classificationMode: 'all'` | Exported `FaceDetectorOptions`, `runClassifications: true`; keep `runLandmarks: false`, `runContours: false`, fast mode and tracking disabled. Verify any changed minimum-face default. |
| Destructured `{ detectFaces }` | Keep the returned Nitro `FaceDetector` object and invoke its method with the object intact. Copy required face properties to primitives before crossing runtimes or releasing frames. |
| `useFrameProcessor` / `Camera.frameProcessor` | V5 uses `useFrameOutput` / `Camera.outputs`. Verify pixel format and buffer resolution at the output API rather than copying old camera props. |
| Worklets Core plugin, `useRunOnJS`, shared values | Audit every current consumer before replacing plugins or bridge/shared-value APIs. Verify the exact versions and Babel configuration for `react-native-vision-camera-worklets` plus `react-native-worklets`. |
| Borrowed frame managed by v4 | V5 frame ownership is explicit. Release each received frame exactly once after its last use, including throttled, busy, empty, failed, stopped, and stale paths. |
| Bounds divided by `frame.width/height` | Establish the detector's actual coordinate space, mirroring, orientation, and matching dimensions before calling `assessCameraSetup`. Do not assume preview or interface dimensions are image dimensions. |
| Camera runtime error codes | Map candidate errors deliberately; preserve bounded recovery and truthful stopped/unavailable state without retry loops. |

These changes follow the actual [v2 hook](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/src/hooks/useFaceDetector.ts),
[face type](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/src/specs/Face.nitro.ts),
and [option definitions](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/src/specs/ImageFaceDetectorFactory.nitro.ts).
Use those contracts rather than treating mixed README snippets as working code.

Prefer an explicit frame-output adapter for the first parity experiment. The
tag also exports [useFaceDetectorOutput](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/src/hooks/useFaceDetectorOutput.ts),
but its callback supplies faces without frame dimensions or inference timing.
Throttling that callback alone would not retain the current pre-inference load
limit. Do not substitute it without a proven adapter for all three contracts.

The [v5 frame-output documentation](https://visioncamera.margelo.com/docs/frame-output)
requires explicit disposal. If using the [async runner](https://visioncamera.margelo.com/docs/async-frame-processing),
release accepted frames in a completion `finally`; release rejected/busy frames
immediately. Choose one owner for every frame and avoid double disposal.
Bound concurrent inference, retain the existing sampling cadence, and discard
late results using a monitoring generation before they update setup, fatigue,
alerts, or a newer session. Measure capture-to-result delay separately from
inference duration; a queued result must not masquerade as a fresh frame.

Portrait app configuration does not guarantee portrait sensor buffers. V5
[orientation metadata](https://visioncamera.margelo.com/docs/orientation) and
front-camera mirroring need explicit interpretation. The investigated
[iOS detector](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/ios/HybridFaceDetector.swift)
swaps landscape dimensions when constructing its processing configuration;
test bounds, left/right eyes, and pitch/yaw/roll signs against the chosen
version instead of changing setup tolerances to hide a coordinate mismatch.

## Prerequisites and acceptance gates

1. **Freeze the candidate source.** Record exact resolved camera, detector,
   Nitro, Nitro Image, worklets, React/RN, Expo and Babel versions, tarball
   integrity, and upstream tags/commits. Follow [Expo's upgrade guidance](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)
   for any required SDK change; align its dependency set rather than forcing
   peer overrides. Keep unrelated major updates out of this migration.
2. **Review native integration.** Inspect both platforms' native dependencies,
   generated Nitro registration, supported OS/architecture requirements and
   autolinking. The investigated [v2 podspec](https://github.com/luicfrr/react-native-vision-camera-face-detector/blob/v2.0.0/VisionCameraFaceDetector.podspec)
   requests GoogleMLKit/FaceDetection 8.0.0 and iOS 15.5; verify actual resolved
   Pods/Gradle artifacts, privacy manifests and SDK data behavior in the new
   binary. The README's iOS 26 ARM64 simulator warning requires a candidate
   archive/platform check; JavaScript typechecking cannot resolve it.
3. **Implement one guarded adapter.** Keep the v4 baseline on main while the
   candidate branch and binary are evaluated. Use a development flag for any
   experimental detection/export behavior and separate pipeline provenance.
   A JavaScript flag cannot switch the installed native module between v4 and
   v5; compare separate baseline/candidate binaries until promotion. Test
   hybrid-method binding, numeric payloads, option mapping, largest-face choice, missing values,
   orientation/dimensions, throttle/drop behavior and exactly-once disposal.
   Exercise stop, unmount, camera recovery and overlapping session generations
   with in-flight work; stale callbacks must never restart alerts or sync.
4. **Verify the actual toolchain.** Use Node 24 and clean root/native installs,
   including the EAS npm 10.9.8 install path, then run both verification suites
   and Expo dependency checks/doctor. Retain Watch connectivity patches,
   iOS Watch linking and Android Watch exclusion. Add regressions for the new
   camera stack instead of disabling existing audits or compatibility tests.
5. **Build and test an exact native candidate when authorized.** Camera native
   module changes require a new binary; Expo Go and an OTA JavaScript update
   cannot demonstrate compatibility. Record binary/source identity for iOS
   and Android separately. Test permission denial/restoration, front-camera
   start/stop/restart, parked camera checks, physical rotation with the portrait
   UI, background/lock/call interruption and mount/lighting/eyewear conditions.
   Include any supported rear-camera parked check without enabling rear-camera
   monitoring. Follow [DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md), including
   its 30-/60-minute tracking, battery, heat, memory and alert-perception checks.
6. **Attach comparison evidence before promotion.** Compare both pipelines on
   the same authorized, labeled input and event timelines; record usable
   tracking coverage, missing eyes, event recall/false alerts, latency and load
   by device/condition. Existing [EAR benchmarking](ACCURACY_BENCHMARK.md) does
   not validate ML Kit probabilities or native camera lifecycle. The
   [event scorer](EVENT_BENCHMARK.md) needs compatible exports and independent
   labels; it does not itself execute either detector. Keep samples local and
   exclude personal media/raw motion from fleet reporting. Preserve thresholds
   during the comparison and document differences rather than tuning them away.

## Release and rollback decision

Advance only with a reviewed compatibility set, passing automated checks,
recorded exact-build device acceptance, and benchmark evidence adequate for
the intended supported devices. Open failures must have an affected version,
owner and retest result; do not claim orientation readiness from a release
title or an issue's closure. Update release notes and pipeline provenance when
promoting. Restore the complete prior dependency lockfile, adapter and native
binary together if needed; an old JavaScript bundle cannot restore v4 native
modules inside a v5 binary.

Pending work remains candidate selection, implementation, native compilation,
physical testing and labeled comparison. This document performs none of those
steps and authorizes no EAS build or public distribution.
