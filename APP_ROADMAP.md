# Occulert App Roadmap

This document outlines the full multi-phase development plan for Occulert — expanding from a browser-based PWA into a cross-platform native app with multi-device hardware integration.

> ★ = top-priority milestone for each phase

---

## Phase 0 · Foundation

**Goal:** Lock in accuracy, safety credibility, and an early real-world pilot before hardware expansion.

| Task | Priority |
|------|----------|
| Validate detection accuracy against ground-truth drowsiness data | ★ |
| Add user-controlled sensitivity slider (low / medium / high) | — |
| Audit background reliability (screen-off, app-backgrounded) | — |
| Land a pilot fleet (rideshare, delivery, or trucking partner) | ★ |
| Tighten safety disclaimers and credibility documentation | — |

---

## Phase 1 · Earbuds

**Goal:** Use paired Bluetooth earbuds as a low-friction wearable input and alert layer.

| Task | Priority |
|------|----------|
| Head-nod / head-drop detection via earbud accelerometer | ★ |
| In-ear heart rate and HRV monitoring (where supported) | — |
| Directional in-ear audio alerts (left/right/stereo cues) | ★ |
| Auto-detect paired earbuds and graceful fallback to phone speaker | — |

---

## Phase 2 · Smartwatch

**Goal:** Pull biometric data from the wrist and surface pre-drive risk scoring.

| Task | Priority |
|------|----------|
| Pull HRV and sleep data from Apple Health / Google Fit | — |
| Pre-drive fatigue risk score shown before each trip | ★ |
| Wrist haptic alert when fatigue threshold is crossed | — |
| Watch-face widget showing live safety score | — |

---

## Phase 3 · Fusion + Fleet

**Goal:** Combine all sensor streams into one confidence model and scale to fleets.

| Task | Priority |
|------|----------|
| Unified confidence model fusing camera + earbud + watch signals | ★ |
| Device-agnostic engine (works with any combination of devices) | — |
| Fleet dashboard with per-driver device and signal data | — |
| Tiered pricing model for fleet operators | — |

---

## Phase 4 · Smart Glasses

**Goal:** Add ambient audio alerts and inward eye-tracking via smart glasses.

| Task | Priority |
|------|----------|
| Open-ear audio alerts via glasses speaker (Ray-Ban Meta, etc.) | — |
| Inward eye-tracking integration (gaze, blink rate, saccades) | ★ |
| Evaluate and track smart glasses SDKs (Meta, Snap, others) | — |

---

## ⚙ Platform

**Goal:** Deliver native apps while keeping the PWA as the top-of-funnel entry point.

| Task | Priority |
|------|----------|
| Native iOS app (Swift / React Native) | ★ |
| Native Android app | — |
| Keep PWA as lightweight onboarding funnel | — |
| Verify real-time sensor access per platform (camera, motion, BT) | ★ |
| Preserve and enforce privacy-first promise across all platforms | — |

---

## Milestone Summary

| Phase | Focus | Key ★ Milestones |
|-------|-------|-----------------|
| 0 · Foundation | Accuracy & pilots | Detection validation, pilot fleet |
| 1 · Earbuds | Head & heart signals | Head-nod detection, directional alerts |
| 2 · Smartwatch | Biometric pre-screening | Pre-drive risk score |
| 3 · Fusion + Fleet | Multi-signal model | Unified confidence engine |
| 4 · Smart Glasses | Ambient + eye tracking | Inward eye-tracking |
| Platform | Native apps | iOS app, real-time sensor access |

---

*Built by Richard Pacheco — San Francisco, CA*
*Occulert™ · Safety should be accessible.*
