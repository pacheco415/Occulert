# Occulert development roadmap

Use [Status](STATUS.md) for dated source, website, TestFlight, open pull request
and migration facts. This roadmap defines product scope and evidence gates.
[The September 28 archive](archive/APP_ROADMAP_2026-09-28.md) preserves earlier
release receipts, build-52 device reports and testing deferrals.

## Status definitions

- **Shipped web:** merged and production-verified website behavior. This does
  not establish real-fleet usefulness or detection accuracy.
- **Private native release:** distribution for an exact TestFlight build.
  Availability does not establish installation or physical-device acceptance.
  A source merge does not update an installed binary.
- **Implemented source:** checked-in code awaiting deployment or device checks.
- **Validating:** a physical-device, production, pilot or labeled-data gap
  remains. Source tests cannot close those gaps.
- **Future:** proposed capability without an implementation or delivery claim.

## Product contracts

| Capability | Recorded baseline | Practical boundary |
|---|---|---|
| Browser monitoring and PWA | Shipped web | Foreground camera processing, local eye/fatigue estimates, sensitivity, alerts and History. Foreground loss stops monitoring. No camera video upload. Browser and audio-route behavior require device checks. |
| [Compact browser driver view](COMPACT_DRIVER_VIEW.md) | Implemented source | Narrow and short viewports keep camera, Stop and scrollable full status separate. Keyboard and recovery checks use software adapters; physical-device acceptance and multitasking camera access remain separate evidence gates. |
| [Compact native monitoring screen](NATIVE_COMPACT_MONITOR.md) | Implemented source | Start/Stop is separate from scrolling warnings, setup and metrics. Camera identity and alert continuity have software checks; exact-build, physical layout, VoiceOver and camera/audio acceptance remain required. |
| Fleet identity and consent | Shipped web | Verified identity, hashed one-time invitations, deliberate cloud consent and owner-scoped reports. Local demo data stays separate. |
| Manager reporting and follow-ups | Shipped web | Recent summaries select the latest 50 protected sessions. The separate 7/30-day period report depends on its migration and includes all stored sessions in its selected period. Telemetry is an unverified client report. |
| Older fleet History | Released source | Filters, sorting, CSV and print cover loaded records. They do not search unloaded records or broaden the recent-summary snapshot. |
| Fleet TV and launch checklist | Shipped web | Read-only aggregate TV view excludes names, vehicles, locations, individual scores and raw events. Record-derived milestones do not certify offline tasks or fitness to drive. |
| Managed early access and billing | Published qualification pages; billing prepared in test mode | Proposed prices do not activate subscriptions, automatic renewals or entitlement enforcement. Commercial terms and legal review precede paid activation. |
| iPhone and Apple Watch | Private native releases, identified in Status | Native uses ML Kit; browser uses MediaPipe. Validate camera, Watch delivery, audio routes, History migration and recovery on the exact binary. Earlier device results stay with their tested build. |
| Local History identity and privacy | Released source | Validate the entire stored array before rewriting it; persist missing IDs before exposing them. Ambiguous keyed edits fail closed. Valid zero stays distinct from missing values. Local deletion does not delete cloud records. Local IDs confer no cloud authority. |
| Sensor-fusion observations | Local observation only | Candidate camera/headphone counts and optional Watch coverage do not affect cloud telemetry, feedback exports, scores or alerts. Accessories are optional. |

## Current backlog

1. Keep reviewed source changes and required checks green on each pull request
   and resulting main. Preserve immutable asset bytes; compose any overlapping
   browser changes from the active release.
2. Use the prepared [October 29 native handoff](RELEASE_2026-10-29.md) for source
   and checklist details. An authorized build/submission and exact-build
   physical acceptance remain separate from the completed source preparation.
3. Keep alert retries and fleet offboarding off by default. Verify each
   deployment prerequisite before activation; keep production operational
   receipts private. Fleet offboarding remains a separate owner decision,
   including the draft's proposed consequence that ongoing sessions retain their original fleet
   attribution after membership removal.
4. Preserve fresh server identity checks and account/consent boundaries as
   remaining work is composed. Source tests do not replace a genuine signed-in
   fleet walkthrough or physical Safari/PWA acceptance.
5. Collect authorized, independently labeled parked data with the existing
   observer and replay tooling before evaluating detector changes. Default-off
   experiment code and synthetic tests do not support threshold promotion.
6. Consider additional registered-source coverage, schema consolidation or
   other maintenance when the active task selects it and a current-source
   review identifies a remaining need. The driver source modules, shared event
   engine, native History components and monitor extraction already exist;
   inspect and extend them rather than repeating those refactors.

## Remaining evidence and later work

[Future capability proposals](VISION_ROADMAP.md) collect possible Watch, spoken-cue,
contact, road-camera, commercial and platform work. They require separate task
selection and the gates below. Indexing that plan does not authorize changes to
released alerts, detection thresholds, timing, data collection or messaging.

The [verified 2026–2028 device roadmap](DEVICE_ROADMAP_2026_2028.md) expands the
phone, Watch, headphone and glasses plan with primary sources and explicit
access/acceptance gates. Its planning windows do not override the backlog or
release evidence rules here. Keep the phone product standalone; accessory
corroboration remains experimental until independently validated.

- **Physical acceptance:** parked iPhone Silent-mode Safari/PWA alerts, Watch
  delay and Focus/permissions, audio routes, install-over-existing History,
  cloud retries, interruptions, accessibility, battery and heat. Genuine
  signed-in fleet and Safari/PWA offline checks remain separate.
- **Pilot:** qualify one willing fleet owner and up to five voluntary drivers;
  confirm consent, support and stop rules. Review missing data and voluntary
  false/missed/late-alert feedback at days 7 and 30. Counts do not establish
  accuracy or crash prevention. Outreach requires authorized recipients.
- **Detection:** obtain authorized independently labeled data with frozen
  participant-separated splits, provenance and slices. See the [accuracy
  benchmark](ACCURACY_BENCHMARK.md) and [event benchmark](EVENT_BENCHMARK.md).
  Compare camera baseline before tuning or integrating accessory confidence.
- **Commercial decisions:** pricing, final legal terms, hosting plan and live
  billing activation remain distinct from source preparation.
- **Later platforms:** Android device acceptance, Watch complications, native
  tvOS and additional health/accessory signals need demand and platform proof.
  Dual-camera diagnostics do not establish road-hazard detection.

## Release and evidence rules

Follow [AGENTS.md](../AGENTS.md), [RELEASING.md](../RELEASING.md) and
[backend setup](../BACKEND_SETUP.md). Review the full diff and repair findings
before advancing the authorized release workflow. Record Preview, merged
source, production, installed binary, and device evidence separately. Required
checks must pass on the pull request and resulting main. Apply migrations
before deploying dependent code. Keep explicit observation dates in Status;
the status tool reads Git and supplied snapshots without contacting services.

Occulert may miss drowsiness or produce false alerts. It cannot guarantee alert
delivery, crash prevention, alertness, emergency response or compliance. Setup
and interaction happen while safely parked or by a passenger. Feeling tired
means pull over safely and rest, regardless of any score or alert.
