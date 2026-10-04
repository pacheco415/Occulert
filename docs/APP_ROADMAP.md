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
| Fleet identity and consent | Shipped web | Verified identity, hashed one-time invitations, deliberate cloud consent and owner-scoped reports. Local demo data stays separate. |
| Manager reporting and follow-ups | Shipped web | Recent summaries select the latest 50 protected sessions. The separate 7/30-day period report depends on its migration and includes all stored sessions in its selected period. Telemetry is an unverified client report. |
| Older fleet History | Released source | Filters, sorting, CSV and print cover loaded records. They do not search unloaded records or broaden the recent-summary snapshot. |
| Fleet TV and launch checklist | Shipped web | Read-only aggregate TV view excludes names, vehicles, locations, individual scores and raw events. Record-derived milestones do not certify offline tasks or fitness to drive. |
| Managed early access and billing | Published qualification pages; billing prepared in test mode | Proposed prices do not activate subscriptions, automatic renewals or entitlement enforcement. Commercial terms and legal review precede paid activation. |
| iPhone and Apple Watch | Private native releases, identified in Status | Native uses ML Kit; browser uses MediaPipe. Validate camera, Watch delivery, audio routes, History migration and recovery on the exact binary. Earlier device results stay with their tested build. |
| Local History identity and privacy | Released source | Validate the entire stored array before rewriting it; persist missing IDs before exposing them. Ambiguous keyed edits fail closed. Valid zero stays distinct from missing values. Local deletion does not delete cloud records. Local IDs confer no cloud authority. |
| Sensor-fusion observations | Local observation only | Candidate camera/headphone counts and optional Watch coverage do not affect cloud telemetry, feedback exports, scores or alerts. Accessories are optional. |

## Current backlog

1. Finish current-source checks, then merge the remaining reviewed
   pull requests sequentially against current main. Preserve immutable asset
   bytes and compose overlapping browser changes from the active release.
2. Complete native release notes and the device checklist for the inspected
   source. Build and device acceptance are separate steps.
3. Verify the production migration ledger and deployed definitions before
   activating event quotas, fleet offboarding or schema consolidation.
4. Review security and consent composition as the remaining branches merge.
   Keep the external-script CSP policy and fresh server identity checks
   for sensitive account and fleet changes and preserve consent boundaries.
5. Benchmark detector experiments under safe parked conditions with flags
   off by default. Do not change released alerts without supporting evidence.
6. After the pull request backlog falls below five, introduce reviewed source
   files and release output, modularize the driver app, consolidate schema
   history, share identical styling and extract native History components.

## Remaining evidence and later work

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
