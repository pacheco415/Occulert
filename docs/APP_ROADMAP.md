# Occulert development roadmap

Status recorded September 25, 2026. This is the authoritative product roadmap.
Backend, detection, performance, and pilot documents explain specific contracts
and evidence procedures. Older audit and release notes describe their dated
state; they are not the current feature backlog.

## Status definitions

- **Shipped web:** merged and production-verified website behavior. This does
  not establish real-fleet usefulness or detection accuracy.
- **Private native baseline:** a particular installed TestFlight build with
  recorded device feedback. A source merge does not update that binary.
- **Implemented source:** checked-in code awaiting release or device checks.
  **In development** also means review and tests remain unfinished.
- **Validating:** a physical-device, production, pilot, or labeled-data evidence
  gap remains. Source tests cannot close those gaps.
- **Future:** proposed capability without an implementation or delivery claim.

Production web baseline includes TV display `568cdc3` (PR #136) and pilot
launch checklist `f67b260` (PR #137). Quick start at `bcd73a3` is on
`feat/pilot-quick-start-center` and is unmerged. New branch work remains source
work until its release and production verification are recorded here.

## Shipped and private baseline

| Capability | Recorded status | Practical boundary |
|---|---|---|
| Browser monitoring and PWA | Shipped web | Foreground camera processing, eye/fatigue estimates, sensitivity, phone alerts, local history. Foreground loss stops monitoring; no camera video upload. Browser/accessory behavior varies. |
| Fleet identity and consent | Shipped web | Supabase Auth, fleet creation, hashed one-time invitations, explicit driver cloud consent, protected sessions and owner-scoped roster/history. Local demo data stays separate. |
| Manager reporting and follow-ups | Shipped web | Bounded 7/30-day summaries of the latest 50 protected sessions, privacy-limited CSV, per-session follow-up outcomes, adaptive polling, action queue. Metrics are unverified client reports. |
| Managed early-access offers | Shipped web pages and qualification | Card-free 30-day trial for up to five active drivers; introductory Starter/Growth comparison and rollout requests. No payment collection, automatic renewal, billing, or entitlement enforcement. |
| Fleet TV display | Shipped web, PR #136 | Authenticated read-only browser/AirPlay aggregate view. No names, vehicles, locations, individual scores, raw events, local fallback, or editing. Native tvOS remains future. |
| Pilot launch checklist | Shipped web, PR #137 | Setup, joined-driver, first-session, 7/30-day milestones derive from protected records. It cannot confirm offline tasks or fitness to drive. |
| iPhone and Apple Watch | Private TestFlight distribution; latest installed build not reconfirmed here | Recorded September 21 release evidence includes build-49 parked load/readiness feedback and build-50 submission/availability. It does not prove acceptance of later changes. Native uses ML Kit; browser uses MediaPipe. Build-36 evidence in the [dated audit](AUDIT.md) is historical. |

## Current source package

| Workstream | Source state | Next evidence |
|---|---|---|
| Manager-and-driver quick start | Implemented, unmerged at `bcd73a3` | Review parked setup, consent, alert response, TV privacy, and 7/30-day instructions; verify production after release. Reading progress is not tracked. |
| Printable manager report | Implemented source | Dedicated 7/30-day reports, print/Save PDF, privacy-limited exports, missing-score coverage, current saved per-session review counts, and protected/demo separation. Browser checks, authenticated Preview, then production; not shipped. |
| Fleet data quality | Implemented source | Explain unfinished sessions, missing values, history limits, and unverified telemetry. Protected summaries do not include interruption reasons; do not infer them. Verify source/privacy boundaries before release. |
| TV operating controls | Implemented source | 7/30-day selection, large text, connection/fullscreen details; verify keyboard/mobile, fullscreen failure, and signed-in privacy. No native TV build. |
| Pilot recruitment package | Prepared source documents; nothing sent | [One-page overview, qualification, unsent emails, 30-day plan](PILOT_OUTREACH.md). A real partner and voluntary participants remain external evidence. |
| Parked setup and reliability | Implemented native source | Exact-build camera guidance, fresh permission/readiness, foreground-loss stop, interruptions, 15-second checkpoints, explicitly partial recovery. See [device readiness](PARKED_DEVICE_READINESS.md). |
| Local History and privacy controls | Implemented native source | Install-over-existing-data, save/read failures, aggregate sharing, confirmed individual/all-history deletion, recovery safeguards. Local deletion does not delete cloud records. |
| Alerts, Watch, accessibility | Implemented native source beyond the private baseline | Bounded phone/audio cues, optional directional earbuds, Watch status/haptics/notifications, larger text, VoiceOver, Reduce Motion/Transparency. Retest speaker, headphones, car audio, Watch. |
| Runtime and fleet performance | Implemented source; web portions released | Preserve analysis cadence/preferences; measure battery/heat/camera timing on device and signed-in API latency. [Performance Roadmap](PERFORMANCE_ROADMAP.md) contains targets, not measured claims. |
| Sensor-fusion observations | Implemented source, observation only | Camera/headphone candidate counts, optional Watch availability, bounded co-occurrences, validation coverage, next-session planning. No raw timeline, cloud sync, export, feedback inclusion, score or alert changes. Accessories optional. |

## Validating

1. **Native acceptance:** freeze the package before using the remaining reserved
   native build. Queueing/submission need final authorization; none is queued
   by this documentation work. Record model, OS, exact build, setup, routing,
   interruptions, accessibility, battery, and heat. Earlier TestFlight feedback
   is evidence for its specific build, not a pass for subsequent changes.
2. **Pilot readiness and recruitment:** qualify one fleet owner and up to five
   willing drivers. Confirm parked setup, cloud consent, ownership, support,
   and stop/escalation rules. Outreach remains unsent; authorize recipients and
   messages before sending.
3. **Pilot operation:** review participation, incomplete/missing records, setup
   friction, and voluntary false/missed/late-alert observations at days 7 and
   30. Latest-50-session history can truncate a window. Counts describe this
   pilot; they do not establish accuracy or crash prevention.
4. **Labeled benchmark:** obtain authorized data, extract compatible EAR,
   freeze participant-separated splits, record provenance and slices. The
   runner validates frame-level EAR only; full-pipeline evaluation and
   prospective evidence are separate. See [Accuracy Benchmark](ACCURACY_BENCHMARK.md).
5. **Fusion validation:** collect independent signals under safe parked or
   passenger conditions, exclude recovered partial sessions, and never stage
   fatigue on the road. Calibrate/validate accessories before a confidence
   model or scoring integration.

## Future, ordered by evidence

| Priority | Capability | Required evidence or decision |
|---|---|---|
| Next | Detection tuning | Reviewed Medium sessions with varied conditions and reproducible benchmark evidence. Observation counts alone cannot justify threshold changes or public accuracy claims. |
| After pilot | Longer history, pagination, retention, aggregates, realtime subscriptions | Observed scale or demonstrated bottleneck, with permissions/deletion/query behavior defined. Protected fleet updates currently use polling. |
| After pilot | Billing and enforced entitlements | Agreed commercial terms and explicit activation. Published plans do not activate subscriptions. |
| After independent validation | Camera/headphone/Watch confidence fusion, pre-drive scoring | Calibration, ground truth, privacy review, value over camera baseline. Health context remains local/read-only information. |
| Later | Watch complication, Android app/health, device-agnostic engine | Proven need and platform implementation/validation. Android source configuration is not a released Android app. |
| Later | Native tvOS | Browser/AirPlay pilot establishes demand beyond the existing web TV view. |
| Exploratory | Smart glasses, earbud heart-rate/HRV | Supported hardware/API evidence and a specific privacy-safe use case. No promised integration. |

## Release and evidence rules

Run repository verification, relevant responsive-browser coverage, and native
type/bundle checks for native changes. Review the full diff and repair findings
before advancing the authorized release workflow. Record Preview, merged
source, production, installed binary, and device evidence separately. Existing
session authorization governs current work; this document does not require
repeated approval for approved source changes. External sending, payment
activation, and the reserved native build remain distinct actions.

Occulert may miss drowsiness or produce false alerts. It cannot guarantee alert
delivery, crash prevention, alertness, emergency response, or compliance. Setup
and interaction happen while safely parked or by a passenger. Feeling tired
means pull over safely and rest, regardless of any score or alert.
