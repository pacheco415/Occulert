# Occulert App Roadmap

This document outlines the full multi-phase development plan for Occulert — expanding from a browser-based PWA into a cross-platform native app with multi-device hardware integration.

★ = top-priority milestone for each phase

**Last updated: 2026-07-05** — statuses below reflect actual progress in the native-app build and web app. See AUDIT.md and issue #6 for the fuller near/mid/long-term gap list.

---

## Phase 0 · Foundation

**Goal:** Lock in accuracy, safety credibility, and an early real-world pilot before hardware expansion.

| Task | Priority | Status |
|------|----------|--------|
| Validate detection accuracy against ground-truth drowsiness data | ★ | Not started |
| Add user-controlled sensitivity slider (low / medium / high) | — | Done |
| Audit background reliability (screen-off, app-backgrounded) | — | Partial |
| Land a pilot fleet (rideshare, delivery, or trucking partner) | ★ | Not started |
| Tighten safety disclaimers and credibility documentation | — | Done |

---

## Phase 1 · Earbuds

**Goal:** Use paired Bluetooth earbuds as a low-friction wearable input and alert layer.

| Task | Priority | Status |
|------|----------|--------|
| Head-nod / head-drop detection via earbud accelerometer | ★ | Not started |
| In-ear heart rate and HRV monitoring (where supported) | — | Not started |
| Directional in-ear audio alerts (left/right/stereo cues) | ★ | Not started |
| Auto-detect paired earbuds and graceful fallback to phone speaker | — | Done |

Note: AirPods audio routing shipped in native-app (PR #2), covering auto-detect/fallback; head-nod detection and directional cues are still open.

---

## Phase 2 · Smartwatch

**Goal:** Pull biometric data from the wrist and surface pre-drive risk scoring.

| Task | Priority | Status |
|------|----------|--------|
| Pull HRV and sleep data from Apple Health / Google Fit | — | Not started |
| Pre-drive fatigue risk score shown before each trip | ★ | Not started |
| Wrist haptic alert when fatigue threshold is crossed | — | Partial |
| Watch-face widget showing live safety score | — | Not started |

Note: a basic Apple Watch alert bridge shipped via react-native-watch-connectivity (native-app PR #2); the full watchOS companion app is tracked in issue #3.

---

## Phase 3 · Fusion + Fleet

**Goal:** Combine all sensor streams into one confidence model and scale to fleets.

| Task | Priority | Status |
|------|----------|--------|
| Unified confidence model fusing camera + earbud + watch signals | ★ | Not started |
| Device-agnostic engine (works with any combination of devices) | — | Not started |
| Fleet dashboard with per-driver device and signal data | — | Prototype (localStorage-based; see BACKEND_ROADMAP.md) |
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
| Native iOS app (Swift / React Native) | ★ | In progress (native-app/, Expo + EAS build) |
| Native Android app | — | Not started |
| Keep PWA as lightweight onboarding funnel | — | Done |
| Verify real-time sensor access per platform (camera, motion, BT) | ★ | Partial (camera via vision-camera + ML Kit shipped; motion/BT partial) |
| Preserve and enforce privacy-first promise across all platforms | — | Ongoing |

---

## Milestone Summary

| Phase | Focus | Key Milestones | Status |
|-------|-------|------------------|--------|
| 0 · Foundation | Accuracy & pilots | Detection validation, pilot fleet | Not started |
| 1 · Earbuds | Head & heart signals | Head-nod detection, directional alerts | Partial (audio routing done) |
| 2 · Smartwatch | Biometric pre-screening | Pre-drive risk score | Partial (basic alert bridge done) |
| 3 · Fusion + Fleet | Multi-signal model | Unified confidence engine | Not started |
| 4 · Smart Glasses | Ambient + eye tracking | Inward eye-tracking | Not started |
| Platform | Native apps | iOS app, real-time sensor access | In progress |

For the current detailed gap list and near/mid/long-term breakdown, see issue #6.

Built by Richard Pacheco — San Francisco, CA
Occulert™ · Safety should be accessible.
