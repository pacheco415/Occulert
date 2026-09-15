# Occulert Performance Roadmap

Last updated: 2026-09-01

This roadmap separates source optimizations from physical-device, live-service,
and accuracy evidence. A green source check means the implementation is ready
for review; it does not establish battery life, production latency, detection
accuracy, or safe real-world behavior.

## Current source package

| Area | Implemented upgrade | Safety and privacy boundary |
|---|---|---|
| Native monitoring | Keeps the 100 ms analysis cadence, records bounded inference timing, refreshes display-only metrics at most every 250 ms, and moves the one-second clock into a memoized child | Alert-state changes still update immediately; frames and timing samples stay on device |
| Web monitoring | Loads MediaPipe only after Start, rejects overlapping inference, and exposes a bounded local timing snapshot | Camera processing remains local; the snapshot contains counts and durations only |
| Web startup | Removes the eager MediaPipe request and lazy-loads the hidden install-logo image | No behavior or consent default changes |
| Fleet API | Runs driver and session reads concurrently, optionally skips event history, and returns `Server-Timing` durations | Existing owner verification and privacy-limited field selection remain unchanged |
| Fleet dashboard | Keeps the existing 30-second refresh while a session is active, shifts idle dashboards to 90 seconds, backs off after failures, updates relative-time labels every 15 seconds, and limits open history-event refreshes to every two minutes | Active manager visibility is unchanged; protected and local fallback data remain separate; GPS and personal media stay excluded |
| Native cloud sync | Reuses the verified SecureStore auth value in memory and deduplicates its initial read | Token writes refresh the cache; sign-out clears it before local deletion/revocation |
| Native alert delivery | Preloads confirmed haptic, audio, in-ear, and Watch preferences before monitoring so alert cues do not wait for storage reads | Detection thresholds, cooldowns, cue plans, and user-confirmed settings remain unchanged |
| Optional headphone motion | Starts observation-only headphone motion without delaying camera activation | Late accessory results are discarded after cancellation; headphone data never changes scores or alerts |
| Device evidence | Saves aggregate first-sample, inference, cadence, UI-rate, and stall measurements in the local session record | No frames are saved or uploaded; measurements are evidence, not accuracy claims |
| Parked camera setup | Reuses the on-device face detector in an optional preview to guide framing, mount angle, and eye visibility at no more than four interface updates per second | Setup samples return before fatigue scoring and alert delivery; no frames or setup samples are stored |
| Interrupted-session recovery | Writes a serialized local summary checkpoint every 15 seconds and converts a recent interrupted checkpoint into a clearly labeled partial Session History record | Checkpoints contain aggregate session values only; normal completion clears the matching checkpoint and recovered records are never presented as complete cloud sessions |
| Connected-device readiness | Refreshes independent Watch preference, Watch status, and headphone-motion status reads concurrently behind a single-flight control | Primary phone alerts remain independent of optional accessory availability |
| Build reproducibility | Pins the production profile to the validated SDK 57/Xcode 26.6 EAS image | Queueing, TestFlight submission, and device validation remain separate gates |
| Regression coverage | Adds deterministic timing, cadence, lazy-loading, overlap, and conditional-history contracts to `npm run verify` | Tests establish code contracts, not physical-device performance |

## Performance budgets

These are acceptance targets, not measured production claims.

| Signal | Target | Evidence required |
|---|---:|---|
| Native analysis cadence | One eligible sample every 100 ms | Timing snapshot plus a 30-minute physical iPhone run |
| Native display refresh | At most 4 routine updates per second | Automated contract and simulator profiler |
| Native first camera sample | Record the exact delay without a source-only pass claim | Local session record from the exact tested native build on each iPhone |
| Native p95 inference | Below the 100 ms analysis budget | Supported physical iPhone, day/night and eyewear slices |
| Web overlapping inference | Zero concurrent sends | Automated contract plus Safari and Chrome camera runs |
| Web p95 inference | Below the 135 ms browser analysis interval | Supported iPhone Safari and Android Chrome |
| Fleet roster API p95 | Under 750 ms for the agreed pilot fleet size | Authenticated Preview and production timing samples |
| Fleet event query | No query while protected history is closed | API contract and browser request trace |
| Idle fleet refresh | At most one protected summary request every 90 seconds | Automated policy contract and authenticated browser trace |
| Thermal and battery | No thermal shutdown or safety-loop stall during a 30-minute session | Physical-device log with model, OS, battery delta, and ambient conditions |

## Verification sequence

1. Run the full source and browser suites.
2. Review the complete performance diff for alert, privacy, authentication, and
   accessibility regressions.
3. After separate approval, open a draft pull request and validate an
   authenticated Preview with an owner-scoped fleet.
4. Run the physical iPhone, Safari, Chrome, Watch, headphone, and car-audio
   matrix. Record timing, temperature, battery delta, foreground-loss behavior,
   and visible alerts for the exact tested build.
5. After merge and deployment approvals, repeat public and signed-in production
   checks. Do not substitute Preview or device results for production evidence.

## Evidence still blocked or external

- Detection accuracy still needs an authorized labeled dataset and the
  participant-safe workflow in `ACCURACY_BENCHMARK.md`. No accuracy percentage
  is claimed by this performance work.
- Battery, thermal, camera, Watch, headphone, and car-audio results require a
  physical build and devices.
- Camera-setup framing and interrupted-session recovery require physical
  preview plus force-quit/relaunch checks on the exact native build.
- Production fleet latency requires a signed-in owner and an agreed read-only
  dataset size.
- Exact 96 px, 192 px, and 512 px exports now serve browser shortcuts and PWA
  install metadata; the original high-resolution logo remains available for
  social previews and brand use.
- Pricing, billing activation, plan entitlements, push, pull request, merge,
  deployment, and native-build submission remain separate approval gates.

## Later scaling work

After pilot evidence establishes real bottlenecks, consider cursor-based fleet
history, precomputed fleet aggregates, native background retry with server-side
idempotency keys, and bundle splitting for optional driver tools. These should
not be added before their failure modes and privacy contracts are defined.
