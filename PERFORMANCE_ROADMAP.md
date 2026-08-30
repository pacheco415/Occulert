# Occulert Performance Roadmap

Last updated: 2026-08-29

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
| Fleet dashboard | Uses lightweight 30-second roster refreshes and fetches events when protected history is opened or remains open | Protected and local fallback data remain separate; GPS and personal media stay excluded |
| Native cloud sync | Reuses the verified SecureStore auth value in memory and deduplicates its initial read | Token writes refresh the cache; sign-out clears it before local deletion/revocation |
| Regression coverage | Adds deterministic timing, cadence, lazy-loading, overlap, and conditional-history contracts to `npm run verify` | Tests establish code contracts, not physical-device performance |

## Performance budgets

These are acceptance targets, not measured production claims.

| Signal | Target | Evidence required |
|---|---:|---|
| Native analysis cadence | One eligible sample every 100 ms | Timing snapshot plus a 30-minute physical iPhone run |
| Native display refresh | At most 4 routine updates per second | Automated contract and simulator profiler |
| Native p95 inference | Below the 100 ms analysis budget | Supported physical iPhone, day/night and eyewear slices |
| Web overlapping inference | Zero concurrent sends | Automated contract plus Safari and Chrome camera runs |
| Web p95 inference | Below the 135 ms browser analysis interval | Supported iPhone Safari and Android Chrome |
| Fleet roster API p95 | Under 750 ms for the agreed pilot fleet size | Authenticated Preview and production timing samples |
| Fleet event query | No query while protected history is closed | API contract and browser request trace |
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
- Production fleet latency requires a signed-in owner and an agreed read-only
  dataset size.
- The large source logo is no longer on the normal driver-page startup path,
  but a smaller pixel asset should come from an exact-brand export rather than
  an approximate redraw.
- Pricing, billing activation, plan entitlements, push, pull request, merge,
  deployment, and native-build submission remain separate approval gates.

## Later scaling work

After pilot evidence establishes real bottlenecks, consider cursor-based fleet
history, precomputed fleet aggregates, native background retry with server-side
idempotency keys, and bundle splitting for optional driver tools. These should
not be added before their failure modes and privacy contracts are defined.
