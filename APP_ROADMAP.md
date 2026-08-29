# Occulert App Roadmap

This document outlines the full multi-phase development plan for Occulert — expanding from a browser-based PWA into a cross-platform native app with multi-device hardware integration.

★ = top-priority milestone for each phase

**Last updated: 2026-08-28** — statuses distinguish shipped production work,
current development source, and physical-device validation. See
`ACCURACY_BENCHMARK.md`, `BETA_TEST_PLAN.md`, `SAFE_STOP_HANDOFF.md`, and issue
#6 for the remaining evidence and product gaps.

## Current milestone · Alerts, Fleet performance, and manager reporting

This milestone is developed and reviewed as one work package. It does not
queue a native build or publish the website by itself.

| Workstream | Source status | Remaining evidence |
|---|---|---|
| Stronger phone and headphone alert delivery | Bounded two-cue standard and three-cue critical sequences implemented; explicit audio and haptic preferences remain authoritative | Physical speaker, AirPods / Bluetooth, car-audio, and interruption testing |
| Stronger Apple Watch alerts | Severity-specific foreground haptics, time-sensitive background notification copy, and a more prominent latest-alert card implemented | Physical Watch foreground, background, locked-screen, and notification-settings testing |
| Native visual cleanup | Shared neutral material tokens, calmer depth, simpler headers, and less technical Settings copy implemented | Simulator and physical-device visual review, including larger text and reduced transparency |
| Website visual cleanup | Shared Apple-inspired material hierarchy implemented across public, sign-in, Account, and fleet surfaces and verified in production | Optional signed-in visual acceptance with a populated protected fleet |
| Fleet Dashboard performance | Driver-only filter rendering, hidden-tab polling pause, protected-request single-flight guard, and clearer mobile driver hierarchy verified in production | Optional signed-in populated-fleet acceptance |
| Fleet manager reporting | 7/30-day pilot scorecard, privacy-limited report export, driver-specific action queue, and paid-rollout lead attribution implemented in source | Signed-in Preview verified for owner scoping, a two-driver no-session fleet, and both reporting windows; production verification after merge remains pending. Nonzero results passed automated browser coverage; pricing and plan entitlements remain separate work |

Safety boundary: stronger alerts are intended to get attention and prompt a
safe stop. They cannot wake every driver, keep a drowsy driver safely awake, or
make it safe to continue driving. Critical alert output remains short and
bounded, and the existing cooldown remains in force.

---

## Phase 0 · Foundation

**Goal:** Lock in accuracy, safety credibility, and an early real-world pilot before hardware expansion.

| Task | Priority | Status |
|------|----------|--------|
| Validate detection accuracy against ground-truth drowsiness data | ★ | Pilot feedback capture ready; formal dataset validation not started |
| Add user-controlled sensitivity slider (low / medium / high) | — | Done |
| Capture structured correct / false / missed alert feedback | — | Done in private TestFlight build 13 |
| Audit background reliability (screen-off, app-backgrounded) | — | Partial |
| Offer a safe-stop Maps handoff after a confirmed alert | — | Implemented in source; physical-device verification pending |
| Land a pilot fleet (rideshare, delivery, or trucking partner) | ★ | Not started |
| Tighten safety disclaimers and credibility documentation | — | Done |

The safe-stop handoff offers rest-area, gas-station, and food/coffee searches.
It stops and saves the foreground camera session before opening Maps, does not
add GPS collection, and must only be used after parking or by a passenger. See
`SAFE_STOP_HANDOFF.md` for the exact boundary and validation checklist.

---

## Phase 1 · Earbuds

**Goal:** Use paired Bluetooth earbuds as a low-friction wearable input and alert layer.

| Task | Priority | Status |
|------|----------|--------|
| Head-nod / head-drop detection via earbud accelerometer | ★ | Local-only compatible-headphone motion diagnostics implemented in source; device calibration not started |
| In-ear heart rate and HRV monitoring (where supported) | — | Not started |
| Directional in-ear audio alerts (left/right/stereo cues) | ★ | Opt-in alternating stereo emphasis plus bounded severity repeats implemented in source; device verification pending |
| Auto-detect paired earbuds and graceful fallback to phone speaker | — | Done |

Note: AirPods audio routing shipped in native-app (PR #2), covering
auto-detect/fallback. Current source can read processed motion from compatible
Apple headphones during foreground monitoring and save only aggregate candidate
observations locally. It does not change scores or alerts. Directional audio is
independent: the centered default remains, with opt-in alternating left/right
emphasis for non-critical alerts. Standard and critical outputs now use short,
bounded repeats on every enabled audio route. Real-device calibration,
stereo-earbud verification, and audio-interruption testing remain open.

---

## Phase 2 · Smartwatch

**Goal:** Pull biometric data from the wrist and surface pre-drive risk scoring.

| Task | Priority | Status |
|------|----------|--------|
| Pull HRV and sleep data from Apple Health / Google Fit | — | Apple Health read-only foundation implemented in source; Android not started |
| Pre-drive fatigue risk score shown before each trip | ★ | Factual local sleep/HRV context implemented in source; scoring intentionally deferred |
| Wrist haptic alert when fatigue threshold is crossed | — | Baseline verified in private TestFlight build 15; stronger severity sequence implemented in current source and awaiting device verification |
| Watch-face widget showing live safety score | — | Live in-app Watch status implemented in source; watch-face complication not started |

Note: the packaged watchOS companion, live and queued WatchConnectivity
alert delivery, direct test control, and baseline wrist haptics passed a real
iPhone/Apple Watch check in private TestFlight build 15. Current source also
mirrors a privacy-safe live monitoring snapshot—fatigue score, PERCLOS,
tracking state, and session time—into the Watch app and visibly expires the
snapshot when phone updates stop. The current milestone adds severity-specific
foreground haptics, a time-sensitive background notification, and clearer
pull-over guidance without changing detection. These status updates do not
change scoring or cloud data. The Apple Health foundation remains read-only,
local-only, and informational. A validated pre-drive score and true Watch-face
complication remain separate future work.

---

## Phase 3 · Fusion + Fleet

**Goal:** Combine all sensor streams into one confidence model and scale to fleets.

| Task | Priority | Status |
|------|----------|--------|
| Unified confidence model fusing camera + earbud + watch signals | ★ | Not started |
| Device-agnostic engine (works with any combination of devices) | — | Not started |
| Fleet dashboard with per-driver device and signal data | — | Protected session history, mobile hierarchy, and hidden-tab performance are production-verified; 7/30-day pilot value reporting, privacy-limited CSV export, driver-specific follow-up actions, and the paid-rollout lead path are implemented in source and verified in a signed-in Preview for a two-driver fleet with no recorded sessions. Nonzero results passed automated browser coverage; production verification remains pending |
| Tiered pricing model for fleet operators | — | Not started |

---

## Phase 4 · Smart Glasses

**Goal:** Add ambient audio alerts and inward eye-tracking via smart glasses.

| Task | Priority | Status |
|------|----------|--------|
| Open-ear audio alerts via glasses speaker (Ray-Ban Meta, etc.) | — | Not started |
| Inward eye-tracking integration (gaze, blink rate, saccades) | ★ | Not started |
| Evaluate and track smart glasses SDKs (Meta, Snap, others) | — | Not started |

---

## Platform

**Goal:** Deliver native apps while keeping the PWA as the top-of-funnel entry point.

| Task | Priority | Status |
|------|----------|--------|
| Native iOS app (Swift / React Native) | ★ | Private TestFlight pilot; current source is ahead of the last physically verified accessory build |
| Native Android app | — | Not started |
| Keep PWA as lightweight onboarding funnel | — | Done |
| Verify real-time sensor access per platform (camera, motion, BT) | ★ | Partial (camera and Watch alerts verified; compatible-headphone motion bridge implemented but not device-calibrated) |
| Preserve and enforce privacy-first promise across all platforms | — | Ongoing |

---

## Milestone Summary

| Phase | Focus | Key Milestones | Status |
|-------|-------|------------------|--------|
| 0 · Foundation | Accuracy & pilots | Detection validation, safe-stop handoff, pilot fleet | Partial (handoff implemented; formal benchmark and pilot partner pending) |
| 1 · Earbuds | Head & heart signals | Head-nod detection, directional alerts | Partial (routing, directional/repeated cues, and local motion diagnostics implemented; physical calibration remains open) |
| 2 · Smartwatch | Biometric pre-screening | Pre-drive risk score | Partial (live status and stronger alerts implemented; device revalidation, pre-drive score, and complication remain open) |
| 3 · Fusion + Fleet | Multi-signal model | Unified confidence engine | Partial (protected fleet history and dashboard performance work implemented; fusion not started) |
| 4 · Smart Glasses | Ambient + eye tracking | Inward eye-tracking | Not started |
| Platform | Native apps | iOS app, real-time sensor access | Private iOS pilot |

For the current detailed gap list and near/mid/long-term breakdown, see issue #6.

## Release path for this milestone

1. Complete automated, responsive-browser, native type, and static Watch checks.
2. Open one draft pull request only after explicit approval.
3. Perform a focused review of the complete draft pull request diff.
4. Repair any findings in the draft, rerun validation, and repeat the focused
   review until no actionable findings remain.
5. Mark the pull request ready, complete the final review, and merge only at
   their separately approved gates; keep physical
   Watch, headphone, camera, and car-audio evidence labeled separately.
6. Verify the merged website in production. Queue a native build only after a
   fresh build-capacity check and separate approval.

Built by Richard Pacheco — San Francisco, CA
Occulert™ · Safety should be accessible.
