# Occulert device roadmap, 2026–2028

**Duo readiness update: October 24, 2026.** Other planning findings retain their
October 19 verification date. Planning windows are conditional, not release
commitments. Hardware announcements, developer access, implemented
source, installed builds and physical acceptance are separate evidence.

## Product direction and current baseline

The phone-camera product remains useful by itself. Watches, headphones and
glasses are optional additions; a missing accessory never suppresses the
released camera alert policy. A future corroboration policy is an experiment,
not a requirement to introduce into current alerts.

The native app already exists. It uses **VisionCamera and ML Kit eye
probabilities/PERCLOS**; the browser uses MediaPipe landmarks/EAR. VisionCamera
is not Apple's Vision framework. Share event definitions, fixtures and evidence
requirements across these pipelines; do not promise identical raw measurements
or a single camera implementation. See [native implementation](../native-app/README.md)
and [product contracts](APP_ROADMAP.md).

Source already includes a Watch alert companion, optional read-only HealthKit
sleep/HRV context, compatible-headphone motion diagnostics and aggregate sensor
coincidence observations. Those observations do not influence scores, alerts or
cloud payloads. A source merge does not update TestFlight or establish device
acceptance. Build 56 availability is a dated historical record, not proof of the
latest source's installation; consult [Status](STATUS.md).

## Verified claims and remaining boundaries

| Item | Verified finding | Development boundary |
|---|---|---|
| iPhone Duo | Released October 23, 2026; Apple's announcement records that availability date. [Apple announcement](https://www.apple.com/newsroom/2026/09/apple-unveils-iphone-duo/) | Folded is the supported driving-mode policy. Occulert device acceptance remains pending; no accuracy or side-by-side monitoring claim. |
| Duo front camera | A front-camera selection can be a virtual device whose active physical camera changes with the display in use. Read the active constituent rather than treating a stable virtual device ID as a stable camera. [Apple camera guidance](https://developer.apple.com/documentation/avkit/choosing-a-camera-by-the-direction-it-faces) | Record outer/inner/unknown identity locally. Setup and experimental eye-baseline evidence from one physical camera must not silently carry over to another. |
| Duo layout | Apple documents side-by-side use and a 50/50 split. [Design talk](https://developer.apple.com/videos/play/tech-talks/111466/?time=120), [layout guidance](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo) | Use adaptive widths and size classes. The input's 313/445-point examples are test cases, not fixed layout constants or verified camera dimensions. |
| Watch Ultra 4 | Apple describes five-second background heart-rate sampling and HRV as often as every five minutes. [Apple health announcement](https://www.apple.com/newsroom/2026/09/apple-advances-health-and-fitness-capabilities-using-apple-intelligence/) | Hardware sampling does not establish third-party delivery cadence, freshness or continuous HRV access. |
| AirPods Pro 3 | Apple supports heart-rate measurement with at least one AirPod during supported workouts, with the relevant permissions. [Apple Support](https://support.apple.com/en-us/123184) | This does not establish continuous heart-rate availability during driving. One-ear HR support also does not prove one-ear motion support or local driving legality. |
| Headphone motion | Apple's public manager supports motion-capable headphones and requires availability/authorization checks. [Core Motion](https://developer.apple.com/documentation/coremotion/cmheadphonemotionmanager) | Test exact devices, single-ear behavior, delivered cadence, disconnects and permission denial; preserve camera-only operation. |
| Meta glasses | Meta's FAQ says Device Access Toolkit 1.0 began rolling out September 30, 2026, with motion/IMU and other capabilities, varying by device and market. [Meta FAQ](https://developers.meta.com/wearables/faq/) | Replace the input's preview-only assumption. API access does not establish sufficient sampling, phone compatibility, permitted use or eye tracking. |
| Samsung eyewear | Samsung's July 22 announcement confirms Android XR eyewear; its compatibility note specifies a compatible Samsung Galaxy AI phone. [Samsung announcement](https://news.samsung.com/us/samsung-galaxy-ecosystem-everyday-eyewear/) | iPhone pairing and an accessible head-motion API are not established by this source. Do not make them iPhone roadmap dependencies. |
| Future Apple glasses | No verified announcement or accessible SDK was established in this review. | Keep proposed release dates, prices and eye-tracking capability speculative; no purchase or implementation dependency. |

No universal front-camera resolution, frame-rate, depth or low-light guarantee
is adopted from the input. Measure the selected device, camera and capture
configuration. Apple exposes a [multitasking camera capability check](https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccesssupported);
its existence does not establish Safari/PWA behavior or Occulert support.

## iPhone Duo driving-mode policy and acceptance

**Folded is the supported driving mode.** This is the product policy, not a
completed device-acceptance result. No physical Duo is available for this
revision, and native, Safari and home-screen PWA behavior remain unverified on
that device. The unfolded inner camera is treated as lower confidence and is
untested at night. Split View beside Maps is reserved for an off-by-default
experiment, not advertised monitoring support.

Hardware-access check, October 24: Apple's [Cupertino Duo workshop](https://developer.apple.com/events/view/RQJY598JC6/dashboard)
was October 13–14 and registration is closed. No future Bay Area hands-on Duo
session was confirmed in this check; consult Apple's [upcoming workshops](https://developer.apple.com/events/view/upcoming-events?formats=inperson&topics=iphone-duo)
before considering a test-phone purchase. No registration or purchase is part
of this readiness work.

Parked setup on the inner camera should ask the driver to fold the phone before
starting. A switch while monitoring should keep monitoring, clear the optional
experimental eye baseline, and give one notice plus an inner-camera status line.
These are readiness implementation requirements, not claims that the installed
TestFlight build already implements them. Preserve released alert thresholds;
if monitoring is actually lost, stop visibly under the existing recovery policy.

Before making Duo support claims, record the exact source, installed build, OS
and physical camera for parked testing under [Device acceptance](DEVICE_ACCEPTANCE.md):

- Camera identity, fold/unfold frame gaps, face orientation and switch notices.
- Folded/inner-camera night comparison and the same-phone heat/capture benchmark.
- Sustained folded monitoring in the intended mount, including sun and shade.
- Full-screen versus Split View interruption reasons, camera capability and audio
  over Maps; do not enable capture where the system reports it unsupported.
- Safari and home-screen PWA resize, stale-calibration guidance and track recovery.
- Watch delivery and audio routes after a new SDK 58 build, plus outer/inner
  screenshots. Simulator layout evidence cannot establish camera or thermal behavior.

## Phase 1: phone reliability and compact layout — now to February 2027

1. Finish exact-build acceptance of the existing native app: startup, tracking,
   calibration, interruptions, audio routes, Watch delivery, History and consent.
2. Prepare an adaptive compact view that emphasizes monitoring state and alerts.
   Keep setup, feedback and diagnostic interaction parked. Test narrow widths,
   large text and orientation changes without hiding stop/recovery controls.
3. With Duo now released, test native and Safari/home-screen PWA separately
   alongside Maps or another app. Record foreground state, camera interruptions,
   physical camera identity, thermal behavior and alert delivery. Stop visibly
   on lost monitoring; do not force capture through unsupported system states.
4. Compare native and browser event behavior using the existing
   [event benchmark](EVENT_BENCHMARK.md) and [accuracy protocol](ACCURACY_BENCHMARK.md),
   accounting for different input signals. Numeric EAR equality is not a native
   ML Kit acceptance criterion.

**Gate:** reproducible exact-device evidence for advertised multi-app behavior,
plus independently labeled event evaluation. Record limitations when a mode
cannot maintain capture; a compact layout alone does not close this gate.

## Phase 2: Watch reliability and optional physiology — March to May 2027

Improve the existing companion's opt-in delivery and recovery first. Test
supported Series/Ultra models by capability rather than requiring Ultra 4.
Investigate permission, sample timestamps, delayed/missing HRV and HealthKit
availability separately from Watch connectivity and notification delivery.

Do not automatically record a drive as a workout to obtain more samples.
Apple describes [workout sessions](https://developer.apple.com/documentation/healthkit/hkworkoutsession)
as workout tracking, with activity-specific sensor behavior and one active
Watch workout at a time. A suitable driving use and its App Review/privacy
acceptability remain unresolved; review the [Health and Health Research rules](https://developer.apple.com/app-store/review/guidelines/#health-and-health-research)
before selecting any collection design. This is an Occulert implementation
gate, not a finding that Apple has approved or categorically prohibited it.

**Gate:** exact-build delivery evidence and permitted, consented physiological
access with measured freshness/coverage. Associations between HRV and camera
events alone do not validate fatigue detection or justify changing alerts.

## Phase 3: headphone motion and audio — June to August 2027

Extend the existing observation-only module. Validate candidate nods against
independent labels and camera observations; count missing coverage and false
coincidences. Evaluate phone speaker, car audio and single-earbud delivery.
Keep the centered alert default for single-ear use; the optional stereo pattern
requires its own physical acceptance.

Treat AirPods heart-rate access as a separate feasibility item, conditional on
the Phase 2 collection review. Do not make it a fallback that requires a
workout session or fabricate a reading when the Watch is absent.

**Gate:** measured motion availability, candidate quality and reliable audio on
the installed build. Sensor fusion stays off by default until a reviewed
experiment compares false alerts, missed events, latency and coverage against
the camera baseline on held-out, independently labeled data. Two agreeing
signals are not automatically independent evidence.

## Phase 4: glasses feasibility — late 2027 to 2028

Start with an SDK/device/phone capability matrix. Meta's current public toolkit
is a concrete feasibility candidate; Samsung/iPhone access remains unverified.
Establish head-motion timestamps, delivered sample rate, transport delay,
permissions, audio routing and disconnect behavior before a parked prototype.

Outward-facing camera access is not inward eye tracking. Do not add glasses
PERCLOS or driver-eye claims without a verified inward-facing API. Do not
collect outward video merely to obtain head motion.

**Gate:** documented permitted APIs plus exact-device measurements sufficient
for the proposed signal. Only then schedule implementation; do not tie core
phone releases to a future glasses launch.

## Immediate decisions and evidence to collect

- **Next engineering step:** exact-build phone/Watch acceptance using
  [Device acceptance](DEVICE_ACCEPTANCE.md), followed by compact-layout work.
  Preserve the current standalone phone alerts and optional consent model.
- **Patent:** obtain the actual filing receipt privately and have a registered
  practitioner confirm dates and scope. USPTO describes a normal 12-month
  provisional benefit window, with limited restoration procedures; this
  roadmap's publication date cannot establish a filing deadline or coverage of
  Duo/glasses ideas. [USPTO guidance](https://www.uspto.gov/patents/basics/apply/provisional-application)
- **Local law:** the input's California one-touch and earphone interpretations
  were not independently confirmed in this pass because the statute pages
  were unavailable. Verify applicable current law and fleet policy before
  publishing those claims; parked setup/review remains the product rule.
- **Budget:** the phone-only Core kit is complete. Wearables remain optional.
  Replace sale prices and summed kit costs with dated quotes when a purchase
  is actually considered; no new hardware purchase is authorized by this plan.
- **Evidence:** use consenting participants and the existing parked testing
  protocols. Do not induce fatigue during road driving. Preserve source,
  installed-build, device and labeled-data evidence separately; no accuracy or
  crash-prevention claims follow from correlations or logged counts alone.

This revision changes planning documentation only. It enables no sensor,
HealthKit write, new collection, scoring policy or alert suppression.
