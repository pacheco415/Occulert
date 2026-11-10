# Native capture-load experiment

Prepared October 24, 2026. **Off by default. No parked heat or accuracy benchmark
has been performed, and no physical Duo is available.** Keep the released
capture defaults until the same-iPhone before/after acceptance below passes.

An explicit development build with
`EXPO_PUBLIC_CAPTURE_LOAD_EXPERIMENT=1` enables this experiment. Other values,
including an absent flag, leave the actual native Camera props without a new
`format` or `fps` override. The current device, YUV pixel format, frame processor,
preview mode, error handling and callbacks pass through unchanged.

## Selection and fallback

`MonitorCaptureCamera` uses the installed VisionCamera 4.7.3 `useCameraFormat`
hook with one prevalidated candidate. The hook's filters are preference scores;
its [implementation](https://github.com/margelo/react-native-vision-camera/blob/v4.7.3/package/src/devices/getCameraFormat.ts)
does not enforce a minimum resolution or `minFps`. The candidate therefore must
have finite video dimensions at least **1280 × 720** (orientation normalized)
and a frame-rate range containing **both 15 and 30**. The smallest video area
wins, with dimension/range tie breakers. The real device object goes to Camera;
only the hook receives a copy restricted to that candidate.

Normal load requests 30 fps. Reduced load requests 15 fps on the same format;
critical heat keeps the existing visible-stop policy. A device with no eligible
format, including a 30-only format, receives no format/fps override. Existing
analysis throttling and critical-heat stopping still apply. The fallback is
recorded as unavailable, without inventing the native default dimensions or fps.
No detection thresholds, scoring, alert content or cue timing change.

## Watchdog and local diagnostics

The existing 5-second sample-stall timeout and 10-second startup grace remain.
A configuration change may extend the original sample-stall deadline by at most
**2 seconds**, provided the stream was not already stalled. The fixed deadline
is `max(change time, last sample + stall timeout) + 2000 ms`: a change immediately
after a healthy frame sets a seven-second total frame-gap deadline, checked by
the existing 500-ms watchdog.
The first configuration and a camera with no samples receive no added grace.
Repeated thermal/format changes during the same frame gap cannot renew this
deadline, even after it expires. A new sample permits a later independent
transition. A frame arriving during grace clears it. Configuration changes never
advance the sample clock, change the camera key, remount the camera or spend the
one automatic recovery. Real stalls
after the deadline retain that existing recovery and then visible stop; native
camera errors retain their existing immediate handling.

`monitorPerformance.captureLoad` is optional and local only. It records selected
width/height, requested fps, availability, configuration-change count,
unavailable-configuration count and granted-grace count as finite nonnegative
numbers. It has fixed shape, contains no device IDs, frames or sample history,
and passes the existing interrupted-drive checkpoint validator. These are
requested configuration diagnostics, not proof of delivered native fps. The
cloud completion whitelist is unchanged. Older/flag-off sessions keep their
previous snapshot shape.

## Road-stream load policy preparation — November 1, 2026

[Task 3.2](VISION_ROADMAP.md#task-32--road-stream-load-policy) adds the pure
`deriveRoadStreamLoadPolicy` helper in
[`captureLoadPolicy.ts`](../native-app/lib/captureLoadPolicy.ts). It has no
runtime consumer. Neither the existing capture experiment flag nor an ordinary
drive enables road capture through this addition.

The helper proposes **5 fps for evaluation only**, with an explicit
`evaluationRequested: true` and known `nominal`/`fair` thermal and pressure
conditions. This is a requested evaluation rate, not proof of a supported
capture format, delivered fps or road-model performance. Absent, false or
malformed requests return `disabled` and zero requested road fps.

For a requested evaluation, `serious`/`critical` heat or
`serious`/`critical`/`shutdown` system pressure returns `driverOnlyFallback` and
zero requested road fps. Unknown or malformed conditions fail closed to the
same recommendation. An explicit `fallbackLatched: true` keeps road disabled
through subsequent cooling; malformed latch values also fail closed. The helper
stores no state: a future session owner must retain that latch after a fallback
and clear it only for a new parked session.

`driverOnlyFallback` retains the parked diagnostic's road-first meaning. Here
it is only a load recommendation: it does not assert that driver frames are
healthy or authorize continued capture during critical heat. Current driver
capture, 100/200 ms analysis, watchdog and critical-heat stop policies retain
their existing behavior. The helper returns no driver settings and changes no
camera props, lifecycle, flags, permissions, History or cloud fields.

The [road-camera architecture decision](ROAD_CAMERA_ARCHITECTURE.md) still
requires a separately selected integration, exact device/pair/format admission,
reliable identity/posture evidence and fresh same-session pressure observations.
The load helper cannot detect stale observations or establish these gates; a
cached configuration probe or diagnostic peak-pressure label is not live
monitoring evidence. A future owner must actually disable rear streaming on
fallback, not only skip inference, and preserve visible driver-loss handling.
No camera migration, road capture or physical acceptance is performed here.

## Acceptance still required

Use consenting participants while parked, following the
[event benchmark](EVENT_BENCHMARK.md), [accuracy protocol](ACCURACY_BENCHMARK.md)
and [device checklist](DEVICE_ACCEPTANCE.md). Compare flag-off and flag-on builds
on the **same iPhone**, OS, physical camera, mount, lighting and labeled actions.
Include normal/reduced/critical heat, frame delivery through 30↔15 changes,
actual selected format and delivered fps, inference timing, missed/false events,
low light, orientation and camera switches, audio/Watch delivery, energy and a
long parked heat run. Record warm-up/order and ambient conditions. Show no
detection regression before enabling this capture policy beyond an experiment.

Automated selection, mounted Camera-prop and actual screen-watchdog fixtures
are regression evidence. They substitute the native camera and cannot prove
lower heat, capture delivery, accuracy or physical-Duo behavior. No such result
or release claim follows from this source preparation.

Local validation on Node 24.22.1: native clean install with npm 10.9.8 and native
verification passed (dependency alignment, TypeScript and all 62 tests, including
12 capture tests). Root clean install and all 90 verification tasks passed.
Independent source review found no blocker. Hosted CI and native runtime/device
acceptance remain separate gates.
