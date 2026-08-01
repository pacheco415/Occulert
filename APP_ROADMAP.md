# Occulert App Roadmap

This document outlines the full multi-phase development plan for Occulert — expanding from a browser-based PWA into a cross-platform native app with multi-device hardware integration.

★ = top-priority milestone for each phase

**Last updated: 2026-08-01** — statuses below reflect private TestFlight build
20 and the current development source. See `ACCURACY_BENCHMARK.md`, `BETA_TEST_PLAN.md`,
and issue #6 for the remaining validation and product gaps.

---

## Phase 0 · Foundation

**Goal:** Lock in accuracy, safety credibility, and an early real-world pilot before hardware expansion.

| Task | Priority | Status |
|------|----------|--------|
| Validate detection accuracy against ground-truth drowsiness data | ★ | Pilot feedback capture ready; formal dataset validation not started |
| Add user-controlled sensitivity slider (low / medium / high) | — | Done |
| Capture structured correct / false / missed alert feedback | — | Done in private TestFlight build 13 |
| Audit background reliability (screen-off, app-backgrounded) | — | Partial |
| Land a pilot fleet (rideshare, delivery, or trucking partner) | ★ | Not started |
| Tighten safety disclaimers and credibility documentation | — | Done |

---

## Phase 1 · Earbuds

**Goal:** Use paired Bluetooth earbuds as a low-friction wearable input and alert layer.

| Task | Priority | Status |
|------|----------|--------|
| Head-nod / head-drop detection via earbud accelerometer | ★ | Local-only compatible-headphone motion diagnostics implemented in source; device calibration not started |
| In-ear heart rate and HRV monitoring (where supported) | — | Not started |
| Directional in-ear audio alerts (left/right/stereo cues) | ★ | Opt-in alternating stereo emphasis implemented in source; device verification pending |
| Auto-detect paired earbuds and graceful fallback to phone speaker | — | Done |

Note: AirPods audio routing shipped in native-app (PR #2), covering
auto-detect/fallback. Current source can read processed motion from compatible
Apple headphones during foreground monitoring and save only aggregate candidate
observations locally. It does not change scores or alerts. Directional audio is
independent: the centered default remains, with opt-in alternating left/right
emphasis for non-critical alerts. Real-device calibration and stereo-earbud
verification remain open.

---

## Phase 2 · Smartwatch

**Goal:** Pull biometric data from the wrist and surface pre-drive risk scoring.

| Task | Priority | Status |
|------|----------|--------|
| Pull HRV and sleep data from Apple Health / Google Fit | — | Apple Health read-only foundation implemented in source; Android not started |
| Pre-drive fatigue risk score shown before each trip | ★ | Factual local sleep/HRV context implemented in source; scoring intentionally deferred |
| Wrist haptic alert when fatigue threshold is crossed | — | Done in private TestFlight build 15 |
| Watch-face widget showing live safety score | — | Not started |

Note: the packaged watchOS companion, live and queued WatchConnectivity
delivery, direct test control, and wrist haptics passed a real iPhone/Apple
Watch check in private TestFlight build 15. The Apple Health foundation is
read-only, local-only, and informational; it does not alter alerts. A validated
pre-drive score and Watch complication remain separate future work.

---

## Phase 3 · Fusion + Fleet

**Goal:** Combine all sensor streams into one confidence model and scale to fleets.

| Task | Priority | Status |
|------|----------|--------|
| Unified confidence model fusing camera + earbud + watch signals | ★ | Not started |
| Device-agnostic engine (works with any combination of devices) | — | Not started |
| Fleet dashboard with per-driver device and signal data | — | Protected session and event history implemented in source with a local fallback; deployment verification pending |
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
| Native iOS app (Swift / React Native) | ★ | Private TestFlight pilot (build 20) |
| Native Android app | — | Not started |
| Keep PWA as lightweight onboarding funnel | — | Done |
| Verify real-time sensor access per platform (camera, motion, BT) | ★ | Partial (camera and Watch alerts verified; compatible-headphone motion bridge implemented but not device-calibrated) |
| Preserve and enforce privacy-first promise across all platforms | — | Ongoing |

---

## Milestone Summary

| Phase | Focus | Key Milestones | Status |
|-------|-------|------------------|--------|
| 0 · Foundation | Accuracy & pilots | Detection validation, pilot fleet | Not started |
| 1 · Earbuds | Head & heart signals | Head-nod detection, directional alerts | Partial (audio routing and local motion diagnostics implemented; calibration and directional alerts open) |
| 2 · Smartwatch | Biometric pre-screening | Pre-drive risk score | Partial (wrist alerts done; local read-only Apple Health context implemented in source) |
| 3 · Fusion + Fleet | Multi-signal model | Unified confidence engine | Partial (protected fleet session history implemented in source; fusion not started) |
| 4 · Smart Glasses | Ambient + eye tracking | Inward eye-tracking | Not started |
| Platform | Native apps | iOS app, real-time sensor access | Private iOS pilot |

For the current detailed gap list and near/mid/long-term breakdown, see issue #6.

Built by Richard Pacheco — San Francisco, CA
Occulert™ · Safety should be accessible.
